import { useState, type ComponentType } from 'react';
import { KeyRound, Layers, Server, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SettingsPage } from '@/pages/SettingsPage';

type PageId = 'runners' | 'connections' | 'presets' | 'settings';

function Placeholder({ phase }: { phase: number }) {
  return (
    <p className="text-muted-foreground text-sm">Coming in phase {phase}.</p>
  );
}

const PAGES: {
  id: PageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  render: () => React.ReactNode;
}[] = [
  {
    id: 'runners',
    label: 'Runners',
    icon: Server,
    render: () => <Placeholder phase={3} />,
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: KeyRound,
    render: () => <Placeholder phase={2} />,
  },
  {
    id: 'presets',
    label: 'Presets',
    icon: Layers,
    render: () => <Placeholder phase={3} />,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    render: () => <SettingsPage />,
  },
];

export function App() {
  const [pageId, setPageId] = useState<PageId>('runners');
  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0]!;

  return (
    <div className="flex h-screen">
      <nav className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-52 shrink-0 flex-col gap-1 border-r p-3">
        <div className="px-2 pt-1 pb-4 text-sm font-semibold">
          GRC Self-Host
        </div>
        {PAGES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPageId(id)}
            className={cn(
              'hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              id === pageId &&
                'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <h1 className="mb-6 text-xl font-semibold">{page.label}</h1>
        {page.render()}
      </main>
    </div>
  );
}
