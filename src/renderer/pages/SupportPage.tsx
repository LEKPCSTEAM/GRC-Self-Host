import { useState } from 'react';
import { toast } from 'sonner';
import type { SupportPreview } from '../../shared/types';
import { api, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { Button } from '@/components/ui/button';

export function SupportPage() {
  const [days, setDays] = useState(7);
  const [preview, setPreview] = useState<SupportPreview>();
  const [loading, setLoading] = useState(false);
  const buildPreview = async () => {
    setLoading(true);
    try {
      setPreview(await api.invoke('support:preview', days));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };
  const exportBundle = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const file = await api.invoke('support:export', preview.id);
      if (file) {
        toast.success(`Exported support bundle to ${file}`);
        setPreview(undefined);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-muted-foreground text-sm">
        Export runner status and recent _diag log summaries for troubleshooting.
        Raw messages, tokens and passwords are never included. Up to four recent
        files per log kind and 64 KiB per file are summarized. Review the
        preview before sharing the file.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Log period:</span>
        {[1, 7, 30].map((value) => (
          <Button
            key={value}
            size="sm"
            variant={days === value ? 'default' : 'outline'}
            onClick={() => {
              setDays(value);
              setPreview(undefined);
            }}
          >
            {value} day{value === 1 ? '' : 's'}
          </Button>
        ))}
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void buildPreview()}
        >
          {loading ? 'Working…' : 'Preview bundle'}
        </Button>
      </div>
      {preview && (
        <div className="space-y-4 rounded-md border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {preview.runnerCount} runners · {preview.files.length} log files ·{' '}
              {formatBytes(
                preview.files.reduce((sum, file) => sum + file.bytes, 0),
              )}{' '}
              of sanitized logs
            </p>
            <Button disabled={loading} onClick={() => void exportBundle()}>
              Export reviewed bundle
            </Button>
          </div>
          {preview.truncated && (
            <p className="text-attention">
              Log limit reached; some files were omitted.
            </p>
          )}
          <div className="max-h-40 overflow-auto rounded border p-2 font-mono text-xs">
            {preview.files.length === 0
              ? 'No diagnostic logs in this period.'
              : preview.files.map((file, index) => (
                  <p key={`${file.runner}-${file.file}-${index}`}>
                    {file.runner}/{file.file} · {formatBytes(file.bytes)}
                  </p>
                ))}
          </div>
          <div>
            <p className="mb-2 font-medium">
              Log summary sample (first 8,000 characters)
            </p>
            <pre className="bg-muted max-h-72 overflow-auto rounded p-3 text-xs whitespace-pre-wrap break-all">
              {preview.sample || 'No log text to preview.'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
