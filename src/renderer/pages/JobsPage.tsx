import { useEffect, useState } from 'react';
import type { JobReport, RunnerJob, Snapshot } from '../../shared/types';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

function duration(job: RunnerJob): string {
  if (!job.startedAt) return 'Duration unknown';
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  const seconds = Math.max(
    0,
    Math.floor((end - Date.parse(job.startedAt)) / 1000),
  );
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function JobsPage({ snapshot }: { snapshot: Snapshot }) {
  const [runnerId, setRunnerId] = useState(snapshot.runners[0]?.id ?? '');
  const [report, setReport] = useState<JobReport>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const selected = snapshot.runners.find((runner) => runner.id === runnerId);
  const load = async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(undefined);
    setReport(undefined);
    try {
      setReport(await api.invoke('jobs:list', id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(runnerId);
  }, [runnerId]);
  const open = async (id: number) => {
    try {
      await api.invoke('jobs:open', id);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const current = report?.jobs.find((job) => job.status === 'in_progress');
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-muted-foreground text-sm">
        Recent jobs for repository runners. The connection needs Actions: read
        permission. Each refresh uses at most 11 GitHub API requests.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="bg-background rounded-md border px-3 py-2 text-sm"
          value={runnerId}
          onChange={(event) => setRunnerId(event.target.value)}
        >
          {snapshot.runners.map((runner) => (
            <option key={runner.id} value={runner.id}>
              {runner.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={!runnerId || loading}
          onClick={() => void load(runnerId)}
        >
          {loading ? 'Loading…' : 'Refresh jobs'}
        </Button>
      </div>
      {error && (
        <p className="text-destructive rounded-md border p-3 text-sm">
          {error}
        </p>
      )}
      {selected?.status.busy && !current && report && (
        <p className="rounded-md border p-3 text-sm">
          Runner is busy, but its current job was not found in the recent
          repository runs. It may belong to another repository or be outside the
          scan window.
        </p>
      )}
      {current && (
        <div className="rounded-md border p-4 text-sm">
          <p className="text-muted-foreground text-xs">Current job</p>
          <p className="font-medium">{current.name}</p>
          <p className="text-muted-foreground">
            {current.workflow} · {duration(current)}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => void open(current.id)}
          >
            Open on GitHub
          </Button>
        </div>
      )}
      {report?.message && (
        <p className="text-muted-foreground text-xs">{report.message}</p>
      )}
      {report && (
        <p className="text-muted-foreground text-xs">
          Checked {new Date(report.checkedAt).toLocaleString()} ·{' '}
          {report.scannedRuns} workflow runs scanned
        </p>
      )}
      {report && report.jobs.length === 0 && (
        <p className="text-muted-foreground rounded-md border p-4 text-sm">
          No matching jobs found.
        </p>
      )}
      {report && report.jobs.length > 0 && (
        <div className="divide-y rounded-md border">
          {report.jobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div>
                <p className="font-medium">{job.name}</p>
                <p className="text-muted-foreground text-xs">
                  {job.workflow ?? 'Workflow'} ·{' '}
                  {job.startedAt
                    ? new Date(job.startedAt).toLocaleString()
                    : 'Start unknown'}{' '}
                  · {duration(job)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span>{job.conclusion ?? job.status}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void open(job.id)}
                >
                  Open
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
