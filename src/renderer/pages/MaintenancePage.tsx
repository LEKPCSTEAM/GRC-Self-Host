import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { MaintenanceTask, Snapshot } from '../../shared/types';
import { api, errorMessage } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export function MaintenancePage({ snapshot }: { snapshot: Snapshot }) {
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<MaintenanceTask['action']>('clean');
  const [runAt, setRunAt] = useState('');
  const [skipBusy, setSkipBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const names = new Map(
    snapshot.runners.map((runner) => [runner.id, runner.name]),
  );
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await api.invoke('maintenance:list');
        if (mounted) setTasks(next);
      } catch (error) {
        if (mounted) toast.error(errorMessage(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);
  const schedule = async () => {
    if (!selected.length || !runAt) return;
    const date = new Date(runAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      toast.error('Choose a future date and time');
      return;
    }
    const ok = await confirm({
      title: `Schedule ${action} for ${selected.length} runner${selected.length === 1 ? '' : 's'}?`,
      description: (
        <div className="space-y-2 text-left">
          <p>{date.toLocaleString()}</p>
          <p>{selected.map((id) => names.get(id) ?? id).join(', ')}</p>
          <p>
            {action === 'clean' || skipBusy
              ? 'Busy runners will be skipped.'
              : 'A restart will interrupt any running job.'}
          </p>
        </div>
      ),
      confirmLabel: 'Schedule',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.invoke(
        'maintenance:schedule',
        action,
        selected,
        date.toISOString(),
        skipBusy,
      );
      setTasks(await api.invoke('maintenance:list'));
      setSelected([]);
      toast.success('Maintenance scheduled');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await api.invoke('maintenance:cancel', id);
      setTasks(await api.invoke('maintenance:list'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-muted-foreground text-sm">
        One-time maintenance runs while this app is open. If the app is closed
        at the scheduled time, the task runs when it opens again. Clean always
        skips busy runners.
      </p>
      <section className="space-y-4 rounded-md border p-4">
        <h2 className="font-medium">Schedule maintenance</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={action === 'clean' ? 'default' : 'outline'}
            onClick={() => setAction('clean')}
          >
            Clean
          </Button>
          <Button
            size="sm"
            variant={action === 'restart' ? 'default' : 'outline'}
            onClick={() => setAction('restart')}
          >
            Restart
          </Button>
          <Input
            type="datetime-local"
            className="w-auto"
            value={runAt}
            onChange={(event) => setRunAt(event.target.value)}
          />
        </div>
        <div className="grid max-h-40 gap-2 overflow-auto rounded border p-3 sm:grid-cols-2">
          {snapshot.runners.map((runner) => (
            <label key={runner.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(runner.id)}
                onCheckedChange={(value) =>
                  setSelected((current) =>
                    value === true
                      ? [...current, runner.id]
                      : current.filter((id) => id !== runner.id),
                  )
                }
              />
              {runner.name}
            </label>
          ))}
        </div>
        {action === 'restart' && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={skipBusy}
              onCheckedChange={(value) => setSkipBusy(value === true)}
            />
            Skip runners running a job
          </label>
        )}
        <p className="text-muted-foreground text-xs">
          Preview: {selected.length} runner{selected.length === 1 ? '' : 's'} ·{' '}
          {action} ·{' '}
          {runAt ? new Date(runAt).toLocaleString() : 'choose a time'} ·{' '}
          {action === 'clean' || skipBusy
            ? 'skip busy'
            : 'restart even if busy'}
        </p>
        <Button
          disabled={saving || !selected.length || !runAt}
          onClick={() => void schedule()}
        >
          Schedule
        </Button>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Scheduled and recent tasks</h2>
        {tasks.length === 0 && (
          <p className="text-muted-foreground rounded border p-4 text-sm">
            No maintenance tasks.
          </p>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded border p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {task.action} · {new Date(task.runAt).toLocaleString()}
              </p>
              <p className="text-muted-foreground text-xs">
                {task.runnerIds.map((id) => names.get(id) ?? id).join(', ')} ·{' '}
                {task.state}
              </p>
              {task.error && (
                <p className="text-destructive text-xs">{task.error}</p>
              )}
              {task.results && (
                <p className="text-muted-foreground text-xs">
                  {task.results.filter((r) => r.ok).length} succeeded ·{' '}
                  {task.results.filter((r) => r.skipped).length} skipped ·{' '}
                  {task.results.filter((r) => !r.ok && !r.skipped).length}{' '}
                  failed
                </p>
              )}
            </div>
            {task.state === 'scheduled' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancel(task.id)}
              >
                Cancel
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
