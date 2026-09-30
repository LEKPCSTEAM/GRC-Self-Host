import { Layers, Play, Trash2 } from 'lucide-react';
import type { Preset } from '../../shared/types';
import { call } from '@/lib/api';
import { targetLabel } from '@/lib/format';
import { useConnections, usePresets } from '@/lib/hooks';
import { useConfirm } from '@/components/confirm';
import type { Form } from '@/components/CreateDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  const connName = new Map(connections.map((c) => [c.id, c.name]));

  const remove = async (p: Preset) => {
    if (
      !(await confirm({
        title: `Delete preset "${p.name}"?`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    await call('presets:remove', p.id);
    reload();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {presets.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No presets. Fill in the Create runners dialog and use{' '}
          <b>Save preset</b> to reuse a configuration.
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
                      {connName.get(p.connectionId) ?? 'missing connection'}
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
                  <Play /> Use
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove(p)}
                  aria-label="Delete"
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}
