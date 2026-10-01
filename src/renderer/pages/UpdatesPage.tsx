import { toast } from 'sonner';
import type { AppReleaseInfo } from '../../shared/types';
import { api, errorMessage } from '@/lib/api';
import { tr } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

export function UpdatesPage({
  release,
  error,
  onCheck,
}: {
  release: AppReleaseInfo | null | undefined;
  error?: string;
  onCheck: () => void;
}) {
  const open = async () => {
    try {
      await api.invoke('app:openRelease');
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {tr(
            'Checks published GRC Self-Host releases. Downloads open in your browser; installation is manual.',
            'ตรวจรุ่นที่เผยแพร่ของ GRC Self-Host โดยเปิดหน้าดาวน์โหลดในเบราว์เซอร์และติดตั้งด้วยตนเอง',
          )}
        </p>
        <Button variant="outline" onClick={onCheck}>
          {tr('Check again', 'ตรวจอีกครั้ง')}
        </Button>
      </div>
      {error && (
        <p className="text-destructive rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
      {release === undefined && !error && (
        <p className="text-muted-foreground text-sm">
          {tr('Checking for releases…', 'กำลังตรวจรุ่นที่เผยแพร่…')}
        </p>
      )}
      {release === null && (
        <p className="text-muted-foreground rounded-md border p-4 text-sm">
          {tr('No published release is available yet.', 'ยังไม่มีรุ่นที่เผยแพร่')}
        </p>
      )}
      {release && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">
                {release.available
                  ? tr('New app version available', 'มีแอปรุ่นใหม่')
                  : tr('App is up to date', 'แอปเป็นรุ่นล่าสุดแล้ว')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {tr('Installed', 'ติดตั้ง')} {release.current} ·{' '}
                {tr('Latest', 'ล่าสุด')} {release.latest} ·{' '}
                {tr('Checked', 'ตรวจเมื่อ')}{' '}
                {new Date(release.checkedAt).toLocaleString()}
              </p>
            </div>
            <Button onClick={() => void open()}>
              {tr('Open downloads', 'เปิดหน้าดาวน์โหลด')}
            </Button>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">
              {release.title} · {tr('Release notes', 'รายละเอียดรุ่น')}
            </h3>
            <pre className="bg-muted max-h-96 overflow-auto rounded p-3 text-xs whitespace-pre-wrap break-words">
              {release.notes ||
                tr('No release notes provided.', 'ไม่มีรายละเอียดรุ่น')}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
