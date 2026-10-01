import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Notification } from 'electron';
import type {
  BatchOperation,
  BulkAction,
  BulkOptionsPatch,
  BulkResult,
  CleanupOptions,
  CreatePreview,
  PreflightCheck,
  CreateRequest,
  ForeignRunner,
  GithubState,
  LocalState,
  RunnerMode,
  RunnerRecord,
  RunnerStatus,
  Snapshot,
  Target,
} from '../../shared/types';
import * as db from '../db';
import * as gh from '../github';
import * as journal from '../journal';
import { ensurePackage, extract } from './download';
import {
  ElevationCancelled,
  isWin,
  run,
  runElevated,
  type Step,
  type StepResult,
} from './exec';
import {
  LABEL_RE,
  NAME_RE,
  clearConfigFiles,
  cleanWork,
  configureStep,
  deleteDir,
  isExtracted,
  readRunnerFile,
  readServiceName,
  removeStep,
  runnerVersion,
  writeEnv,
} from './layout';
import { pruneDiag } from './logs';
import { findListeners, samePath } from './processes';
import {
  linuxInstallSteps,
  linuxUninstallSteps,
  serviceState,
  startSteps,
  stopSteps,
  windowsDeleteSteps,
  type ServiceState,
} from './service';
import { ChildRunner } from './supervisor';

const PARALLEL = 4;
const GITHUB_POLL_MS = 15_000;
const LOCAL_POLL_MS = 5_000;
const PRUNE_MS = 6 * 3600_000;

interface Extra {
  op?: string;
  lastError?: string;
  creationFailed?: boolean;
  service?: ServiceState;
  broken?: string;
}

const children = new Map<string, ChildRunner>();
const observedLocal = new Map<string, LocalState>();
const stopAfterJob = new Set<string>();
const extra = new Map<string, Extra>();
interface GithubObservation {
  state: GithubState;
  busy: boolean;
  checkedAt?: string;
  syncedAt?: string;
  error?: string;
}
const github = new Map<string, GithubObservation>();
const watchStatus = new Map<string, { checkedAt?: string; error?: string }>();
const operations: BatchOperation[] = [];
let foreign: ForeignRunner[] = [];
let quitPending = false;

function beginBatch(action: string, runners: RunnerRecord[]): string {
  const id = randomUUID();
  operations.unshift({
    id,
    action,
    startedAt: new Date().toISOString(),
    items: runners.map((r) => ({ id: r.id, name: r.name, state: 'queued' })),
  });
  operations.length = Math.min(operations.length, 20);
  changed();
  return id;
}

function markBatch(
  id: string,
  runnerId: string,
  state: BatchOperation['items'][number]['state'],
  error?: string,
) {
  const batch = operations.find((b) => b.id === id);
  const item = batch?.items.find((x) => x.id === runnerId);
  if (!batch || !item) return;
  item.state = state;
  item.error = error;
  if (batch.items.every((x) => !['queued', 'running'].includes(x.state)))
    batch.finishedAt = new Date().toISOString();
  changed();
}

// ------------------------------------------------------------ snapshot plumbing

let emit: (s: Snapshot) => void = () => {};
let emitTimer: NodeJS.Timeout | undefined;

export function onSnapshot(fn: (s: Snapshot) => void) {
  emit = fn;
}

function changed() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = undefined;
    emit(snapshot());
  }, 100);
}

function ex(id: string): Extra {
  let e = extra.get(id);
  if (!e) {
    e = {};
    extra.set(id, e);
  }
  return e;
}

function childOf(r: RunnerRecord): ChildRunner {
  let c = children.get(r.id);
  if (!c) {
    c = new ChildRunner(r.dir, {
      onChange: () => {
        const state = children.get(r.id)?.state;
        if (state && state !== observedLocal.get(r.id)) {
          if (state === 'crashed')
            void journal.record('state', 'crash', r, 'crashed').catch(() => {});
          if (
            (state === 'crashed' || state === 'stopped') &&
            stopAfterJob.delete(r.id)
          )
            void journal
              .record(
                'command',
                'stop after job',
                r,
                'failed',
                'Runner stopped before job completion',
              )
              .catch(() => {});
          observedLocal.set(r.id, state);
        }
        changed();
      },
      onCrashLimit: () =>
        notify(
          `${r.name} crashed`,
          'Restarted too often; it has been stopped.',
        ),
      onJobCompleted: () => {
        if (!stopAfterJob.has(r.id) || children.get(r.id)?.busy) return;
        stopAfterJob.delete(r.id);
        changed();
        void childOf(r)
          .stop()
          .then(
            () =>
              void journal
                .record('command', 'stop after job', r, 'succeeded')
                .catch(() => {}),
            (error) => {
              ex(r.id).lastError = errorText(error);
              void journal
                .record('command', 'stop after job', r, 'failed', error)
                .catch(() => {});
              changed();
            },
          );
      },
    });
    children.set(r.id, c);
  }
  return c;
}

function statusOf(r: RunnerRecord): RunnerStatus {
  const e = extra.get(r.id) ?? {};
  const c = children.get(r.id);
  const g = github.get(r.id);
  let local: LocalState;
  if (e.op) local = 'busy-op';
  else if (r.mode === 'child') local = c?.state ?? 'stopped';
  else local = e.service === 'running' ? 'running' : 'stopped';
  return {
    local,
    op: e.op,
    github: g?.state ?? 'unknown',
    githubCheckedAt: g?.checkedAt,
    githubSyncedAt: g?.syncedAt,
    githubError:
      g?.error ??
      (!g?.checkedAt ? 'GitHub has not been checked yet' : undefined),
    busy: Boolean(c?.busy || g?.busy),
    jobName: c?.jobName,
    broken: e.op ? undefined : e.broken,
    lastError: e.lastError ?? c?.lastError,
    creationFailed: e.creationFailed,
    orphan: c?.orphan,
    stopAfterJob: stopAfterJob.has(r.id),
  };
}

