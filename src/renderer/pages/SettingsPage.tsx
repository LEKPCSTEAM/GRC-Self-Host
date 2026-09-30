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
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <Label>
            <input
              type="checkbox"
              checked={draft.notifications}
              onChange={(e) => set({ notifications: e.target.checked })}
              className="size-4"
            />
            Notify when a runner goes offline or crashes
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
