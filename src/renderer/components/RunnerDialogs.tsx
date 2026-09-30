import { useEffect, useState } from 'react';
import type {
  CleanupOptions,
  RunnerMode,
  RunnerView,
} from '../../shared/types';
import { call, reportBulk } from '@/lib/api';
import { splitList } from '@/lib/format';
import { useAppInfo } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LabelsDialog({
  runners,
  onClose,
}: {
  runners: RunnerView[] | null;
  onClose: () => void;
}) {
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAdd('');
    setRemove('');
  }, [runners]);

  const existing = [...new Set(runners?.flatMap((r) => r.labels) ?? [])];

  const apply = async () => {
    if (!runners) return;
    setBusy(true);
    const res = await call(
      'runners:setLabels',
      runners.map((r) => r.id),
      splitList(add),
      splitList(remove),
    );
    setBusy(false);
    reportBulk(
      'Updated labels on',
      res,
      new Map(runners.map((r) => [r.id, r.name])),
    );
    if (res) onClose();
  };

  return (
    <Dialog open={runners !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit labels</DialogTitle>
          <DialogDescription>
            {runners?.length} runner{runners?.length === 1 ? '' : 's'} · applied
            on GitHub immediately, no re-registration.
          </DialogDescription>
        </DialogHeader>
        {existing.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {existing.map((l) => (
              <button
                key={l}
                type="button"
                className="bg-secondary hover:bg-destructive/20 rounded px-2 py-0.5 font-mono text-xs"
                title="Click to remove"
                onClick={() =>
                  setRemove((r) =>
                    [...new Set([...splitList(r), l])].join(', '),
                  )
                }
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label>Add</Label>
          <Input
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            placeholder="gpu, windows-build"
            className="font-mono"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Remove</Label>
          <Input
            value={remove}
            onChange={(e) => setRemove(e.target.value)}
            className="font-mono"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            disabled={busy || (!add.trim() && !remove.trim())}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ModeDialog({
  runner,
  onClose,
}: {
  runner: RunnerView | null;
  onClose: () => void;
}) {
  const info = useAppInfo();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    setAccount(runner?.serviceAccount ?? '');
    setPassword('');
  }, [runner]);

  if (!runner) return null;
  const to: RunnerMode = runner.mode === 'child' ? 'service' : 'child';
  const isWin = info?.platform === 'win32';

  const apply = () => {
    // Runs in the background; progress shows in the table.
    void call(
      'runners:setMode',
      runner.id,
      to,
      account || undefined,
      password || undefined,
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Switch {runner.name} to{' '}
            {to === 'service' ? 'OS service' : 'app process'}
          </DialogTitle>
          <DialogDescription>
            {isWin
              ? 'On Windows the runner is re-registered with the same name (--replace). Administrator approval is required.'
              : to === 'service'
                ? 'Installs a systemd service with svc.sh. Administrator approval is required.'
                : 'Uninstalls the systemd service. Administrator approval is required.'}
          </DialogDescription>
        </DialogHeader>
        {to === 'service' && isWin && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Service account</Label>
              <Input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="NETWORK SERVICE"
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!account}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Switch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OptionsDialog({
  runner,
  onClose,
}: {
  runner: RunnerView | null;
  onClose: () => void;
}) {
  const [autostart, setAutostart] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupOptions>({
    enabled: true,
    actions: false,
    tool: false,
  });
  useEffect(() => {
    if (runner) {
      setAutostart(runner.autostart);
      setCleanup(runner.cleanup);
    }
  }, [runner]);
  if (!runner) return null;

  const save = async () => {
    await call('runners:setOptions', runner.id, { autostart, cleanup });
    onClose();
  };

  const check = (
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    disabled = false,
  ) => (
    <Label className="font-normal">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
      />
      {label}
    </Label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Options · {runner.name}</DialogTitle>
          <DialogDescription>
            Cleanup changes take effect the next time the runner starts.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {runner.mode === 'child' &&
            check(
              autostart,
              setAutostart,
              'Start automatically when the app starts',
            )}
          {check(
            cleanup.enabled,
            (enabled) => setCleanup({ ...cleanup, enabled }),
            'Clean the job workspace and _temp after every job',
          )}
          <div className="flex flex-col gap-3 pl-6">
            {check(
              cleanup.actions,
              (actions) => setCleanup({ ...cleanup, actions }),
              'Also clear _actions',
              !cleanup.enabled,
            )}
            {check(
              cleanup.tool,
              (tool) => setCleanup({ ...cleanup, tool }),
              'Also clear _tool',
              !cleanup.enabled,
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
