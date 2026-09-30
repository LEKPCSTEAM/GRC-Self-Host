import { useEffect, useMemo, useState } from 'react';
import {
  Brush,
  CircleAlert,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCw,
  ScrollText,
  Search,
  Settings2,
  Square,
  Tags,
  Trash2,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  BulkAction,
  ForeignRunner,
  RunnerView,
  Snapshot,
} from '../../shared/types';
import { api, call, errorMessage, reportBulk } from '@/lib/api';
import { targetKey, targetLabel } from '@/lib/format';
import { useAppInfo, useConnections } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/confirm';
import { LogsDialog } from '@/components/LogsDialog';
import {
  LabelsDialog,
  ModeDialog,
  OptionsDialog,
} from '@/components/RunnerDialogs';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Filter = 'all' | 'running' | 'stopped' | 'busy' | 'problem';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['running', 'Running'],
  ['busy', 'Running a job'],
  ['stopped', 'Stopped'],
  ['problem', 'Needs attention'],
];

function matches(r: RunnerView, f: Filter, q: string): boolean {
  const s = r.status;
  if (q) {
    const hay =
      `${r.name} ${r.labels.join(' ')} ${targetKey(r.target)}`.toLowerCase();
    if (
      !q
        .toLowerCase()
        .split(/\s+/)
        .every((w) => hay.includes(w))
    )
      return false;
  }
  switch (f) {
    case 'running':
      return s.local === 'running';
    case 'stopped':
      return s.local === 'stopped';
    case 'busy':
      return s.busy;
    case 'problem':
      return Boolean(
        s.broken ||
        s.lastError ||
        s.local === 'crashed' ||
        (s.github === 'offline' && s.local === 'running'),
      );
    default:
      return true;
  }
}

