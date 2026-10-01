import { Octokit } from '@octokit/rest';
import type {
  JobReport,
  RunnerGroup,
  RunnerJob,
  Target,
  TargetOption,
} from '../shared/types';
import { shell } from 'electron';
import * as db from './db';
import { unseal } from './secrets';

const USER_AGENT = 'grc-self-host';
const clients = new Map<string, Octokit>();
const jobLinks = new Map<number, string>();

export function targetKey(t: Target): string {
  return t.kind === 'repo' ? `${t.owner}/${t.repo}` : t.owner;
}

export function targetUrl(t: Target): string {
  return `https://github.com/${targetKey(t)}`;
}

export function sameTarget(a: Target, b: Target): boolean {
  return (
    a.kind === b.kind &&
    targetKey(a).toLowerCase() === targetKey(b).toLowerCase()
  );
}

export async function repoVisibility(
  connectionId: string,
  owner: string,
  repo: string,
): Promise<'public' | 'private'> {
  const response = await client(connectionId).request(
    'GET /repos/{owner}/{repo}',
    { owner, repo },
  );
  return response.data.private ? 'private' : 'public';
}

export function forgetClient(connectionId: string) {
  clients.delete(connectionId);
}

function client(connectionId: string): Octokit {
  let c = clients.get(connectionId);
  if (!c) {
    const rec = db.load().connections.find((x) => x.id === connectionId);
    if (!rec) throw new Error('Connection not found');
    c = new Octokit({ auth: unseal(rec), userAgent: USER_AGENT });
    clients.set(connectionId, c);
  }
  return c;
}

/** Validates a token and returns the login it belongs to. */
export async function whoAmI(token: string): Promise<string> {
  const res = await new Octokit({ auth: token, userAgent: USER_AGENT }).request(
    'GET /user',
  );
  return res.data.login;
}

// Repo and org runner endpoints differ only in their prefix.
function base(t: Target): { prefix: string; params: Record<string, string> } {
  return t.kind === 'repo'
    ? {
        prefix: '/repos/{owner}/{repo}/actions',
        params: { owner: t.owner, repo: t.repo },
      }
    : { prefix: '/orgs/{org}/actions', params: { org: t.owner } };
}

export async function registrationToken(
  connectionId: string,
  t: Target,
): Promise<string> {
  const { prefix, params } = base(t);
  const res = await client(connectionId).request(
    `POST ${prefix}/runners/registration-token`,
    params,
  );
  return (res.data as { token: string }).token;
}

export async function removalToken(
  connectionId: string,
  t: Target,
): Promise<string> {
  const { prefix, params } = base(t);
  const res = await client(connectionId).request(
    `POST ${prefix}/runners/remove-token`,
    params,
  );
  return (res.data as { token: string }).token;
}

export interface GithubRunner {
  id: number;
  name: string;
  os: string;
  status: string;
  busy: boolean;
  labels: { name: string; type?: string }[];
}

export async function listRunners(
  connectionId: string,
  t: Target,
): Promise<GithubRunner[]> {
  const { prefix, params } = base(t);
  const c = client(connectionId);
  return (await c.paginate(`GET ${prefix}/runners`, {
    ...params,
    per_page: 100,
  })) as GithubRunner[];
}

export async function deleteRunner(
  connectionId: string,
  t: Target,
  runnerId: number,
): Promise<void> {
  const { prefix, params } = base(t);
  try {
    await client(connectionId).request(`DELETE ${prefix}/runners/{runner_id}`, {
      ...params,
      runner_id: runnerId,
    });
  } catch (err) {
    // Already gone is the outcome we wanted.
    if ((err as { status?: number }).status !== 404) throw err;
  }
}

/** Replaces the runner's custom labels. */
export async function setCustomLabels(
  connectionId: string,
  t: Target,
  runnerId: number,
  labels: string[],
): Promise<void> {
  const { prefix, params } = base(t);
  await client(connectionId).request(
    `PUT ${prefix}/runners/{runner_id}/labels`,
    { ...params, runner_id: runnerId, labels },
  );
}

