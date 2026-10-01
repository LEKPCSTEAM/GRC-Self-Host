import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import type { AppInfo, RestorePreview, Settings } from '../../shared/types';
import { api, call } from '@/lib/api';
import { tr } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function SettingsPage() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null,
  );
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    api.invoke('settings:get').then((s) => {
      setSaved(s);
      setDraft(s);
    });
    api.invoke('app:info').then(setInfo);
  }, []);

  if (!draft || !saved) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  const browse = async () => {
    const dir = await api.invoke('settings:chooseRootDir');
    if (dir) set({ rootDir: dir });
  };

  const save = async () => {
    // Language and theme are set from the sidebar; don't overwrite them here.
    const { language: _language, theme: _theme, ...patch } = draft;
    const s = await api.invoke('settings:update', patch);
    setSaved(s);
    setDraft(s);
  };

  const exportBackup = async () => {
    const file = await call('backup:export');
    if (file)
      toast.success(
        tr(`Exported metadata to ${file}`, `ส่งออกข้อมูลไปยัง ${file}`),
      );
  };

  const restoreBackup = async () => {
    if (!restorePreview) return;
    setRestoring(true);
    const result = await call('backup:restore', restorePreview.id);
    setRestoring(false);
    if (!result) return;
    setRestorePreview(null);
    const settings = await call('settings:get');
    if (settings) {
      setSaved(settings);
      setDraft(settings);
    }
    toast.success(
      tr(
        `Restored ${result.connections} connections, ${result.presets} presets, ${result.runners} runners and ${result.watchedTargets} watched targets`,
        `นำเข้า ${result.connections} การเชื่อมต่อ, ${result.presets} presets, ${result.runners} runners และ ${result.watchedTargets} targets ที่ติดตาม`,
      ),
    );
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{tr('Runner storage', 'ที่เก็บ Runner')}</CardTitle>
          <CardDescription>
            {tr(
              'New runners are created under this folder. Changing it does not move existing runners. Keep it short (near the drive root) to avoid long path issues on Windows.',
              'Runner ใหม่จะถูกสร้างในโฟลเดอร์นี้ การเปลี่ยนค่าไม่ย้าย Runner เดิม ควรใช้ path สั้นใกล้รากไดรฟ์เพื่อเลี่ยงปัญหา path ยาวบน Windows',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rootDir">{tr('Root folder', 'โฟลเดอร์หลัก')}</Label>
            <div className="flex gap-2">
              <Input
                id="rootDir"
                value={draft.rootDir}
                onChange={(e) => set({ rootDir: e.target.value })}
                className="font-mono"
              />
              <Button variant="outline" onClick={browse}>
                <FolderOpen /> {tr('Browse', 'เลือกโฟลเดอร์')}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="retention">
              {tr('Keep _diag logs for (days)', 'เก็บ log _diag (วัน)')}
            </Label>
            <Input
              id="retention"
              type="number"
              min={1}
              value={draft.diagRetentionDays}
              onChange={(e) =>
                set({ diagRetentionDays: Math.max(1, Number(e.target.value)) })
              }
              className="w-32"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('App', 'แอป')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Label className="font-normal">
            <Switch
              checked={draft.launchAtLogin}
              onCheckedChange={(launchAtLogin) => set({ launchAtLogin })}
            />
            {tr(
              'Launch at login (starts hidden in the tray; installed app only)',
              'เปิดเมื่อเข้าสู่ระบบ (เริ่มแบบซ่อนในถาดระบบ เฉพาะแอปที่ติดตั้ง)',
            )}
          </Label>
          <Label className="font-normal">
            <Switch
              checked={draft.notifications}
              onCheckedChange={(notifications) => set({ notifications })}
            />
            {tr(
              'Notify when a runner goes offline or crashes',
              'แจ้งเตือนเมื่อ Runner ออฟไลน์หรือหยุดทำงานผิดปกติ',
            )}
          </Label>
          <Label className="font-normal">
            <Switch
              checked={Boolean(draft.quietHours)}
              onCheckedChange={(enabled) =>
                set({
                  quietHours: enabled
                    ? { start: '22:00', end: '08:00' }
                    : undefined,
                })
              }
            />
            {tr(
              'Quiet hours for desktop notifications',
              'ช่วงเวลางดการแจ้งเตือนบนเดสก์ท็อป',
            )}
          </Label>
          {draft.quietHours && (
            <div className="flex flex-wrap items-center gap-2 pl-6 text-sm">
              <Input
                type="time"
                aria-label={tr('Quiet hours start', 'เวลาเริ่มงดแจ้งเตือน')}
                className="w-36"
                value={draft.quietHours.start}
                onChange={(e) =>
                  set({
                    quietHours: { ...draft.quietHours!, start: e.target.value },
                  })
                }
              />
              <span>{tr('to', 'ถึง')}</span>
              <Input
                type="time"
                aria-label={tr('Quiet hours end', 'เวลาสิ้นสุดการงดแจ้งเตือน')}
                className="w-36"
                value={draft.quietHours.end}
                onChange={(e) =>
                  set({
                    quietHours: { ...draft.quietHours!, end: e.target.value },
                  })
                }
              />
              <p className="text-muted-foreground w-full text-xs">
                {tr(
                  'Runner status and errors remain visible in the app.',
                  'สถานะ Runner และข้อผิดพลาดยังแสดงในแอป',
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('Runner environment', 'สภาพแวดล้อม Runner')}</CardTitle>
          <CardDescription>
            {tr(
              "Written to each runner's .env. Restart runners to apply.",
              'เขียนลงไฟล์ .env ของ Runner แต่ละตัว และต้องเริ่ม Runner ใหม่จึงจะมีผล',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label className="items-start font-normal">
            <Switch
              checked={draft.invariantCulture}
              onCheckedChange={(invariantCulture) => set({ invariantCulture })}
            />
            <span>
              {tr(
                'Use invariant culture (DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1)',
                'ใช้ invariant culture (DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1)',
              )}
              <span className="text-muted-foreground block pt-1 text-xs">
                {tr(
                  'Fixes jobs failing instantly with "ArgumentOutOfRangeException … SecretMasker" on some system languages such as Thai. Jobs inherit this variable too.',
                  'แก้กรณี job ล้มเหลวทันทีด้วย "ArgumentOutOfRangeException … SecretMasker" ในบางภาษาของระบบ เช่น ภาษาไทย โดย job จะได้รับตัวแปรนี้ด้วย',
                )}
              </span>
            </span>
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {tr('Backup and restore metadata', 'สำรองและกู้คืนข้อมูลกำกับ')}
          </CardTitle>
          <CardDescription>
            {tr(
              'Exports settings, presets, connection names and runner metadata. Tokens, passwords and runner files are excluded. Copy runner folders separately before restoring on another machine.',
              'ส่งออกการตั้งค่า presets ชื่อการเชื่อมต่อ และข้อมูล Runner โดยไม่รวม token รหัสผ่าน หรือไฟล์ Runner โปรดคัดลอกโฟลเดอร์ Runner แยกต่างหากก่อนกู้คืนบนเครื่องอื่น',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportBackup}>
              {tr('Export metadata', 'ส่งออกข้อมูล')}
            </Button>
            <Button
              variant="outline"
              onClick={async () =>
                setRestorePreview((await call('backup:preview')) ?? null)
              }
            >
              {tr('Preview restore…', 'ดูตัวอย่างการกู้คืน…')}
            </Button>
          </div>
          {restorePreview && (
            <div className="space-y-3 rounded-md border p-3 text-sm">
              <p className="font-mono text-xs break-all">
                {restorePreview.file}
              </p>
              <p>
                {tr('Settings', 'การตั้งค่า')}{' '}
                {restorePreview.settingsChanged
                  ? tr('will change', 'จะเปลี่ยน')
                  : tr('are unchanged', 'ไม่เปลี่ยน')}{' '}
                · {restorePreview.newConnections}{' '}
                {tr('new connections', 'การเชื่อมต่อใหม่')} ·{' '}
                {restorePreview.newPresets} {tr('new presets', 'presets ใหม่')} ·{' '}
                {restorePreview.newRunners} {tr('new runners', 'runners ใหม่')} ·{' '}
                {restorePreview.newWatchedTargets}{' '}
                {tr('watched targets', 'targets ที่ติดตาม')}
              </p>
              {restorePreview.warnings.map((w) => (
                <p key={w} className="text-attention">
                  {w}
                </p>
              ))}
              {restorePreview.conflicts.length > 0 && (
                <div>
                  <p className="font-medium">
                    {tr(
                      'Skipped conflicts and invalid paths',
                      'รายการที่ข้ามเพราะข้อมูลซ้ำหรือ path ไม่ถูกต้อง',
                    )}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {restorePreview.conflicts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={restoreBackup} disabled={restoring}>
                  {tr('Restore eligible metadata', 'กู้คืนข้อมูลที่ใช้ได้')}
                </Button>
                <Button variant="ghost" onClick={() => setRestorePreview(null)}>
                  {tr('Cancel', 'ยกเลิก')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={!dirty}>
          {tr('Save', 'บันทึก')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDraft(saved)}
          disabled={!dirty}
        >
          {tr('Discard', 'ยกเลิกการแก้ไข')}
        </Button>
      </div>

      {info && (
        <p className="text-muted-foreground font-mono text-xs select-text">
          v{info.version} · {info.platform}-{info.arch} · {info.hostname}
          <br />
          {info.dbPath}
        </p>
      )}
    </div>
  );
}
