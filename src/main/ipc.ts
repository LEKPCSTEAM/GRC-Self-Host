import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { Channel, IpcContract } from '../shared/ipc';
import type { Connection, Preset } from '../shared/types';
import * as db from './db';
import * as gh from './github';
import { applyLaunchAtLogin } from './login';
import { readDiag } from './runner/logs';
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

  // ---------------------------------------------------------- settings

  handle('settings:get', () => db.load().settings);

  handle('settings:update', async (patch) => {
    const before = db.load().settings;
    await db.update((d) => {
      d.settings = { ...d.settings, ...patch };
    });
    const after = db.load().settings;
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
    if (used)
      throw new Error(
        `${used} runner(s) still use this connection. Remove them first.`,
      );
    await db.update((d) => {
      d.connections = d.connections.filter((c) => c.id !== id);
      d.presets = d.presets.filter((p) => p.connectionId !== id);
    });
    gh.forgetClient(id);
  });

  handle('connections:targets', (id) => gh.listTargets(id));
  handle('connections:runnerGroups', (id, org) => gh.listRunnerGroups(id, org));

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
  handle('runners:create', (req) => manager.create(req));
  handle('runners:bulk', (ids, action) => manager.bulk(ids, action));
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
  handle('runners:removeForeign', (connectionId, target, githubId) =>
    manager.removeForeign(connectionId, target, githubId),
  );
  handle('runners:openFolder', async (id) => {
    const err = await shell.openPath(db.getRunner(id).dir);
    if (err) throw new Error(err);
  });

  handle('logs:read', async (id, kind, file, offset) => {
    if (kind === 'console') {
      return { files: [], file: null, ...manager.consoleOf(id, offset) };
    }
    return readDiag(db.getRunner(id).dir, kind, file, offset);
  });
}