function LocalBadge({ r }: { r: RunnerView }) {
  const s = r.status;
  if (s.op) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> {s.op}
      </span>
    );
  }
  const map: Record<string, [string, string]> = {
    running: [
      'Running',
      'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    ],
    starting: [
      'Starting',
      'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    ],
    stopping: [
      'Stopping',
      'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    ],
    stopped: ['Stopped', 'bg-muted text-muted-foreground'],
    crashed: ['Crashed', 'bg-destructive/15 text-destructive'],
  };
  const [label, cls] = map[s.local] ?? [s.local, ''];
  return (
    <Badge variant="outline" className={cn('border-transparent', cls)}>
      {label}
      {s.orphan && ' (adopted)'}
    </Badge>
  );
}

function GithubBadge({ r }: { r: RunnerView }) {
  const s = r.status;
  if (s.busy) {
    return (
      <Badge
        variant="outline"
        className="max-w-48 truncate border-transparent bg-sky-500/15 text-sky-600 dark:text-sky-400"
      >
        Busy{s.jobName ? `: ${s.jobName}` : ''}
      </Badge>
    );
  }
  const map: Record<string, [string, string]> = {
    online: ['Online', 'bg-emerald-500'],
    offline: ['Offline', 'bg-zinc-400'],
    missing: ['Not registered', 'bg-red-500'],
    unknown: ['—', 'bg-transparent'],
  };
  const [label, dot] = map[s.github] ?? ['—', ''];
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={cn('size-2 rounded-full', dot)} /> {label}
    </span>
  );
}

function PasswordDialog({
  runner,
  onSubmit,
  onClose,
}: {
  runner: RunnerView | null;
  onSubmit: (password: string) => void;
  onClose: () => void;
}) {
  const [pw, setPw] = useState('');
  useEffect(() => setPw(''), [runner]);
  return (
    <Dialog open={runner !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Password for {runner?.serviceAccount}</DialogTitle>
          <DialogDescription>
            Needed to reinstall the Windows service. It is not stored.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(pw)}>Repair</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RunnersPage({
  snapshot,
  onCreate,
}: {
  snapshot: Snapshot;
  onCreate: () => void;
}) {
  const info = useAppInfo();
  const [connections] = useConnections();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [logsFor, setLogsFor] = useState<RunnerView | null>(null);
  const [labelsFor, setLabelsFor] = useState<RunnerView[] | null>(null);
  const [modeFor, setModeFor] = useState<RunnerView | null>(null);
  const [optionsFor, setOptionsFor] = useState<RunnerView | null>(null);
  const [repairFor, setRepairFor] = useState<RunnerView | null>(null);

  const connName = useMemo(
    () => new Map(connections.map((c) => [c.id, c.name])),
    [connections],
  );
  const names = useMemo(
    () => new Map(snapshot.runners.map((r) => [r.id, r.name])),
    [snapshot.runners],
  );
  const visible = useMemo(
    () => snapshot.runners.filter((r) => matches(r, filter, query)),
    [snapshot.runners, filter, query],
  );

  const groups = useMemo(() => {
    const m = new Map<
      string,
      { title: string; subtitle: string; runners: RunnerView[] }
    >();
    for (const r of visible) {
      const key = `${r.connectionId}|${targetKey(r.target).toLowerCase()}`;
      const g = m.get(key) ?? {
        title: targetLabel(r.target),
        subtitle: connName.get(r.connectionId) ?? '',
        runners: [],
      };
      g.runners.push(r);
      m.set(key, g);
    }
    for (const g of m.values())
      g.runners.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [visible, connName]);

  // Drop selections that disappeared.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(snapshot.runners.map((r) => r.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [snapshot.runners]);

  // Ctrl+A selects every visible runner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'a' &&
        !el.closest('input, textarea, [role=dialog]')
      ) {
        e.preventDefault();
        setSelected(new Set(visible.map((r) => r.id)));
      }
      if (e.key === 'Escape' && !el.closest('[role=dialog]'))
        setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  const selectedRunners = snapshot.runners.filter((r) => selected.has(r.id));

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const bulk = async (rs: RunnerView[], action: BulkAction) => {
    const busy = rs.filter((r) => r.status.busy);
    if ((action === 'stop' || action === 'restart') && busy.length) {
      const ok = await confirm({
        title: `${busy.length} runner${busy.length === 1 ? ' is' : 's are'} running a job`,
        description: `${busy.map((r) => r.name).join(', ')} will be stopped and the job will fail. Continue?`,
        confirmLabel: action === 'stop' ? 'Stop anyway' : 'Restart anyway',
        destructive: true,
      });
      if (!ok) return;
    }
    if (action === 'clean') {
      const ok = await confirm({
        title: `Clean ${rs.length} runner${rs.length === 1 ? '' : 's'}?`,
        description:
          'Empties job workspaces and _temp (and _actions / _tool if enabled). The repository mapping is kept. Busy runners are skipped.',
        confirmLabel: 'Clean',
      });
      if (!ok) return;
    }
    const verbs: Record<BulkAction, string> = {
      start: 'Started',
      stop: 'Stopped',
      restart: 'Restarted',
      clean: 'Cleaned',
    };
    reportBulk(
      verbs[action],
      await call(
        'runners:bulk',
        rs.map((r) => r.id),
        action,
      ),
      names,
    );
  };

  const remove = async (rs: RunnerView[]) => {
    const busy = rs.filter((r) => r.status.busy);
    const ok = await confirm({
      title: `Delete ${rs.length} runner${rs.length === 1 ? '' : 's'}?`,
      description: (
        <div className="space-y-2">
          <p>
            Deregisters from GitHub, uninstalls services and deletes the runner
            folders.
          </p>
          {busy.length > 0 && (
            <p className="text-destructive font-medium">
              {busy.map((r) => r.name).join(', ')}{' '}
              {busy.length === 1 ? 'is' : 'are'} running a job — it will be
              cancelled.
            </p>
          )}
        </div>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    reportBulk(
      'Deleted',
      await call(
        'runners:remove',
        rs.map((r) => r.id),
      ),
      names,
    );
  };

  const repair = (r: RunnerView) => {
    if (info?.platform === 'win32' && r.mode === 'service' && r.serviceAccount)
      setRepairFor(r);
    else void call('runners:repair', r.id);
  };

  const forget = async (r: RunnerView) => {
    const ok = await confirm({
      title: `Forget ${r.name}?`,
      description:
        'Removes it from this app, uninstalls its service if any and deletes its folder. GitHub registration is removed if possible.',
      confirmLabel: 'Forget',
      destructive: true,
    });
    if (ok) await call('runners:forget', r.id);
  };

  const removeForeign = async (f: ForeignRunner) => {
    const first = await confirm({
      title: `Delete ${f.name} from GitHub?`,
      description: `This runner is not managed by this app (it may be on another machine). It will be deregistered from ${targetKey(f.target)}.`,
      confirmLabel: 'Continue',
      destructive: true,
    });
    if (!first) return;
    const second = await confirm({
      title: 'Are you sure?',
      description: `The machine running ${f.name} will stop receiving jobs and must be re-registered to work again.`,
      confirmLabel: `Delete ${f.name}`,
      destructive: true,
    });
    if (!second) return;
    try {
      await api.invoke(
        'runners:removeForeign',
        f.connectionId,
        f.target,
        f.githubId,
      );
      toast.success(`Deleted ${f.name} from GitHub`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onCreate}>
          <Plus /> Create runners{' '}
          <kbd className="ml-1 text-[10px] opacity-60">Ctrl+N</kbd>
        </Button>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, label, repo…"
            className="w-64 pl-8"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-muted-foreground ml-auto text-xs">
          {snapshot.runners.length} runners ·{' '}
          {snapshot.runners.filter((r) => r.status.local === 'running').length}{' '}
          running · {snapshot.runners.filter((r) => r.status.busy).length} busy
        </div>
      </div>

      {snapshot.quitPending && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          The app will quit when running jobs finish. Use the tray menu to
          cancel.
        </div>
      )}

      {selected.size > 0 && (
        <div className="bg-card sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border p-2 shadow-sm">
          <span className="px-2 text-sm font-medium">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk(selectedRunners, 'start')}
          >
            <Play /> Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk(selectedRunners, 'stop')}
          >
            <Square /> Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk(selectedRunners, 'restart')}
          >
            <RotateCw /> Restart
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk(selectedRunners, 'clean')}
          >
            <Brush /> Clean
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLabelsFor(selectedRunners)}
          >
            <Tags /> Labels
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => remove(selectedRunners)}
          >
            <Trash2 /> Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Clear <kbd className="text-[10px] opacity-60">Esc</kbd>
          </Button>
        </div>
      )}

      {snapshot.runners.length === 0 && (
        <div className="text-muted-foreground rounded-md border border-dashed p-10 text-center text-sm">
          No runners yet.{' '}
          {connections.length
            ? 'Create some with Ctrl+N.'
            : 'Add a connection first, then create runners.'}
        </div>
      )}

      {groups.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(v) =>
                      toggle(
                        visible.map((r) => r.id),
                        v === true,
                      )
                    }
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Local</TableHead>
                <TableHead>GitHub</TableHead>
                <TableHead>Labels</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => {
                const ids = g.runners.map((r) => r.id);
                const all = ids.every((id) => selected.has(id));
                return [
                  <TableRow
                    key={`g-${g.title}-${g.subtitle}`}
                    className="bg-muted/40 hover:bg-muted/40"
                  >
                    <TableCell>
                      <Checkbox
                        checked={all}
                        onCheckedChange={(v) => toggle(ids, v === true)}
                        aria-label={`Select ${g.title}`}
                      />
                    </TableCell>
                    <TableCell colSpan={7} className="text-xs">
                      <span className="font-semibold">{g.title}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {g.subtitle} · {g.runners.length}
                      </span>
                    </TableCell>
                  </TableRow>,
                  ...g.runners.map((r) => (
                    <TableRow
                      key={r.id}
                      data-state={selected.has(r.id) ? 'selected' : undefined}
                      // The default selected background matches the badges and hides them.
                      className="data-[state=selected]:bg-sky-500/10"
                    >
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={(v) => toggle([r.id], v === true)}
                          aria-label={`Select ${r.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-sm">{r.name}</div>
                        {r.status.broken && (
                          <div className="text-destructive mt-1 flex items-center gap-2 text-xs">
                            <CircleAlert className="size-3.5" />{' '}
                            {r.status.broken}
                            {!r.pendingRemoval && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                onClick={() => repair(r)}
                              >
                                Repair
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => forget(r)}
                            >
                              Forget
                            </Button>
                          </div>
                        )}
                        {r.status.lastError && !r.status.broken && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="text-destructive mt-1 max-w-80 truncate text-xs">
                                {r.status.lastError}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md whitespace-pre-wrap">
                              {r.status.lastError}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {r.mode === 'child' ? 'App' : 'Service'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <LocalBadge r={r} />
                      </TableCell>
                      <TableCell>
                        <GithubBadge r={r} />
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {r.labels.map((l) => (
                            <span
                              key={l}
                              className="bg-secondary rounded px-1.5 py-0.5 font-mono text-[11px]"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {r.version ?? '—'}
                      </TableCell>
                      <TableCell>
                        <RowMenu
                          r={r}
                          onAction={(a) => bulk([r], a)}
                          onLogs={() => setLogsFor(r)}
                          onLabels={() => setLabelsFor([r])}
                          onMode={() => setModeFor(r)}
                          onOptions={() => setOptionsFor(r)}
                          onRepair={() => repair(r)}
                          onForget={() => forget(r)}
                          onDelete={() => remove([r])}
                        />
                      </TableCell>
                    </TableRow>
                  )),
                ];
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {snapshot.foreign.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Other runners on GitHub</h2>
          <p className="text-muted-foreground text-xs">
            Registered in the same repositories/organizations but not managed by
            this app.
          </p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Labels</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.foreign.map((f) => (
                  <TableRow key={`${targetKey(f.target)}-${f.githubId}`}>
                    <TableCell className="font-mono text-sm">
                      {f.name}
                    </TableCell>
                    <TableCell className="text-xs">
                      {targetLabel(f.target)}
                    </TableCell>
                    <TableCell className="text-xs">{f.os}</TableCell>
                    <TableCell className="text-xs">
                      {f.busy ? 'busy' : f.status}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-64 truncate font-mono text-[11px]">
                      {f.labels.join(', ')}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeForeign(f)}
                        aria-label={`Delete ${f.name}`}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <LogsDialog runner={logsFor} onClose={() => setLogsFor(null)} />
      <LabelsDialog runners={labelsFor} onClose={() => setLabelsFor(null)} />
      <ModeDialog runner={modeFor} onClose={() => setModeFor(null)} />
      <OptionsDialog runner={optionsFor} onClose={() => setOptionsFor(null)} />
      <PasswordDialog
        runner={repairFor}
        onClose={() => setRepairFor(null)}
        onSubmit={(pw) => {
          if (repairFor) void call('runners:repair', repairFor.id, pw);
          setRepairFor(null);
        }}
      />
    </div>
  );
}

function RowMenu({
  r,
  onAction,
  onLogs,
  onLabels,
  onMode,
  onOptions,
  onRepair,
  onForget,
  onDelete,
}: {
  r: RunnerView;
  onAction: (a: BulkAction) => void;
  onLogs: () => void;
  onLabels: () => void;
  onMode: () => void;
  onOptions: () => void;
  onRepair: () => void;
  onForget: () => void;
  onDelete: () => void;
}) {
  const s = r.status;
  const busyOp = Boolean(s.op);
  const running = s.local === 'running' || s.local === 'starting';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={busyOp || running || Boolean(s.broken)}
          onClick={() => onAction('start')}
        >
          <Play /> Start
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busyOp || !running}
          onClick={() => onAction('stop')}
        >
          <Square /> Stop
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busyOp || Boolean(s.broken)}
          onClick={() => onAction('restart')}
        >
          <RotateCw /> Restart
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogs}>
          <ScrollText /> Logs
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void call('runners:openFolder', r.id)}>
          <FolderOpen /> Open folder
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busyOp} onClick={() => onAction('clean')}>
          <Brush /> Clean now
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busyOp || !r.githubId} onClick={onLabels}>
          <Tags /> Edit labels
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busyOp} onClick={onOptions}>
          <Settings2 /> Options
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busyOp || s.busy || Boolean(s.broken)}
          onClick={onMode}
        >
          <RotateCw /> Switch to{' '}
          {r.mode === 'child' ? 'service' : 'app process'}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busyOp || Boolean(r.pendingRemoval)}
          onClick={onRepair}
        >
          <Wrench /> Repair (re-register)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {s.broken && (
          <DropdownMenuItem disabled={busyOp} onClick={onForget}>
            <Trash2 /> Forget
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          disabled={busyOp}
          onClick={onDelete}
        >
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
