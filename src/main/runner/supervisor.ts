import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { interrupt, isAlive, isWin, killTree, spawnStep } from './exec';

const CONSOLE_LINES = 2000;
const BACKOFF_MS = [1_000, 5_000, 30_000, 60_000, 60_000];
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 5;
const GRACEFUL_STOP_MS = 30_000;

export type ChildState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed';

export interface ChildEvents {
  onChange(): void;
  onCrashLimit(): void;
}

/** Owns one runner's `run.cmd` / `run.sh` process. */
export class ChildRunner {
  state: ChildState = 'stopped';
  busy = false;
  jobName?: string;
  lastError?: string;
  /** Adopted from an earlier app session; no output is available. */
  orphan = false;

  private proc?: ChildProcess;
  private pid?: number;
  private lines: string[] = [];
  /** Total lines ever received, used as the console log offset. */
  private lineCount = 0;
  private partial = '';
  private crashes: number[] = [];
  private restartTimer?: NodeJS.Timeout;
  private orphanTimer?: NodeJS.Timeout;
  private stopRequested = false;

  constructor(
    private readonly dir: string,
    private readonly events: ChildEvents,
  ) {}

  get running() {
    return this.state === 'running' || this.state === 'starting';
  }

  start() {
    if (this.proc || this.orphan) return;
    clearTimeout(this.restartTimer);
    this.stopRequested = false;
    this.state = 'starting';
    this.lastError = undefined;
    this.append(`[grc] starting ${new Date().toISOString()}`);

    const proc = isWin
      ? spawnStep(
          // Absolute path: with NoDefaultCurrentDirectoryInExePath set, a bare
          // `run.cmd` resolves through PATH (e.g. nvm ships one).
          {
            file: 'cmd.exe',
            args: ['/d', '/c', path.join(this.dir, 'run.cmd')],
            cwd: this.dir,
          },
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
      : spawnStep(
          { file: path.join(this.dir, 'run.sh'), args: [], cwd: this.dir },
          // Own process group so SIGINT/SIGKILL reach the whole tree.
          { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
        );
    this.proc = proc;
    this.pid = proc.pid;
    proc.stdout?.on('data', (d: Buffer) => this.onOutput(d));
    proc.stderr?.on('data', (d: Buffer) => this.onOutput(d));
    proc.on('error', (err) => {
      this.lastError = err.message;
      this.append(`[grc] ${err.message}`);
    });
    proc.on('close', (code) => this.onExit(code));
    this.events.onChange();
  }

  /**
   * Stop the runner gracefully (Ctrl+Break / SIGINT) so it deletes its GitHub session;
   * kill the process tree if it does not exit in time.
   */
  async stop(): Promise<void> {
    clearTimeout(this.restartTimer);
    this.stopRequested = true;
    if (this.orphan && this.pid) {
      const pid = this.pid;
      this.state = 'stopping';
      this.events.onChange();
      if (await interrupt(pid)) {
        const deadline = Date.now() + GRACEFUL_STOP_MS;
        while (isAlive(pid) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (isAlive(pid)) await killTree(pid);
      this.clearOrphan();
      return;
    }
    const proc = this.proc;
    const pid = this.pid;
    if (!proc || !pid) {
      if (this.state === 'crashed') this.state = 'stopped';
      this.events.onChange();
      return;
    }
    this.state = 'stopping';
    this.events.onChange();
    const exited = new Promise<void>((r) => proc.once('close', () => r()));
    const sent = await interrupt(pid);
    const timer = setTimeout(
      () => void killTree(pid),
      sent ? GRACEFUL_STOP_MS : 0,
    );
    await exited;
    clearTimeout(timer);
  }

  /** Track a Runner.Listener that survived a previous app session. */
  adopt(pid: number) {
    this.orphan = true;
    this.pid = pid;
    this.state = 'running';
    this.append(
      `[grc] adopted running process ${pid} from a previous session (no output available)`,
    );
    this.orphanTimer = setInterval(() => {
      if (!isAlive(pid)) {
        this.clearOrphan();
      }
    }, 5_000);
  }

  private clearOrphan() {
    clearInterval(this.orphanTimer);
    this.orphan = false;
    this.pid = undefined;
    this.state = 'stopped';
    this.busy = false;
    this.events.onChange();
  }

  consoleSince(offset?: number): { text: string; offset: number } {
    const first = this.lineCount - this.lines.length;
    const from = offset === undefined ? first : Math.max(offset, first);
    return {
      text: this.lines.slice(from - first).join('\n'),
      offset: this.lineCount,
    };
  }

  dispose() {
    clearTimeout(this.restartTimer);
    clearInterval(this.orphanTimer);
  }

  private onOutput(d: Buffer) {
    const text = this.partial + d.toString();
    const parts = text.split(/\r?\n/);
    this.partial = parts.pop() ?? '';
    let changed = false;
    for (const line of parts) {
      if (!line.trim()) continue;
      this.append(line);
      if (/Listening for Jobs/i.test(line) && this.state === 'starting') {
        this.state = 'running';
        this.crashes = [];
        changed = true;
      }
      const job = /Running job: (.+)$/.exec(line);
      if (job) {
        this.busy = true;
        this.jobName = job[1]?.trim();
        changed = true;
      }
      if (/Job .+ completed with result/i.test(line)) {
        this.busy = false;
        this.jobName = undefined;
        changed = true;
      }
    }
    if (changed) this.events.onChange();
  }

  private onExit(code: number | null) {
    this.proc = undefined;
    this.pid = undefined;
    this.busy = false;
    this.jobName = undefined;
    this.append(`[grc] exited with code ${code}`);

    if (this.stopRequested) {
      this.state = 'stopped';
      this.events.onChange();
      return;
    }

    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
    this.crashes.push(now);
    this.lastError = `Exited unexpectedly (code ${code})`;
    if (this.crashes.length > MAX_CRASHES) {
      this.state = 'crashed';
      this.lastError = `Crashed ${this.crashes.length} times in 10 minutes; not restarting.`;
      this.events.onChange();
      this.events.onCrashLimit();
      return;
    }
    const delay =
      BACKOFF_MS[Math.min(this.crashes.length - 1, BACKOFF_MS.length - 1)] ??
      60_000;
    this.state = 'starting';
    this.append(`[grc] restarting in ${delay / 1000}s`);
    this.restartTimer = setTimeout(() => this.start(), delay);
    this.events.onChange();
  }

  private append(line: string) {
    this.lines.push(line);
    this.lineCount++;
    if (this.lines.length > CONSOLE_LINES) this.lines.shift();
  }
}
