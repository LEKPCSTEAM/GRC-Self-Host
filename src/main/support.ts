import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { SupportPreview } from '../shared/types';
import * as db from './db';
import { safeError } from './journal';
import { listDiag } from './runner/logs';
import { snapshot } from './runner/manager';
import { summarizeLog } from './support-summary';

const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILES_PER_KIND = 4;

interface Bundle {
  format: 'grc-support';
  createdAt: string;
  days: number;
  runners: {
    name: string;
    target: string;
    mode: string;
    local: string;
    github: string;
    error?: string;
  }[];
  logs: { runner: string; file: string; modifiedAt: string; text: string }[];
  truncated: boolean;
}

let pending:
  | { id: string; at: number; bundle: Bundle; preview: SupportPreview }
  | undefined;

async function tail(full: string): Promise<string> {
  const stat = await fs.stat(full);
  const start = Math.max(0, stat.size - MAX_FILE_BYTES);
  const handle = await fs.open(full, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await handle.close();
  }
}

export async function preview(days: number): Promise<SupportPreview> {
  if (![1, 7, 30].includes(days)) throw new Error('Choose 1, 7 or 30 days');
  const data = db.load();
  const cutoff = Date.now() - days * 86_400_000;
  const logs: Bundle['logs'] = [];
  let total = 0;
  let truncated = false;
  for (const [runnerIndex, runner] of data.runners.entries()) {
    const runnerAlias = `runner-${runnerIndex + 1}`;
    for (const kind of ['runner', 'worker'] as const) {
      const files = (await listDiag(runner.dir, kind)).slice(
        0,
        MAX_FILES_PER_KIND,
      );
      for (const [fileIndex, file] of files.entries()) {
        const full = path.join(runner.dir, '_diag', file);
        try {
          const stat = await fs.lstat(full);
          if (!stat.isFile()) continue;
          if (stat.mtimeMs < cutoff) continue;
          if (stat.size > MAX_FILE_BYTES) truncated = true;
          if (total >= MAX_TOTAL_BYTES) {
            truncated = true;
            continue;
          }
          const text = summarizeLog(await tail(full));
          const remaining = MAX_TOTAL_BYTES - total;
          const content =
            Buffer.byteLength(text) > remaining
              ? Buffer.from(text).subarray(0, remaining).toString('utf8')
              : text;
          if (content !== text) truncated = true;
          total += Buffer.byteLength(content);
          logs.push({
            runner: runnerAlias,
            file: `${kind}-${fileIndex + 1}.log`,
            modifiedAt: stat.mtime.toISOString(),
            text: content,
          });
        } catch {
          // Log rotated during preview; skip it.
        }
      }
    }
  }
  const runners = snapshot().runners.map((runner, index) => ({
    name: `runner-${index + 1}`,
    target:
      runner.target.kind === 'repo'
        ? `${runner.target.owner}/${runner.target.repo}`
        : runner.target.owner,
    mode: runner.mode,
    local: runner.status.local,
    github: runner.status.github,
    error: runner.status.lastError
      ? safeError(runner.status.lastError)
      : undefined,
  }));
  const bundle: Bundle = {
    format: 'grc-support',
    createdAt: new Date().toISOString(),
    days,
    runners,
    logs,
    truncated,
  };
  const id = randomUUID();
  const result: SupportPreview = {
    id,
    days,
    runnerCount: runners.length,
    files: logs.map((log) => ({
      runner: log.runner,
      file: log.file,
      bytes: Buffer.byteLength(log.text),
    })),
    sample: logs
      .map((log) => `${log.runner}/${log.file}\n${log.text}`)
      .join('\n\n')
      .slice(0, 8000),
    truncated,
  };
  pending = { id, at: Date.now(), bundle, preview: result };
  return result;
}

export async function exportBundle(id: string): Promise<string | null> {
  if (!pending || pending.id !== id || Date.now() - pending.at > 10 * 60_000)
    throw new Error('Support preview expired; preview again');
  const options: Electron.SaveDialogOptions = {
    title: 'Export support bundle',
    defaultPath: `grc-support-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const win = BrowserWindow.getFocusedWindow();
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, JSON.stringify(pending.bundle, null, 2));
  pending = undefined;
  return result.filePath;
}
