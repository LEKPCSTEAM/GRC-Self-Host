import { useEffect, useMemo, useState } from 'react';
import {
  Brush,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pin,
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
  BulkResult,
  ForeignRunner,
  RunnerView,
  Snapshot,
} from '../../shared/types';
import { api, call, errorMessage, reportBulk } from '@/lib/api';
import { formatBytes, targetKey, targetLabel } from '@/lib/format';
import { localizeError, tr } from '@/lib/i18n';
import { useAppInfo, useConnections } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/confirm';
import { LogsDialog } from '@/components/LogsDialog';
import type { Form } from '@/components/CreateDialog';
import {
  BulkOptionsDialog,
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
  DropdownMenuCheckboxItem,
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

export type Filter =
  | 'all'
  | 'running'
  | 'stopped'
  | 'online'
  | 'offline'
  | 'busy'
  | 'broken'
  | 'problem';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['running', 'Running'],
  ['online', 'Online on GitHub'],
  ['offline', 'Offline on GitHub'],
  ['busy', 'Running a job'],
  ['broken', 'Broken'],
  ['stopped', 'Stopped'],
  ['problem', 'Needs attention'],
];

type SortKey = 'name' | 'status' | 'target' | 'mode' | 'version';
type ColumnKey = 'mode' | 'local' | 'github' | 'labels' | 'version';
interface SavedView {
  name: string;
  filter: Filter;
  query: string;
  sort: SortKey;
  descending: boolean;
}
interface TablePrefs {
  sort: SortKey;
  descending: boolean;
  columns: ColumnKey[];
  pinned: string[];
  collapsed: string[];
  views: SavedView[];
}
const PREFS_KEY = 'grc:runners-table';
const DEFAULT_PREFS: TablePrefs = {
  sort: 'name',
  descending: false,
  columns: ['mode', 'local', 'github', 'labels', 'version'],
  pinned: [],
  collapsed: [],
  views: [],
};

