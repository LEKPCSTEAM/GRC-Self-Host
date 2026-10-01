import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogKind, RunnerView } from '../../shared/types';
import { tr } from '@/lib/i18n';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  const [search, setSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const pre = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const matches = useMemo(() => {
    if (!search) return [];
    const found: number[] = [];
    const hay = text.toLocaleLowerCase();
    const needle = search.toLocaleLowerCase();
    let at = 0;
    while ((at = hay.indexOf(needle, at)) !== -1) {
      found.push(at);
      at += needle.length;
    }
    return found;
  }, [text, search]);
  const highlighted = useMemo(() => {
    if (!matches.length) return text;
    const parts: React.ReactNode[] = [];
    let from = 0;
    matches.forEach((at, i) => {
      parts.push(text.slice(from, at));
      parts.push(
        <mark
          key={at}
          data-match={i}
          className={
            i === matchIndex
              ? 'bg-attention text-background'
              : 'bg-attention/25 text-foreground'
          }
        >
          {text.slice(at, at + search.length)}
        </mark>,
      );
      from = at + search.length;
    });
    parts.push(text.slice(from));
    return parts;
  }, [text, matches, matchIndex, search]);

  const goToMatch = (index: number) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setMatchIndex(next);
    stick.current = false;
    requestAnimationFrame(() =>
      pre.current
        ?.querySelector(`[data-match="${next}"]`)
        ?.scrollIntoView({ block: 'center' }),
    );
  };

  useEffect(() => {
    if (runner) setKind(runner.mode === 'child' ? 'console' : 'runner');
    setFile(undefined);
    setSearch('');
    setMatchIndex(0);
  }, [runner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tail the selected log.
  useEffect(() => {
    if (!runner) return;
    stick.current = true;
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

  useEffect(() => {
    setMatchIndex(0);
  }, [kind, file, search]);

  return (
    <Dialog open={runner !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {tr('Logs', 'บันทึกการทำงาน')} · {runner?.name}
          </DialogTitle>
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
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                goToMatch(matchIndex + (e.shiftKey ? -1 : 1));
            }}
            placeholder={tr('Find in this log', 'ค้นหาใน log นี้')}
            aria-label={tr('Find in this log', 'ค้นหาใน log นี้')}
            className="max-w-xs"
          />
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {search
              ? matches.length
                ? `${Math.min(matchIndex + 1, matches.length)} of ${matches.length}`
                : tr('No matches', 'ไม่พบคำที่ค้นหา')
              : ''}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!matches.length}
            onClick={() => goToMatch(matchIndex - 1)}
          >
            {tr('Previous', 'ก่อนหน้า')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!matches.length}
            onClick={() => goToMatch(matchIndex + 1)}
          >
            {tr('Next', 'ถัดไป')}
          </Button>
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
          {highlighted ||
            (kind === 'console'
              ? tr('No output yet.', 'ยังไม่มีข้อความ')
              : tr('No log files yet.', 'ยังไม่มีไฟล์ log'))}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
