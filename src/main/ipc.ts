import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from 'electron';
import type { Channel, IpcContract } from '../shared/ipc';
import type { Connection, Preset } from '../shared/types';
import * as db from './db';
import * as backup from './backup';
import * as gh from './github';
import * as journal from './journal';
import { applyLaunchAtLogin } from './login';
import { readDiag } from './runner/logs';
import * as versions from './runner/versions';
import * as disk from './runner/disk';
import * as support from './support';
import * as appRelease from './app-release';
import * as maintenance from './maintenance';
import * as multi from './multi';
import * as importRunner from './import-runner';
import * as manager from './runner/manager';
import { seal, storageWarning } from './secrets';

function handle<C extends Channel>(
  channel: C,
  fn: (
    ...args: Parameters<IpcContract[C]>
  ) => ReturnType<IpcContract[C]> | Promise<ReturnType<IpcContract[C]>>,
) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as Parameters<IpcContract[C]>));
    } catch (err) {
      // Octokit errors carry a status; give the renderer a readable message.
      if ((err as { status?: number }).status)
        throw new Error(gh.describeError(err));
      throw err;
    }
  });
}

const publicConnection = ({
  id,
  name,
  login,
  createdAt,
}: db.ConnectionRecord): Connection => ({
  id,
  name,
  login,
  createdAt,
});