function readPrefs(): TablePrefs {
  try {
    const saved = JSON.parse(
      localStorage.getItem(PREFS_KEY) ?? '{}',
    ) as Partial<TablePrefs>;
    const columns = DEFAULT_PREFS.columns.filter((c) =>
      saved.columns?.includes(c),
    );
    return {
      sort: ['name', 'status', 'target', 'mode', 'version'].includes(
        saved.sort ?? '',
      )
        ? saved.sort!
        : 'name',
      descending:
        typeof saved.descending === 'boolean' ? saved.descending : false,
      columns: Array.isArray(saved.columns) ? columns : DEFAULT_PREFS.columns,
      pinned: Array.isArray(saved.pinned)
        ? saved.pinned.filter((x) => typeof x === 'string')
        : [],
      collapsed: Array.isArray(saved.collapsed)
        ? saved.collapsed.filter((x) => typeof x === 'string')
        : [],
      views: Array.isArray(saved.views)
        ? saved.views.filter(
            (v) =>
              v &&
              typeof v.name === 'string' &&
              typeof v.query === 'string' &&
              FILTERS.some(([f]) => f === v.filter) &&
              ['name', 'status', 'target', 'mode', 'version'].includes(
                v.sort,
              ) &&
              typeof v.descending === 'boolean',
          )
        : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function sortValue(r: RunnerView, key: SortKey): string {
  switch (key) {
    case 'status':
      return r.status.busy ? 'busy' : `${r.status.github}:${r.status.local}`;
    case 'target':
      return targetKey(r.target);
    case 'mode':
      return r.mode;
    case 'version':
      return r.version ?? '';
    default:
      return r.name;
  }
}

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
    case 'online':
      return s.github === 'online';
    case 'offline':
      return s.github === 'offline';
    case 'broken':
      return Boolean(s.broken || s.local === 'crashed');
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
    running: ['Running', 'bg-success/15 text-success'],
    starting: ['Starting', 'bg-attention/15 text-attention'],
    stopping: ['Stopping', 'bg-attention/15 text-attention'],
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

function GithubBadge({ r, now }: { r: RunnerView; now: number }) {
  const s = r.status;
  const checked = s.githubCheckedAt ? new Date(s.githubCheckedAt) : null;
  const stale = !checked || now - checked.getTime() > 45_000;
  const detail = (
    <div
      className="text-muted-foreground mt-1 text-[11px]"
      title={s.githubError ? localizeError(s.githubError) : undefined}
    >
      {s.github === 'unknown'
        ? s.githubError
          ? localizeError(s.githubError)
          : tr('Unable to verify GitHub status', 'ตรวจสถานะ GitHub ไม่ได้')
        : stale
          ? tr('Status may be stale', 'สถานะอาจไม่เป็นปัจจุบัน')
          : tr('GitHub checked', 'ตรวจ GitHub แล้ว')}
      {checked && ` ${checked.toLocaleTimeString()}`}
    </div>
  );
  if (s.busy) {
    return (
      <div>
        <Badge
          variant="outline"
          className="max-w-48 truncate border-transparent bg-info/15 text-info"
        >
          {tr('Busy', 'กำลังทำงาน')}
          {s.jobName ? `: ${s.jobName}` : ''}
        </Badge>
        {detail}
      </div>
    );
  }
  const map: Record<string, [string, string]> = {
    online: ['Online', 'bg-success'],
    offline: ['Offline', 'bg-muted-foreground/60'],
    missing: ['Not registered', 'bg-danger'],
    unknown: ['Not verified', 'bg-attention'],
  };
  const [label, dot] = map[s.github] ?? ['—', ''];
  return (
    <div>
      <span className="flex items-center gap-1.5 text-xs">
        <span className={cn('size-2 rounded-full', dot)} /> {label}
      </span>
      {detail}
    </div>
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
  filter,
  onFilterChange,
}: {
  snapshot: Snapshot;
  onCreate: (initial?: Form) => void;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
}) {
  const info = useAppInfo();
  const [connections] = useConnections();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = useState(readPrefs);
  const [viewName, setViewName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [logsFor, setLogsFor] = useState<RunnerView | null>(null);
  const [labelsFor, setLabelsFor] = useState<RunnerView[] | null>(null);
  const [modeFor, setModeFor] = useState<RunnerView | null>(null);
  const [optionsFor, setOptionsFor] = useState<RunnerView | null>(null);
  const [bulkOptionsFor, setBulkOptionsFor] = useState<RunnerView[] | null>(
    null,
  );
  const [repairFor, setRepairFor] = useState<RunnerView | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [failedBulk, setFailedBulk] = useState<{
    action: BulkAction;
    results: BulkResult[];
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* Local preferences are optional. */
    }
  }, [prefs]);

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
      { key: string; title: string; subtitle: string; runners: RunnerView[] }
    >();
    for (const r of visible) {
      const key = `${r.connectionId}|${targetKey(r.target).toLowerCase()}`;
      const g = m.get(key) ?? {
        key,
        title: targetLabel(r.target),
        subtitle: connName.get(r.connectionId) ?? '',
        runners: [],
      };
      g.runners.push(r);
      m.set(key, g);
    }
    const compare = (a: RunnerView, b: RunnerView) => {
      const pinned =
        Number(prefs.pinned.includes(b.id)) -
        Number(prefs.pinned.includes(a.id));
      if (pinned) return pinned;
      const order = sortValue(a, prefs.sort).localeCompare(
        sortValue(b, prefs.sort),
        undefined,
        { numeric: true },
      );
      return (
        (prefs.descending ? -order : order) ||
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
    };
    for (const g of m.values()) g.runners.sort(compare);
    return [...m.values()].sort((a, b) =>
      prefs.sort === 'target'
        ? (prefs.descending ? -1 : 1) * a.title.localeCompare(b.title)
        : compare(a.runners[0]!, b.runners[0]!) ||
          a.title.localeCompare(b.title),
    );
  }, [visible, connName, prefs.sort, prefs.descending, prefs.pinned]);

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
  const details = snapshot.runners.find((r) => r.id === detailsId) ?? null;

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error(tr(`Could not copy ${label}`, `คัดลอก ${label} ไม่สำเร็จ`));
    }
  };

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
    if (
      (action === 'stop' || action === 'restart') &&
      busy.length &&
      !skipBusy
    ) {
      const ok = await confirm({
        title: tr(
          `${busy.length} runner${busy.length === 1 ? ' is' : 's are'} running a job`,
          `Runner ${busy.length} ตัวกำลังทำ job`,
        ),
        description: tr(
          `${busy.map((r) => r.name).join(', ')} will be stopped and the job will fail. Continue?`,
          `${busy.map((r) => r.name).join(', ')} จะถูกหยุดและ job จะล้มเหลว ดำเนินการต่อหรือไม่?`,
        ),
        confirmLabel:
          action === 'stop'
            ? tr('Stop anyway', 'หยุดต่อ')
            : tr('Restart anyway', 'เริ่มใหม่ต่อ'),
        destructive: true,
      });
      if (!ok) return;
    }
    if (action === 'clean') {
      const report = await call('disk:report');
      if (!report) return;
      const preview = report.runners.filter((item) =>
        rs.some((r) => r.id === item.id),
      );
      const estimated = preview.reduce((sum, item) => sum + item.cleanBytes, 0);
      const ok = await confirm({
        title: tr(
          `Clean ${rs.length} runner${rs.length === 1 ? '' : 's'}?`,
          `ล้างข้อมูล Runner ${rs.length} ตัวหรือไม่?`,
        ),
        description: (
          <div className="space-y-2 text-left">
            <p>
              {tr('Estimated space to clear', 'พื้นที่ที่จะล้างโดยประมาณ')}:{' '}
              {formatBytes(estimated)}.{' '}
              {tr(
                'Busy runners are skipped. Repository mapping is kept.',
                'ข้าม Runner ที่กำลังทำ job และเก็บ repository mapping ไว้',
              )}
            </p>
            <div className="max-h-52 space-y-2 overflow-auto rounded border p-2 font-mono text-xs">
              {preview.map((item) => (
                <div key={item.id}>
                  <strong>
                    {names.get(item.id)} · {formatBytes(item.cleanBytes)}
                  </strong>
                  {item.cleanPaths.length === 0 && <p>Nothing to remove</p>}
                  {item.cleanPaths.map((target) => (
                    <p key={target.path} className="break-all">
                      {target.path} · {formatBytes(target.bytes)}
                    </p>
                  ))}
                  {item.omittedPaths > 0 && (
                    <p>…and {item.omittedPaths} more paths</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs">
              Sizes are approximate and may change before clean runs.
            </p>
          </div>
        ),
        confirmLabel: tr('Clean', 'ล้างข้อมูล'),
      });
      if (!ok) return;
    }
    const verbs: Record<BulkAction, string> = {
      start: 'Started',
      stop: 'Stopped',
      restart: 'Restarted',
      clean: 'Cleaned',
    };
    const results = await call(
      'runners:bulk',
      rs.map((r) => r.id),
      action,
      skipBusy,
    );
    reportBulk(verbs[action], results, names);
    if (results) {
      const failed = results.filter((r) => !r.ok && !r.skipped);
      setFailedBulk(failed.length ? { action, results: failed } : null);
    }
  };

  const stopAfterCurrentJob = async (runner: RunnerView) => {
    if (runner.status.stopAfterJob) {
      await call('runners:stopAfterJob', runner.id, false);
      return;
    }
    const ok = await confirm({
      title: tr('Stop after this job?', 'หยุดหลัง job นี้จบหรือไม่?'),
      description: tr(
        'This works only for an app process managed in this session. GRC waits for the local completion message, then disconnects the runner. GitHub may assign another job before it disconnects, so this is best effort. Keep the app running.',
        'ใช้ได้เฉพาะ app process ที่แอปนี้กำลังดูแลอยู่ GRC จะรอข้อความว่า job จบแล้วจึงตัดการเชื่อมต่อ GitHub อาจมอบ job ใหม่ก่อนตัดการเชื่อมต่อ จึงไม่รับประกันว่าจะหยุดทันที และต้องเปิดแอปไว้',
      ),
      confirmLabel: tr('Stop when job completes', 'หยุดเมื่อ job จบ'),
    });
    if (ok) await call('runners:stopAfterJob', runner.id, true);
  };

  const remove = async (rs: RunnerView[]) => {
    const busy = rs.filter((r) => r.status.busy);
    const ok = await confirm({
      title: tr(
        `Delete ${rs.length} runner${rs.length === 1 ? '' : 's'}?`,
        `ลบ Runner ${rs.length} ตัวหรือไม่?`,
      ),
      description: (
        <div className="space-y-2">
          <p>
            {tr(
              'Deregisters from GitHub, uninstalls services and deletes the runner folders.',
              'ยกเลิกการลงทะเบียนใน GitHub ถอน service และลบโฟลเดอร์ Runner',
            )}
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
      confirmLabel: tr('Delete', 'ลบ'),
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
      title: tr(`Forget ${r.name}?`, `ลบ ${r.name} ออกจากแอปหรือไม่?`),
      description: tr(
        'Removes it from this app, uninstalls its service if any and deletes its folder. GitHub registration is removed if possible.',
        'ลบ Runner ออกจากแอป ถอน service และลบโฟลเดอร์ รวมถึงยกเลิกการลงทะเบียน GitHub หากทำได้',
      ),
      confirmLabel: tr('Forget', 'ลบออก'),
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
  const hasColumn = (column: ColumnKey) => prefs.columns.includes(column);
  const setColumn = (column: ColumnKey, show: boolean) =>
    setPrefs((p) => ({
      ...p,
      columns: show
        ? [...p.columns, column]
        : p.columns.filter((c) => c !== column),
    }));
  const togglePinned = (id: string) =>
    setPrefs((p) => ({
      ...p,
      pinned: p.pinned.includes(id)
        ? p.pinned.filter((x) => x !== id)
        : [...p.pinned, id],
    }));
  const toggleCollapsed = (key: string) =>
    setPrefs((p) => ({
      ...p,
      collapsed: p.collapsed.includes(key)
        ? p.collapsed.filter((x) => x !== key)
        : [...p.collapsed, key],
    }));
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    if (prefs.views.some((v) => v.name.toLowerCase() === name.toLowerCase())) {
      toast.error(tr('A view with this name already exists', 'มีมุมมองชื่อนี้แล้ว'));
      return;
    }
    setPrefs((p) => ({
      ...p,
      views: [
        ...p.views,
        { name, filter, query, sort: p.sort, descending: p.descending },
      ],
    }));
    setViewName('');
    toast.success(`Saved view "${name}"`);
  };
  const applyView = (name: string) => {
    const view = prefs.views.find((v) => v.name === name);
    if (!view) return;
    onFilterChange(view.filter);
    setQuery(view.query);
    setPrefs((p) => ({ ...p, sort: view.sort, descending: view.descending }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onCreate()}>
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
        <Select
          value={filter}
          onValueChange={(v) => onFilterChange(v as Filter)}
        >
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

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Sort</span>
        <Select
          value={prefs.sort}
          onValueChange={(sort) =>
            setPrefs((p) => ({ ...p, sort: sort as SortKey }))
          }
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['name', 'status', 'target', 'mode', 'version'] as SortKey[]).map(
              (key) => (
                <SelectItem key={key} value={key}>
                  {key[0]!.toUpperCase() + key.slice(1)}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPrefs((p) => ({ ...p, descending: !p.descending }))}
        >
          {prefs.descending ? 'Descending' : 'Ascending'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {DEFAULT_PREFS.columns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column}
                checked={hasColumn(column)}
                onCheckedChange={(checked) => setColumn(column, checked)}
              >
                {column[0]!.toUpperCase() + column.slice(1)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {prefs.views.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Saved views
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {prefs.views.map((view) => (
                <DropdownMenuItem
                  key={view.name}
                  onClick={() => applyView(view.name)}
                >
                  {view.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Input
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          placeholder="New view name"
          className="h-8 w-40"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!viewName.trim()}
          onClick={saveView}
        >
          Save view
        </Button>
        {prefs.views.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                Delete view
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {prefs.views.map((view) => (
                <DropdownMenuItem
                  key={view.name}
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      views: p.views.filter((v) => v.name !== view.name),
                    }))
                  }
                >
                  {view.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {snapshot.quitPending && (
        <div className="rounded-md border border-attention/40 bg-attention/10 p-3 text-sm">
          The app will quit when running jobs finish. Use the tray menu to
          cancel.
        </div>
      )}

      {failedBulk && (
        <div className="border-destructive/40 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>
              {failedBulk.results.length} {failedBulk.action} action
              {failedBulk.results.length === 1 ? '' : 's'} failed
            </strong>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void bulk(
                    snapshot.runners.filter((r) =>
                      failedBulk.results.some((f) => f.id === r.id),
                    ),
                    failedBulk.action,
                  )
                }
              >
                Retry failed only
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFailedBulk(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
          <ul className="mt-2 space-y-1">
            {failedBulk.results.map((r) => (
              <li key={r.id}>
                <span className="font-mono">{names.get(r.id) ?? r.id}</span>:{' '}
                {r.error
                  ? localizeError(r.error)
                  : tr('Unknown error', 'ข้อผิดพลาดที่ไม่ทราบสาเหตุ')}
              </li>
            ))}
          </ul>
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
          <label className="flex items-center gap-2 px-2 text-xs">
            <Checkbox
              checked={skipBusy}
              onCheckedChange={(v) => setSkipBusy(v === true)}
            />
            Skip runners running a job for Stop/Restart
          </label>
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
            variant="outline"
            onClick={() => setBulkOptionsFor(selectedRunners)}
          >
            <Settings2 /> Options
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
                {hasColumn('mode') && <TableHead>Mode</TableHead>}
                {hasColumn('local') && <TableHead>Local</TableHead>}
                {hasColumn('github') && <TableHead>GitHub</TableHead>}
                {hasColumn('labels') && <TableHead>Labels</TableHead>}
                {hasColumn('version') && <TableHead>Version</TableHead>}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => {
                const ids = g.runners.map((r) => r.id);
                const all = ids.every((id) => selected.has(id));
                const collapsed = prefs.collapsed.includes(g.key);
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
                    <TableCell
                      colSpan={2 + prefs.columns.length}
                      className="text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(g.key)}
                        aria-expanded={!collapsed}
                        className="inline-flex items-center gap-1 font-semibold hover:underline"
                      >
                        {collapsed ? (
                          <ChevronRight className="size-3.5" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                        {g.title}
                      </button>
                      <span className="text-muted-foreground">
                        {' '}
                        · {g.subtitle} · {g.runners.length}
                      </span>
                    </TableCell>
                  </TableRow>,
                  ...(!collapsed ? g.runners : []).map((r) => (
                    <TableRow
                      key={r.id}
                      data-state={selected.has(r.id) ? 'selected' : undefined}
                      // The default selected background matches the badges and hides them.
                      className="cursor-pointer data-[state=selected]:bg-info/10"
                      tabIndex={0}
                      onClick={(e) => {
                        if (
                          !(e.target as HTMLElement).closest(
                            'button, [role=checkbox], a',
                          ) &&
                          !window.getSelection()?.toString()
                        )
                          setDetailsId(r.id);
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.target === e.currentTarget &&
                          (e.key === 'Enter' || e.key === ' ')
                        ) {
                          e.preventDefault();
                          setDetailsId(r.id);
                        }
                      }}
                      aria-label={`Details for ${r.name}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={(v) => toggle([r.id], v === true)}
                          aria-label={`Select ${r.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 font-mono text-sm">
                          <button
                            type="button"
                            className={
                              prefs.pinned.includes(r.id)
                                ? 'text-primary'
                                : 'text-muted-foreground'
                            }
                            onClick={() => togglePinned(r.id)}
                            aria-label={`${prefs.pinned.includes(r.id) ? 'Unpin' : 'Pin'} ${r.name}`}
                            title={
                              prefs.pinned.includes(r.id)
                                ? 'Unpin runner'
                                : 'Pin runner'
                            }
                          >
                            <Pin className="size-3.5" />
                          </button>
                          {r.name}
                        </div>
                        {r.status.broken && (
                          <div className="text-destructive mt-1 flex items-center gap-2 text-xs">
                            <CircleAlert className="size-3.5" />{' '}
                            {localizeError(r.status.broken)}
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
                        {r.status.lastError && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="text-destructive mt-1 max-w-80 truncate text-xs">
                                {localizeError(r.status.lastError)}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md whitespace-pre-wrap">
                              {localizeError(r.status.lastError)}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {r.status.creationFailed && !r.status.op && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1 h-6 px-2 text-xs"
                            onClick={() => repair(r)}
                          >
                            Retry failed creation
                          </Button>
                        )}
                      </TableCell>
                      {hasColumn('mode') && (
                        <TableCell>
                          <Badge variant="secondary">
                            {r.mode === 'child' ? 'App' : 'Service'}
                          </Badge>
                        </TableCell>
                      )}
                      {hasColumn('local') && (
                        <TableCell>
                          <LocalBadge r={r} />
                        </TableCell>
                      )}
                      {hasColumn('github') && (
                        <TableCell>
                          <GithubBadge r={r} now={now} />
                        </TableCell>
                      )}
                      {hasColumn('labels') && (
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
                      )}
                      {hasColumn('version') && (
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {r.version ?? '—'}
                        </TableCell>
                      )}
                      <TableCell>
                        <RowMenu
                          r={r}
                          onAction={(a) => bulk([r], a)}
                          onStopAfterJob={() => void stopAfterCurrentJob(r)}
                          onLogs={() => setLogsFor(r)}
                          onLabels={() => setLabelsFor([r])}
                          onMode={() => setModeFor(r)}
                          onOptions={() => setOptionsFor(r)}
                          onClone={() =>
                            onCreate({
                              connectionId: r.connectionId,
                              target: r.target,
                              count: 1,
                              prefix: r.name.replace(/-\d+$/, '').slice(0, 56),
                              labels: [...r.labels],
                              runnerGroup: r.runnerGroup,
                              mode: r.mode,
                              autostart: r.autostart,
                              cleanup: { ...r.cleanup },
                              serviceAccount: r.serviceAccount,
                            })
                          }
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
                      {f.readOnly ? (
                        <span className="text-muted-foreground text-xs">
                          Read-only
                        </span>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeForeign(f)}
                          aria-label={`Delete ${f.name}`}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <LogsDialog runner={logsFor} onClose={() => setLogsFor(null)} />
      <Dialog
        open={details !== null}
        onOpenChange={(open) => !open && setDetailsId(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{details?.name}</DialogTitle>
            <DialogDescription>Runner details and actions</DialogDescription>
          </DialogHeader>
          {details && (
            <div className="space-y-3 text-sm">
              {(
                [
                  ['Name', details.name],
                  ['Target', targetKey(details.target)],
                  ['Path', details.dir],
                  [
                    'GitHub ID',
                    details.githubId?.toString() ?? 'Not registered',
                  ],
                  ['Labels', details.labels.join(', ') || 'None'],
                  [
                    'Status',
                    `${details.status.local} · GitHub ${details.status.github}${details.status.busy ? ' · busy' : ''}`,
                  ],
                  ...(details.status.broken || details.status.lastError
                    ? ([
                        [
                          'Message',
                          details.status.broken ?? details.status.lastError!,
                        ],
                      ] as const)
                    : []),
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[6rem_1fr_auto] items-start gap-2"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="break-all font-mono text-xs">{value}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void copy(label, value)}
                  >
                    Copy
                  </Button>
                </div>
              ))}
              <div className="border-t pt-3">
                <p className="font-medium">Cleanup</p>
                <p className="text-muted-foreground">
                  {details.cleanup.enabled
                    ? `After each job${details.cleanup.actions ? ', actions' : ''}${details.cleanup.tool ? ', tools' : ''}`
                    : 'Disabled'}
                </p>
              </div>
              {(details.status.broken || details.status.lastError) && (
                <div className="border-destructive/30 text-destructive rounded border p-2 text-xs">
                  {localizeError(
                    details.status.broken ?? details.status.lastError!,
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(details.status.op)}
                  onClick={() => {
                    setDetailsId(null);
                    void bulk([details], 'start');
                  }}
                >
                  <Play /> Start
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(details.status.op)}
                  onClick={() => {
                    setDetailsId(null);
                    void bulk([details], 'stop');
                  }}
                >
                  <Square /> Stop
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(details.status.op)}
                  onClick={() => {
                    setDetailsId(null);
                    void bulk([details], 'restart');
                  }}
                >
                  <RotateCw /> Restart
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDetailsId(null);
                    setLogsFor(details);
                  }}
                >
                  <ScrollText /> Logs
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void call('runners:openFolder', details.id)}
                >
                  <FolderOpen /> Folder
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void call('runners:openGithub', details.id, 'target')
                  }
                >
                  Target on GitHub
                </Button>
                {details.githubId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void call('runners:openGithub', details.id, 'runner')
                    }
                  >
                    Runner on GitHub
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDetailsId(null);
                    repair(details);
                  }}
                >
                  <Wrench /> Repair
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <LabelsDialog runners={labelsFor} onClose={() => setLabelsFor(null)} />
      <ModeDialog runner={modeFor} onClose={() => setModeFor(null)} />
      <OptionsDialog runner={optionsFor} onClose={() => setOptionsFor(null)} />
      <BulkOptionsDialog
        runners={bulkOptionsFor}
        onClose={() => setBulkOptionsFor(null)}
      />
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
  onStopAfterJob,
  onLogs,
  onLabels,
  onMode,
  onOptions,
  onClone,
  onRepair,
  onForget,
  onDelete,
}: {
  r: RunnerView;
  onAction: (a: BulkAction) => void;
  onStopAfterJob: () => void;
  onLogs: () => void;
  onLabels: () => void;
  onMode: () => void;
  onOptions: () => void;
  onClone: () => void;
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
        {r.mode === 'child' && (Boolean(s.jobName) || s.stopAfterJob) && (
          <DropdownMenuItem
            disabled={busyOp || s.orphan}
            onClick={onStopAfterJob}
          >
            <Square />{' '}
            {s.stopAfterJob
              ? tr('Cancel stop after job', 'ยกเลิกการหยุดหลัง job')
              : tr(
                  'Stop after current job (best effort)',
                  'หยุดหลัง job นี้ (ตามที่ทำได้)',
                )}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={busyOp || Boolean(s.broken)}
          onClick={() => onAction('restart')}
        >
          <RotateCw /> Restart
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClone}>
          <Plus /> Create like this
        </DropdownMenuItem>
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
