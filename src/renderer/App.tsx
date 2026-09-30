import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  ChevronRight,
  Eye,
  HardDrive,
  HeartPulse,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListTodo,
  PackageSearch,
  Download,
  BriefcaseBusiness,
  CalendarClock,
  Monitor,
  Moon,
  Sun,
  Activity,
  Wrench,
  SlidersHorizontal,
  Boxes,
  FolderInput,
  ListChecks,
  ScrollText,
  Server,
  Settings,
} from 'lucide-react';
import { api, call, reportBulk } from '@/lib/api';
import { setLanguage, useLanguage, tr } from '@/lib/i18n';
import {
  setTheme,
  useThemePreference,
  type ThemePreference,
} from '@/lib/theme';
import { usePresets, useSnapshot } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { CommandPalette, type Command } from '@/components/CommandPalette';
import { ConfirmProvider } from '@/components/confirm';
import { CreateDialog, type Form } from '@/components/CreateDialog';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConnectionsPage } from '@/pages/ConnectionsPage';
import { PresetsPage } from '@/pages/PresetsPage';
import { RunnersPage } from '@/pages/RunnersPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DiagnosticsPage } from '@/pages/DiagnosticsPage';
import { WatchPage } from '@/pages/WatchPage';
import { OperationsPage } from '@/pages/OperationsPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { VersionsPage } from '@/pages/VersionsPage';
import { DiskPage } from '@/pages/DiskPage';
import { SupportPage } from '@/pages/SupportPage';
import { UpdatesPage } from '@/pages/UpdatesPage';
import { JobsPage } from '@/pages/JobsPage';
import { MaintenancePage } from '@/pages/MaintenancePage';
import { MultiCreatePage } from '@/pages/MultiCreatePage';
import { ImportPage } from '@/pages/ImportPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import appIcon from '../../assets/icon.svg';
import type { AppReleaseInfo } from '../shared/types';
import type { Filter } from '@/pages/RunnersPage';

type PageId =
  | 'dashboard'
  | 'runners'
  | 'diagnostics'
  | 'watch'
  | 'operations'
  | 'history'
  | 'versions'
  | 'disk'
  | 'support'
  | 'updates'
  | 'jobs'
  | 'maintenance'
  | 'multi'
  | 'import'
  | 'onboarding'
  | 'connections'
  | 'presets'
  | 'settings';

