import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type {
  MultiTargetPreview,
  MultiTargetResult,
  Snapshot,
  TargetOption,
} from '../../shared/types';
import { api, call, errorMessage } from '@/lib/api';
import { targetKey } from '@/lib/format';
import { usePresets } from '@/lib/hooks';
import { useConfirm } from '@/components/confirm';
import { tr } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export function MultiCreatePage({ snapshot }: { snapshot: Snapshot }) {
  const [presets] = usePresets();
  const [presetId, setPresetId] = useState('');
  const [options, setOptions] = useState<TargetOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<MultiTargetPreview>();
  const [results, setResults] = useState<MultiTargetResult[]>();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const preset = presets.find((item) => item.id === presetId) ?? presets[0];
  useEffect(() => {
    if (!preset) return;
    let mounted = true;
    void call('connections:targets', preset.connectionId).then((next) => {
      if (mounted) setOptions(next ?? []);
    });
    return () => {
      mounted = false;
    };
  }, [preset?.id, preset?.connectionId]);
  const choices = options
    .filter((item) =>
      selected.includes(
        `${item.target.kind}:${targetKey(item.target).toLowerCase()}`,
      ),
    )
    .map((item) => item.target);
  const toggle = (key: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key),
    );
    setPreview(undefined);
    setResults(undefined);
  };
  const buildPreview = async () => {
    if (!preset) return;
    setBusy(true);
    try {
      setPreview(await api.invoke('multi:preview', preset.id, choices));
      setResults(undefined);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!preset || !preview) return;
    const risky = preview.targets.filter(
      (item) => item.target.kind === 'repo' && item.visibility !== 'private',
    );
    const ok = await confirm({
      title: tr(
        `Create ${preview.total} runners on ${preview.targets.length} targets?`,
        `สร้าง ${preview.total} runners บน ${preview.targets.length} targets หรือไม่?`,
      ),
      description: (
        <div className="space-y-2 text-left">
          <p>
            {preview.targets.map((item) => targetKey(item.target)).join(', ')}
          </p>
          {risky.length > 0 && (
            <p className="text-destructive">
              {tr(
                `${risky.length} public or unverified repositories: persistent runners can execute workflow and pull request code on this machine. Workspace cleanup does not isolate it.`,
                `${risky.length} ที่เก็บโค้ดเป็นสาธารณะหรือยังตรวจสอบไม่ได้: Runner แบบถาวรสามารถรัน workflow และโค้ดจาก pull request บนเครื่องนี้ การล้างพื้นที่ทำงานไม่ได้แยกสภาพแวดล้อมของเครื่อง`,
              )}
            </p>
          )}
        </div>
      ),
      confirmLabel: risky.length
        ? tr('I understand, create runners', 'เข้าใจความเสี่ยงแล้ว สร้าง Runner')
        : tr('Create runners', 'สร้าง Runner'),
      destructive: risky.length > 0,
    });
    if (!ok) return;
    setBusy(true);
    try {
      setResults(
        await api.invoke(
          'multi:create',
          preset.id,
          preview,
          risky.length > 0,
          password || undefined,
        ),
      );
      setPassword('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const failed = preview?.targets.some((item) =>
    item.checks.some((check) => check.status === 'fail'),
  );
  return (
    <div className="max-w-4xl space-y-5">
      <p className="text-muted-foreground text-sm">
        {tr(
          'Create runners from one preset on several targets. Preview names, paths and checks before submitting. Up to 10 targets and 100 runners total.',
          'สร้าง Runner จาก preset เดียวบนหลาย targets ตรวจชื่อ path และผลตรวจสอบก่อนเริ่ม สูงสุด 10 targets และ 100 runners',
        )}
      </p>
      {presets.length === 0 ? (
        <p className="rounded border p-4 text-sm">
          {tr(
            'Save a preset first in Create runners.',
            'กรุณาบันทึก preset ในหน้าสร้าง Runner ก่อน',
          )}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm" htmlFor="multi-preset">
              {tr('Preset', 'Preset')}
            </label>
            <select
              id="multi-preset"
              className="bg-background rounded border px-3 py-2 text-sm"
              value={preset?.id ?? ''}
              onChange={(event) => {
                setPresetId(event.target.value);
                setSelected([]);
                setPreview(undefined);
                setResults(undefined);
              }}
            >
              {presets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-xs">
              {preset?.count} {tr('runners per target', 'runners ต่อ target')} ·{' '}
              {preset?.mode} {tr('mode', 'โหมด')}
            </span>
          </div>
          <div className="grid max-h-52 gap-2 overflow-auto rounded border p-3 sm:grid-cols-2">
            {options.map((item) => {
              const key = `${item.target.kind}:${targetKey(item.target).toLowerCase()}`;
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(key)}
                    onCheckedChange={(value) => toggle(key, value === true)}
                  />
                  {item.label}
                </label>
              );
            })}
            {options.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {tr(
                  'No accessible targets found for this connection.',
                  'ไม่พบ target ที่การเชื่อมต่อนี้เข้าถึงได้',
                )}
              </p>
            )}
          </div>
          {preset?.mode === 'service' && preset.serviceAccount && (
            <div>
              <label htmlFor="multi-password" className="text-sm">
                {tr('Service account password', 'รหัสผ่านบัญชีบริการ')}
              </label>
              <Input
                id="multi-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          )}
          <Button
            variant="outline"
            disabled={
              busy ||
              !choices.length ||
              choices.length > 10 ||
              Boolean(preset && choices.length * preset.count > 100)
            }
            onClick={() => void buildPreview()}
          >
            {busy
              ? tr('Working…', 'กำลังทำงาน…')
              : tr('Preview all targets', 'ดูตัวอย่างทุก target')}
          </Button>
          {preview && (
            <div className="space-y-3">
              <p className="font-medium">
                {tr('Preview', 'ตัวอย่าง')}: {preview.total} runners
              </p>
              {preview.targets.map((item) => (
                <div
                  key={`${item.target.kind}:${targetKey(item.target)}`}
                  className="rounded border p-3 text-sm"
                >
                  <p className="font-medium">
                    {targetKey(item.target)}{' '}
                    {item.visibility ? `· ${item.visibility}` : ''}
                  </p>
                  <div className="mt-2 max-h-32 overflow-auto font-mono text-xs">
                    {item.runners.map((runner) => (
                      <p key={runner.name}>
                        {runner.name} · {runner.path}
                      </p>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    {item.checks.map((check) => (
                      <p
                        key={check.name}
                        className={
                          check.status === 'fail'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }
                      >
                        {check.status}: {check.name} — {check.message}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
              <Button disabled={busy || failed} onClick={() => void create()}>
                {tr('Create all targets', 'สร้างบนทุก target')}
              </Button>
            </div>
          )}
          {results && (
            <div className="space-y-2">
              <h2 className="font-medium">
                {tr('Results by target', 'ผลลัพธ์แยกตาม target')}
              </h2>
              {results.map((result) => {
                const runners = snapshot.runners.filter((runner) =>
                  result.ids.includes(runner.id),
                );
                return (
                  <div
                    key={`${result.target.kind}:${targetKey(result.target)}`}
                    className="rounded border p-3 text-sm"
                  >
                    <p className="font-medium">{targetKey(result.target)}</p>
                    {result.error ? (
                      <p className="text-destructive">{result.error}</p>
                    ) : (
                      <p>
                        {
                          runners.filter(
                            (runner) => runner.status.creationFailed,
                          ).length
                        }{' '}
                        {tr('failed', 'ล้มเหลว')} ·{' '}
                        {runners.filter((runner) => runner.status.op).length}{' '}
                        {tr('in progress', 'กำลังดำเนินการ')} ·{' '}
                        {
                          runners.filter(
                            (runner) =>
                              !runner.status.creationFailed &&
                              !runner.status.op,
                          ).length
                        }{' '}
                        {tr('configured', 'ตั้งค่าแล้ว')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
