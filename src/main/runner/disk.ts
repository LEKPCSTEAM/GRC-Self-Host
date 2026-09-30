import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiskReport, RunnerRecord } from '../../shared/types';
import * as db from '../db';

async function entries(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Logical file bytes. Symbolic links are never followed. */
async function size(full: string): Promise<number> {
  let stat;
  try {
    stat = await fs.lstat(full);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let bytes = 0;
  for (const entry of await entries(full))
    bytes += await size(path.join(full, entry.name));
  return bytes;
}

/** Match the paths deleted by cleanWork while preserving repo and mapping folders. */
async function cleanPaths(runner: RunnerRecord): Promise<string[]> {
  const work = path.join(runner.dir, '_work');
  const paths: string[] = [];
  for (const entry of await entries(work)) {
    if (!entry.isDirectory() || entry.name === '_PipelineMapping') continue;
    const full = path.join(work, entry.name);
    if (entry.name === '_actions' && !runner.cleanup.actions) continue;
    if (entry.name === '_tool' && !runner.cleanup.tool) continue;
    if (entry.name.startsWith('_')) {
      for (const child of await entries(full))
        paths.push(path.join(full, child.name));
    } else {
      for (const sub of await entries(full)) {
        const nested = path.join(full, sub.name);
        if (sub.isDirectory()) {
          for (const child of await entries(nested))
            paths.push(path.join(nested, child.name));
        } else paths.push(nested);
      }
    }
  }
  return paths;
}

export async function report(): Promise<DiskReport> {
  const data = db.load();
  const runners: DiskReport['runners'] = [];
  for (const runner of data.runners) {
    const targets = await cleanPaths(runner);
    const cleanPathsWithSize = [];
    for (const full of targets)
      cleanPathsWithSize.push({ path: full, bytes: await size(full) });
    runners.push({
      id: runner.id,
      workBytes: await size(path.join(runner.dir, '_work')),
      diagBytes: await size(path.join(runner.dir, '_diag')),
      cleanBytes: cleanPathsWithSize.reduce((sum, item) => sum + item.bytes, 0),
      cleanPaths: cleanPathsWithSize.slice(0, 100),
      omittedPaths: Math.max(0, cleanPathsWithSize.length - 100),
    });
  }
  const cacheBytes = await size(path.join(data.settings.rootDir, 'cache'));
  return {
    checkedAt: new Date().toISOString(),
    cacheBytes,
    totalBytes:
      cacheBytes +
      runners.reduce((sum, item) => sum + item.workBytes + item.diagBytes, 0),
    runners,
  };
}