type NavItem = {
  id: PageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

type NavGroup = {
  id: string;
  label: string;
  th: string;
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
};

const TOP_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'onboarding', label: 'Get started', icon: ListChecks },
];

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'runners',
    label: 'Manage runners',
    th: 'จัดการ Runner',
    icon: Server,
    items: [
      { id: 'runners', label: 'Runners', icon: Server },
      { id: 'jobs', label: 'Jobs', icon: BriefcaseBusiness },
      { id: 'multi', label: 'Multi-target create', icon: Boxes },
      { id: 'import', label: 'Import runner', icon: FolderInput },
    ],
  },
  {
    id: 'monitor',
    label: 'Monitoring',
    th: 'ติดตามสถานะ',
    icon: Activity,
    items: [
      { id: 'diagnostics', label: 'Diagnostics', icon: HeartPulse },
      { id: 'watch', label: 'Watch targets', icon: Eye },
      { id: 'operations', label: 'Operations', icon: ListTodo },
      { id: 'history', label: 'History', icon: History },
    ],
  },
  {
    id: 'maintain',
    label: 'Maintenance',
    th: 'ดูแลระบบ',
    icon: Wrench,
    items: [
      { id: 'maintenance', label: 'Maintenance', icon: CalendarClock },
      { id: 'versions', label: 'Runner versions', icon: PackageSearch },
      { id: 'disk', label: 'Disk usage', icon: HardDrive },
      { id: 'updates', label: 'App updates', icon: Download },
      { id: 'support', label: 'Support bundle', icon: ScrollText },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    th: 'การตั้งค่า',
    icon: SlidersHorizontal,
    items: [
      { id: 'connections', label: 'Connections', icon: KeyRound },
      { id: 'presets', label: 'Presets', icon: Layers },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

const NAV: NavItem[] = [...TOP_NAV, ...NAV_GROUPS.flatMap((g) => g.items)];

const groupOf = (id: PageId) =>
  NAV_GROUPS.find((g) => g.items.some((i) => i.id === id))?.id ?? null;

const TH_NAV: Record<PageId, string> = {
  dashboard: 'ภาพรวม',
  onboarding: 'เริ่มต้นใช้งาน',
  runners: 'Runners',
  diagnostics: 'ตรวจสุขภาพ',
  watch: 'ติดตาม Targets',
  operations: 'งานที่กำลังทำ',
  history: 'ประวัติ',
  versions: 'เวอร์ชัน Runner',
  disk: 'พื้นที่ดิสก์',
  support: 'ชุดข้อมูลช่วยเหลือ',
  updates: 'อัปเดตแอป',
  jobs: 'Jobs',
  maintenance: 'บำรุงรักษา',
  multi: 'สร้างหลาย Targets',
  import: 'นำเข้า Runner',
  connections: 'การเชื่อมต่อ',
  presets: 'Presets',
  settings: 'ตั้งค่า',
};

export function App() {
  const language = useLanguage();
  const [page, setPage] = useState<PageId>('dashboard');
  const [runnerFilter, setRunnerFilter] = useState<Filter>('all');
  const snapshot = useSnapshot();
  const [presets, reloadPresets] = usePresets();
  const [create, setCreate] = useState<{ open: boolean; initial?: Form }>({
    open: false,
  });
  const [palette, setPalette] = useState(false);
  const theme = useThemePreference();
  const changeLanguage = (next: 'en' | 'th') => {
    setLanguage(next);
    void api.invoke('settings:update', { language: next });
  };
  const changeTheme = (next: ThemePreference) => {
    setTheme(next);
    void api.invoke('settings:update', { theme: next });
  };
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  useEffect(() => {
    const group = groupOf(page);
    if (group) setOpenGroup(group);
  }, [page]);
  const [release, setRelease] = useState<AppReleaseInfo | null>();
  const [releaseError, setReleaseError] = useState<string>();

  const checkRelease = () => {
    setReleaseError(undefined);
    void api
      .invoke('app:release')
      .then(setRelease)
      .catch((error: unknown) => {
        setReleaseError((error as Error).message);
      });
  };
  useEffect(() => {
    checkRelease();
    void api.invoke('settings:get').then((settings) => {
      setLanguage(settings.language === 'th' ? 'th' : 'en');
      setTheme(settings.theme ?? 'system');
    });
  }, []);

  const openCreate = (initial?: Form) => {
    setPage('runners');
    setCreate({ open: true, initial });
  };
  const showRunners = (filter: Filter) => {
    setRunnerFilter(filter);
    setPage('runners');
  };

  // Global shortcuts and requests from the tray.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'n') {
        e.preventDefault();
        openCreate();
      } else if (k === 'k') {
        e.preventDefault();
        reloadPresets();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    const off = api.on('command', (c) => {
      if (c === 'create') openCreate();
      else if (c === 'problems') showRunners('problem');
      else setPalette(true);
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, [reloadPresets]);

  const problems = snapshot.runners.filter(
    (r) =>
      r.status.broken ||
      r.status.lastError ||
      r.status.local === 'crashed' ||
      (r.status.github === 'offline' && r.status.local === 'running'),
  ).length;

  const commands = useMemo<Command[]>(() => {
    const names = new Map(snapshot.runners.map((r) => [r.id, r.name]));
    const runAll = async (
      action: 'start' | 'stop' | 'restart',
      filter: (r: (typeof snapshot.runners)[number]) => boolean,
    ) => {
      const ids = snapshot.runners.filter(filter).map((r) => r.id);
      const verb = { start: 'Started', stop: 'Stopped', restart: 'Restarted' }[
        action
      ];
      if (ids.length)
        reportBulk(verb, await call('runners:bulk', ids, action), names);
    };
    return [
      {
        id: 'create',
        label: 'Create runners…',
        hint: 'Ctrl+N',
        run: () => openCreate(),
      },
      ...presets.map((p) => {
        const { id: _id, name: _name, ...form } = p;
        return {
          id: `preset-${p.id}`,
          label: `Create from preset: ${p.name}`,
          run: () => openCreate(form),
        };
      }),
      {
        id: 'start-all',
        label: 'Start all stopped runners',
        run: () =>
          runAll(
            'start',
            (r) =>
              r.status.local === 'stopped' && !r.status.broken && !r.status.op,
          ),
      },
      {
        id: 'stop-idle',
        label: 'Stop all idle runners',
        run: () =>
          runAll('stop', (r) => r.status.local === 'running' && !r.status.busy),
      },
      {
        id: 'restart-idle',
        label: 'Restart all idle runners',
        run: () =>
          runAll(
            'restart',
            (r) => r.status.local === 'running' && !r.status.busy,
          ),
      },
      ...NAV.map((n) => ({
        id: `go-${n.id}`,
        label: `${tr('Go to', 'ไปที่')} ${language === 'th' ? TH_NAV[n.id] : n.label}`,
        run: () => setPage(n.id),
      })),
    ];
  }, [snapshot.runners, presets, language]);

  const badgeFor = (id: PageId) =>
    id === 'runners' && problems > 0 ? (
      <span className="bg-destructive ml-auto rounded-full px-1.5 text-[11px] leading-5 text-white">
        {problems}
      </span>
    ) : id === 'updates' && release?.available ? (
      <span className="bg-primary text-primary-foreground ml-auto rounded-full px-1.5 text-[11px] leading-5">
        New
      </span>
    ) : null;

  const navLabel = (item: NavItem) =>
    language === 'th' ? TH_NAV[item.id] : item.label;

  return (
    <TooltipProvider>
      <ConfirmProvider>
        <div className="flex h-screen">
          <nav className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-60 shrink-0 flex-col overflow-y-auto border-r px-3 py-4">
            <div className="flex items-center gap-2.5 px-2 pb-5">
              <img src={appIcon} alt="" className="size-7" />
              <span className="text-[15px] font-bold">GRC Self-Host</span>
            </div>
            <div className="flex flex-col gap-1">
              {TOP_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    className={cn(
                      'hover:bg-sidebar-accent flex h-10 items-center gap-3 rounded-lg px-3 text-[15px]',
                      item.id === page &&
                        'bg-sidebar-accent text-sidebar-accent-foreground font-bold',
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" />
                    {navLabel(item)}
                  </button>
                );
              })}
            </div>
            <div className="border-sidebar-border my-3 border-t" />
            <div className="flex flex-col gap-1">
              {NAV_GROUPS.map((group) => {
                const Icon = group.icon;
                const open = openGroup === group.id;
                const active = groupOf(page) === group.id;
                const badges = group.items.map((i) => badgeFor(i.id));
                return (
                  <div key={group.id}>
                    <button
                      onClick={() => setOpenGroup(open ? null : group.id)}
                      aria-expanded={open}
                      className={cn(
                        'hover:bg-sidebar-accent flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[15px]',
                        active && 'font-bold',
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      {language === 'th' ? group.th : group.label}
                      <span className="ml-auto flex items-center gap-1.5">
                        {!open && badges.find(Boolean)}
                        <ChevronRight
                          className={cn(
                            'text-muted-foreground size-4 transition-transform duration-150 motion-reduce:transition-none',
                            open && 'rotate-90',
                          )}
                        />
                      </span>
                    </button>
                    {open && (
                      <div className="border-sidebar-border mt-0.5 mb-1 ml-[21px] flex flex-col border-l">
                        {group.items.map((item, index) => (
                          <button
                            key={item.id}
                            onClick={() => setPage(item.id)}
                            className={cn(
                              '-ml-px flex h-9 items-center border-l-2 border-transparent pr-3 pl-4 text-left text-sm',
                              item.id === page
                                ? 'border-sidebar-indicator text-foreground font-bold'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {navLabel(item)}
                            {badges[index]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-sidebar-border mt-auto flex flex-col gap-2 border-t pt-3">
              <button
                onClick={() => setPalette(true)}
                className="text-muted-foreground hover:bg-sidebar-accent flex h-9 items-center rounded-lg px-3 text-left text-sm"
              >
                {tr('Command palette', 'ชุดคำสั่ง')}
                <kbd className="ml-auto text-xs opacity-70">Ctrl+K</kbd>
              </button>
              <div className="flex items-center gap-2 px-1">
                <Segmented
                  label={tr('Language', 'ภาษา')}
                  value={language}
                  onChange={changeLanguage}
                  options={[
                    { value: 'th', content: 'ไทย', title: 'ไทย' },
                    { value: 'en', content: 'EN', title: 'English' },
                  ]}
                />
                <Segmented
                  label={tr('Theme', 'ธีม')}
                  value={theme}
                  onChange={changeTheme}
                  options={[
                    {
                      value: 'light',
                      content: <Sun className="size-4" />,
                      title: tr('Light', 'สว่าง'),
                    },
                    {
                      value: 'dark',
                      content: <Moon className="size-4" />,
                      title: tr('Dark', 'มืด'),
                    },
                    {
                      value: 'system',
                      content: <Monitor className="size-4" />,
                      title: tr('Match system', 'ตามระบบ'),
                    },
                  ]}
                />
              </div>
            </div>
          </nav>
          <main className="flex-1 overflow-auto p-6">
            <h1 className="mb-6 text-xl font-semibold">
              {language === 'th'
                ? TH_NAV[page]
                : NAV.find((n) => n.id === page)?.label}
            </h1>
            {page === 'dashboard' && (
              <DashboardPage
                snapshot={snapshot}
                onShowRunners={showRunners}
                onOnboarding={() => setPage('onboarding')}
              />
            )}
            {page === 'diagnostics' && (
              <DiagnosticsPage
                snapshot={snapshot}
                onShowProblems={() => showRunners('problem')}
              />
            )}
            {page === 'watch' && <WatchPage snapshot={snapshot} />}
            {page === 'operations' && <OperationsPage snapshot={snapshot} />}
            {page === 'history' && <HistoryPage />}
            {page === 'versions' && <VersionsPage snapshot={snapshot} />}
            {page === 'disk' && <DiskPage snapshot={snapshot} />}
            {page === 'support' && <SupportPage />}
            {page === 'updates' && (
              <UpdatesPage
                release={release}
                error={releaseError}
                onCheck={checkRelease}
              />
            )}
            {page === 'jobs' && <JobsPage snapshot={snapshot} />}
            {page === 'maintenance' && <MaintenancePage snapshot={snapshot} />}
            {page === 'multi' && <MultiCreatePage snapshot={snapshot} />}
            {page === 'import' && <ImportPage />}
            {page === 'onboarding' && (
              <OnboardingPage
                snapshot={snapshot}
                onConnections={() => setPage('connections')}
                onCreate={openCreate}
                onRunners={() => showRunners('all')}
              />
            )}
            {page === 'runners' && (
              <RunnersPage
                snapshot={snapshot}
                onCreate={openCreate}
                filter={runnerFilter}
                onFilterChange={setRunnerFilter}
              />
            )}
            {page === 'connections' && <ConnectionsPage />}
            {page === 'presets' && <PresetsPage onUse={openCreate} />}
            {page === 'settings' && <SettingsPage />}
          </main>
        </div>
        <CreateDialog
          open={create.open}
          initial={create.initial}
          onOpenChange={(open) => setCreate((c) => ({ ...c, open }))}
        />
        <CommandPalette
          open={palette}
          onOpenChange={setPalette}
          commands={commands}
        />
        <Toaster position="bottom-right" richColors />
      </ConfirmProvider>
    </TooltipProvider>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; content: ReactNode; title: string }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="border-sidebar-border bg-background flex flex-1 rounded-lg border p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex h-7 flex-1 items-center justify-center rounded-md text-xs',
            option.value === value
              ? 'bg-sidebar-accent text-foreground font-bold'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.content}
        </button>
      ))}
    </div>
  );
}
