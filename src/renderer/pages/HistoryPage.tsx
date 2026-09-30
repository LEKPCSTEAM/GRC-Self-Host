import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { JournalEvent } from '../../shared/types';
import { api, errorMessage } from '@/lib/api';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';

export function HistoryPage() {
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [tab, setTab] = useState<JournalEvent['type']>('command');
  const confirm = useConfirm();

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await api.invoke('history:list');
        if (mounted) setEvents(next);
      } catch (error) {
        if (mounted) toast.error(errorMessage(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const clearTimeline = async () => {
    if (
      !(await confirm({
        title: 'Clear runner timeline?',
        description: 'Status events will be removed. Command history is kept.',
        confirmLabel: 'Clear timeline',
        destructive: true,
      }))
    )
      return;
    try {
      await api.invoke('history:clearState');
      setEvents(await api.invoke('history:list'));
      toast.success('Runner timeline cleared');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const visible = events.filter((event) => event.type === tab);
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-muted-foreground text-sm">
        Recent runner commands and status changes. Up to 500 events are kept for
        30 days. Errors are summarized to avoid storing credentials or command
        output.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={tab === 'command' ? 'default' : 'outline'}
          onClick={() => setTab('command')}
        >
          Commands
        </Button>
        <Button
          variant={tab === 'state' ? 'default' : 'outline'}
          onClick={() => setTab('state')}
        >
          Timeline
        </Button>
        {tab === 'state' && events.some((event) => event.type === 'state') && (
          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => void clearTimeline()}
          >
            Clear timeline
          </Button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          No {tab === 'command' ? 'commands' : 'status events'} recorded yet.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {visible.map((event) => (
            <div
              key={event.id}
              className="grid gap-1 p-3 text-sm sm:grid-cols-[11rem_minmax(0,1fr)_6rem] sm:gap-3"
            >
              <time
                className="text-muted-foreground text-xs"
                dateTime={event.at}
              >
                {new Date(event.at).toLocaleString()}
              </time>
              <div className="min-w-0">
                <span className="font-mono">{event.runnerName}</span>
                <span className="text-muted-foreground"> · {event.action}</span>
                {event.error && (
                  <p className="text-destructive text-xs">{event.error}</p>
                )}
              </div>
              <span
                className={
                  event.outcome === 'failed' ||
                  event.outcome === 'crashed' ||
                  event.outcome === 'offline'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }
              >
                {event.outcome}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
