import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { AppInfo, Settings } from '../../shared/types';
import { api } from '@/lib/api';
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
    const s = await api.invoke('settings:update', draft);
    setSaved(s);
    setDraft(s);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Runner storage</CardTitle>
          <CardDescription>
            New runners are created under this folder. Changing it does not move
            existing runners. Keep it short (near the drive root) to avoid long
            path issues on Windows.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rootDir">Root folder</Label>
            <div className="flex gap-2">
              <Input
                id="rootDir"
                value={draft.rootDir}
                onChange={(e) => set({ rootDir: e.target.value })}
                className="font-mono"
              />
              <Button variant="outline" onClick={browse}>
                <FolderOpen /> Browse
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="retention">Keep _diag logs for (days)</Label>
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
          <CardTitle>App</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Label className="font-normal">
            <Switch
              checked={draft.launchAtLogin}
              onCheckedChange={(launchAtLogin) => set({ launchAtLogin })}
            />
            Launch at login (starts hidden in the tray; installed app only)
          </Label>
          <Label className="font-normal">
            <Switch
              checked={draft.notifications}
              onCheckedChange={(notifications) => set({ notifications })}
            />
            Notify when a runner goes offline or crashes
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runner environment</CardTitle>
          <CardDescription>
            Written to each runner&apos;s .env. Restart runners to apply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label className="items-start font-normal">
            <Switch
              checked={draft.invariantCulture}
              onCheckedChange={(invariantCulture) => set({ invariantCulture })}
            />
            <span>
              Use invariant culture (DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1)
              <span className="text-muted-foreground block pt-1 text-xs">
                Fixes jobs failing instantly with
                &quot;ArgumentOutOfRangeException … SecretMasker&quot; on some
                system languages such as Thai. Jobs inherit this variable too.
              </span>
            </span>
          </Label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={!dirty}>
          Save
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDraft(saved)}
          disabled={!dirty}
        >
          Discard
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
