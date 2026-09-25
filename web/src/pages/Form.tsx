import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX = 280;

export default function Form() {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const over = body.length > MAX;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || over || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.complain(body.trim());
      navigate(`/thanks?id=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Intake is unavailable.');
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-5">
      <Card className="w-full max-w-xl gap-0 overflow-hidden p-0 shadow-lg">
        <header className="border-border border-b px-8 pt-7 pb-5">
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
            Form CD-1 · Grievance Intake
          </p>
          <h1 className="mt-2.5 text-[27px] font-semibold tracking-tight">
            The Complaints Department
          </h1>
          <p className="text-muted-foreground mt-1 text-[15px]">
            Complain about anything. One sentence.
          </p>
        </header>

        <form onSubmit={submit} className="px-8 py-6">
          {error && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-md border px-3.5 py-2.5 text-sm"
            >
              {error}
            </div>
          )}

          <Label
            htmlFor="body"
            className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.06em] uppercase"
          >
            Nature of grievance
          </Label>
          <textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX + 40}
            required
            autoFocus
            rows={4}
            placeholder="The coffee here is cold."
            className={cn(
              'border-input bg-background placeholder:text-muted-foreground/60 w-full resize-y rounded-md border px-3.5 py-3 text-base leading-relaxed',
              'focus-visible:border-ring focus-visible:ring-ring/40 outline-none focus-visible:ring-[3px]',
            )}
          />

          <div className="text-muted-foreground mt-2 flex justify-between gap-3 text-xs">
            <span>All submissions are triaged and assigned an owner.</span>
            <span className={cn('tabular', over && 'text-destructive font-semibold')}>
              {body.length} / {MAX}
            </span>
          </div>

          <div className="mt-5 flex items-center gap-3.5">
            <Button type="submit" disabled={busy || over || !body.trim()}>
              {busy ? 'Filing…' : 'Submit grievance'}
            </Button>
            <span className="text-muted-foreground text-[13px]">
              No login. No follow-up. No appeal.
            </span>
          </div>
        </form>

        <p className="text-muted-foreground/80 border-border border-t px-8 py-5 text-[11.5px] leading-relaxed">
          By submitting this form you consent to your grievance being classified against a fixed
          schema, assigned a severity and a service-level objective, and routed to a team that did
          not ask for it. Response times are indicative and non-binding. This department does not
          acknowledge receipt, provide status updates, or entertain escalation.
        </p>
      </Card>
    </main>
  );
}
