import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { ImportPreview, RunnerRecord, Target } from '../shared/types';
import * as db from './db';
import * as gh from './github';
import * as journal from './journal';
import {
  isExtracted,
  NAME_RE,
  readServiceName,
  runnerVersion,
} from './runner/layout';
import * as manager from './runner/manager';
import { findListeners, samePath } from './runner/processes';
import { serviceState } from './runner/service';

let pending:
  | {
      id: string;
      at: number;
      connectionId: string;
      target: Target;
      dir: string;
      preview: ImportPreview;
      pid?: number;
    }
  | undefined;

export async function chooseDir(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose an existing local runner folder',
    properties: ['openDirectory'],
  };
  const win = BrowserWindow.getFocusedWindow();
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function inspect(
  connectionId: string,
  target: Target,
  input: string,
): Promise<{ preview: ImportPreview; pid?: number }> {
  if (!db.load().connections.some((item) => item.id === connectionId))
    throw new Error('Choose a connection');
  const dir = fs.realpathSync(path.resolve(input));
  const checks: ImportPreview['checks'] = [];
  const root = fs.lstatSync(dir);
  if (!root.isDirectory()) throw new Error('Choose a runner directory');
  const raw = JSON.parse(
    fs.readFileSync(path.join(dir, '.runner'), 'utf8').replace(/^\uFEFF/, ''),
  ) as {
    agentId?: unknown;
    agentName?: unknown;
    gitHubUrl?: unknown;
  };
  const githubId = Number(raw.agentId);
  const name = raw.agentName;
  if (
    !Number.isSafeInteger(githubId) ||
    githubId <= 0 ||
    typeof name !== 'string' ||
    !NAME_RE.test(name)
  )
    throw new Error('The .runner file has no valid GitHub ID and runner name');
  checks.push({
    name: 'Local configuration',
    status:
      isExtracted(dir) && fs.existsSync(path.join(dir, '.credentials'))
        ? 'pass'
        : 'fail',
    message: 'Runner executable and .credentials must exist in this directory.',
  });
  const duplicate = db
    .load()
    .runners.some(
      (item) =>
        samePath(item.dir, dir) ||
        item.name.toLowerCase() === name.toLowerCase() ||
        (item.githubId === githubId &&
          item.connectionId === connectionId &&
          gh.sameTarget(item.target, target)),
    );
  checks.push({
    name: 'Existing record',
    status: duplicate ? 'fail' : 'pass',
    message: duplicate
      ? 'This path, name or GitHub runner ID is already managed.'
      : 'No existing managed record conflicts.',
  });
  if (typeof raw.gitHubUrl === 'string') {
    let matches = false;
    try {
      const url = new URL(raw.gitHubUrl);
      matches =
        url.origin === 'https://github.com' &&
        url.pathname.replace(/^\/|\/$/g, '').toLowerCase() ===
          gh.targetKey(target).toLowerCase();
    } catch {
      /* Invalid URL is a mismatch. */
    }
    checks.push({
      name: 'Configured target',
      status: matches ? 'pass' : 'fail',
      message: matches
        ? 'Local .runner target matches the selected target.'
        : 'Local .runner target does not match the selected GitHub target.',
    });
  }
  const listeners = await findListeners();
  const listener = listeners.find((item) => samePath(item.dir, dir));
  const serviceName = readServiceName(dir);
  const service = serviceName ? await serviceState(dir) : 'missing';
  const mode = service !== 'missing' ? 'service' : 'child';
  const local = listener
    ? `Listener running locally (PID ${listener.pid})`
    : service !== 'missing'
      ? `Local service ${service}`
      : 'No local listener or installed service';
  checks.push({
    name: 'Local ownership',
    status: listener || service !== 'missing' ? 'pass' : 'fail',
    message:
      local +
      (listener || service !== 'missing'
        ? ''
        : '. Start the runner locally before import; a copied folder cannot be claimed.'),
  });
  const remote = (await gh.listRunners(connectionId, target)).find(
    (item) => item.id === githubId,
  );
  checks.push({
    name: 'GitHub identity',
    status: remote?.name === name ? 'pass' : 'fail',
    message:
      remote?.name === name
        ? `GitHub ID ${githubId} and name match.`
        : 'Runner ID and name were not found together on the selected target.',
  });
  if (remote?.status === 'online' && !listener && service !== 'running')
    checks.push({
      name: 'Remote activity',
      status: 'fail',
      message:
        'GitHub reports this runner online but no local listener/service is running. It may be on another machine.',
    });
  const preview: ImportPreview = {
    id: randomUUID(),
    dir,
    name,
    githubId,
    version: runnerVersion(dir),
    mode,
    local,
    github: remote?.status ?? 'not found',
    labels:
      remote?.labels
        .filter((label) => label.type === 'custom')
        .map((label) => label.name) ?? [],
    checks,
  };
  return { preview, pid: listener?.pid };
}

export async function preview(
  connectionId: string,
  target: Target,
  dir: string,
): Promise<ImportPreview> {
  const result = await inspect(connectionId, target, dir);
  pending = {
    id: result.preview.id,
    at: Date.now(),
    connectionId,
    target,
    dir: result.preview.dir,
    preview: result.preview,
    pid: result.pid,
  };
  return result.preview;
}

export async function commit(id: string): Promise<string> {
  const plan = pending;
  if (!plan || plan.id !== id || Date.now() - plan.at > 10 * 60_000)
    throw new Error('Import preview expired; preview again');
  const fresh = await inspect(plan.connectionId, plan.target, plan.dir);
  if (
    fresh.preview.checks.some((check) => check.status === 'fail') ||
    fresh.preview.name !== plan.preview.name ||
    fresh.preview.githubId !== plan.preview.githubId
  )
    throw new Error('Runner changed or a check failed. Preview again.');
  const record: RunnerRecord = {
    id: randomUUID(),
    name: fresh.preview.name,
    connectionId: plan.connectionId,
    target: plan.target,
    dir: fresh.preview.dir,
    mode: fresh.preview.mode,
    labels: fresh.preview.labels,
    autostart: false,
    cleanup: { enabled: false, actions: false, tool: false },
    githubId: fresh.preview.githubId,
    version: fresh.preview.version,
    createdAt: new Date().toISOString(),
  };
  await db.update((data) => {
    data.runners.push(record);
  });
  await manager.acceptImported(record, fresh.pid);
  void journal.record('command', 'import', record, 'succeeded').catch(() => {});
  pending = undefined;
  return record.id;
}
