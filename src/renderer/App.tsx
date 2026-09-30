import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { KeyRound, Layers, Server, Settings } from 'lucide-react';
import { api, call, reportBulk } from '@/lib/api';
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

type PageId = 'runners' | 'connections' | 'presets' | 'settings';

const NAV: {
  id: PageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: 'runners', label: 'Runners', icon: Server },
  { id: 'connections', label: 'Connections', icon: KeyRound },
  { id: 'presets', label: 'Presets', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function App() {
  const [page, setPage] = useState<PageId>('runners');
  const snapshot = useSnapshot();
  const [presets, reloadPresets] = usePresets();
  const [create, setCreate] = useState<{ open: boolean; initial?: Form }>({
    open: false,
  });
  const [palette, setPalette] = useState(false);

  const openCreate = (initial?: Form) => {
    setPage('runners');
    setCreate({ open: true, initial });
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
    const off = api.on('command', (c) =>
      c === 'create' ? openCreate() : setPalette(true),
    );
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, [reloadPresets]);

  const problems = snapshot.runners.filter(
    (r) => r.status.broken || r.status.local === 'crashed',
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
        label: `Go to ${n.label}`,
        run: () => setPage(n.id),
      })),
    ];
  }, [snapshot.runners, presets]);

  return (
    <TooltipProvider>
      <ConfirmProvider>
        <div className="flex h-screen">
          <nav className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-52 shrink-0 flex-col gap-1 border-r p-3">
            <div className="px-2 pt-1 pb-4 text-sm font-semibold">
              GRC Self-Host
            </div>
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setPage(id)}
                className={cn(
                  'hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  id === page &&
                    'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
                )}
              >
                <Icon className="size-4" />
                {label}
                {id === 'runners' && problems > 0 && (
                  <span className="bg-destructive ml-auto rounded-full px-1.5 text-[10px] text-white">
                    {problems}
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={() => setPalette(true)}
              className="text-muted-foreground hover:bg-sidebar-accent mt-auto rounded-md px-2 py-1.5 text-left text-xs"
            >
              Command palette{' '}
              <kbd className="float-right opacity-70">Ctrl+K</kbd>
            </button>
          </nav>
          <main className="flex-1 overflow-auto p-6">
            <h1 className="mb-6 text-xl font-semibold">
              {NAV.find((n) => n.id === page)?.label}
            </h1>
            {page === 'runners' && (
              <RunnersPage snapshot={snapshot} onCreate={() => openCreate()} />
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
