import type { Snapshot } from '../../shared/types';
import { localizeError, tr } from '@/lib/i18n';

export function OperationsPage({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-muted-foreground text-sm">
        {tr(
          'Batch progress remains available while the app is running. The most recent 20 batches are shown.',
          'ดูความคืบหน้าชุดคำสั่งได้ขณะเปิดแอป โดยแสดง 20 ชุดล่าสุด',
        )}
      </p>
      {snapshot.operations.length === 0 && (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          {tr('No batch actions yet.', 'ยังไม่มีชุดคำสั่ง')}
        </p>
      )}
      {snapshot.operations.map((batch) => {
        const count = (state: (typeof batch.items)[number]['state']) =>
          batch.items.filter((item) => item.state === state).length;
        return (
          <section key={batch.id} className="rounded-md border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <div>
                <h2 className="font-medium">{batch.action}</h2>
                <p className="text-muted-foreground text-xs">
                  {tr('Started', 'เริ่ม')}{' '}
                  {new Date(batch.startedAt).toLocaleString()}
                  {batch.finishedAt
                    ? ` · ${tr('Finished', 'เสร็จ')} ${new Date(batch.finishedAt).toLocaleTimeString()}`
                    : ` · ${tr('In progress', 'กำลังดำเนินการ')}`}
                </p>
              </div>
              <div className="text-muted-foreground text-xs tabular-nums">
                {count('queued')} {tr('queued', 'รอ')} · {count('running')}{' '}
                {tr('running', 'กำลังทำ')} · {count('succeeded')}{' '}
                {tr('succeeded', 'สำเร็จ')} · {count('failed')}{' '}
                {tr('failed', 'ล้มเหลว')}
                {count('skipped')
                  ? ` · ${count('skipped')} ${tr('skipped', 'ข้าม')}`
                  : ''}
              </div>
            </div>
            <div className="divide-y">
              {batch.items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="truncate font-mono">{item.name}</p>
                    {item.error && (
                      <p className="text-destructive text-xs">
                        {localizeError(item.error)}
                      </p>
                    )}
                  </div>
                  <span
                    className={
                      item.state === 'failed'
                        ? 'text-destructive'
                        : item.state === 'succeeded'
                          ? 'text-success'
                          : 'text-muted-foreground'
                    }
                  >
                    {tr(
                      item.state,
                      {
                        queued: 'รอ',
                        running: 'กำลังทำ',
                        succeeded: 'สำเร็จ',
                        failed: 'ล้มเหลว',
                        skipped: 'ข้าม',
                      }[item.state],
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
