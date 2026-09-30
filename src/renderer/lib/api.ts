import { toast } from 'sonner';
import type { Channel, GrcApi, IpcContract } from '../../shared/ipc';
import type { BulkResult } from '../../shared/types';

declare global {
  interface Window {
    grc: GrcApi;
  }
}

export const api = window.grc;

/** Strip Electron's "Error invoking remote method 'x': Error: " wrapper. */
export function errorMessage(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  return msg.replace(
    /^Error invoking remote method '[^']+': (?:\w*Error: )?/,
    '',
  );
}

/** Invoke and show a toast on failure. Resolves to undefined when the call failed. */
export async function call<C extends Channel>(
  channel: C,
  ...args: Parameters<IpcContract[C]>
): Promise<Awaited<ReturnType<IpcContract[C]>> | undefined> {
  try {
    return await api.invoke(channel, ...args);
  } catch (err) {
    toast.error(errorMessage(err));
    return undefined;
  }
}

/** Toast a summary of a bulk operation. */
export function reportBulk(
  verb: string,
  results: BulkResult[] | undefined,
  names: Map<string, string>,
) {
  if (!results) return;
  const failed = results.filter((r) => !r.ok);
  const warned = results.filter((r) => r.ok && r.error);
  const ok = results.length - failed.length;
  if (ok) toast.success(`${verb} ${ok} runner${ok === 1 ? '' : 's'}`);
  for (const f of failed) toast.error(`${names.get(f.id) ?? f.id}: ${f.error}`);
  for (const w of warned)
    toast.warning(`${names.get(w.id) ?? w.id}: ${w.error}`);
}
