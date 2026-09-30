import fs from 'node:fs';
import path from 'node:path';
import { isWin, run } from './exec';

export interface ListenerProcess {
  pid: number;
  /** Runner folder, i.e. the parent of `bin/`. */
  dir: string;
}

/** Finds running Runner.Listener processes on this machine. */
export async function findListeners(): Promise<ListenerProcess[]> {
  if (isWin) {
    const res = await run(
      {
        file: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process -Filter "Name=\'Runner.Listener.exe\'" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress',
        ],
      },
      30_000,
    );
    if (res.code !== 0 || !res.output.trim()) return [];
    try {
      const parsed = JSON.parse(res.output) as
        | { ProcessId: number; ExecutablePath: string | null }
        | { ProcessId: number; ExecutablePath: string | null }[];
      return (Array.isArray(parsed) ? parsed : [parsed])
        .filter((p) => p.ExecutablePath)
        .map((p) => ({
          pid: p.ProcessId,
          dir: path.dirname(path.dirname(p.ExecutablePath!)),
        }));
    } catch {
      return [];
    }
  }

  const found: ListenerProcess[] = [];
  for (const pid of await fs.promises
    .readdir('/proc')
    .catch(() => [] as string[])) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const exe = await fs.promises.readlink(`/proc/${pid}/exe`);
      if (exe.endsWith('/bin/Runner.Listener')) {
        found.push({ pid: Number(pid), dir: path.dirname(path.dirname(exe)) });
      }
    } catch {
      // Not ours to inspect.
    }
  }
  return found;
}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p);
    return isWin ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}
