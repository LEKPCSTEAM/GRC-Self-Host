import { randomUUID } from 'node:crypto';
import type { MaintenanceTask } from '../shared/types';
import * as db from './db';
import { safeError } from './journal';
import * as manager from './runner/manager';

let processing = false;

export function list(): MaintenanceTask[] {
  return db.load().maintenance;
}

export async function schedule(
  action: MaintenanceTask['action'],
  ids: string[],
  runAt: string,
  skipBusy: boolean,
): Promise<MaintenanceTask> {
  if (action !== 'clean' && action !== 'restart')
    throw new Error('Invalid action');
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Select runners once');
  for (const id of ids) db.getRunner(id);
  const time = Date.parse(runAt);
  if (
    !Number.isFinite(time) ||
    time <= Date.now() ||
    time > Date.now() + 365 * 86_400_000
  )
    throw new Error('Choose a future time within one year');
  const task: MaintenanceTask = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runAt: new Date(time).toISOString(),
    action,
    runnerIds: ids,
    skipBusy: action === 'clean' ? true : skipBusy,
    state: 'scheduled',
  };
  await db.update((data) => {
    data.maintenance.unshift(task);
    const active = data.maintenance.filter(
      (item) => item.state === 'scheduled' || item.state === 'running',
    );
    const recent = data.maintenance
      .filter(
        (item) => item.state === 'completed' || item.state === 'cancelled',
      )
      .slice(0, 100);
    data.maintenance = [...active, ...recent].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  });
  return task;
}

export async function cancel(id: string): Promise<void> {
  await db.update((data) => {
    const item = data.maintenance.find((entry) => entry.id === id);
    if (!item || item.state !== 'scheduled')
      throw new Error('Task is no longer scheduled');
    item.state = 'cancelled';
  });
}

async function tick(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const due = db
      .load()
      .maintenance.filter(
        (task) =>
          task.state === 'scheduled' && Date.parse(task.runAt) <= Date.now(),
      );
    for (const task of due) {
      await db.update((data) => {
        const item = data.maintenance.find((entry) => entry.id === task.id);
        if (item) item.state = 'running';
      });
      try {
        const results = await manager.bulk(
          task.runnerIds,
          task.action,
          task.skipBusy,
        );
        await db.update((data) => {
          const item = data.maintenance.find((entry) => entry.id === task.id);
          if (item) {
            item.state = 'completed';
            item.finishedAt = new Date().toISOString();
            item.results = results.map((result) => ({
              ...result,
              error: result.error ? safeError(result.error) : undefined,
            }));
          }
        });
      } catch (error) {
        await db.update((data) => {
          const item = data.maintenance.find((entry) => entry.id === task.id);
          if (item) {
            item.state = 'completed';
            item.finishedAt = new Date().toISOString();
            item.error = safeError(error);
          }
        });
      }
    }
  } finally {
    processing = false;
  }
}

export async function init(): Promise<void> {
  await db.update((data) => {
    for (const task of data.maintenance) {
      if (task.state === 'running') {
        task.state = 'completed';
        task.finishedAt = new Date().toISOString();
        task.error =
          'App stopped while maintenance was running. Review runner status.';
      }
    }
  });
  void tick();
  setInterval(() => void tick(), 15_000);
}
