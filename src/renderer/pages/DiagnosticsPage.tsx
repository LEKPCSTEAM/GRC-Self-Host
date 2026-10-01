import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react';
import type { RunnerView, Snapshot } from '../../shared/types';
import { targetKey } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { localizeError, tr } from '@/lib/i18n';

function nextStep(error?: string): string {
  if (!error)
    return tr(
      'Target access works. Check the runner process if it remains offline.',
      'เข้าถึง target ได้ หาก Runner ยังออฟไลน์ ให้ตรวจโปรเซสในเครื่อง',
    );
  if (error.includes('rate limit'))
    return tr(
      'Wait for the GitHub API rate limit to reset, then check again.',
      'รอให้ GitHub รีเซ็ตจำนวนคำขอ แล้วตรวจอีกครั้ง',
    );
  if (error.includes('401'))
    return tr(
      'Replace the token in Connections, then check again.',
      'เปลี่ยน token ในหน้า Connections แล้วตรวจอีกครั้ง',
    );
  if (error.includes('403'))
    return tr(
      'Grant runner administration access to this target, then check again.',
      'ให้สิทธิ์จัดการ Runner ใน target นี้ แล้วตรวจอีกครั้ง',
    );
  if (error.includes('404'))
    return tr(
      'Check the target name and whether this token can access it.',
      'ตรวจชื่อ target และสิทธิ์การเข้าถึงของ token',
    );
  if (error === 'GitHub has not been checked yet')
    return tr('Wait for the first GitHub poll.', 'รอการตรวจ GitHub ครั้งแรก');
  return tr(
    'Check network access to GitHub and the connection token, then retry.',
    'ตรวจเครือข่ายและ token แล้วลองอีกครั้ง',
  );
}

function time(value?: string): string {
  return value ? new Date(value).toLocaleString() : tr('Never', 'ไม่เคย');
}

export function DiagnosticsPage({
  snapshot,
  onShowProblems,
}: {
  snapshot: Snapshot;
  onShowProblems: () => void;
}) {
  const groups = new Map<string, RunnerView[]>();
  for (const runner of snapshot.runners) {
    const key = `${runner.connectionId}:${targetKey(runner.target).toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), runner]);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          {tr(
            'GitHub access is checked for each target with managed runners. Local status comes from this machine; GitHub status comes from the latest API poll.',
            'ตรวจสิทธิ์ GitHub ของแต่ละ target ที่มี Runner ในระบบ สถานะในเครื่องมาจากเครื่องนี้ ส่วนสถานะ GitHub มาจากการตรวจ API ล่าสุด',
          )}
        </p>
        <Button variant="outline" onClick={onShowProblems}>
          {tr('Show runners needing attention', 'ดู Runner ที่ต้องตรวจสอบ')}
        </Button>
      </div>
      {groups.size === 0 && (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          {tr(
            'Create a runner to see target and machine diagnostics here.',
            'สร้าง Runner เพื่อดูผลตรวจ target และเครื่องที่นี่',
          )}
        </p>
      )}
      {[...groups.entries()].map(([key, runners]) => {
        const first = runners[0]!;
        const status = first.status;
        const error =
          status.githubCheckedAt === status.githubSyncedAt
            ? undefined
            : status.githubError;
        const access = !status.githubCheckedAt
          ? tr('Not checked', 'ยังไม่ตรวจ')
          : error
            ? error.includes('rate limit')
              ? tr('Rate limited', 'คำขอเกินกำหนด')
              : error.includes('401')
                ? tr('Token rejected', 'token ถูกปฏิเสธ')
                : error.includes('403')
                  ? tr('Access denied', 'ถูกปฏิเสธสิทธิ์')
                  : tr('Unknown', 'ไม่ทราบ')
            : tr('Access verified', 'ตรวจสิทธิ์ผ่าน');
        const Icon =
          !status.githubCheckedAt ||
          (error &&
            !error.includes('401') &&
            !error.includes('403') &&
            !error.includes('rate limit'))
            ? CircleHelp
            : error
              ? CircleAlert
              : CircleCheck;
        return (
          <section key={key} className="rounded-md border">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
              <div>
                <h2 className="font-mono font-medium">
                  {targetKey(first.target)}
                </h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  {runners.length}{' '}
                  {tr(
                    `managed runner${runners.length === 1 ? '' : 's'}`,
                    'Runner ที่จัดการ',
                  )}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-sm">
                <Icon className="size-4" /> {access}
              </span>
            </div>
            <div className="grid gap-3 border-b p-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">
                  {tr('Last GitHub check', 'ตรวจ GitHub ล่าสุด')}
                </span>
                <p>{time(status.githubCheckedAt)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">
                  {tr('Last successful sync', 'ซิงก์สำเร็จล่าสุด')}
                </span>
                <p>{time(status.githubSyncedAt)}</p>
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">
                  {tr('Latest API result', 'ผล API ล่าสุด')}
                </span>
                <p className={error ? 'text-destructive' : ''}>
                  {error
                    ? localizeError(error)
                    : tr(
                        'Runner list loaded successfully',
                        'โหลดรายการ Runner สำเร็จ',
                      )}
                </p>
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">
                  {tr('Next step', 'ขั้นตอนถัดไป')}
                </span>
                <p>{nextStep(error)}</p>
              </div>
            </div>
            <div className="divide-y">
              {runners.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm"
                >
                  <span className="min-w-40 font-mono">{r.name}</span>
                  <span>
                    {tr('Local', 'ในเครื่อง')}{' '}
                    {r.mode === 'service'
                      ? tr('service', 'เซอร์วิส')
                      : tr('process', 'โปรเซส')}
                    : {r.status.local}
                  </span>
                  <span>GitHub: {r.status.github}</span>
                  {r.status.github === 'unknown' && r.status.githubError && (
                    <span className="text-attention">
                      {localizeError(r.status.githubError)}
                    </span>
                  )}
                  {r.status.broken && (
                    <span className="text-destructive">
                      {localizeError(r.status.broken)}
                    </span>
                  )}
                  {r.status.op && (
                    <span className="text-muted-foreground">{r.status.op}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
