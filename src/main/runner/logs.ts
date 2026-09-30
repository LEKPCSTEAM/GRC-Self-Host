import fs from 'node:fs';
import path from 'node:path';
import type { LogChunk } from '../../shared/types';
import { LEADING_BOM } from './exec';

const INITIAL_TAIL_BYTES = 128 * 1024;
const MAX_READ_BYTES = 512 * 1024;

export async function listDiag(
  dir: string,
  kind: 'runner' | 'worker',
): Promise<string[]> {
  const diag = path.join(dir, '_diag');
  const prefix = kind === 'runner' ? 'Runner_' : 'Worker_';
  let names: string[];
  try {
    names = (await fs.promises.readdir(diag)).filter(
      (n) => n.startsWith(prefix) && n.endsWith('.log'),
    );
  } catch {
    return [];
  }
  const withTime = await Promise.all(
    names.map(async (n) => ({
      n,
      t: (await fs.promises.stat(path.join(diag, n))).mtimeMs,
    })),
  );
  return withTime.sort((a, b) => b.t - a.t).map((x) => x.n);
}

/** Tails a `_diag` file. Without an offset it returns the last part of the file. */
export async function readDiag(
  dir: string,
  kind: 'runner' | 'worker',
  file?: string,
  offset?: number,
): Promise<LogChunk> {
  const files = await listDiag(dir, kind);
  const name = file && files.includes(file) ? file : (files[0] ?? null);
  if (!name) return { files, file: null, text: '', offset: 0 };

  const full = path.join(dir, '_diag', name);
  const size = (await fs.promises.stat(full)).size;
  // A smaller file than the offset means it was replaced; start over.
  let start =
    offset === undefined || offset > size
      ? Math.max(0, size - INITIAL_TAIL_BYTES)
      : offset;
  start = Math.max(start, size - MAX_READ_BYTES);
  if (start >= size) return { files, file: name, text: '', offset: size };

  const fh = await fs.promises.open(full, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8').replace(LEADING_BOM, '');
    // Drop the partial first line of a tail.
    if (offset === undefined && start > 0)
      text = text.slice(text.indexOf('\n') + 1);
    return { files, file: name, text, offset: size };
  } finally {
    await fh.close();
  }
}

/** Deletes `_diag` files (including `pages/` and `blocks/`) older than the retention period. */
export async function pruneDiag(dir: string, days: number) {
  const cutoff = Date.now() - days * 86_400_000;
  const walk = async (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      try {
        if ((await fs.promises.stat(full)).mtimeMs < cutoff)
          await fs.promises.rm(full);
      } catch {
        // In use by the runner; try again next time.
      }
    }
  };
  await walk(path.join(dir, '_diag'));
}
