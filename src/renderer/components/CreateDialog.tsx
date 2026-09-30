import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import type {
  Preset,
  RunnerGroup,
  Target,
  TargetOption,
} from '../../shared/types';
import { api, call } from '@/lib/api';
import { splitList, targetKey } from '@/lib/format';
import { useAppInfo, useConnections, usePresets } from '@/lib/hooks';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type Form = Omit<Preset, 'id' | 'name'>;

/** Matches the labels the main process builds for organization options. */
const ORG_SUFFIX = ' (organization)';

function targetText(t: Target): string {
  if (!t.owner) return '';
  return t.kind === 'org' ? t.owner + ORG_SUFFIX : targetKey(t);
}

/** A listed option by label; otherwise "owner/repo" is a repository and a bare name an organization. */
function parseTarget(text: string, options: TargetOption[] | null): Target {
  const t = text.trim();
  const hit = options?.find((o) => o.label.toLowerCase() === t.toLowerCase());
  if (hit) return hit.target;
  const name = t.endsWith(ORG_SUFFIX) ? t.slice(0, -ORG_SUFFIX.length) : t;
  if (name.includes('/')) {
    const [owner = '', repo = ''] = name.split('/');
    return { kind: 'repo', owner: owner.trim(), repo: repo.trim() };
  }
  return { kind: 'org', owner: name };
}

function defaultForm(hostname: string, connectionId: string): Form {
  return {
    connectionId,
    target: { kind: 'repo', owner: '', repo: '' },
    count: 1,
    prefix:
      hostname
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .slice(0, 40) || 'runner',
    labels: [],
    mode: 'child',
    autostart: true,
    cleanup: { enabled: true, actions: false, tool: false },
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Label className="font-normal">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
      />
      {children}
    </Label>
  );
}

