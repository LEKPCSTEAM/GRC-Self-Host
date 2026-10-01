import { useEffect, useState } from 'react';
import type { Snapshot, VersionReport } from '../../shared/types';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

function older(installed: string, latest: string): boolean {
  const a = installed.split('.').map(Number);
  const b = latest.split('.').map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

export function VersionsPage({ snapshot }: { snapshot: Snapshot }) {
  const [report, setReport] = useState<VersionReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const check = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setReport(await api.invoke('versions:check'));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm">GitHub Actions runner version</p>
          <p className="text-muted-foreground text-xs">
            This checks the runner package. The GRC app version is shown in
            Settings.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void check()}
        >
          {loading ? 'Checking…' : 'Check now'}
        </Button>
      </div>
      {error && (
        <p className="text-destructive rounded-md border p-3 text-sm">
          Release check failed: {error}
        </p>
      )}
      {report && (
        <p className="text-muted-foreground text-sm">
          Latest release:{' '}
          <span className="text-foreground font-mono">{report.latest}</span>
          {' · '}Checked {new Date(report.checkedAt).toLocaleString()}
        </p>
      )}
      {snapshot.runners.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          No managed runners.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {snapshot.runners.map((runner) => {
            const data = report?.runners.find((item) => item.id === runner.id);
            const installed = data?.installed ?? runner.version;
            const behind = Boolean(
              installed && report && older(installed, report.latest),
            );
            return (
              <div
                key={runner.id}
                className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <p className="font-mono">{runner.name}</p>
                  <p className="text-muted-foreground text-xs">
                    Installed {installed ?? 'unknown'}
                    {behind && (
                      <span className="text-attention">
                        {' '}
                        · Update available
                      </span>
                    )}
                  </p>
                  {data?.updateIssue && (
                    <p className="text-destructive mt-1 text-xs">
                      {data.updateIssue}
                    </p>
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {runner.mode} runner
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
