import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Section } from '@/components/AdminShell';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, type Complaint } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUSES = ['pending', 'processing', 'ticketed', 'failed'] as const;

const TONE: Record<string, string> = {
  ticketed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  failed: 'bg-destructive/15 text-destructive border-destructive/25',
  processing: 'bg-p3/15 text-p3 border-p3/25',
};

export default function Intake() {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => { api.complaints(status).then((d) => setRows(d.complaints)); }, [status]);

  return (
    <>
      <Section>Raw intake</Section>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 rounded-md border px-2.5 text-[13.5px] outline-none focus-visible:ring-[3px]"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={() => setStatus('')}>Reset</Button>
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">#</TableHead>
              <TableHead>Complaint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                  Nothing yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id} className="[&>td]:py-3 [&>td]:align-top">
                <TableCell className="text-muted-foreground font-mono">{c.id}</TableCell>
                <TableCell className="max-w-[460px] whitespace-normal">“{c.body}”</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('font-normal', TONE[c.status])}>
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-[11px]">
                  {c.session_id ? c.session_id.slice(0, 8) : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[260px] text-xs whitespace-normal">
                  {c.error ?? ''}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-[11.5px] whitespace-nowrap">
                  {new Date(c.submitted_at).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
