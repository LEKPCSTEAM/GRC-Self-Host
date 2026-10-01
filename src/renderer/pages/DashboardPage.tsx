import { Activity, ArrowUpRight, CircleAlert } from 'lucide-react';
import type { Snapshot } from '../../shared/types';
import type { Filter } from '@/pages/RunnersPage';
import { targetLabel } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { localizeError, tr } from '@/lib/i18n';

export function DashboardPage({
  snapshot,
  onShowRunners,
  onOnboarding,
}: {
  snapshot: Snapshot;
  onShowRunners: (filter: Filter) => void;
  onOnboarding: () => void;
}) {
  const runners = snapshot.runners;
  const counts: {
    label: string;
    count: number;
    filter: Filter;
    color: string;
  }[] = [
    {
      label: tr('Online', 'ออนไลน์'),
      count: runners.filter((r) => r.status.github === 'online').length,
      filter: 'online',
      color: 'text-success',
    },
    {
      label: tr('Offline', 'ออฟไลน์'),
      count: runners.filter((r) => r.status.github === 'offline').length,
      filter: 'offline',
      color: 'text-muted-foreground',
    },
    {
      label: tr('Running a job', 'กำลังรันงาน'),
      count: runners.filter((r) => r.status.busy).length,
      filter: 'busy',
      color: 'text-info',
    },
    {
      label: tr('Broken', 'มีปัญหา'),
      count: runners.filter(
        (r) => r.status.broken || r.status.local === 'crashed',
      ).length,
      filter: 'broken',
      color: 'text-danger',
    },
  ];
  const active = runners.filter((r) => r.status.op || r.status.busy);
  const attention = runners.filter(
    (r) =>
      r.status.broken ||
      r.status.lastError ||
      r.status.local === 'crashed' ||
      (r.status.github === 'offline' && r.status.local === 'running'),
  );

  return (
    <div className="space-y-8">
      {runners.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4 text-sm">
          <span>
            {tr(
              'No managed runners yet. Use the setup checklist to create one and verify it online.',
              'ยังไม่มี runner ที่จัดการอยู่ ใช้รายการตั้งค่าเพื่อสร้างและตรวจสอบว่าออนไลน์',
            )}
          </span>
          <Button onClick={onOnboarding}>{tr('Start setup', 'เริ่มตั้งค่า')}</Button>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-muted-foreground text-sm">
            {tr('Runner fleet', 'ภาพรวม Runner')}
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {runners.length} {tr('managed', 'รายการ')}
          </p>
        </div>
        <Button variant="outline" onClick={() => onShowRunners('all')}>
          {tr('View all runners', 'ดู Runner ทั้งหมด')} <ArrowUpRight />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border lg:grid-cols-4">
        {counts.map(({ label, count, filter, color }) => (
          <button
            key={filter}
            type="button"
            onClick={() => onShowRunners(filter)}
            className="bg-background hover:bg-accent focus-visible:ring-ring flex min-h-32 flex-col items-start justify-between p-4 text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="text-muted-foreground text-sm">{label}</span>
            <span className={`text-4xl font-semibold tabular-nums ${color}`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-md border">
          <div className="flex items-center gap-2 border-b px-4 py-3 font-medium">
            <Activity className="size-4 text-info" />{' '}
            {tr('In progress', 'กำลังดำเนินการ')}{' '}
            <span className="text-muted-foreground ml-auto text-sm tabular-nums">
              {active.length}
            </span>
          </div>
          {active.length ? (
            active.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{r.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {targetLabel(r.target)}
                  </p>
                </div>
                <span className="text-muted-foreground max-w-48 truncate text-right text-xs">
                  {r.status.op ??
                    r.status.jobName ??
                    tr('Running a job', 'กำลังรันงาน')}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground px-4 py-6 text-sm">
              {tr(
                'No active jobs or operations.',
                'ไม่มีงานหรือคำสั่งที่กำลังดำเนินการ',
              )}
            </p>
          )}
        </section>
        <section className="rounded-md border">
          <button
            type="button"
            className="hover:bg-accent flex w-full items-center gap-2 border-b px-4 py-3 text-left font-medium"
            onClick={() => onShowRunners('problem')}
          >
            <CircleAlert className="text-destructive size-4" />{' '}
            {tr('Needs attention', 'ต้องตรวจสอบ')}{' '}
            <span className="text-muted-foreground ml-auto text-sm tabular-nums">
              {attention.length}
            </span>
          </button>
          {attention.length ? (
            attention.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{r.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {targetLabel(r.target)}
                  </p>
                </div>
                <span
                  className="text-destructive max-w-48 truncate text-right text-xs"
                  title={
                    r.status.broken ??
                    r.status.lastError ??
                    tr('Offline on GitHub', 'ออฟไลน์บน GitHub')
                  }
                >
                  {r.status.broken || r.status.lastError
                    ? localizeError(r.status.broken ?? r.status.lastError!)
                    : tr('Offline on GitHub', 'ออฟไลน์บน GitHub')}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground px-4 py-6 text-sm">
              {tr('No runners need attention.', 'ไม่มี Runner ที่ต้องตรวจสอบ')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
