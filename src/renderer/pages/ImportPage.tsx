import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ImportPreview, TargetOption } from '../../shared/types';
import { api, call, errorMessage } from '@/lib/api';
import { targetKey } from '@/lib/format';
import { useConnections } from '@/lib/hooks';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';

export function ImportPage() {
  const [connections] = useConnections();
  const [connectionId, setConnectionId] = useState('');
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [targetKeyValue, setTargetKeyValue] = useState('');
  const [dir, setDir] = useState('');
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const activeConnection = connectionId || connections[0]?.id || '';
  useEffect(() => {
    if (!activeConnection) return;
    let mounted = true;
    void call('connections:targets', activeConnection).then((items) => {
      if (mounted) {
        setTargets(items ?? []);
        setTargetKeyValue('');
      }
    });
    return () => {
      mounted = false;
    };
  }, [activeConnection]);
  const target =
    targets.find(
      (item) =>
        `${item.target.kind}:${targetKey(item.target)}` === targetKeyValue,
    )?.target ?? targets[0]?.target;
  const choose = async () => {
    const folder = await call('import:chooseDir');
    if (folder) {
      setDir(folder);
      setPreview(undefined);
    }
  };
  const inspect = async () => {
    if (!target || !dir) return;
    setBusy(true);
    try {
      setPreview(
        await api.invoke('import:preview', activeConnection, target, dir),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!preview) return;
    const ok = await confirm({
      title: `Manage local runner ${preview.name}?`,
      description:
        'This adds the existing runner folder to GRC. Autostart and cleanup start off. GRC can then stop, restart, repair or remove this runner.',
      confirmLabel: 'Import runner',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.invoke('import:commit', preview.id);
      toast.success(`Imported ${preview.name}`);
      setPreview(undefined);
      setDir('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-muted-foreground text-sm">
        Import an existing runner installed on this computer. GRC checks its
        .runner identity, GitHub ID, local executable and credentials, and a
        running local listener or installed service. A copied folder cannot be
        claimed.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          className="bg-background rounded border px-3 py-2 text-sm"
          value={activeConnection}
          onChange={(event) => {
            setConnectionId(event.target.value);
            setPreview(undefined);
          }}
        >
          <option value="">Choose connection</option>
          {connections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          className="bg-background rounded border px-3 py-2 text-sm"
          value={target ? `${target.kind}:${targetKey(target)}` : ''}
          onChange={(event) => {
            setTargetKeyValue(event.target.value);
            setPreview(undefined);
          }}
        >
          <option value="">Choose target</option>
          {targets.map((item) => (
            <option
              key={`${item.target.kind}:${targetKey(item.target)}`}
              value={`${item.target.kind}:${targetKey(item.target)}`}
            >
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void choose()}>
          Choose runner folder
        </Button>
        <span className="text-muted-foreground break-all font-mono text-xs">
          {dir || 'No folder chosen'}
        </span>
      </div>
      <Button disabled={!dir || !target || busy} onClick={() => void inspect()}>
        {busy ? 'Checking…' : 'Preview import'}
      </Button>
      {preview && (
        <div className="space-y-3 rounded border p-4 text-sm">
          <h2 className="font-medium">
            {preview.name} · GitHub ID {preview.githubId}
          </h2>
          <p className="text-muted-foreground">
            {preview.mode} · {preview.local} · GitHub {preview.github} · version{' '}
            {preview.version ?? 'unknown'}
          </p>
          <p className="text-muted-foreground font-mono text-xs break-all">
            {preview.dir}
          </p>
          <p className="text-xs">
            Labels: {preview.labels.join(', ') || 'none'}
          </p>
          {preview.checks.map((check) => (
            <p
              key={check.name}
              className={
                check.status === 'fail'
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }
            >
              {check.status}: {check.name} — {check.message}
            </p>
          ))}
          <Button
            disabled={
              busy || preview.checks.some((check) => check.status === 'fail')
            }
            onClick={() => void accept()}
          >
            Import this runner
          </Button>
        </div>
      )}
    </div>
  );
}
