import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

/**
 * Wipes the demo between rehearsals.
 *
 * Gated behind typing the word, not a confirm dialog: this sits a click away
 * from the wall that is being projected, and the database half cannot be
 * undone.
 */
export function ResetButton({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await api.reset();
      toast.success(`Database wiped. Next ticket #${r.nextTicket}.`, {
        description:
          r.tracker === 'closing'
            ? 'An agent is closing the open issues in the tracker.'
            : `Tracker: ${r.tracker}`,
      });
      setOpen(false);
      setTyped('');
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Reset demo
      </Button>
    );
  }

  return (
    <Card className="border-destructive/40 gap-0 p-4">
      <p className="text-card-foreground text-sm font-medium">
        Delete every complaint, ticket and summary?
      </p>
      <p className="text-muted-foreground mt-1 text-[13px]">
        The tracker's open issues are closed, not deleted — an agent does that, so it takes a
        few seconds. Ticket numbering continues from the last issue so the two stay in step.
        To delete issues outright, run{' '}
        <code className="font-mono">./scripts/clear-issues.sh</code>.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="type reset to confirm"
          className="h-9 w-56"
          autoFocus
        />
        <Button
          variant="destructive"
          size="sm"
          disabled={typed !== 'reset' || busy}
          onClick={run}
        >
          {busy ? 'Resetting…' : 'Reset'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setOpen(false); setTyped(''); }}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </Card>
  );
}