export function snapshot(): Snapshot {
  return {
    runners: db.load().runners.map((r) => ({ ...r, status: statusOf(r) })),
    foreign,
    watched: db
      .load()
      .watchedTargets.map((w) => ({ ...w, ...watchStatus.get(w.id) })),
    operations: operations.map((b) => ({
      ...b,
      items: b.items.map((item) => ({ ...item })),
    })),
    quitPending,
  };
}

function notify(title: string, body: string) {
  const settings = db.load().settings;
  const quiet = settings.quietHours;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = quiet
    ? Number(quiet.start.slice(0, 2)) * 60 + Number(quiet.start.slice(3, 5))
    : 0;
  const end = quiet
    ? Number(quiet.end.slice(0, 2)) * 60 + Number(quiet.end.slice(3, 5))
    : 0;
  const inQuietHours = Boolean(
    quiet &&
    start !== end &&
    (start < end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end),
  );
  if (settings.notifications && !inQuietHours && Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// ------------------------------------------------------------ helpers

async function withOp<T>(
  id: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const e = ex(id);
  if (e.op) throw new Error(`Busy: ${e.op}`);
  e.op = label;
  e.lastError = undefined;
  changed();
  try {
    return await fn();
  } catch (err) {
    e.lastError = errorText(err);
    throw err;
  } finally {
    e.op = undefined;
    await refreshLocal(id);
  }
}

function setOp(id: string, label: string | undefined) {
  ex(id).op = label;
  changed();
}

function errorText(err: unknown): string {
  if (err instanceof ElevationCancelled) return err.message;
  const status = (err as { status?: number }).status;
  return status
    ? gh.describeError(err)
    : ((err as Error).message ?? String(err));
}

/** Last meaningful lines of runner CLI output, for error messages. */
function tail(res: StepResult): string {
  const lines = res.output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-4).join(' ') || `exit code ${res.code}`;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function runSteps(
  steps: Step[],
  elevated: boolean,
): Promise<StepResult[]> {
  if (elevated) return runElevated(steps);
  const out: StepResult[] = [];
  for (const s of steps) out.push(await run(s));
  return out;
}

function busy(r: RunnerRecord) {
  return statusOf(r).busy;
}

async function syncFromRunnerFile(r: RunnerRecord) {
  const info = readRunnerFile(r.dir);
  await db.updateRunner(r.id, {
    githubId: info?.agentId ?? r.githubId,
    version: runnerVersion(r.dir) ?? r.version,
  });
}

function validateLabels(labels: string[]) {
  for (const l of labels) {
    if (!LABEL_RE.test(l))
      throw new Error(`Invalid label "${l}": use letters, digits, . _ -`);
  }
}

function envOptions(cleanup: CleanupOptions) {
  return { cleanup, invariantCulture: db.load().settings.invariantCulture };
}

/** Rewrites every runner's `.env` after a setting that affects it changed. */
export async function applyEnvToAll() {
  for (const r of db.load().runners) {
    if (fs.existsSync(r.dir))
      await writeEnv(r.dir, envOptions(r.cleanup)).catch(() => {});
  }
}

// ------------------------------------------------------------ create

function takenNames(target: Target): Set<string> {
  const root = path.join(db.load().settings.rootDir, 'runners');
  const taken = new Set<string>(
    db.load().runners.map((r) => r.name.toLowerCase()),
  );
  for (const f of foreign) {
    if (gh.sameTarget(f.target, target)) taken.add(f.name.toLowerCase());
  }
  try {
    for (const d of fs.readdirSync(root)) taken.add(d.toLowerCase());
  } catch {
    // Root does not exist yet.
  }
  return taken;
}

function allocateNames(
  prefix: string,
  count: number,
  target: Target,
): string[] {
  const taken = takenNames(target);
  const names: string[] = [];
  for (let n = 1; names.length < count; n++) {
    const name = `${prefix}-${String(n).padStart(2, '0')}`;
    if (!taken.has(name.toLowerCase())) names.push(name);
  }
  return names;
}

export function previewCreate(
  req: Omit<CreateRequest, 'servicePassword' | 'acknowledgePublicRisk'>,
): CreatePreview {
  if (!db.load().connections.some((c) => c.id === req.connectionId))
    throw new Error('Choose a connection');
  if (!Number.isInteger(req.count) || req.count < 1 || req.count > 50)
    throw new Error('Count must be between 1 and 50');
  if (!NAME_RE.test(req.prefix) || req.prefix.length > 56)
    throw new Error('Invalid name prefix');
  if (
    !req.target.owner.trim() ||
    (req.target.kind === 'repo' && !req.target.repo.trim())
  )
    throw new Error('Choose a target');
  validateLabels(req.labels);
  const root = db.load().settings.rootDir;
  if (!path.isAbsolute(root))
    throw new Error('Set an absolute root folder in Settings');
  const names = allocateNames(req.prefix, req.count, req.target);
  const taken = takenNames(req.target);
  const collisions: string[] = [];
  const lastNumber = Number(names.at(-1)!.slice(req.prefix.length + 1));
  for (let n = 1; n <= lastNumber; n++) {
    const candidate = `${req.prefix}-${String(n).padStart(2, '0')}`;
    if (taken.has(candidate.toLowerCase())) collisions.push(candidate);
  }
  return {
    runners: names.map((name) => ({
      name,
      path: path.join(root, 'runners', name),
    })),
    target: req.target,
    mode: req.mode,
    labels: req.labels,
    requiresAdmin: req.mode === 'service',
    collisions,
  };
}

function executable(name: string): boolean {
  if (path.isAbsolute(name)) return fs.existsSync(name);
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((folder) => fs.existsSync(path.join(folder, name)));
}

export async function preflight(
  req: Omit<CreateRequest, 'servicePassword' | 'acknowledgePublicRisk'>,
): Promise<PreflightCheck[]> {
  const preview = previewCreate(req);
  const checks: PreflightCheck[] = [];
  try {
    await gh.registrationToken(req.connectionId, req.target);
    checks.push({
      name: 'GitHub target permission',
      status: 'pass',
      message: 'Runner registration permission verified.',
    });
  } catch (err) {
    const reason = gh.describeError(err);
    const denied = /401|403|404/.test(reason) && !/rate limit/i.test(reason);
    checks.push({
      name: 'GitHub target permission',
      status: denied ? 'fail' : 'unknown',
      message: reason,
    });
  }
  let ancestor = db.load().settings.rootDir;
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor)
    ancestor = path.dirname(ancestor);
  try {
    const stat = fs.statSync(ancestor);
    if (!stat.isDirectory()) throw new Error(`${ancestor} is not a directory`);
    fs.accessSync(ancestor, fs.constants.W_OK);
    checks.push({
      name: 'Runner path',
      status: 'pass',
      message: `Can write under ${ancestor}. ${preview.runners.length} destination path(s) allocated.`,
    });
  } catch (err) {
    checks.push({
      name: 'Runner path',
      status: 'fail',
      message: (err as Error).message,
    });
  }
  try {
    const stat = fs.statfsSync(ancestor);
    const free = stat.bavail * stat.bsize;
    checks.push({
      name: 'Free disk space',
      status: free >= 1024 ** 3 ? 'pass' : 'unknown',
      message: `${(free / 1024 ** 3).toFixed(1)} GiB available; at least 1 GiB is recommended before downloading and running jobs.`,
    });
  } catch (err) {
    checks.push({
      name: 'Free disk space',
      status: 'unknown',
      message: (err as Error).message,
    });
  }
  const needed = isWin
    ? [
        path.join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'tar.exe',
        ),
        ...(req.mode === 'service' ? ['powershell.exe', 'sc.exe'] : []),
      ]
    : ['tar', ...(req.mode === 'service' ? ['pkexec', 'systemctl'] : [])];
  const missing = needed.filter((name) => !executable(name));
  checks.push({
    name: 'Required executables',
    status: missing.length ? 'fail' : 'pass',
    message: missing.length
      ? `Missing: ${missing.join(', ')}`
      : 'All required commands are available.',
  });
  checks.push({
    name: 'OS permission',
    status: req.mode === 'service' ? 'unknown' : 'pass',
    message:
      req.mode === 'service'
        ? 'Administrator approval is required during service installation and cannot be verified in advance.'
        : 'App process mode needs no service administrator approval.',
  });
  return checks;
}

