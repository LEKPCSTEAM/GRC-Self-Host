import { randomUUID } from 'node:crypto';
import type { JournalEvent, RunnerRecord } from '../shared/types';
import * as db from './db';

const MAX_EVENTS = 500;
const RETENTION_MS = 30 * 24 * 60 * 60_000;

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/rate limit/i.test(message)) return 'GitHub API rate limit';
  if (/401/.test(message)) return 'Token rejected by GitHub';
  if (/403/.test(message)) return 'GitHub permission denied';
  if (/404/.test(message)) return 'GitHub target or runner not found';
  if (/network|ENOTFOUND|ECONN|ETIMEDOUT|fetch failed/i.test(message))
    return 'Network error';
  if (/admin|elevat|permission|access denied/i.test(message))
    return 'OS permission error';
  if (/cancel/i.test(message)) return 'Cancelled';
  return 'Operation failed; see current runner error';
}

export async function record(
  type: JournalEvent['type'],
  action: string,
  runner: Pick<RunnerRecord, 'id' | 'name'>,
  outcome: string,
  error?: unknown,
): Promise<void> {
  const event: JournalEvent = {
    id: randomUUID(),
    at: new Date().toISOString(),
    type,
    action,
    runnerId: runner.id,
    runnerName: runner.name,
    outcome,
    error: error === undefined ? undefined : safeError(error),
  };
  await db.update((data) => {
    data.events.unshift(event);
    const cutoff = Date.now() - RETENTION_MS;
    data.events = data.events
      .filter((item) => Date.parse(item.at) >= cutoff)
      .slice(0, MAX_EVENTS);
  });
}

export function list(): JournalEvent[] {
  return db.load().events;
}

export async function clearState(): Promise<void> {
  await db.update((data) => {
    data.events = data.events.filter((event) => event.type !== 'state');
  });
}
