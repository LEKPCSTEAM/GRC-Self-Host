import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { Connection } from '../../shared/types';
import { call } from '@/lib/api';
import { useConnections } from '@/lib/hooks';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

function TokenHelp() {
  return (
    <div className="text-muted-foreground space-y-1 text-xs">
      <p>
        Use a fine-grained personal access token. One token covers one resource
        owner.
      </p>
      <ul className="list-disc pl-4">
        <li>
          Repository runners: repository permission{' '}
          <b>Administration: Read and write</b>
        </li>
        <li>
          Organization runners: organization permission{' '}
          <b>Self-hosted runners: Read and write</b>
        </li>
      </ul>
    </div>
  );
}

function ConnectionDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Connection | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setToken('');
    }
  }, [open, editing]);

  const save = async () => {
    setSaving(true);
    const res = editing
      ? await call('connections:update', editing.id, {
          name,
          token: token || undefined,
        })
      : await call('connections:add', name, token);
    setSaving(false);
    if (res) {
      toast.success(
        editing ? 'Connection updated' : `Connected as ${res.login}`,
      );
      onSaved();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Edit connection' : 'Add connection'}
          </DialogTitle>
          <DialogDescription>
            The token is validated against GitHub and stored encrypted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to the GitHub login"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-token">
              {editing
                ? 'New token (leave empty to keep)'
                : 'Personal access token'}
            </Label>
            <Input
              id="c-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              className="font-mono"
            />
          </div>
          <TokenHelp />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || (!editing && !token.trim())}
          >
            {saving ? 'Checking…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectionsPage() {
  const [connections, reload] = useConnections();
  const [warning, setWarning] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    editing: Connection | null;
  }>({ open: false, editing: null });
  const confirm = useConfirm();

  useEffect(() => {
    call('connections:storageWarning').then((w) => setWarning(w ?? null));
  }, []);

  const remove = async (c: Connection) => {
    if (
      !(await confirm({
        title: `Remove connection "${c.name}"?`,
        description: 'Presets using it are removed too.',
        confirmLabel: 'Remove',
        destructive: true,
      }))
    )
      return;
    await call('connections:remove', c.id);
    reload();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {warning && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="size-4 text-amber-500" /> {warning}
        </div>
      )}
      <div>
        <Button onClick={() => setDialog({ open: true, editing: null })}>
          <Plus /> Add connection
        </Button>
      </div>
      {connections.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No connections yet. Add a GitHub token to start creating runners.
        </p>
      )}
      {connections.map((c) => (
        <Card key={c.id} className="gap-2 py-4">
          <CardHeader className="flex flex-row items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <KeyRound className="text-muted-foreground size-5" />
              <div>
                <CardTitle>{c.name}</CardTitle>
                <CardDescription>
                  @{c.login} · added{' '}
                  {new Date(c.createdAt).toLocaleDateString()}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog({ open: true, editing: c })}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(c)}
                aria-label="Remove"
              >
                <Trash2 />
              </Button>
            </div>
          </CardHeader>
        </Card>
      ))}
      <ConnectionDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={reload}
      />
    </div>
  );
}