export async function create(req: CreateRequest): Promise<string[]> {
  if (!db.load().connections.some((c) => c.id === req.connectionId)) {
    throw new Error('Choose a connection');
  }
  if (req.target.kind === 'repo' && !req.acknowledgePublicRisk) {
    let visibility: 'public' | 'private' | 'unknown' = 'unknown';
    try {
      visibility = await gh.repoVisibility(
        req.connectionId,
        req.target.owner,
        req.target.repo,
      );
    } catch {
      // Treat unavailable visibility as unverified, never as private.
    }
    if (visibility !== 'private')
      throw new Error(
        visibility === 'public'
          ? 'Confirm the public repository runner risk before creating.'
          : 'Repository visibility could not be verified. Confirm the runner risk before creating.',
      );
  }
  if (!Number.isInteger(req.count) || req.count < 1 || req.count > 50) {
    throw new Error('Count must be between 1 and 50');
  }
  if (!NAME_RE.test(req.prefix) || req.prefix.length > 56) {
    throw new Error(
      'Prefix may only contain letters, digits, . _ - (max 56 characters)',
    );
  }
  validateLabels(req.labels);
  const rootDir = db.load().settings.rootDir;
  if (!path.isAbsolute(rootDir))
    throw new Error('Set an absolute root folder in Settings');

  const serviceAccount =
    isWin && req.mode === 'service'
      ? req.serviceAccount?.trim() || undefined
      : undefined;
  const names = allocateNames(req.prefix, req.count, req.target);
  if (
    req.expectedNames &&
    JSON.stringify(names) !== JSON.stringify(req.expectedNames)
  )
    throw new Error(
      'Runner names changed since the preview. Review and try again.',
    );
  const records: RunnerRecord[] = names.map((name) => ({
    id: randomUUID(),
    name,
    connectionId: req.connectionId,
    target: req.target,
    dir: path.join(rootDir, 'runners', name),
    mode: req.mode,
    labels: [...new Set(req.labels)],
    runnerGroup:
      req.target.kind === 'org' ? req.runnerGroup || undefined : undefined,
    autostart: req.mode === 'child' && req.autostart,
    cleanup: req.cleanup,
    serviceAccount,
    createdAt: new Date().toISOString(),
  }));
  await db.update((d) => d.runners.push(...records));
  const batchId = beginBatch('Create runners', records);
  for (const r of records) ex(r.id).op = 'Queued';
  changed();

  void createBatch(records, rootDir, batchId, req.servicePassword).catch(
    (err) => {
      const batch = operations.find((b) => b.id === batchId);
      for (const r of records) {
        const state = batch?.items.find((item) => item.id === r.id)?.state;
        if (state === 'queued' || state === 'running') fail(r, err, batchId);
      }
    },
  );
  return records.map((r) => r.id);
}

function fail(r: RunnerRecord, err: unknown, batchId: string) {
  const e = ex(r.id);
  e.op = undefined;
  e.lastError = errorText(err);
  e.creationFailed = true;
  markBatch(batchId, r.id, 'failed', e.lastError);
  void journal.record('command', 'create', r, 'failed', err).catch(() => {});
  void refreshLocal(r.id);
}

