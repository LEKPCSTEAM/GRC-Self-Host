import { useEffect, useState } from 'react';
import { Eye, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Snapshot, Target } from '../../shared/types';
import { api, call, errorMessage } from '@/lib/api';
import { targetKey } from '@/lib/format';
import { useConnections } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function parseTarget(value: string): Target | null {
  const parts = value.trim().split('/');
  if (parts.length === 1 && parts[0]) return { kind: 'org', owner: parts[0] };
  if (parts.length === 2 && parts.every(Boolean))
    return { kind: 'repo', owner: parts[0]!, repo: parts[1]! };
  return null;
}

export function WatchPage({ snapshot }: { snapshot: Snapshot }) {
  const [connections] = useConnections();
  const [connectionId, setConnectionId] = useState('');
  const [targetText, setTargetText] = useState('');
  useEffect(() => {
    if (!connections.some((c) => c.id === connectionId))
      setConnectionId(connections[0]?.id ?? '');
  }, [connections, connectionId]);

  const add = async () => {
    const target = parseTarget(targetText);
    if (!target || !connectionId) return;
    const result = await call('watch:add', connectionId, target);
    if (result) {
      setTargetText('');
      toast.success(`Watching ${targetKey(target)}`);
    }
  };

  return (
    <div className="max-w-4xl space-y-5">
      <p className="text-muted-foreground text-sm">
        Watch a GitHub repository or organization without creating a local
        runner. Runners in watched targets are read-only.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <Eye className="text-muted-foreground size-4" />
        <Select value={connectionId} onValueChange={setConnectionId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Connection" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="min-w-56 flex-1 font-mono"
          value={targetText}
          onChange={(e) => setTargetText(e.target.value)}
          placeholder="owner/repo or organization"
          aria-label="Target to watch"
        />
        <Button
          onClick={add}
          disabled={!connectionId || !parseTarget(targetText)}
        >
          Watch target
        </Button>
      </div>
      {snapshot.watched.length === 0 && (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          No watched targets yet.
        </p>
      )}
      {snapshot.watched.map((watch) => {
        const runners = snapshot.foreign.filter(
          (r) =>
            r.connectionId === watch.connectionId &&
            targetKey(r.target).toLowerCase() ===
              targetKey(watch.target).toLowerCase(),
        );
        const managed = snapshot.runners.filter(
          (r) =>
            r.connectionId === watch.connectionId &&
            targetKey(r.target).toLowerCase() ===
              targetKey(watch.target).toLowerCase() &&
            (r.status.github === 'online' || r.status.github === 'offline'),
        );
        return (
          <section key={watch.id} className="rounded-md border">
            <div className="flex items-center justify-between gap-3 border-b p-3">
              <div>
                <h2 className="font-mono font-medium">
                  {targetKey(watch.target)}
                </h2>
                <p className="text-muted-foreground text-xs">
                  {connections.find((c) => c.id === watch.connectionId)?.name ??
                    'Missing connection'}{' '}
                  ·{' '}
                  {watch.checkedAt
                    ? `Checked ${new Date(watch.checkedAt).toLocaleString()}`
                    : 'Not checked yet'}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Stop watching ${targetKey(watch.target)}`}
                onClick={async () => {
                  try {
                    await api.invoke('watch:remove', watch.id);
                    toast.success(
                      `Stopped watching ${targetKey(watch.target)}`,
                    );
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                <Trash2 />
              </Button>
            </div>
            {watch.error ? (
              <p className="text-destructive p-3 text-sm">{watch.error}</p>
            ) : runners.length || managed.length ? (
              <div className="divide-y">
                {managed.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="min-w-40 font-mono">{r.name}</span>
                    <span>{r.status.busy ? 'Busy' : r.status.github}</span>
                    <span className="text-muted-foreground">
                      Managed locally
                    </span>
                    <span className="text-muted-foreground truncate">
                      {r.labels.join(', ')}
                    </span>
                  </div>
                ))}
                {runners.map((r) => (
                  <div
                    key={r.githubId}
                    className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="min-w-40 font-mono">{r.name}</span>
                    <span>{r.busy ? 'Busy' : r.status}</span>
                    <span className="text-muted-foreground">{r.os}</span>
                    <span className="text-muted-foreground truncate">
                      {r.labels.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground p-3 text-sm">
                No runners reported by GitHub.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
