import { useState } from 'react';
import { Layers, Pencil, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Preset } from '../../shared/types';
import { call } from '@/lib/api';
import { splitList, targetLabel } from '@/lib/format';
import { useConnections, usePresets } from '@/lib/hooks';
import { useConfirm } from '@/components/confirm';
import { tr } from '@/lib/i18n';
import type { Form } from '@/components/CreateDialog';
import { Badge } from '@/components/ui/badge';
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
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function PresetsPage({ onUse }: { onUse: (form: Form) => void }) {
  const [presets, reload] = usePresets();
  const [connections] = useConnections();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Preset | null>(null);
  const [original, setOriginal] = useState<Preset | null>(null);
  const [editLabels, setEditLabels] = useState('');
  const connName = new Map(connections.map((c) => [c.id, c.name]));

  const remove = async (p: Preset) => {
    if (
      !(await confirm({
        title: tr(`Delete preset "${p.name}"?`, `ลบ preset "${p.name}" หรือไม่?`),
        confirmLabel: tr('Delete', 'ลบ'),
        destructive: true,
      }))
    )
      return;
    await call('presets:remove', p.id);
    reload();
  };

  const closeEdit = async () => {
    if (
      editing &&
      original &&
      (JSON.stringify(editing) !== JSON.stringify(original) ||
        editLabels !== original.labels.join(', '))
    ) {
      if (
        !(await confirm({
          title: tr(
            'Discard unsaved preset changes?',
            'ยกเลิกการแก้ไข preset ที่ยังไม่บันทึกหรือไม่?',
          ),
          confirmLabel: tr('Discard', 'ยกเลิกการแก้ไข'),
          destructive: true,
        }))
      )
        return;
    }
    setEditing(null);
    setOriginal(null);
  };

  const saveEdit = async () => {
    if (
      !editing ||
      !editing.name.trim() ||
      !editing.prefix.trim() ||
      editing.count < 1 ||
      editing.count > 50
    )
      return;
    const saved = await call('presets:save', {
      ...editing,
      labels: splitList(editLabels),
    });
    if (!saved) return;
    toast.success(
      tr(`Saved preset "${saved.name}"`, `บันทึก preset "${saved.name}" แล้ว`),
    );
    setEditing(null);
    setOriginal(null);
    reload();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {presets.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {tr(
            'No presets. Fill in the Create runners dialog and use Save preset to reuse a configuration.',
            'ยังไม่มี preset กรุณากรอกแบบฟอร์มสร้าง Runner แล้วเลือกบันทึก preset เพื่อใช้การตั้งค่าซ้ำ',
          )}
        </p>
      )}
      {presets.map((p) => {
        const { id: _id, name: _name, ...form } = p;
        return (
          <Card key={p.id} className="py-4">
            <CardHeader className="flex flex-row items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <Layers className="text-muted-foreground size-5" />
                <div>
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span>{targetLabel(p.target)}</span>·
                    <span>
                      {connName.get(p.connectionId) ??
                        tr('missing connection', 'ไม่มีการเชื่อมต่อ')}
                    </span>
                    ·
                    <span>
                      {p.count} × {p.prefix}-nn
                    </span>
                    <Badge variant="secondary">
                      {p.mode === 'child' ? 'App' : 'Service'}
                    </Badge>
                    {p.labels.map((l) => (
                      <span
                        key={l}
                        className="bg-secondary rounded px-1.5 font-mono text-[11px]"
                      >
                        {l}
                      </span>
                    ))}
                  </CardDescription>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onUse(form)}>
                  <Play /> {tr('Use', 'ใช้')}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={tr(`Edit ${p.name}`, `แก้ไข ${p.name}`)}
                  onClick={() => {
                    setEditing(structuredClone(p));
                    setOriginal(structuredClone(p));
                    setEditLabels(p.labels.join(', '));
                  }}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove(p)}
                  aria-label={tr('Delete', 'ลบ')}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
          </Card>
        );
      })}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) void closeEdit();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tr('Edit preset', 'แก้ไข preset')}</DialogTitle>
            <DialogDescription>
              {tr(
                'Changes to this preset do not change existing runners.',
                'การแก้ไข preset นี้ไม่เปลี่ยน Runner ที่มีอยู่',
              )}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label>{tr('Name', 'ชื่อ')}</Label>
                <Input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>{tr('Connection', 'การเชื่อมต่อ')}</Label>
                <Select
                  value={editing.connectionId}
                  onValueChange={(connectionId) =>
                    setEditing({ ...editing, connectionId })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{tr('Target type', 'ประเภท Target')}</Label>
                <Select
                  value={editing.target.kind}
                  onValueChange={(kind) =>
                    setEditing({
                      ...editing,
                      target:
                        kind === 'org'
                          ? { kind: 'org', owner: editing.target.owner }
                          : {
                              kind: 'repo',
                              owner: editing.target.owner,
                              repo: '',
                            },
                      runnerGroup: undefined,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="repo">
                      {tr('Repository', 'ที่เก็บโค้ด')}
                    </SelectItem>
                    <SelectItem value="org">
                      {tr('Organization', 'องค์กร')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{tr('Owner or organization', 'เจ้าของหรือองค์กร')}</Label>
                <Input
                  value={editing.target.owner}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      target: { ...editing.target, owner: e.target.value },
                    })
                  }
                />
              </div>
              {editing.target.kind === 'repo' && (
                <div className="space-y-1">
                  <Label>{tr('Repository', 'ที่เก็บโค้ด')}</Label>
                  <Input
                    value={editing.target.repo}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        target: {
                          kind: 'repo',
                          owner: editing.target.owner,
                          repo: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              )}
              {editing.target.kind === 'org' && (
                <div className="space-y-1">
                  <Label>{tr('Runner group', 'กลุ่ม Runner')}</Label>
                  <Input
                    value={editing.runnerGroup ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        runnerGroup: e.target.value || undefined,
                      })
                    }
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label>{tr('Count', 'จำนวน')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={editing.count}
                  onChange={(e) =>
                    setEditing({ ...editing, count: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>{tr('Name prefix', 'คำนำหน้าชื่อ')}</Label>
                <Input
                  value={editing.prefix}
                  onChange={(e) =>
                    setEditing({ ...editing, prefix: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>
                  {tr('Labels (comma separated)', 'Labels (คั่นด้วยจุลภาค)')}
                </Label>
                <Input
                  value={editLabels}
                  onChange={(e) => setEditLabels(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{tr('Mode', 'โหมด')}</Label>
                <Select
                  value={editing.mode}
                  onValueChange={(mode) =>
                    setEditing({ ...editing, mode: mode as Preset['mode'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="child">
                      {tr('App process', 'โปรเซสของแอป')}
                    </SelectItem>
                    <SelectItem value="service">
                      {tr('OS service', 'บริการของระบบ')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing.mode === 'service' && (
                <div className="space-y-1">
                  <Label>{tr('Service account', 'บัญชีบริการ')}</Label>
                  <Input
                    value={editing.serviceAccount ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        serviceAccount: e.target.value || undefined,
                      })
                    }
                  />
                </div>
              )}
              {editing.mode === 'child' && (
                <Label className="col-span-2 font-normal">
                  <Checkbox
                    checked={editing.autostart}
                    onCheckedChange={(v) =>
                      setEditing({ ...editing, autostart: v === true })
                    }
                  />
                  {tr('Start with app', 'เริ่มพร้อมแอป')}
                </Label>
              )}
              <Label className="col-span-2 font-normal">
                <Checkbox
                  checked={editing.cleanup.enabled}
                  onCheckedChange={(v) =>
                    setEditing({
                      ...editing,
                      cleanup: { ...editing.cleanup, enabled: v === true },
                    })
                  }
                />
                {tr('Clean workspace after jobs', 'ล้างพื้นที่ทำงานหลัง job')}
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={editing.cleanup.actions}
                  disabled={!editing.cleanup.enabled}
                  onCheckedChange={(v) =>
                    setEditing({
                      ...editing,
                      cleanup: { ...editing.cleanup, actions: v === true },
                    })
                  }
                />
                {tr('Also clear actions', 'ล้าง actions ด้วย')}
              </Label>
              <Label className="font-normal">
                <Checkbox
                  checked={editing.cleanup.tool}
                  disabled={!editing.cleanup.enabled}
                  onCheckedChange={(v) =>
                    setEditing({
                      ...editing,
                      cleanup: { ...editing.cleanup, tool: v === true },
                    })
                  }
                />
                {tr('Also clear tools', 'ล้าง tools ด้วย')}
              </Label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void closeEdit()}>
              {tr('Cancel', 'ยกเลิก')}
            </Button>
            <Button
              onClick={saveEdit}
              disabled={
                !editing?.name.trim() ||
                !editing.prefix.trim() ||
                !editing.target.owner.trim() ||
                (editing.target.kind === 'repo' &&
                  !editing.target.repo.trim()) ||
                editing.count < 1 ||
                editing.count > 50
              }
            >
              {tr('Save changes', 'บันทึกการแก้ไข')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
