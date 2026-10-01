import { toast } from 'sonner';
import type { Channel, GrcApi, IpcContract } from '../../shared/ipc';
import type { BulkResult } from '../../shared/types';
import { localizeError, tr } from './i18n';

declare global {
  interface Window {
    grc: GrcApi;
  }
}

export const api = window.grc;

/** Strip Electron's "Error invoking remote method 'x': Error: " wrapper. */
export function errorMessage(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  const clean = msg.replace(
    /^Error invoking remote method '[^']+': (?:\w*Error: )?/,
    '',
  );
  return localizeError(clean);
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
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const warned = results.filter((r) => r.ok && r.error);
  const ok = results.length - failed.length - skipped.length;
  if (ok)
    toast.success(
      tr(
        `${verb} ${ok} runner${ok === 1 ? '' : 's'}`,
        `${verb} สำเร็จ ${ok} รายการ`,
      ),
    );
  for (const s of skipped)
    toast.info(
      `${names.get(s.id) ?? s.id}: ${tr('skipped', 'ข้าม')} (${localizeError(s.error ?? 'busy')})`,
    );
  for (const f of failed)
    toast.error(
      `${names.get(f.id) ?? f.id}: ${localizeError(f.error ?? 'Unknown error')}`,
    );
  for (const w of warned)
    toast.warning(
      `${names.get(w.id) ?? w.id}: ${localizeError(w.error ?? 'Unknown error')}`,
    );
}
