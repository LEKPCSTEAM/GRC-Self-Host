import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type {
  PreflightCheck,
  Snapshot,
  TargetOption,
} from '../../shared/types';
import { api, call, errorMessage } from '@/lib/api';
import { sameTarget, targetKey } from '@/lib/format';
import { useConnections } from '@/lib/hooks';
import type { Form } from '@/components/CreateDialog';
import { Button } from '@/components/ui/button';

export function OnboardingPage({
  snapshot,
  onConnections,
  onCreate,
  onRunners,
}: {
  snapshot: Snapshot;
  onConnections: () => void;
  onCreate: (form: Form) => void;
  onRunners: () => void;
}) {
  const [connections, reloadConnections] = useConnections();
  const [connectionId, setConnectionId] = useState('');
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [targetKeyValue, setTargetKeyValue] = useState('');
  const [checks, setChecks] = useState<PreflightCheck[]>();
  const [checking, setChecking] = useState(false);
  const activeConnection = connectionId || connections[0]?.id || '';
  useEffect(() => {
    if (!activeConnection) return;
    let mounted = true;
    void call('connections:targets', activeConnection).then((items) => {
      if (mounted) {
        setTargets(items ?? []);
        setTargetKeyValue('');
        setChecks(undefined);
      }
    });
    return () => {
      mounted = false;
    };
  }, [activeConnection]);
  const target = targets.find(
    (item) =>
      `${item.target.kind}:${targetKey(item.target)}` === targetKeyValue,
  )?.target;
  const matching = target
    ? snapshot.runners.filter(
        (runner) =>
          runner.connectionId === activeConnection &&
          sameTarget(runner.target, target),
      )
    : snapshot.runners;
  const online = matching.some((runner) => runner.status.github === 'online');
  const ready = checks && !checks.some((check) => check.status === 'fail');
  const form: Form | undefined = target
    ? {
        connectionId: activeConnection,
        target,
        count: 1,
        prefix: 'runner',
        labels: [],
        mode: 'child',
        autostart: true,
        cleanup: { enabled: true, actions: false, tool: false },
      }
    : undefined;
  const preflight = async () => {
    if (!form) return;
    setChecking(true);
    try {
      setChecks(await api.invoke('runners:preflight', form));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setChecking(false);
    }
  };
  const steps = [
    {
      label: '1. Connect GitHub',
      done: connections.length > 0,
      detail: 'Add a token with runner administration permission.',
      action: (
        <Button size="sm" variant="outline" onClick={onConnections}>
          Open Connections
        </Button>
      ),
    },
    {
      label: '2. Choose a target',
      done: Boolean(target || snapshot.runners.length),
      detail: 'Select the repository or organization that will own the runner.',
      action: null,
    },
    {
      label: '3. Run preflight',
      done: Boolean(ready || snapshot.runners.length),
      detail:
        'Check registration permission, path, disk space and required commands.',
      action: (
        <Button
          size="sm"
          variant="outline"
          disabled={!target || checking}
          onClick={() => void preflight()}
        >
          {checking ? 'Checking…' : 'Run preflight'}
        </Button>
      ),
    },
    {
      label: '4. Create a runner',
      done: matching.length > 0,
      detail: 'Review the create preview and any public repository warning.',
      action: (
        <Button
          size="sm"
          variant="outline"
          disabled={!form || !ready}
          onClick={() => form && onCreate(form)}
        >
          Create runner
        </Button>
      ),
    },
    {
      label: '5. Verify online',
      done: online,
      detail: 'Wait for GitHub sync and verify the new runner is online.',
      action: (
        <Button size="sm" variant="outline" onClick={onRunners}>
          View runners
        </Button>
      ),
    },
  ];
  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-muted-foreground text-sm">
        Follow these steps to connect GitHub, create a local runner and confirm
        that GitHub sees it online.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          className="bg-background rounded border px-3 py-2 text-sm"
          value={activeConnection}
          onChange={(event) => {
            setConnectionId(event.target.value);
            setChecks(undefined);
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
          value={targetKeyValue}
          onChange={(event) => {
            setTargetKeyValue(event.target.value);
            setChecks(undefined);
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
        <Button variant="ghost" size="sm" onClick={reloadConnections}>
          Refresh connections
        </Button>
      </div>
      {checks && (
        <div className="space-y-1 rounded border p-3 text-xs">
          {checks.map((check) => (
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
        </div>
      )}
      <div className="divide-y rounded border">
        {steps.map((step) => (
          <div
            key={step.label}
            className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
          >
            <div>
              <p className="font-medium">
                {step.done ? '✓ ' : '○ '}
                {step.label}
              </p>
              <p className="text-muted-foreground text-xs">{step.detail}</p>
            </div>
            {step.action}
          </div>
        ))}
      </div>
      {online && (
        <p className="rounded border border-success/40 bg-success/10 p-3 text-sm text-success">
          Onboarding complete: a managed runner is online on GitHub.
        </p>
      )}
    </div>
  );
}
