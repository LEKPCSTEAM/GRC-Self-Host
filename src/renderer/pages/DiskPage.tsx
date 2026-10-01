import { useEffect, useState } from 'react';
import type { DiskReport, Snapshot } from '../../shared/types';
import { api, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { tr } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

export function DiskPage({ snapshot }: { snapshot: Snapshot }) {
  const [report, setReport] = useState<DiskReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const scan = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setReport(await api.invoke('disk:report'));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void scan();
  }, []);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {tr(
            'Logical file sizes for managed runner workspaces, diagnostics and the shared package cache.',
            'ขนาดไฟล์ของพื้นที่ทำงาน Runner ที่จัดการอยู่ ข้อมูลวินิจฉัย และแคชแพ็กเกจที่ใช้ร่วมกัน',
          )}
        </p>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void scan()}
        >
          {loading
            ? tr('Scanning…', 'กำลังสแกน…')
            : tr('Scan again', 'สแกนอีกครั้ง')}
        </Button>
      </div>
      {error && (
        <p className="text-destructive rounded-md border p-3 text-sm">
          {tr('Disk scan failed', 'สแกนดิสก์ไม่สำเร็จ')}: {error}
        </p>
      )}
      {report && (
        <div className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-3">
          <div>
            {tr('Managed total', 'รวมที่จัดการ')}{' '}
            <strong className="block text-lg">
              {formatBytes(report.totalBytes)}
            </strong>
          </div>
          <div>
            {tr('Shared package cache', 'แคชแพ็กเกจร่วม')}{' '}
            <strong className="block text-lg">
              {formatBytes(report.cacheBytes)}
            </strong>
          </div>
          <div className="text-muted-foreground">
            {tr('Scanned', 'สแกนเมื่อ')}{' '}
            {new Date(report.checkedAt).toLocaleString()}
          </div>
        </div>
      )}
      {report && (
        <div className="divide-y rounded-md border">
          {snapshot.runners.map((runner) => {
            const item = report.runners.find((entry) => entry.id === runner.id);
            if (!item) return null;
            return (
              <div
                key={runner.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span className="font-mono">{runner.name}</span>
                <span className="text-muted-foreground">
                  _work {formatBytes(item.workBytes)} · _diag{' '}
                  {formatBytes(item.diagBytes)} ·{' '}
                  {tr('clean estimate', 'คาดว่าจะล้างได้')}{' '}
                  {formatBytes(item.cleanBytes)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