export function CreateDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Form;
}) {
  const info = useAppInfo();
  const [connections, reloadConnections] = useConnections();
  const [presets, reloadPresets] = usePresets();
  const [form, setForm] = useState<Form | null>(null);
  const [labelsText, setLabelsText] = useState('');
  const [targets, setTargets] = useState<TargetOption[] | null>(null);
  const [targetInput, setTargetInput] = useState('');
  const [groups, setGroups] = useState<RunnerGroup[]>([]);
  const [password, setPassword] = useState('');
  const [presetName, setPresetName] = useState('');
  const [busy, setBusy] = useState(false);

  const isWin = info?.platform === 'win32';

  // Reset whenever the dialog opens.
  useEffect(() => {
    if (!open || !info) return;
    const f = initial ?? defaultForm(info.hostname, connections[0]?.id ?? '');
    setForm(f);
    setLabelsText(f.labels.join(', '));
    setPassword('');
    setPresetName('');
    setTargetInput(targetText(f.target));
    if (open) {
      reloadConnections();
      reloadPresets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, info, initial]);

  // Pick the first connection once the list arrives.
  useEffect(() => {
    if (form && !form.connectionId && connections[0])
      set({ connectionId: connections[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, form?.connectionId]);

  const set = (patch: Partial<Form>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  // Load targets for the chosen connection.
  const connectionId = form?.connectionId;
  useEffect(() => {
    if (!open || !connectionId) return;
    setTargets(null);
    call('connections:targets', connectionId).then((t) => setTargets(t ?? []));
  }, [open, connectionId]);

  const org =
    form?.target.kind === 'org' && form.target.owner ? form.target.owner : null;
  // Debounced and silent: the org name may still be half-typed.
  useEffect(() => {
    setGroups([]);
    if (!open || !connectionId || !org) return;
    const timer = setTimeout(() => {
      api
        .invoke('connections:runnerGroups', connectionId, org)
        .then(setGroups)
        .catch(() => setGroups([]));
    }, 600);
    return () => clearTimeout(timer);
  }, [open, connectionId, org]);

  if (!form) return null;

  const targetValid =
    form.target.kind === 'repo'
      ? Boolean(form.target.owner && form.target.repo)
      : Boolean(form.target.owner);
  const valid =
    Boolean(form.connectionId) &&
    targetValid &&
    form.count >= 1 &&
    form.count <= 50 &&
    form.prefix.trim().length > 0;

  const current = (): Form => ({
    ...form,
    labels: splitList(labelsText),
    prefix: form.prefix.trim(),
  });

  const create = async () => {
    setBusy(true);
    const f = current();
    const ids = await call('runners:create', {
      ...f,
      servicePassword:
        f.mode === 'service' && isWin && f.serviceAccount
          ? password
          : undefined,
    });
    setBusy(false);
    if (ids) {
      toast.success(
        `Creating ${ids.length} runner${ids.length === 1 ? '' : 's'}…`,
      );
      onOpenChange(false);
    }
  };

  const savePreset = async () => {
    if (!presetName.trim()) return;
    const p = await call('presets:save', {
      ...current(),
      name: presetName.trim(),
    });
    if (p) {
      toast.success(`Saved preset "${p.name}"`);
      setPresetName('');
      reloadPresets();
    }
  };

  const loadPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const { id: _id, name: _name, ...rest } = p;
    setForm(rest);
    setLabelsText(rest.labels.join(', '));
    setTargetInput(targetText(rest.target));
  };

  const onTargetInput = (text: string) => {
    setTargetInput(text);
    set({ target: parseTarget(text, targets), runnerGroup: undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create runners</DialogTitle>
          <DialogDescription>
            Downloads the latest runner, verifies its SHA256 and registers{' '}
            {form.count} runner{form.count === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {presets.length > 0 && (
            <div className="col-span-2">
              <Field label="Preset">
                <Select onValueChange={loadPreset}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Load a preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          <Field label="Connection">
            <Select
              value={form.connectionId}
              onValueChange={(v) => set({ connectionId: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    connections.length ? 'Choose…' : 'Add a connection first'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} (@{c.login})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Target"
            hint={
              targets === null && form.connectionId
                ? 'Loading repositories…'
                : 'Type to search, or enter owner/repo (repository) or a name (organization).'
            }
          >
            <Input
              list="grc-targets"
              value={targetInput}
              onChange={(e) => onTargetInput(e.target.value)}
              placeholder="owner/repo or organization"
              disabled={!form.connectionId}
              className="font-mono"
            />
            <datalist id="grc-targets">
              {targets?.map((t) => (
                <option key={t.label} value={t.label} />
              ))}
            </datalist>
          </Field>

          {form.target.kind === 'org' && (
            <Field label="Runner group">
              <Select
                value={form.runnerGroup ?? 'Default'}
                onValueChange={(v) =>
                  set({ runnerGroup: v === 'Default' ? undefined : v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(groups.length ? groups : [{ id: 1, name: 'Default' }]).map(
                    (g) => (
                      <SelectItem key={g.id} value={g.name}>
                        {g.name}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="col-span-2 grid grid-cols-[6rem_1fr] gap-4">
            {/* count 0 means "empty while typing"; Create stays disabled until it is valid. */}
            <Field label="Count">
              <Input
                type="number"
                min={1}
                max={50}
                value={form.count || ''}
                onChange={(e) =>
                  set({
                    count: Math.min(
                      50,
                      Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                    ),
                  })
                }
              />
            </Field>
            <Field
              label="Name prefix"
              hint={`Runners are named ${form.prefix || 'prefix'}-01, ${form.prefix || 'prefix'}-02, …`}
            >
              <Input
                value={form.prefix}
                onChange={(e) => set({ prefix: e.target.value })}
                className="font-mono"
              />
            </Field>
          </div>

          <div className="col-span-2">
            <Field
              label="Custom labels"
              hint="Comma separated. self-hosted, OS and architecture labels are added by GitHub."
            >
              <Input
                value={labelsText}
                onChange={(e) => setLabelsText(e.target.value)}
                placeholder="build, gpu"
                className="font-mono"
              />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="Run as">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    [
                      'child',
                      'App process',
                      'Started by this app. Live output, no admin needed. Stops when the app quits.',
                    ],
                    [
                      'service',
                      'OS service',
                      `Runs without the app and after reboot. Needs administrator approval (${isWin ? 'UAC' : 'polkit'}).`,
                    ],
                  ] as const
                ).map(([mode, title, desc]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set({ mode })}
                    className={`rounded-md border p-3 text-left text-sm ${form.mode === mode ? 'border-primary bg-accent' : 'hover:bg-accent/50'}`}
                  >
                    <div className="font-medium">{title}</div>
                    <div className="text-muted-foreground text-xs">{desc}</div>
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {form.mode === 'service' && isWin && (
            <>
              <Field
                label="Service account"
                hint="Empty = NT AUTHORITY\NETWORK SERVICE"
              >
                <Input
                  value={form.serviceAccount ?? ''}
                  onChange={(e) => set({ serviceAccount: e.target.value })}
                  placeholder="DOMAIN\user"
                  className="font-mono"
                />
              </Field>
              <Field label="Account password" hint="Used once; never stored.">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!form.serviceAccount}
                />
              </Field>
            </>
          )}

          <div className="col-span-2 flex flex-col gap-2">
            <Label>Options</Label>
            {form.mode === 'child' && (
              <Check
                checked={form.autostart}
                onChange={(autostart) => set({ autostart })}
              >
                Start automatically when the app starts
              </Check>
            )}
            <Check
              checked={form.cleanup.enabled}
              onChange={(enabled) =>
                set({ cleanup: { ...form.cleanup, enabled } })
              }
            >
              Clean the job workspace and _temp after every job
            </Check>
            <div className="flex flex-col gap-2 pl-6">
              <Check
                checked={form.cleanup.actions}
                disabled={!form.cleanup.enabled}
                onChange={(actions) =>
                  set({ cleanup: { ...form.cleanup, actions } })
                }
              >
                Also clear downloaded actions (_actions)
              </Check>
              <Check
                checked={form.cleanup.tool}
                disabled={!form.cleanup.enabled}
                onChange={(tool) => set({ cleanup: { ...form.cleanup, tool } })}
              >
                Also clear the tool cache (_tool) — jobs re-download Node,
                Python, …
              </Check>
            </div>
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="h-8 w-40"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={savePreset}
              disabled={!presetName.trim() || !valid}
            >
              <Save /> Save preset
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!valid || busy}>
              {busy ? <Loader2 className="animate-spin" /> : null} Create{' '}
              {form.count}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