async function createBatch(
  records: RunnerRecord[],
  rootDir: string,
  batchId: string,
  password?: string,
) {
  const first = records[0]!;
  const token = await gh.registrationToken(first.connectionId, first.target);

  // 1. Download once, extract each in parallel.
  const prepared = await mapLimit(records, PARALLEL, async (r) => {
    markBatch(batchId, r.id, 'running');
    try {
      if (fs.existsSync(r.dir) && fs.readdirSync(r.dir).length) {
        throw new Error(`Folder already exists: ${r.dir}`);
      }
      setOp(r.id, 'Downloading');
      const pkg = await ensurePackage(rootDir, (pct) =>
        setOp(r.id, `Downloading ${pct}%`),
      );
      setOp(r.id, 'Extracting');
      await extract(pkg.file, r.dir);
      // Before configure: a Windows service starts as soon as it is installed.
      await writeEnv(r.dir, envOptions(r.cleanup));
      await db.updateRunner(r.id, { version: pkg.version });
      return r;
    } catch (err) {
      fail(r, err, batchId);
      return null;
    }
  });
  const ok = prepared.filter((r): r is RunnerRecord => r !== null);
  if (!ok.length) return;

  // 2. Register. Windows services need one elevated batch for all runners.
  const winService = isWin && first.mode === 'service';
  let results: (StepResult | Error)[];
  if (winService) {
    for (const r of ok) setOp(r.id, 'Waiting for administrator approval');
    const steps = ok.map((r) =>
      configureStep(r, {
        token,
        windowsService: { account: r.serviceAccount, password },
      }),
    );
    results = await runElevated(steps).catch((err: Error) => ok.map(() => err));
  } else {
    results = await mapLimit(ok, PARALLEL, async (r) => {
      setOp(r.id, 'Registering');
      return run(configureStep(r, { token }));
    });
  }
  const configured: RunnerRecord[] = [];
  ok.forEach((r, i) => {
    const res = results[i]!;
    if (res instanceof Error) fail(r, res, batchId);
    else if (res.code !== 0)
      fail(r, new Error(`Registration failed: ${tail(res)}`), batchId);
    else configured.push(r);
  });

  for (const r of configured) {
    // config.sh rewrites .env on Linux.
    await writeEnv(r.dir, envOptions(r.cleanup));
    await syncFromRunnerFile(r);
  }

  // 3. Linux services: install + start in one polkit prompt.
  if (!isWin && first.mode === 'service' && configured.length) {
    for (const r of configured)
      setOp(r.id, 'Waiting for administrator approval');
    try {
      const res = await runElevated(
        configured.flatMap((r) => linuxInstallSteps(r.dir)),
      );
      configured.forEach((r, i) => {
        const bad = res.slice(i * 2, i * 2 + 2).find((x) => x.code !== 0);
        if (bad) ex(r.id).lastError = `Service install failed: ${tail(bad)}`;
      });
    } catch (err) {
      for (const r of configured) ex(r.id).lastError = errorText(err);
    }
  }

  for (const r of configured) {
    setOp(r.id, undefined);
    ex(r.id).creationFailed = Boolean(ex(r.id).lastError);
    markBatch(
      batchId,
      r.id,
      ex(r.id).lastError ? 'failed' : 'succeeded',
      ex(r.id).lastError,
    );
    void journal
      .record(
        'command',
        'create',
        r,
        ex(r.id).lastError ? 'failed' : 'succeeded',
        ex(r.id).lastError,
      )
      .catch(() => {});
    // New child runners start right away; `autostart` only governs app start.
    if (r.mode === 'child') childOf(r).start();
    void refreshLocal(r.id);
  }
}

// ------------------------------------------------------------ start / stop / clean

