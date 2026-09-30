import { spawn, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const isWin = process.platform === 'win32';

// Built from the code point so formatters cannot turn it into an invisible literal.
export const BOM = String.fromCharCode(0xfeff);
export const LEADING_BOM = new RegExp(`^${BOM}`);

export interface Step {
  file: string;
  args: string[];
  cwd?: string;
  /** Extra environment, e.g. secrets passed as ACTIONS_RUNNER_INPUT_*. */
  env?: Record<string, string>;
}

export interface StepResult {
  code: number;
  output: string;
}

/** Environment for runner processes, without Electron's own switches. */
export function cleanEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) {
    if (k.startsWith('ELECTRON_')) delete env[k];
  }
  return env;
}

export function spawnStep(step: Step, opts: SpawnOptions = {}) {
  return spawn(step.file, step.args, {
    cwd: step.cwd,
    env: cleanEnv(step.env),
    windowsHide: true,
    ...opts,
  });
}

export function run(step: Step, timeoutMs = 10 * 60_000): Promise<StepResult> {
  return new Promise((resolve) => {
    const child = spawnStep(step, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (d: Buffer) => {
      output += d.toString();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = setTimeout(() => {
      output += '\n[grc] timed out';
      if (child.pid) killTree(child.pid);
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (isWin) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
      }).on('close', () => resolve());
    } else {
      try {
        // Children are spawned detached, so the pid is also the process group.
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      resolve();
    }
  });
}

// Attaches to the process's (hidden) console and raises Ctrl+Break for everything on it.
// Ctrl+Break rather than Ctrl+C: Ctrl+C can be disabled by an inherited "ignore" flag.
// The helper's own handler returns true so it survives the event it sends.
const CTRL_BREAK_PS = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class GrcBreak {
  delegate bool Handler(uint ctrlType);
  static readonly Handler Keep = t => true;
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(Handler h, bool add);
  [DllImport("kernel32.dll")] static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
  public static bool Send(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) return false;
    SetConsoleCtrlHandler(Keep, true);
    bool ok = GenerateConsoleCtrlEvent(1, 0);
    Thread.Sleep(500);
    FreeConsole();
    return ok;
  }
}
'@
if ([GrcBreak]::Send(__PID__)) { exit 0 } else { exit 1 }`;

/**
 * Asks a runner to shut down cleanly so it deletes its GitHub session
 * (a killed runner leaves one behind and the next start waits for it to expire).
 */
export async function interrupt(pid: number): Promise<boolean> {
  if (!isWin) {
    try {
      // Children are spawned detached, so the pid is also the process group.
      process.kill(-pid, 'SIGINT');
      return true;
    } catch {
      return false;
    }
  }
  const res = await run(
    {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        CTRL_BREAK_PS.replace('__PID__', String(pid)),
      ],
    },
    30_000,
  );
  return res.code === 0;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class ElevationCancelled extends Error {
  constructor() {
    super('Administrator permission was not granted.');
  }
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const MARK = '__GRC_EXIT_';

/**
 * Runs several steps with administrator rights behind a single UAC / polkit prompt.
 * Returns one result per step, in order.
 */
export async function runElevated(steps: Step[]): Promise<StepResult[]> {
  if (steps.length === 0) return [];
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grc-'));
  try {
    return isWin
      ? await runElevatedWindows(dir, steps)
      : await runElevatedLinux(dir, steps);
  } finally {
    // The script can contain registration tokens.
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function runElevatedWindows(
  dir: string,
  steps: Step[],
): Promise<StepResult[]> {
  const log = path.join(dir, 'out.log');
  const lines = [
    `$ErrorActionPreference = 'Continue'`,
    `$log = ${psQuote(log)}`,
  ];
  steps.forEach((s, i) => {
    const env = Object.entries(s.env ?? {});
    for (const [k, v] of env) lines.push(`$env:${k} = ${psQuote(v)}`);
    if (s.cwd) lines.push(`Set-Location -LiteralPath ${psQuote(s.cwd)}`);
    lines.push(
      `& ${psQuote(s.file)} ${s.args.map(psQuote).join(' ')} 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8`,
      `"${MARK}${i}__=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8`,
    );
    for (const [k] of env)
      lines.push(`Remove-Item Env:${k} -ErrorAction SilentlyContinue`);
  });
  const script = path.join(dir, 'steps.ps1');
  await fs.promises.writeFile(script, `${BOM}${lines.join('\r\n')}\r\n`);

  const launcher = [
    'try {',
    `  $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psQuote(`"${script}"`)}`,
    '  exit $p.ExitCode',
    '} catch { exit 1223 }',
  ].join('\n');
  const res = await run({
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', launcher],
  });
  if (res.code === 1223) throw new ElevationCancelled();

  const out = fs.existsSync(log)
    ? (await fs.promises.readFile(log, 'utf8')).replaceAll(BOM, '')
    : '';
  return parseMarked(out, steps.length);
}

async function runElevatedLinux(
  dir: string,
  steps: Step[],
): Promise<StepResult[]> {
  const lines = ['#!/bin/bash'];
  steps.forEach((s, i) => {
    const env = Object.entries(s.env ?? {})
      .map(([k, v]) => `${k}=${shQuote(v)}`)
      .join(' ');
    lines.push(
      `( ${s.cwd ? `cd ${shQuote(s.cwd)} && ` : ''}${env ? `env ${env} ` : ''}${[s.file, ...s.args].map(shQuote).join(' ')} ) 2>&1`,
      `echo "${MARK}${i}__=$?"`,
    );
  });
  const script = path.join(dir, 'steps.sh');
  await fs.promises.writeFile(script, `${lines.join('\n')}\n`, { mode: 0o700 });
  const res = await run({ file: 'pkexec', args: ['/bin/bash', script] });
  // 126: the user dismissed the dialog, 127: not authorized.
  if (res.code === 126 || res.code === 127) throw new ElevationCancelled();
  return parseMarked(res.output, steps.length);
}

function parseMarked(out: string, count: number): StepResult[] {
  const results: StepResult[] = [];
  let rest = out;
  for (let i = 0; i < count; i++) {
    const re = new RegExp(`${MARK}${i}__=(-?\\d*)`);
    const m = re.exec(rest);
    if (!m) {
      results.push({ code: -1, output: rest || 'Step did not run.' });
      rest = '';
      continue;
    }
    results.push({
      code: m[1] === '' ? 0 : Number(m[1]),
      output: rest.slice(0, m.index).trim(),
    });
    rest = rest.slice(m.index + m[0].length);
  }
  return results;
}