export function registerIpc() {
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    dbPath: db.dbPath(),
  }));
  handle('app:release', () => appRelease.latest());
  handle('app:openRelease', () => appRelease.openDownload());

  // ---------------------------------------------------------- settings

  handle('settings:get', () => db.load().settings);

  handle('settings:update', async (patch) => {
    const before = db.load().settings;
    await db.update((d) => {
      d.settings = { ...d.settings, ...patch };
    });
    const after = db.load().settings;
    nativeTheme.themeSource = after.theme ?? 'system';
    if (after.launchAtLogin !== before.launchAtLogin)
      applyLaunchAtLogin(after.launchAtLogin);
    if (after.invariantCulture !== before.invariantCulture)
      await manager.applyEnvToAll();
    return after;
  });

  handle('settings:chooseRootDir', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose runner root folder',
      defaultPath: db.load().settings.rootDir,
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  handle('backup:export', () => backup.exportMetadata());
  handle('backup:preview', () => backup.previewRestore());
  handle('backup:restore', async (id) => {
    const before = db.load().settings;
    const result = await backup.restore(id);
    const after = db.load().settings;
    if (before.launchAtLogin !== after.launchAtLogin)
      applyLaunchAtLogin(after.launchAtLogin);
    if (before.invariantCulture !== after.invariantCulture)
      await manager.applyEnvToAll();
    manager.refreshNow();
    return result;
  });

  // ---------------------------------------------------------- connections

  handle('connections:list', () => db.load().connections.map(publicConnection));

  handle('connections:storageWarning', () => storageWarning());

  handle('connections:add', async (name, token) => {
    token = token.trim();
    if (!token) throw new Error('Enter a token');
    const login = await gh.whoAmI(token);
    const rec: db.ConnectionRecord = {
      id: randomUUID(),
      name: name.trim() || login,
      login,
      createdAt: new Date().toISOString(),
      ...seal(token),
    };
    await db.update((d) => d.connections.push(rec));
    return publicConnection(rec);
  });

  handle('connections:update', async (id, patch) => {
    const token = patch.token?.trim();
    const login = token ? await gh.whoAmI(token) : undefined;
    await db.update((d) => {
      const c = d.connections.find((x) => x.id === id);
      if (!c) throw new Error('Connection not found');
      if (patch.name?.trim()) c.name = patch.name.trim();
      if (token && login) Object.assign(c, { login }, seal(token));
    });
    if (token) {
      gh.forgetClient(id);
      manager.refreshNow();
    }
    return publicConnection(db.load().connections.find((x) => x.id === id)!);
  });

  handle('connections:remove', async (id) => {
    const used = db.load().runners.filter((r) => r.connectionId === id).length;
    const watched = db
      .load()
      .watchedTargets.filter((w) => w.connectionId === id).length;
    if (used)
      throw new Error(
        `${used} runner(s) still use this connection. Remove them first.`,
      );
    if (watched)
      throw new Error(
        `${watched} watched target(s) still use this connection. Remove them first.`,
      );
    await db.update((d) => {
      d.connections = d.connections.filter((c) => c.id !== id);
      d.presets = d.presets.filter((p) => p.connectionId !== id);
    });
    gh.forgetClient(id);
  });

  handle('connections:targets', (id) => gh.listTargets(id));
  handle('connections:runnerGroups', (id, org) => gh.listRunnerGroups(id, org));
  handle('watch:list', () => manager.snapshot().watched);
  handle('watch:add', async (connectionId, target) => {
    if (!db.load().connections.some((c) => c.id === connectionId))
      throw new Error('Connection not found');
    if (!target.owner.trim() || (target.kind === 'repo' && !target.repo.trim()))
      throw new Error('Enter a valid target');
    if (
      db
        .load()
        .watchedTargets.some(
          (w) =>
            w.connectionId === connectionId && gh.sameTarget(w.target, target),
        )
    )
      throw new Error('Target is already watched');
    const watch = { id: randomUUID(), connectionId, target };
    await db.update((d) => d.watchedTargets.push(watch));
    manager.refreshNow();
    return watch;
  });
  handle('watch:remove', async (id) => {
    await db.update((d) => {
      d.watchedTargets = d.watchedTargets.filter((w) => w.id !== id);
    });
    manager.refreshNow();
  });
  handle('connections:repoVisibility', (id, owner, repo) =>
    gh.repoVisibility(id, owner, repo),
  );

  // ---------------------------------------------------------- presets

  handle('presets:list', () => db.load().presets);

  handle('presets:save', async (preset) => {
    const saved: Preset = { ...preset, id: preset.id ?? randomUUID() };
    await db.update((d) => {
      const i = d.presets.findIndex((p) => p.id === saved.id);
      if (i >= 0) d.presets[i] = saved;
      else d.presets.push(saved);
    });
    return saved;
  });

  handle('presets:remove', async (id) => {
    await db.update((d) => {
      d.presets = d.presets.filter((p) => p.id !== id);
    });
  });

  // ---------------------------------------------------------- runners

  handle('runners:snapshot', () => manager.snapshot());
  handle('history:list', () => journal.list());
  handle('history:clearState', () => journal.clearState());
  handle('versions:check', () => versions.check());
  handle('disk:report', () => disk.report());
  handle('support:preview', (days) => support.preview(days));
  handle('support:export', (id) => support.exportBundle(id));
  handle('jobs:list', (runnerId) => gh.recentJobs(runnerId));
  handle('jobs:open', (jobId) => gh.openJob(jobId));
  handle('maintenance:list', () => maintenance.list());
  handle('maintenance:schedule', (action, ids, runAt, skipBusy) =>
    maintenance.schedule(action, ids, runAt, skipBusy),
  );
  handle('maintenance:cancel', (id) => maintenance.cancel(id));
  handle('multi:preview', (presetId, targets) =>
    multi.preview(presetId, targets),
  );
  handle('multi:create', (presetId, preview, acknowledged, password) =>
    multi.create(presetId, preview, acknowledged, password),
  );
  handle('import:chooseDir', () => importRunner.chooseDir());
  handle('import:preview', (connectionId, target, dir) =>
    importRunner.preview(connectionId, target, dir),
  );
  handle('import:commit', (id) => importRunner.commit(id));
  handle('runners:create', (req) => manager.create(req));
  handle('runners:previewCreate', (req) => manager.previewCreate(req));
  handle('runners:preflight', (req) => manager.preflight(req));
  handle('runners:bulk', (ids, action, skipBusy) =>
    manager.bulk(ids, action, skipBusy),
  );
  handle('runners:stopAfterJob', (id, enabled) =>
    manager.setStopAfterJob(id, enabled),
  );
  handle('runners:remove', (ids) => manager.remove(ids));
  handle('runners:repair', (id, password) => manager.repair(id, password));
  handle('runners:forget', (id) => manager.forget(id));
  handle('runners:setMode', (id, mode, account, password) =>
    manager.setMode(id, mode, account, password),
  );
  handle('runners:setLabels', (ids, add, remove) =>
    manager.setLabels(ids, add, remove),
  );
  handle('runners:setOptions', (id, patch) => manager.setOptions(id, patch));
  handle('runners:setOptionsBulk', (ids, patch) =>
    manager.setOptionsBulk(ids, patch),
  );
  handle('runners:removeForeign', (connectionId, target, githubId) =>
    manager.removeForeign(connectionId, target, githubId),
  );
  handle('runners:openFolder', async (id) => {
    const err = await shell.openPath(db.getRunner(id).dir);
    if (err) throw new Error(err);
  });
  handle('runners:openGithub', async (id, destination) => {
    const runner = db.getRunner(id);
    const target =
      runner.target.kind === 'repo'
        ? `https://github.com/${encodeURIComponent(runner.target.owner)}/${encodeURIComponent(runner.target.repo)}`
        : `https://github.com/${encodeURIComponent(runner.target.owner)}`;
    const url =
      destination === 'runner' && runner.githubId
        ? runner.target.kind === 'org'
          ? `https://github.com/organizations/${encodeURIComponent(runner.target.owner)}/settings/actions/runners/${runner.githubId}`
          : `${target}/settings/actions/runners/${runner.githubId}`
        : target;
    await shell.openExternal(url);
  });

  handle('logs:read', async (id, kind, file, offset) => {
    if (kind === 'console') {
      return { files: [], file: null, ...manager.consoleOf(id, offset) };
    }
    return readDiag(db.getRunner(id).dir, kind, file, offset);
  });
}
