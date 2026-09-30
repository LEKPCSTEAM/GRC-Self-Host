import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Notification } from 'electron';
import type {
  BulkAction,
  BulkResult,
  CleanupOptions,
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
  service?: ServiceState;
  broken?: string;
}

const children = new Map<string, ChildRunner>();
const extra = new Map<string, Extra>();
const github = new Map<string, { state: GithubState; busy: boolean }>();
let foreign: ForeignRunner[] = [];
let quitPending = false;

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
      onChange: changed,
      onCrashLimit: () =>
        notify(
          `${r.name} crashed`,
          'Restarted too often; it has been stopped.',
        ),
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
    busy: Boolean(c?.busy || g?.busy),
    jobName: c?.jobName,
    broken: e.op ? undefined : e.broken,
    lastError: e.lastError ?? c?.lastError,
    orphan: c?.orphan,
  };
}

export function snapshot(): Snapshot {
  return {
    runners: db.load().runners.map((r) => ({ ...r, status: statusOf(r) })),
    foreign,
    quitPending,
  };
}

function notify(title: string, body: string) {
  if (db.load().settings.notifications && Notification.isSupported()) {
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

function allocateNames(
  prefix: string,
  count: number,
  target: Target,
): string[] {
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
  const names: string[] = [];
  for (let n = 1; names.length < count; n++) {
    const name = `${prefix}-${String(n).padStart(2, '0')}`;
    if (!taken.has(name.toLowerCase())) names.push(name);
  }
  return names;
}

export async function create(req: CreateRequest): Promise<string[]> {
  if (!db.load().connections.some((c) => c.id === req.connectionId)) {
    throw new Error('Choose a connection');
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
  const records: RunnerRecord[] = allocateNames(
    req.prefix,
    req.count,
    req.target,
  ).map((name) => ({
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
  for (const r of records) ex(r.id).op = 'Queued';
  changed();

  void createBatch(records, rootDir, req.servicePassword).catch((err) => {
    for (const r of records) fail(r, err);
  });
  return records.map((r) => r.id);
}

function fail(r: RunnerRecord, err: unknown) {
  const e = ex(r.id);
  e.op = undefined;
  e.lastError = errorText(err);
  void refreshLocal(r.id);
}

async function createBatch(
  records: RunnerRecord[],
  rootDir: string,
  password?: string,
) {
  const first = records[0]!;
  const token = await gh.registrationToken(first.connectionId, first.target);

  // 1. Download once, extract each in parallel.
  const prepared = await mapLimit(records, PARALLEL, async (r) => {
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
      fail(r, err);
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
    if (res instanceof Error) fail(r, res);
    else if (res.code !== 0)
      fail(r, new Error(`Registration failed: ${tail(res)}`));
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
    // New child runners start right away; `autostart` only governs app start.
    if (r.mode === 'child') childOf(r).start();
    void refreshLocal(r.id);
  }
}

// ------------------------------------------------------------ start / stop / clean

export async function bulk(
  ids: string[],
  action: BulkAction,
): Promise<BulkResult[]> {
  const rs = ids.map((id) => db.getRunner(id));
  const results = new Map<string, BulkResult>();
  const usable = rs.filter((r) => {
    const s = statusOf(r);
    const reason = s.op
      ? `Busy: ${s.op}`
      : s.broken && action !== 'stop'
        ? s.broken
        : undefined;
    if (reason) results.set(r.id, { id: r.id, ok: false, error: reason });
    return !reason;
  });

  if (action === 'clean') {
    for (const r of usable) {
      if (busy(r)) {
        results.set(r.id, { id: r.id, ok: false, error: 'Running a job' });
        continue;
      }
      await cleanWork(r.dir, { ...r.cleanup, enabled: true });
      results.set(r.id, { id: r.id, ok: true });
    }
  } else {
    const kids = usable.filter((r) => r.mode === 'child');
    const services = usable.filter((r) => r.mode === 'service');

    if (action === 'stop' || action === 'restart') {
      await Promise.all(kids.map((r) => childOf(r).stop()));
    }
    if (action === 'start' || action === 'restart') {
      for (const r of kids) childOf(r).start();
    }
    for (const r of kids) results.set(r.id, { id: r.id, ok: true });

    if (services.length) {
      const steps: Step[] = [];
      for (const r of services) {
        if (action !== 'start') steps.push(...stopSteps(r.dir));
        if (action !== 'stop') steps.push(...startSteps(r.dir));
        ex(r.id).op = 'Waiting for administrator approval';
      }
      changed();
      try {
        await runElevated(steps);
        for (const r of services) results.set(r.id, { id: r.id, ok: true });
      } catch (err) {
        for (const r of services)
          results.set(r.id, { id: r.id, ok: false, error: errorText(err) });
      } finally {
        for (const r of services) ex(r.id).op = undefined;
      }
    }
  }
  await Promise.all(rs.map((r) => refreshLocal(r.id)));
  return rs.map((r) => results.get(r.id) ?? { id: r.id, ok: true });
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
  }
  setOp(r.id, undefined);
}

export async function forget(id: string) {
  const r = db.getRunner(id);
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
  }
  changed();
  return out;
}

export async function setOptions(
  id: string,
  patch: { autostart?: boolean; cleanup?: CleanupOptions },
) {
  const r = db.getRunner(id);
  await db.updateRunner(id, patch);
  if (patch.cleanup && fs.existsSync(r.dir))
    await writeEnv(r.dir, envOptions(patch.cleanup));
  changed();
}

export async function removeForeign(
  connectionId: string,
  target: Target,
  githubId: number,
) {
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

async function pollGithub() {
  const runners = db.load().runners;
  const groups = new Map<
    string,
    { connectionId: string; target: Target; runners: RunnerRecord[] }
  >();
  for (const r of runners) {
    const key = `${r.connectionId}|${gh.targetKey(r.target).toLowerCase()}`;
    const g = groups.get(key) ?? {
      connectionId: r.connectionId,
      target: r.target,
      runners: [],
    };
    g.runners.push(r);
    groups.set(key, g);
  }

  const nextForeign: ForeignRunner[] = [];
  for (const g of groups.values()) {
    let list: gh.GithubRunner[];
    try {
      list = await gh.listRunners(g.connectionId, g.target);
    } catch {
      for (const r of g.runners)
        github.set(r.id, { state: 'unknown', busy: false });
      continue;
    }
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
        github.set(r.id, { state, busy: found.busy });
        if (found.id !== r.githubId && !r.pendingRemoval)
          await db.updateRunner(r.id, { githubId: found.id });
        if (prev === 'online' && state === 'offline' && !ex(r.id).op) {
          notify(
            `${r.name} is offline`,
            `GitHub reports ${r.name} (${gh.targetKey(r.target)}) offline.`,
          );
        }
      } else {
        const configured = readRunnerFile(r.dir) !== null;
        github.set(r.id, {
          state: configured || r.githubId ? 'missing' : 'unknown',
          busy: false,
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
      });
    }
  }
  foreign = nextForeign;

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
