import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type {
  Connection,
  Preset,
  RestorePreview,
  RestoreResult,
  RunnerRecord,
  Settings,
  WatchTarget,
} from '../shared/types';
import * as db from './db';

interface BackupData {
  format: 'grc-metadata';
  version: 1;
  exportedAt: string;
  settings: Settings;
  connections: Connection[];
  presets: Preset[];
  runners: RunnerRecord[];
  watchedTargets?: Pick<WatchTarget, 'id' | 'connectionId' | 'target'>[];
}

let pending: { id: string; file: string; data: BackupData } | undefined;

function chooseWindow() {
  return BrowserWindow.getFocusedWindow();
}

function safeExport(): BackupData {
  const data = db.load();
  return {
    format: 'grc-metadata',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      rootDir: data.settings.rootDir,
      diagRetentionDays: data.settings.diagRetentionDays,
      notifications: data.settings.notifications,
      launchAtLogin: data.settings.launchAtLogin,
      invariantCulture: data.settings.invariantCulture,
      language: data.settings.language,
      theme: data.settings.theme,
      quietHours: data.settings.quietHours,
    },
    connections: data.connections.map(({ id, name, login, createdAt }) => ({
      id,
      name,
      login,
      createdAt,
    })),
    presets: data.presets.map((p) => ({
      id: p.id,
      name: p.name,
      connectionId: p.connectionId,
      target: p.target,
      count: p.count,
      prefix: p.prefix,
      labels: p.labels,
      runnerGroup: p.runnerGroup,
      mode: p.mode,
      autostart: p.autostart,
      cleanup: p.cleanup,
      serviceAccount: p.serviceAccount,
    })),
    runners: data.runners.map((r) => ({
      id: r.id,
      name: r.name,
      connectionId: r.connectionId,
      target: r.target,
      dir: r.dir,
      mode: r.mode,
      labels: r.labels,
      runnerGroup: r.runnerGroup,
      autostart: false,
      cleanup: r.cleanup,
      serviceAccount: r.serviceAccount,
      githubId: r.githubId,
      version: r.version,
      createdAt: r.createdAt,
    })),
    watchedTargets: data.watchedTargets.map((w) => ({
      id: w.id,
      connectionId: w.connectionId,
      target: w.target,
    })),
  };
}

