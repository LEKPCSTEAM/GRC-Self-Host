import { useEffect, useState } from 'react';
import type {
  CleanupOptions,
  BulkOptionsPatch,
  RunnerMode,
  RunnerView,
} from '../../shared/types';
import { call, reportBulk } from '@/lib/api';
import { splitList } from '@/lib/format';
import { tr } from '@/lib/i18n';
import { useAppInfo } from '@/lib/hooks';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function LabelsDialog({
  runners,
  onClose,
}: {
  runners: RunnerView[] | null;
  onClose: () => void;
}) {
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAdd('');
    setRemove('');
  }, [runners]);

  const existing = [...new Set(runners?.flatMap((r) => r.labels) ?? [])];

  const apply = async () => {
    if (!runners) return;
    setBusy(true);
    const res = await call(
      'runners:setLabels',
      runners.map((r) => r.id),
      splitList(add),
      splitList(remove),
    );
    setBusy(false);
    reportBulk(
      'Updated labels on',
      res,
      new Map(runners.map((r) => [r.id, r.name])),
    );
    if (res) onClose();
  };

  return (
    <Dialog open={runners !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Edit labels', 'แก้ไข Labels')}</DialogTitle>
          <DialogDescription>
            {tr(
              `${runners?.length} runner${runners?.length === 1 ? '' : 's'} · applied on GitHub immediately, no re-registration.`,
              `Runner ${runners?.length} ตัว · เปลี่ยนบน GitHub ทันทีโดยไม่ต้องลงทะเบียนใหม่`,
            )}
          </DialogDescription>
        </DialogHeader>
        {existing.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {existing.map((l) => (
              <button
                key={l}
                type="button"
                className="bg-secondary hover:bg-destructive/20 rounded px-2 py-0.5 font-mono text-xs"
                title={tr('Click to remove', 'คลิกเพื่อลบ')}
                onClick={() =>
                  setRemove((r) =>
                    [...new Set([...splitList(r), l])].join(', '),
                  )
                }
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label>{tr('Add', 'เพิ่ม')}</Label>
          <Input
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            placeholder="gpu, windows-build"
            className="font-mono"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{tr('Remove', 'ลบ')}</Label>
          <Input
            value={remove}
            onChange={(e) => setRemove(e.target.value)}
            className="font-mono"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Cancel', 'ยกเลิก')}
          </Button>
          <Button
            onClick={apply}
            disabled={busy || (!add.trim() && !remove.trim())}
          >
            {tr('Apply', 'นำไปใช้')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ModeDialog({
  runner,
  onClose,
}: {
  runner: RunnerView | null;
  onClose: () => void;
}) {
  const info = useAppInfo();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    setAccount(runner?.serviceAccount ?? '');
    setPassword('');
  }, [runner]);

  if (!runner) return null;
  const to: RunnerMode = runner.mode === 'child' ? 'service' : 'child';
  const isWin = info?.platform === 'win32';

  const apply = () => {
    // Runs in the background; progress shows in the table.
    void call(
      'runners:setMode',
      runner.id,
      to,
      account || undefined,
      password || undefined,
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr('Switch', 'เปลี่ยน')} {runner.name} {tr('to', 'เป็น')}{' '}
            {to === 'service' ? 'OS service' : 'app process'}
          </DialogTitle>
          <DialogDescription>
            {isWin
              ? tr(
                  'On Windows the runner is re-registered with the same name (--replace). Administrator approval is required.',
                  'บน Windows จะลงทะเบียน Runner ใหม่ด้วยชื่อเดิม (--replace) และต้องอนุญาตสิทธิ์ผู้ดูแลระบบ',
                )
              : to === 'service'
                ? tr(
                    'Installs a systemd service with svc.sh. Administrator approval is required.',
                    'ติดตั้ง systemd service ด้วย svc.sh และต้องอนุญาตสิทธิ์ผู้ดูแลระบบ',
                  )
                : tr(
                    'Uninstalls the systemd service. Administrator approval is required.',
                    'ถอน systemd service และต้องอนุญาตสิทธิ์ผู้ดูแลระบบ',
                  )}
          </DialogDescription>
        </DialogHeader>
        {to === 'service' && isWin && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>{tr('Service account', 'บัญชี Service')}</Label>
              <Input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="NETWORK SERVICE"
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{tr('Password', 'รหัสผ่าน')}</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!account}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Cancel', 'ยกเลิก')}
          </Button>
          <Button onClick={apply}>{tr('Switch', 'เปลี่ยน')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OptionsDialog({
  runner,
  onClose,
}: {
  runner: RunnerView | null;
  onClose: () => void;
}) {
  const [autostart, setAutostart] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupOptions>({
    enabled: true,
    actions: false,
    tool: false,
  });
  useEffect(() => {
    if (runner) {
      setAutostart(runner.autostart);
      setCleanup(runner.cleanup);
    }
  }, [runner]);
  if (!runner) return null;

  const save = async () => {
    await call('runners:setOptions', runner.id, { autostart, cleanup });
    onClose();
  };

  const check = (
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    disabled = false,
  ) => (
    <Label className="font-normal">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
      />
      {label}
    </Label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr('Options', 'ตัวเลือก')} · {runner.name}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'Cleanup changes take effect the next time the runner starts.',
              'การเปลี่ยนค่าล้างข้อมูลจะมีผลเมื่อ Runner เริ่มครั้งถัดไป',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {runner.mode === 'child' &&
            check(
              autostart,
              setAutostart,
              tr(
                'Start automatically when the app starts',
                'เริ่มอัตโนมัติเมื่อเปิดแอป',
              ),
            )}
          {check(
            cleanup.enabled,
            (enabled) => setCleanup({ ...cleanup, enabled }),
            tr(
              'Clean the job workspace and _temp after every job',
              'ล้าง workspace และ _temp หลังทุก job',
            ),
          )}
          <div className="flex flex-col gap-3 pl-6">
            {check(
              cleanup.actions,
              (actions) => setCleanup({ ...cleanup, actions }),
              tr('Also clear _actions', 'ล้าง _actions ด้วย'),
              !cleanup.enabled,
            )}
            {check(
              cleanup.tool,
              (tool) => setCleanup({ ...cleanup, tool }),
              tr('Also clear _tool', 'ล้าง _tool ด้วย'),
              !cleanup.enabled,
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Cancel', 'ยกเลิก')}
          </Button>
          <Button onClick={save}>{tr('Save', 'บันทึก')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OptionField = 'autostart' | 'enabled' | 'actions' | 'tool';
type Choice = 'keep' | 'on' | 'off';
const OPTION_FIELDS: { key: OptionField; label: string }[] = [
  { key: 'autostart', label: 'Start with app' },
  { key: 'enabled', label: 'Clean workspace after jobs' },
  { key: 'actions', label: 'Also clear actions' },
  { key: 'tool', label: 'Also clear tools' },
];
const EMPTY_CHOICES: Record<OptionField, Choice> = {
  autostart: 'keep',
  enabled: 'keep',
  actions: 'keep',
  tool: 'keep',
};

export function BulkOptionsDialog({
  runners,
  onClose,
}: {
  runners: RunnerView[] | null;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState(EMPTY_CHOICES);
  const [saving, setSaving] = useState(false);
  useEffect(() => setChoices(EMPTY_CHOICES), [runners]);
  const valueOf = (r: RunnerView, field: OptionField) =>
    field === 'autostart' ? r.autostart : r.cleanup[field];
  const current = (field: OptionField) => {
    if (!runners?.length) return '—';
    const values = runners
      .filter((r) => field !== 'autostart' || r.mode === 'child')
      .map((r) => valueOf(r, field));
    return !values.length
      ? 'N/A'
      : values.every((v) => v === values[0])
        ? values[0]
          ? 'On'
          : 'Off'
        : 'Mixed';
  };
  const patch: BulkOptionsPatch = {};
  if (choices.autostart !== 'keep')
    patch.autostart = choices.autostart === 'on';
  for (const field of ['enabled', 'actions', 'tool'] as const) {
    if (choices[field] !== 'keep')
      patch.cleanup = { ...patch.cleanup, [field]: choices[field] === 'on' };
  }
  const changed = Object.values(choices).some((v) => v !== 'keep');
  const apply = async () => {
    if (!runners || !changed) return;
    setSaving(true);
    const result = await call(
      'runners:setOptionsBulk',
      runners.map((r) => r.id),
      patch,
    );
    setSaving(false);
    reportBulk(
      'Updated options on',
      result,
      new Map(runners.map((r) => [r.id, r.name])),
    );
    if (result) onClose();
  };
  return (
    <Dialog open={runners !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr('Bulk options', 'ตั้งค่าหลาย Runner')}</DialogTitle>
          <DialogDescription>
            {tr(
              `${runners?.length} selected runner${runners?.length === 1 ? '' : 's'}. Only options changed below will be applied. Cleanup changes take effect on the next runner start.`,
              `เลือก Runner ${runners?.length} ตัว เฉพาะตัวเลือกที่เปลี่ยนจะถูกนำไปใช้ และค่าล้างข้อมูลจะมีผลเมื่อเริ่ม Runner ครั้งถัดไป`,
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {OPTION_FIELDS.map(({ key, label }) => (
            <div
              key={key}
              className="grid grid-cols-[1fr_4rem_8rem] items-center gap-2 text-sm"
            >
              <span>
                {tr(
                  label,
                  (
                    {
                      autostart: 'เริ่มพร้อมแอป',
                      enabled: 'ล้าง workspace หลัง job',
                      actions: 'ล้าง actions ด้วย',
                      tool: 'ล้าง tools ด้วย',
                    } as Record<OptionField, string>
                  )[key],
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                {current(key)}
              </span>
              <Select
                value={choices[key]}
                onValueChange={(value) =>
                  setChoices((c) => ({ ...c, [key]: value as Choice }))
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">{tr('Keep', 'คงเดิม')}</SelectItem>
                  <SelectItem value="on">{tr('On', 'เปิด')}</SelectItem>
                  <SelectItem value="off">{tr('Off', 'ปิด')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        {changed && (
          <div className="max-h-40 overflow-auto rounded-md border p-2 text-xs">
            <p className="mb-1 font-medium">{tr('Preview', 'ตัวอย่างก่อนใช้')}</p>
            {runners?.map((r) => (
              <p key={r.id} className="font-mono">
                {r.name}:{' '}
                {OPTION_FIELDS.filter(({ key }) => choices[key] !== 'keep')
                  .map(
                    ({ key, label }) =>
                      `${label} ${key === 'autostart' && r.mode !== 'child' ? 'N/A' : `${valueOf(r, key) ? 'on' : 'off'} → ${choices[key]}`}`,
                  )
                  .join(', ')}
              </p>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Cancel', 'ยกเลิก')}
          </Button>
          <Button onClick={apply} disabled={!changed || saving}>
            {tr('Apply changes', 'นำการเปลี่ยนแปลงไปใช้')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