export async function listTargets(
  connectionId: string,
): Promise<TargetOption[]> {
  const c = client(connectionId);
  const [orgs, repos] = await Promise.all([
    c
      .paginate('GET /user/orgs', { per_page: 100 })
      .catch(() => [] as { login: string }[]),
    c.paginate('GET /user/repos', { per_page: 100, sort: 'full_name' }),
  ]);
  const orgOptions: TargetOption[] = orgs.map((o) => ({
    target: { kind: 'org', owner: o.login },
    label: `${o.login} (organization)`,
  }));
  // Admin rights are required to register runners on a repository.
  const repoOptions: TargetOption[] = repos
    .filter((r) => r.permissions?.admin !== false)
    .map((r) => ({
      target: { kind: 'repo', owner: r.owner.login, repo: r.name },
      label: r.full_name,
    }));
  return [...orgOptions, ...repoOptions];
}

export async function listRunnerGroups(
  connectionId: string,
  org: string,
): Promise<RunnerGroup[]> {
  const res = await client(connectionId).request(
    'GET /orgs/{org}/actions/runner-groups',
    { org, per_page: 100 },
  );
  return res.data.runner_groups.map((g) => ({ id: g.id, name: g.name }));
}

/** At most 11 API calls: one run list and jobs for ten recent runs. */
export async function recentJobs(runnerId: string): Promise<JobReport> {
  const runner = db.getRunner(runnerId);
  if (runner.target.kind !== 'repo')
    return {
      checkedAt: new Date().toISOString(),
      jobs: [],
      scannedRuns: 0,
      message:
        'Organization runners may serve many repositories. Select a repository target to inspect jobs.',
    };
  if (!runner.githubId)
    return {
      checkedAt: new Date().toISOString(),
      jobs: [],
      scannedRuns: 0,
      message:
        'GitHub runner ID is not available yet. Wait for a successful GitHub sync.',
    };
  const { owner, repo } = runner.target;
  const c = client(runner.connectionId);
  try {
    const runs = await c.request('GET /repos/{owner}/{repo}/actions/runs', {
      owner,
      repo,
      per_page: 10,
    });
    const jobs: RunnerJob[] = [];
    for (const run of runs.data.workflow_runs.slice(0, 10)) {
      const runId = Number(run.id);
      if (!Number.isSafeInteger(runId)) continue;
      const response = await c.request(
        'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
        {
          owner,
          repo,
          run_id: runId,
          per_page: 100,
        },
      );
      for (const job of response.data.jobs) {
        if (Number(job.runner_id) !== runner.githubId) continue;
        const jobId = Number(job.id);
        if (!Number.isSafeInteger(jobId)) continue;
        jobs.push({
          id: jobId,
          name: job.name,
          status: job.status,
          conclusion: job.conclusion ?? undefined,
          startedAt: job.started_at ?? undefined,
          completedAt: job.completed_at ?? undefined,
          workflow: run.name ?? undefined,
        });
        if (job.html_url) jobLinks.set(jobId, job.html_url);
      }
    }
    jobs.sort(
      (a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''),
    );
    return {
      checkedAt: new Date().toISOString(),
      jobs: jobs.slice(0, 20),
      scannedRuns: runs.data.workflow_runs.length,
      message:
        'Only the ten most recent workflow runs and first 100 jobs in each run were scanned. Older jobs may be missing.',
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 403 && !/rate limit/i.test((error as Error).message))
      throw new Error(
        'Job history requires Actions: read permission on this repository.',
      );
    throw error;
  }
}

export async function openJob(id: number): Promise<void> {
  const link = jobLinks.get(id);
  if (!link || !link.startsWith('https://github.com/'))
    throw new Error('Job link expired. Refresh job history and try again.');
  await shell.openExternal(link);
}

/** Human-readable message for Octokit and network errors. */
export function describeError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  if (e.status === 401)
    return 'GitHub rejected the token (401). Check or replace it.';
  if (e.status === 403) {
    if (/rate limit/i.test(e.message ?? ''))
      return 'GitHub API rate limit reached (403). Wait for the limit to reset, then retry.';
    return 'GitHub denied access (403). The token needs "Administration" (repo) or "Self-hosted runners" (org) read/write permission.';
  }
  if (e.status === 404)
    return 'Not found (404). Check the target name and token access.';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|network|fetch failed/i.test(e.message ?? ''))
    return 'Network error while contacting GitHub. Check connectivity and retry.';
  return 'GitHub request failed. Check the target and connection, then retry.';
}
