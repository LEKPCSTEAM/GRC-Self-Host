import fs from 'node:fs/promises';
import path from 'node:path';
import type { VersionReport } from '../../shared/types';
import * as db from '../db';
import { latestRunnerVersion } from './download';
import { runnerVersion } from './layout';
import { readDiag } from './logs';

const RECENT_MS = 7 * 24 * 60 * 60_000;

async function recentUpdateIssue(dir: string): Promise<string | undefined> {
  try {
    const log = await readDiag(dir, 'runner');
    if (!log.file) return undefined;
    const info = await fs.stat(path.join(dir, '_diag', log.file));
    if (Date.now() - info.mtimeMs > RECENT_MS) return undefined;
    const lines = log.text.split(/\r?\n/);
    const issue = lines.some((line) =>
      /\b(?:update|upgrade)\b.{0,100}\b(?:failed|failure|error)\b|\b(?:failed|failure|error)\b.{0,100}\b(?:update|upgrade)\b/i.test(
        line,
      ),
    );
    return issue
      ? 'Recent runner diagnostic log mentions an update error. Review its _diag log.'
      : undefined;
  } catch {
    return undefined;
  }
}

export async function check(): Promise<VersionReport> {
  const latest = await latestRunnerVersion();
  const runners = await Promise.all(
    db.load().runners.map(async (runner) => ({
      id: runner.id,
      installed: runnerVersion(runner.dir) ?? runner.version,
      updateIssue: await recentUpdateIssue(runner.dir),
    })),
  );
  return { latest, checkedAt: new Date().toISOString(), runners };
}