export async function bulk(
  ids: string[],
  action: BulkAction,
  skipBusy = false,
): Promise<BulkResult[]> {
  const rs = ids.map((id) => db.getRunner(id));
  const freshBusy = new Map<string, string>();
  if (skipBusy && (action === 'stop' || action === 'restart')) {
    // Fail closed when GitHub cannot confirm an active runner is idle. A job
    // can still arrive between this check and the stop command.
    const groups = new Map<string, RunnerRecord[]>();
    for (const r of rs) {
      if (statusOf(r).busy || statusOf(r).local === 'stopped') continue;
      const key = `${r.connectionId}|${r.target.kind}|${gh.targetKey(r.target).toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    await Promise.all(
      [...groups.values()].map(async (group) => {
        try {
          const list = await gh.listRunners(
            group[0]!.connectionId,
            group[0]!.target,
          );
          for (const r of group) {
            const found =
              list.find((item) => r.githubId && item.id === r.githubId) ??
              list.find(
                (item) => item.name.toLowerCase() === r.name.toLowerCase(),
              );
            if (!found)
              freshBusy.set(r.id, 'GitHub runner status could not be verified');
            else if (found.busy) freshBusy.set(r.id, 'Running a job');
          }
        } catch (error) {
          for (const r of group)
            freshBusy.set(
              r.id,
              `GitHub runner status could not be verified: ${gh.describeError(error)}`,
            );
        }
      }),
    );
  }
  const batchId = beginBatch(
    `${action[0]!.toUpperCase()}${action.slice(1)} runners`,
    rs,
  );
  const results = new Map<string, BulkResult>();
  const usable = rs.filter((r) => {
    const s = statusOf(r);
    const reason = s.op
      ? `Busy: ${s.op}`
      : s.broken && action !== 'stop'
        ? s.broken
        : undefined;
    if (
      skipBusy &&
      (action === 'stop' || action === 'restart') &&
      (s.busy || freshBusy.has(r.id))
    ) {
      results.set(r.id, {
        id: r.id,
        ok: false,
        skipped: true,
        error: freshBusy.get(r.id) ?? 'Running a job',
      });
      return false;
    }
    if (reason) results.set(r.id, { id: r.id, ok: false, error: reason });
    return !reason;
  });
  if (action === 'stop' || action === 'restart') {
    for (const r of usable) stopAfterJob.delete(r.id);
  }
  for (const r of usable) markBatch(batchId, r.id, 'running');

  if (action === 'clean') {
    for (const r of usable) {
      if (busy(r)) {
        results.set(r.id, { id: r.id, ok: false, error: 'Running a job' });
        continue;
      }
      try {
        await cleanWork(r.dir, { ...r.cleanup, enabled: true });
        results.set(r.id, { id: r.id, ok: true });
      } catch (err) {
        results.set(r.id, { id: r.id, ok: false, error: errorText(err) });
      }
    }
  } else {
    const kids = usable.filter((r) => r.mode === 'child');
    const services = usable.filter((r) => r.mode === 'service');

    await Promise.all(
      kids.map(async (r) => {
        try {
          if (action === 'stop' || action === 'restart')
            await childOf(r).stop();
          if (action === 'start' || action === 'restart') childOf(r).start();
          results.set(r.id, { id: r.id, ok: true });
        } catch (err) {
          results.set(r.id, { id: r.id, ok: false, error: errorText(err) });
        }
      }),
    );

    if (services.length) {
      const steps: Step[] = [];
      const ranges = new Map<string, [number, number]>();
      for (const r of services) {
        const start = steps.length;
        if (action !== 'start') steps.push(...stopSteps(r.dir));
        if (action !== 'stop') steps.push(...startSteps(r.dir));
        ranges.set(r.id, [start, steps.length]);
        ex(r.id).op = 'Waiting for administrator approval';
      }
      changed();
      try {
        const output = await runElevated(steps);
        for (const r of services) {
          const [start, end] = ranges.get(r.id)!;
          const failed = output
            .slice(start, end)
            .find((step) => step.code !== 0);
          results.set(
            r.id,
            failed
              ? { id: r.id, ok: false, error: tail(failed) }
              : { id: r.id, ok: true },
          );
        }
      } catch (err) {
        for (const r of services)
          results.set(r.id, { id: r.id, ok: false, error: errorText(err) });
      } finally {
        for (const r of services) ex(r.id).op = undefined;
      }
    }
  }
  await Promise.all(rs.map((r) => refreshLocal(r.id)));
  const final = rs.map((r) => results.get(r.id) ?? { id: r.id, ok: true });
  for (const result of final) {
    markBatch(
      batchId,
      result.id,
      result.skipped ? 'skipped' : result.ok ? 'succeeded' : 'failed',
      result.error,
    );
    const runner = rs.find((r) => r.id === result.id)!;
    void journal
      .record(
        'command',
        action,
        runner,
        result.skipped ? 'skipped' : result.ok ? 'succeeded' : 'failed',
        result.ok ? undefined : result.error,
      )
      .catch(() => {});
    if (action === 'restart' && result.ok)
      void journal
        .record('state', 'restart', runner, 'restarted')
        .catch(() => {});
  }
  return final;
}

export function setStopAfterJob(id: string, enabled: boolean): void {
  const runner = db.getRunner(id);
  const child = children.get(id);
  if (runner.mode !== 'child' || !child || child.orphan)
    throw new Error(
      'Stop after job requires an app process managed in this session',
    );
  if (enabled) {
    if (!child.busy || !child.running)
      throw new Error('No current local job was detected');
    stopAfterJob.add(id);
  } else stopAfterJob.delete(id);
  changed();
}

// ------------------------------------------------------------ remove

async function safeRemovalToken(r: RunnerRecord): Promise<string | null> {
  try {
    return await gh.removalToken(r.connectionId, r.target);
  } catch {
    return null;
  }
}

export async function remove(ids: string[]): Promise<BulkResult[]> {
  const rs = ids.map((id) => db.getRunner(id)).filter((r) => !ex(r.id).op);
  for (const r of rs) setOp(r.id, 'Removing');

  await Promise.all(
    rs.filter((r) => r.mode === 'child').map((r) => childOf(r).stop()),
  );

  const tokens = new Map<string, string | null>();
  for (const r of rs) {
    const key = `${r.connectionId}|${gh.targetKey(r.target)}`;
    if (!tokens.has(key)) tokens.set(key, await safeRemovalToken(r));
  }
  const tokenOf = (r: RunnerRecord) =>
    tokens.get(`${r.connectionId}|${gh.targetKey(r.target)}`) ?? null;
  const configured = (r: RunnerRecord) =>
    fs.existsSync(path.join(r.dir, '.runner'));

  // Did `remove` deregister the runner from GitHub?
  const deregistered = new Set<string>();
  const errors = new Map<string, string>();

  // Elevated part: services.
  const svc = rs.filter((r) => readServiceName(r.dir));
  if (svc.length) {
    const steps: Step[] = [];
    const owner: { r: RunnerRecord; isRemove: boolean }[] = [];
    for (const r of svc) {
      setOp(r.id, 'Waiting for administrator approval');
      if (isWin) {
        const token = tokenOf(r);
        if (token && configured(r)) {
          steps.push(removeStep(r.dir, token));
          owner.push({ r, isRemove: true });
        }
        // Harmless if `remove` already deleted the service.
        for (const s of windowsDeleteSteps(r.dir)) {
          steps.push(s);
          owner.push({ r, isRemove: false });
        }
      } else {
        for (const s of linuxUninstallSteps(r.dir)) {
          steps.push(s);
          owner.push({ r, isRemove: false });
        }
      }
    }
    try {
      const res = await runElevated(steps);
      res.forEach((x, i) => {
        const o = owner[i]!;
        if (o.isRemove && x.code === 0) deregistered.add(o.r.id);
      });
    } catch (err) {
      // Without admin rights the service stays; keep these runners.
      for (const r of svc) {
        errors.set(r.id, errorText(err));
      }
    }
  }

  // Unelevated part: everything not yet deregistered.
  for (const r of rs) {
    if (errors.has(r.id) || deregistered.has(r.id)) continue;
    setOp(r.id, 'Removing');
    const token = tokenOf(r);
    if (token && configured(r) && !(isWin && r.mode === 'service')) {
      const res = await run(removeStep(r.dir, token));
      if (res.code === 0) deregistered.add(r.id);
    }
  }

  const results: BulkResult[] = [];
  for (const r of rs) {
    if (errors.has(r.id)) {
      setOp(r.id, undefined);
      ex(r.id).lastError = errors.get(r.id);
      results.push({ id: r.id, ok: false, error: errors.get(r.id) });
      continue;
    }
    let pending = false;
    if (!deregistered.has(r.id) && r.githubId) {
      try {
        await gh.deleteRunner(r.connectionId, r.target, r.githubId);
      } catch {
        pending = true;
      }
    }
    try {
      await deleteDir(r.dir);
    } catch (err) {
      ex(r.id).lastError = `Could not delete folder: ${errorText(err)}`;
    }
    await finishRemoval(r, pending);
    results.push({
      id: r.id,
      ok: true,
      error: pending ? 'Deregistration will be retried' : undefined,
    });
  }
  await Promise.all(rs.map((r) => refreshLocal(r.id)));
  for (const result of results) {
    const runner = rs.find((r) => r.id === result.id);
    if (runner)
      void journal
        .record(
          'command',
          'remove',
          runner,
          result.ok ? 'succeeded' : 'failed',
          result.ok ? undefined : result.error,
        )
        .catch(() => {});
  }
  return results;
}

async function finishRemoval(r: RunnerRecord, pendingRemoval: boolean) {
  if (pendingRemoval) {
    await db.updateRunner(r.id, { pendingRemoval: true });
  } else {
    await db.update((d) => {
      d.runners = d.runners.filter((x) => x.id !== r.id);
    });
    children.get(r.id)?.dispose();
    children.delete(r.id);
    extra.delete(r.id);
    github.delete(r.id);
    stopAfterJob.delete(r.id);
  }
  setOp(r.id, undefined);
}

export async function forget(id: string) {
  const r = db.getRunner(id);
  try {
    await withOp(id, 'Forgetting', async () => {
      if (r.mode === 'child') await childOf(r).stop();
      if ((await serviceState(r.dir)) !== 'missing') {
        await runElevated(
          isWin ? windowsDeleteSteps(r.dir) : linuxUninstallSteps(r.dir),
        );
      }
      if (r.githubId)
        await gh
          .deleteRunner(r.connectionId, r.target, r.githubId)
          .catch(() => {});
      await deleteDir(r.dir);
    });
    await finishRemoval(r, false);
    changed();
    void journal.record('command', 'forget', r, 'succeeded').catch(() => {});
  } catch (error) {
    void journal
      .record('command', 'forget', r, 'failed', error)
      .catch(() => {});
    throw error;
  }
}

// ------------------------------------------------------------ re-register / mode

async function reRegister(
  r: RunnerRecord,
  mode: RunnerMode,
  account: string | undefined,
  password: string | undefined,
) {
  const regToken = await gh.registrationToken(r.connectionId, r.target);
  const remToken = await safeRemovalToken(r);
  const wasRunning =
    (r.mode === 'child' && children.get(r.id)?.running) ||
    (r.mode === 'service' && extra.get(r.id)?.service === 'running');
  if (r.mode === 'child') await childOf(r).stop();

  const next: RunnerRecord = {
    ...r,
    mode,
    serviceAccount: mode === 'service' && isWin ? account : undefined,
  };
  const hasService = (await serviceState(r.dir)) !== 'missing';
  const hasConfig = fs.existsSync(path.join(r.dir, '.runner'));

  if (isWin) {
    const elevated = hasService || mode === 'service';
    const steps: Step[] = [];
    if (hasConfig && remToken) steps.push(removeStep(r.dir, remToken));
    if (hasService) steps.push(...windowsDeleteSteps(r.dir));
    steps.push({
      file: 'cmd.exe',
      args: [
        '/d',
        '/c',
        'del',
        '/f',
        '/q',
        '.runner',
        '.credentials',
        '.credentials_rsaparams',
        '.service',
      ],
      cwd: r.dir,
    });
    steps.push(
      configureStep(next, {
        token: regToken,
        replace: true,
        windowsService: mode === 'service' ? { account, password } : undefined,
      }),
    );
    if (elevated) setOp(r.id, 'Waiting for administrator approval');
    const res = await runSteps(steps, elevated);
    const last = res[res.length - 1]!;
    if (last.code !== 0) throw new Error(`Registration failed: ${tail(last)}`);
  } else {
    if (hasService) {
      setOp(r.id, 'Waiting for administrator approval');
      await runElevated(linuxUninstallSteps(r.dir));
    }
    setOp(r.id, 'Registering');
    if (hasConfig && remToken) await run(removeStep(r.dir, remToken));
    await clearConfigFiles(r.dir);
    const res = await run(
      configureStep(next, { token: regToken, replace: true }),
    );
    if (res.code !== 0) throw new Error(`Registration failed: ${tail(res)}`);
    await writeEnv(r.dir, envOptions(r.cleanup));
    if (mode === 'service') {
      setOp(r.id, 'Waiting for administrator approval');
      const out = await runElevated(linuxInstallSteps(r.dir));
      const bad = out.find((x) => x.code !== 0);
      if (bad) throw new Error(`Service install failed: ${tail(bad)}`);
    }
  }

  await db.updateRunner(r.id, {
    mode,
    serviceAccount: next.serviceAccount,
    pendingRemoval: undefined,
  });
  await syncFromRunnerFile(next);
  if (mode === 'child' && (wasRunning || r.autostart)) childOf(next).start();
}

export async function repair(id: string, password?: string) {
  const r = db.getRunner(id);
  try {
    await withOp(id, 'Repairing', async () => {
      if (!isExtracted(r.dir)) {
        setOp(id, 'Downloading');
        const pkg = await ensurePackage(db.load().settings.rootDir, (p) =>
          setOp(id, `Downloading ${p}%`),
        );
        setOp(id, 'Extracting');
        await extract(pkg.file, r.dir);
      }
      await writeEnv(r.dir, envOptions(r.cleanup));
      setOp(id, 'Registering');
      await reRegister(r, r.mode, r.serviceAccount, password);
    });
    ex(id).creationFailed = false;
    changed();
    void journal.record('command', 'repair', r, 'succeeded').catch(() => {});
    void journal.record('state', 'repair', r, 'repaired').catch(() => {});
  } catch (error) {
    void journal
      .record('command', 'repair', r, 'failed', error)
      .catch(() => {});
    throw error;
  }
}

export async function setMode(
  id: string,
  mode: RunnerMode,
  account?: string,
  password?: string,
) {
  const r = db.getRunner(id);
  if (r.mode === mode) return;
  if (busy(r)) throw new Error('The runner is running a job');
  try {
    await withOp(id, 'Switching mode', async () => {
      if (isWin) {
        // Windows can only install the service while configuring.
        await reRegister(r, mode, account?.trim() || undefined, password);
        return;
      }
      const wasRunning = statusOf(r).local === 'running';
      if (mode === 'service') {
        await childOf(r).stop();
        setOp(id, 'Waiting for administrator approval');
        const out = await runElevated(linuxInstallSteps(r.dir));
        const bad = out.find((x) => x.code !== 0);
        if (bad) throw new Error(`Service install failed: ${tail(bad)}`);
        await db.updateRunner(id, { mode });
      } else {
        setOp(id, 'Waiting for administrator approval');
        await runElevated(linuxUninstallSteps(r.dir));
        await db.updateRunner(id, { mode });
        if (wasRunning || r.autostart) childOf(db.getRunner(id)).start();
      }
    });
    void journal
      .record('command', 'switch mode', r, 'succeeded')
      .catch(() => {});
  } catch (error) {
    void journal
      .record('command', 'switch mode', r, 'failed', error)
      .catch(() => {});
    throw error;
  }
}

// ------------------------------------------------------------ labels / options

export async function setLabels(
  ids: string[],
  add: string[],
  removeLabels: string[],
): Promise<BulkResult[]> {
  validateLabels(add);
  const drop = new Set(removeLabels.map((l) => l.toLowerCase()));
  const out: BulkResult[] = [];
  for (const id of ids) {
    const r = db.getRunner(id);
    const labels = [...new Set([...r.labels, ...add])].filter(
      (l) => !drop.has(l.toLowerCase()),
    );
    try {
      if (!r.githubId) throw new Error('Not registered yet');
      await gh.setCustomLabels(r.connectionId, r.target, r.githubId, labels);
      await db.updateRunner(id, { labels });
      out.push({ id, ok: true });
    } catch (err) {
      out.push({ id, ok: false, error: errorText(err) });
    }
    const result = out[out.length - 1]!;
    void journal
      .record(
        'command',
        'set labels',
        r,
        result.ok ? 'succeeded' : 'failed',
        result.error,
      )
      .catch(() => {});
  }
  changed();
  return out;
}

export async function setOptions(
  id: string,
  patch: { autostart?: boolean; cleanup?: CleanupOptions },
) {
  const r = db.getRunner(id);
  try {
    if (patch.cleanup && fs.existsSync(r.dir))
      await writeEnv(r.dir, envOptions(patch.cleanup));
    await db.updateRunner(id, patch);
    changed();
    void journal
      .record('command', 'set options', r, 'succeeded')
      .catch(() => {});
  } catch (error) {
    void journal
      .record('command', 'set options', r, 'failed', error)
      .catch(() => {});
    throw error;
  }
}

export async function setOptionsBulk(
  ids: string[],
  patch: BulkOptionsPatch,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const id of ids) {
    try {
      const runner = db.getRunner(id);
      const cleanup = patch.cleanup
        ? { ...runner.cleanup, ...patch.cleanup }
        : undefined;
      const autostart = runner.mode === 'child' ? patch.autostart : undefined;
      if (!cleanup && autostart === undefined) {
        results.push({
          id,
          ok: false,
          skipped: true,
          error: 'Autostart applies only to app-process runners',
        });
        continue;
      }
      await setOptions(id, { cleanup, autostart });
      results.push({
        id,
        ok: true,
        error:
          runner.mode === 'service' && patch.autostart !== undefined
            ? 'Autostart ignored for OS service'
            : undefined,
      });
    } catch (err) {
      results.push({ id, ok: false, error: errorText(err) });
    }
  }
  return results;
}

export async function removeForeign(
  connectionId: string,
  target: Target,
  githubId: number,
) {
  if (
    db
      .load()
      .watchedTargets.some(
        (w) =>
          w.connectionId === connectionId && gh.sameTarget(w.target, target),
      )
  )
    throw new Error('Watched targets are read-only');
  await gh.deleteRunner(connectionId, target, githubId);
  foreign = foreign.filter(
    (f) => !(f.githubId === githubId && gh.sameTarget(f.target, target)),
  );
  changed();
}

export function consoleOf(id: string, offset?: number) {
  return children.get(id)?.consoleSince(offset) ?? { text: '', offset: 0 };
}

// ------------------------------------------------------------ polling

function computeBroken(r: RunnerRecord): string | undefined {
  if (r.pendingRemoval)
    return 'Removed locally; GitHub deregistration will be retried';
  if (!fs.existsSync(r.dir)) return 'Runner folder is missing';
  if (!isExtracted(r.dir)) return 'Runner files are missing';
  if (!readRunnerFile(r.dir)) return 'Not configured';
  if (r.mode === 'service' && extra.get(r.id)?.service === 'missing')
    return 'Service is not installed';
  if (github.get(r.id)?.state === 'missing') return 'Not registered on GitHub';
  return undefined;
}

async function refreshLocal(id: string) {
  const r = db.load().runners.find((x) => x.id === id);
  if (!r) return changed();
  const e = ex(id);
  if (!e.op) {
    if (r.mode === 'service' && fs.existsSync(r.dir))
      e.service = await serviceState(r.dir);
    e.broken = computeBroken(r);
  }
  changed();
}

async function pollLocal() {
  await Promise.all(db.load().runners.map((r) => refreshLocal(r.id)));
}

/** Attach a newly imported local runner to the live snapshot without starting another process. */
export async function acceptImported(
  runner: RunnerRecord,
  listenerPid?: number,
) {
  if (runner.mode === 'child' && listenerPid)
    childOf(runner).adopt(listenerPid);
  await refreshLocal(runner.id);
  refreshNow();
}

async function pollGithub() {
  const runners = db.load().runners;
  const activeWatches = new Set(db.load().watchedTargets.map((w) => w.id));
  for (const id of watchStatus.keys())
    if (!activeWatches.has(id)) watchStatus.delete(id);
  const groups = new Map<
    string,
    {
      connectionId: string;
      target: Target;
      runners: RunnerRecord[];
      watchIds: string[];
    }
  >();
  for (const r of runners) {
    const key = `${r.connectionId}|${gh.targetKey(r.target).toLowerCase()}`;
    const g = groups.get(key) ?? {
      connectionId: r.connectionId,
      target: r.target,
      runners: [],
      watchIds: [],
    };
    g.runners.push(r);
    groups.set(key, g);
  }
  for (const watch of db.load().watchedTargets) {
    const key = `${watch.connectionId}|${gh.targetKey(watch.target).toLowerCase()}`;
    const g = groups.get(key) ?? {
      connectionId: watch.connectionId,
      target: watch.target,
      runners: [],
      watchIds: [],
    };
    g.watchIds.push(watch.id);
    groups.set(key, g);
  }

  const nextForeign: ForeignRunner[] = [];
  for (const g of groups.values()) {
    let list: gh.GithubRunner[];
    try {
      list = await gh.listRunners(g.connectionId, g.target);
    } catch (err) {
      const checkedAt = new Date().toISOString();
      for (const id of g.watchIds)
        watchStatus.set(id, { checkedAt, error: gh.describeError(err) });
      for (const r of g.runners) {
        const previous = github.get(r.id);
        github.set(r.id, {
          state: 'unknown',
          busy: false,
          checkedAt,
          syncedAt: previous?.syncedAt,
          error: gh.describeError(err),
        });
      }
      continue;
    }
    const checkedAt = new Date().toISOString();
    for (const id of g.watchIds) watchStatus.set(id, { checkedAt });
    const matched = new Set<number>();
    for (const r of g.runners) {
      const found =
        list.find((x) => r.githubId && x.id === r.githubId) ??
        list.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
      const prev = github.get(r.id)?.state;
      if (found) {
        matched.add(found.id);
        const state: GithubState =
          found.status === 'online' ? 'online' : 'offline';
        github.set(r.id, {
          state,
          busy: found.busy,
          checkedAt,
          syncedAt: checkedAt,
        });
        if (found.id !== r.githubId && !r.pendingRemoval)
          await db.updateRunner(r.id, { githubId: found.id });
        if (prev === 'online' && state === 'offline' && !ex(r.id).op) {
          void journal.record('state', 'offline', r, 'offline').catch(() => {});
          notify(
            `${r.name} is offline`,
            `GitHub reports ${r.name} (${gh.targetKey(r.target)}) offline.`,
          );
        }
        if (prev !== 'online' && state === 'online')
          void journal.record('state', 'online', r, 'online').catch(() => {});
        if (prev === undefined && state === 'offline')
          void journal.record('state', 'offline', r, 'offline').catch(() => {});
      } else {
        const configured = readRunnerFile(r.dir) !== null;
        github.set(r.id, {
          state: configured || r.githubId ? 'missing' : 'unknown',
          busy: false,
          checkedAt,
          syncedAt: checkedAt,
          error:
            configured || r.githubId
              ? undefined
              : 'Runner is not configured locally and has not appeared on GitHub',
        });
      }
    }
    for (const x of list) {
      if (matched.has(x.id)) continue;
      nextForeign.push({
        connectionId: g.connectionId,
        target: g.target,
        githubId: x.id,
        name: x.name,
        os: x.os,
        status: x.status,
        busy: x.busy,
        labels: x.labels.map((l) => l.name),
        readOnly: g.watchIds.length > 0,
      });
    }
  }
  foreign = nextForeign;
  changed();

  // Retry deregistration for runners removed while GitHub was unreachable.
  for (const r of runners.filter((x) => x.pendingRemoval)) {
    try {
      if (r.githubId)
        await gh.deleteRunner(r.connectionId, r.target, r.githubId);
      await finishRemoval(r, false);
    } catch {
      // Next poll.
    }
  }
  await pollLocal();
}

let pruneTimer: NodeJS.Timeout | undefined;

async function pruneAll() {
  const days = db.load().settings.diagRetentionDays;
  for (const r of db.load().runners) await pruneDiag(r.dir, days);
}

export async function init() {
  const runners = db.load().runners;
  for (const r of runners) if (r.mode === 'child') childOf(r);
  // Keep managed .env keys in line with the current settings before anything starts.
  await applyEnvToAll();

  // Runners left running by a previous session (crash, forced quit).
  const listeners = await findListeners().catch(() => []);
  for (const r of runners.filter((x) => x.mode === 'child')) {
    const p = listeners.find((l) => samePath(l.dir, r.dir));
    if (p) childOf(r).adopt(p.pid);
  }

  await pollLocal();
  for (const r of runners) {
    if (
      r.mode === 'child' &&
      r.autostart &&
      !ex(r.id).broken &&
      !childOf(r).orphan
    )
      childOf(r).start();
  }

  const loop = (fn: () => Promise<void>, ms: number) => {
    const tick = () =>
      void fn()
        .catch(() => {})
        .finally(() => setTimeout(tick, ms));
    tick();
  };
  loop(pollGithub, GITHUB_POLL_MS);
  setTimeout(() => loop(pollLocal, LOCAL_POLL_MS), LOCAL_POLL_MS);
  void pruneAll();
  pruneTimer = setInterval(() => void pruneAll(), PRUNE_MS);
}

/** Re-poll GitHub now, e.g. after a connection changed. */
export function refreshNow() {
  void pollGithub().catch(() => {});
}

// ------------------------------------------------------------ quit support

export function runningChildren(): RunnerRecord[] {
  return db
    .load()
    .runners.filter((r) => r.mode === 'child' && children.get(r.id)?.running);
}

export function busyChildren(): RunnerRecord[] {
  return runningChildren().filter((r) => busy(r));
}

export async function stopAllChildren() {
  await Promise.all(runningChildren().map((r) => childOf(r).stop()));
}

export function setQuitPending(v: boolean) {
  quitPending = v;
  changed();
}

export function dispose() {
  clearInterval(pruneTimer);
  for (const c of children.values()) c.dispose();
}
