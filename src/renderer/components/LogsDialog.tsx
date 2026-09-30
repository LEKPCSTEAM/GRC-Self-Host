import { useEffect, useRef, useState } from 'react';
import type { LogKind, RunnerView } from '../../shared/types';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const MAX_CHARS = 400_000;
const POLL_MS = 2_000;

export function LogsDialog({
  runner,
  onClose,
}: {
  runner: RunnerView | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<LogKind>('runner');
  const [file, setFile] = useState<string | undefined>();
  const [files, setFiles] = useState<string[]>([]);
  const [text, setText] = useState('');
  const pre = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (runner) setKind(runner.mode === 'child' ? 'console' : 'runner');
    setFile(undefined);
  }, [runner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tail the selected log.
  useEffect(() => {
    if (!runner) return;
    let offset: number | undefined;
    let cancelled = false;
    let current: string | null | undefined = file;
    setText('');
    const tick = async () => {
      try {
        const chunk = await api.invoke(
          'logs:read',
          runner.id,
          kind,
          current ?? undefined,
          offset,
        );
        if (cancelled) return;
        setFiles(chunk.files);
        current = chunk.file ?? undefined;
        const fresh = offset === undefined;
        if (chunk.text) {
          setText((t) => {
            const next = fresh
              ? chunk.text
              : t + (t && !t.endsWith('\n') ? '\n' : '') + chunk.text;
            return next.length > MAX_CHARS ? next.slice(-MAX_CHARS) : next;
          });
        }
        offset = chunk.offset;
      } catch {
        // Runner removed while open.
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runner?.id, kind, file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stick.current && pre.current)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [text]);

  return (
    <Dialog open={runner !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Logs · {runner?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <Tabs
            value={kind}
            onValueChange={(v) => {
              setKind(v as LogKind);
              setFile(undefined);
            }}
          >
            <TabsList>
              {runner?.mode === 'child' && (
                <TabsTrigger value="console">Console</TabsTrigger>
              )}
              <TabsTrigger value="runner">Runner</TabsTrigger>
              <TabsTrigger value="worker">Worker</TabsTrigger>
            </TabsList>
          </Tabs>
          {kind !== 'console' && files.length > 0 && (
            <Select value={file ?? files[0]} onValueChange={setFile}>
              <SelectTrigger size="sm" className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {files.map((f) => (
                  <SelectItem key={f} value={f} className="font-mono text-xs">
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <pre
          ref={pre}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="bg-muted/50 min-h-0 flex-1 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] select-text"
        >
          {text ||
            (kind === 'console' ? 'No output yet.' : 'No log files yet.')}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
