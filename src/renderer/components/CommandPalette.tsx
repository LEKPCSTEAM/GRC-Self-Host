import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  commands: Command[];
}) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
    }
  }, [open]);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) =>
      words.every((w) => c.label.toLowerCase().includes(w)),
    );
  }, [q, commands]);

  const runAt = (i: number) => {
    const c = list[i];
    if (!c) return;
    onOpenChange(false);
    c.run();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, list.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              runAt(index);
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto p-1">
          {list.length === 0 && (
            <div className="text-muted-foreground p-3 text-sm">
              No matching commands.
            </div>
          )}
          {list.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAt(i)}
              className={cn(
                'flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm',
                i === index && 'bg-accent text-accent-foreground',
              )}
            >
              {c.label}
              {c.hint && (
                <span className="text-muted-foreground text-xs">{c.hint}</span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
