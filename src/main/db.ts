import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { Settings } from '../shared/types';

const SCHEMA_VERSION = 1;

export interface DbData {
  schemaVersion: number;
  settings: Settings;
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
    },
  };
}

/** Fill in fields added after the file was written. Bump SCHEMA_VERSION for breaking changes. */
function migrate(raw: Partial<DbData>): DbData {
  const base = defaults();
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...base.settings, ...raw.settings },
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
