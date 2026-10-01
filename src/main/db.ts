import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type {
  Connection,
  Preset,
  RunnerRecord,
  Settings,
  WatchTarget,
  JournalEvent,
  MaintenanceTask,
} from '../shared/types';

const SCHEMA_VERSION = 4;

export interface ConnectionRecord extends Connection {
  /** Base64 of the safeStorage-encrypted token, or the plain token if encryption is unavailable. */
  token: string;
  tokenEncrypted: boolean;
}

export interface DbData {
  schemaVersion: number;
  settings: Settings;
  connections: ConnectionRecord[];
  runners: RunnerRecord[];
  presets: Preset[];
  watchedTargets: Pick<WatchTarget, 'id' | 'connectionId' | 'target'>[];
  events: JournalEvent[];
  maintenance: MaintenanceTask[];
}

function defaultRootDir(): string {
  if (process.platform === 'win32') {
    return path.join(`${process.env.SystemDrive ?? 'C:'}\\`, 'actions-runner');
  }
  return path.join(os.homedir(), 'actions-runner');
}

function defaults(): DbData {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      rootDir: defaultRootDir(),
      diagRetentionDays: 7,
      notifications: true,
      language: 'en',
      theme: 'system',
      launchAtLogin: false,
      // The runner's worker is known to crash under th-TH; default on for Thai systems.
      invariantCulture: app.getSystemLocale().toLowerCase().startsWith('th'),
    },
    connections: [],
    runners: [],
    presets: [],
    watchedTargets: [],
    events: [],
    maintenance: [],
  };
}

/** Fill in fields added after the file was written. Bump SCHEMA_VERSION for breaking changes. */
function migrate(raw: Partial<DbData>): DbData {
  const base = defaults();
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...base.settings, ...raw.settings },
    connections: raw.connections ?? [],
    runners: raw.runners ?? [],
    presets: raw.presets ?? [],
    watchedTargets: raw.watchedTargets ?? [],
    events: raw.events ?? [],
    maintenance: raw.maintenance ?? [],
  };
}

export const dbPath = () => path.join(app.getPath('userData'), 'db.json');

let data: DbData | undefined;
let writing: Promise<void> = Promise.resolve();

export function load(): DbData {
  if (data) return data;
  try {
    data = migrate(JSON.parse(fs.readFileSync(dbPath(), 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Keep the unreadable file for inspection instead of silently overwriting it.
      fs.renameSync(dbPath(), `${dbPath()}.corrupt-${Date.now()}`);
    }
    data = defaults();
  }
  return data;
}

/** Apply a change and persist it. Writes are serialized and atomic (temp file + rename). */
export function update(mutate: (d: DbData) => void): Promise<void> {
  mutate(load());
  const snapshot = JSON.stringify(data, null, 2);
  writing = writing.then(async () => {
    const tmp = `${dbPath()}.tmp`;
    await fs.promises.mkdir(path.dirname(tmp), { recursive: true });
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, dbPath());
  });
  return writing;
}

export function getRunner(id: string): RunnerRecord {
  const r = load().runners.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown runner ${id}`);
  return r;
}

export function updateRunner(
  id: string,
  patch: Partial<RunnerRecord>,
): Promise<void> {
  return update((d) => {
    const r = d.runners.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  });
}