export async function exportMetadata(): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    title: 'Export GRC metadata',
    defaultPath: `grc-metadata-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const win = chooseWindow();
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await fs.promises
    .writeFile(result.filePath, JSON.stringify(safeExport(), null, 2), {
      flag: 'wx',
    })
    .catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
      await fs.promises.writeFile(
        result.filePath!,
        JSON.stringify(safeExport(), null, 2),
      );
    });
  return result.filePath;
}

function hasSecretKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSecretKey);
  return Object.entries(value).some(
    ([key, child]) => /token|password|secret/i.test(key) || hasSecretKey(child),
  );
}

function isTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.owner === 'string' &&
    t.owner.length > 0 &&
    (t.kind === 'org' ||
      (t.kind === 'repo' && typeof t.repo === 'string' && t.repo.length > 0))
  );
}

function isCleanup(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.enabled === 'boolean' &&
    typeof c.actions === 'boolean' &&
    typeof c.tool === 'boolean'
  );
}

function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.rootDir === 'string' &&
    path.isAbsolute(s.rootDir) &&
    typeof s.diagRetentionDays === 'number' &&
    Number.isInteger(s.diagRetentionDays) &&
    s.diagRetentionDays >= 1 &&
    typeof s.notifications === 'boolean' &&
    typeof s.launchAtLogin === 'boolean' &&
    typeof s.invariantCulture === 'boolean' &&
    (s.language === undefined || s.language === 'en' || s.language === 'th') &&
    (s.theme === undefined ||
      s.theme === 'system' ||
      s.theme === 'light' ||
      s.theme === 'dark') &&
    (s.quietHours === undefined ||
      (typeof s.quietHours === 'object' &&
        s.quietHours !== null &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(
          (s.quietHours as { start?: string }).start ?? '',
        ) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(
          (s.quietHours as { end?: string }).end ?? '',
        )))
  );
}

function parse(text: string): BackupData {
  if (text.length > 10_000_000) throw new Error('Backup file is too large');
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object')
    throw new Error('Invalid metadata backup');
  const b = raw as Record<string, unknown>;
  if (b.format !== 'grc-metadata' || b.version !== 1)
    throw new Error('Unsupported metadata backup version');
  if (hasSecretKey(b))
    throw new Error('Backup contains a token, password or secret field');
  if (
    !validSettings(b.settings) ||
    !Array.isArray(b.connections) ||
    !Array.isArray(b.presets) ||
    !Array.isArray(b.runners)
  )
    throw new Error('Backup is missing valid settings or metadata lists');
  for (const c of b.connections) {
    if (
      !c ||
      typeof c.id !== 'string' ||
      !c.id ||
      typeof c.name !== 'string' ||
      !c.name ||
      typeof c.login !== 'string' ||
      !c.login ||
      typeof c.createdAt !== 'string'
    )
      throw new Error('Backup contains an invalid connection');
  }
  for (const p of b.presets) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      !p.id ||
      typeof p.name !== 'string' ||
      !p.name ||
      typeof p.connectionId !== 'string' ||
      !isTarget(p.target) ||
      !Array.isArray(p.labels) ||
      !p.labels.every((x: unknown) => typeof x === 'string') ||
      !Number.isInteger(p.count) ||
      p.count < 1 ||
      p.count > 50 ||
      typeof p.prefix !== 'string' ||
      !/^[a-zA-Z0-9._-]{1,56}$/.test(p.prefix) ||
      (p.mode !== 'child' && p.mode !== 'service') ||
      typeof p.autostart !== 'boolean' ||
      !isCleanup(p.cleanup)
    )
      throw new Error('Backup contains an invalid preset');
  }
  for (const r of b.runners) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id ||
      typeof r.name !== 'string' ||
      !/^[a-zA-Z0-9._-]+$/.test(r.name) ||
      typeof r.connectionId !== 'string' ||
      typeof r.dir !== 'string' ||
      !path.isAbsolute(r.dir) ||
      !isTarget(r.target) ||
      (r.mode !== 'child' && r.mode !== 'service') ||
      !Array.isArray(r.labels) ||
      !r.labels.every((x: unknown) => typeof x === 'string') ||
      typeof r.autostart !== 'boolean' ||
      !isCleanup(r.cleanup) ||
      typeof r.createdAt !== 'string' ||
      (r.githubId !== undefined &&
        (!Number.isInteger(r.githubId) || r.githubId <= 0))
    )
      throw new Error('Backup contains invalid runner metadata');
  }
  if (b.watchedTargets !== undefined) {
    if (!Array.isArray(b.watchedTargets))
      throw new Error('Backup contains invalid watched targets');
    for (const w of b.watchedTargets) {
      if (
        !w ||
        typeof w.id !== 'string' ||
        !w.id ||
        typeof w.connectionId !== 'string' ||
        !isTarget(w.target)
      )
        throw new Error('Backup contains an invalid watched target');
    }
  }
  return b as unknown as BackupData;
}

function key(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function githubIdentity(r: RunnerRecord): string {
  const target =
    r.target.kind === 'repo'
      ? `${r.target.owner}/${r.target.repo}`
      : r.target.owner;
  return `${r.connectionId}:${r.target.kind}:${target.toLowerCase()}:${r.githubId}`;
}

function watchIdentity(
  w: Pick<WatchTarget, 'connectionId' | 'target'>,
): string {
  const target =
    w.target.kind === 'repo'
      ? `${w.target.owner}/${w.target.repo}`
      : w.target.owner;
  return `${w.connectionId}:${w.target.kind}:${target.toLowerCase()}`;
}

function plan(data: BackupData) {
  const current = db.load();
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(current.runners.map((r) => r.id));
  const names = new Set(current.runners.map((r) => key(r.name)));
  const dirs = new Set(current.runners.map((r) => key(path.resolve(r.dir))));
  const githubIds = new Set(
    current.runners.filter((r) => r.githubId).map(githubIdentity),
  );
  const connectionIds = new Set(current.connections.map((c) => c.id));
  const incompatibleConnections = new Set<string>();
  const connections = data.connections.filter((c) => {
    const existing = current.connections.find((x) => x.id === c.id);
    if (existing || connectionIds.has(c.id)) {
      conflicts.push(
        `Connection ${c.name}: ID already exists; existing token is kept`,
      );
      if (existing && existing.login.toLowerCase() !== c.login.toLowerCase())
        incompatibleConnections.add(c.id);
      return false;
    }
    connectionIds.add(c.id);
    return true;
  });
  const availableConnections = new Set([
    ...current.connections.map((c) => c.id),
    ...connections.map((c) => c.id),
  ]);
  const presetIds = new Set(current.presets.map((p) => p.id));
  const presetNames = new Set(current.presets.map((p) => key(p.name)));
  const presets = data.presets.filter((p) => {
    const reason = incompatibleConnections.has(p.connectionId)
      ? 'connection ID belongs to another login'
      : !availableConnections.has(p.connectionId)
        ? 'connection is missing'
        : presetIds.has(p.id)
          ? 'ID already exists'
          : presetNames.has(key(p.name))
            ? 'name already exists'
            : null;
    if (reason) {
      conflicts.push(`Preset ${p.name}: ${reason}`);
      return false;
    }
    presetIds.add(p.id);
    presetNames.add(key(p.name));
    return true;
  });
  const runners = data.runners.filter((r) => {
    const dir = path.resolve(r.dir);
    const ghId = r.githubId ? githubIdentity(r) : '';
    const reason = incompatibleConnections.has(r.connectionId)
      ? 'connection ID belongs to another login'
      : !availableConnections.has(r.connectionId)
        ? 'connection is missing'
        : ids.has(r.id)
          ? 'ID already exists'
          : names.has(key(r.name))
            ? 'name already exists'
            : dirs.has(key(dir))
              ? 'path already exists in the app'
              : ghId && githubIds.has(ghId)
                ? 'GitHub ID already exists'
                : path.basename(dir) !== r.name ||
                    path.basename(path.dirname(dir)) !== 'runners'
                  ? 'path does not match runner layout'
                  : !fs.existsSync(path.join(dir, '.runner'))
                    ? 'runner files are missing at the saved path'
                    : null;
    if (reason) {
      conflicts.push(`Runner ${r.name}: ${reason}`);
      return false;
    }
    ids.add(r.id);
    names.add(key(r.name));
    dirs.add(key(dir));
    if (ghId) githubIds.add(ghId);
    return true;
  });
  const watchIds = new Set(current.watchedTargets.map((w) => w.id));
  const watchKeys = new Set(current.watchedTargets.map(watchIdentity));
  const watchedTargets = (data.watchedTargets ?? []).filter((w) => {
    const identity = watchIdentity(w);
    const reason = incompatibleConnections.has(w.connectionId)
      ? 'connection ID belongs to another login'
      : !availableConnections.has(w.connectionId)
        ? 'connection is missing'
        : watchIds.has(w.id)
          ? 'ID already exists'
          : watchKeys.has(identity)
            ? 'target is already watched'
            : null;
    if (reason) {
      conflicts.push(`Watched target ${identity}: ${reason}`);
      return false;
    }
    watchIds.add(w.id);
    watchKeys.add(identity);
    return true;
  });
  if (connections.length)
    warnings.push(
      'Imported connections have no token. Reconnect them in Connections before using restored runners.',
    );
  if (runners.length)
    warnings.push(
      'Restored runners have autostart disabled until you review and reconnect them.',
    );
  return { connections, presets, runners, watchedTargets, conflicts, warnings };
}

export async function previewRestore(): Promise<RestorePreview | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose GRC metadata backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const win = chooseWindow();
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  const file = result.filePaths[0];
  const data = parse(await fs.promises.readFile(file, 'utf8'));
  const id = randomUUID();
  pending = { id, file, data };
  const p = plan(data);
  return {
    id,
    file,
    settingsChanged:
      JSON.stringify(data.settings) !== JSON.stringify(db.load().settings),
    newConnections: p.connections.length,
    newPresets: p.presets.length,
    newRunners: p.runners.length,
    newWatchedTargets: p.watchedTargets.length,
    conflicts: p.conflicts,
    warnings: p.warnings,
  };
}

export async function restore(id: string): Promise<RestoreResult> {
  if (!pending || pending.id !== id)
    throw new Error('Preview the backup again before restoring');
  const data = pending.data;
  const p = plan(data);
  const result = {
    connections: p.connections.length,
    presets: p.presets.length,
    runners: p.runners.length,
    watchedTargets: p.watchedTargets.length,
  };
  await db.update((d) => {
    d.settings = { ...d.settings, ...data.settings };
    d.connections.push(
      ...p.connections.map((c) => ({ ...c, token: '', tokenEncrypted: false })),
    );
    d.presets.push(...p.presets);
    d.runners.push(
      ...p.runners.map((r) => ({
        ...r,
        autostart: false,
        pendingRemoval: undefined,
      })),
    );
    d.watchedTargets.push(...p.watchedTargets);
  });
  pending = undefined;
  return result;
}
