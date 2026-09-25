import { Link, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function Thanks() {
  const [params] = useSearchParams();
  const id = Number.parseInt(params.get('id') ?? '', 10);

  return (
    <main className="grid min-h-dvh place-items-center p-5">
      <Card className="w-full max-w-xl px-8 py-11 text-center shadow-lg">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
          <Check className="size-6" strokeWidth={2.5} />
        </div>
        <h1 className="mt-4 text-[23px] font-semibold tracking-tight">
          Your grievance has been received.
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-[42ch] text-[15px]">
          It is being triaged against the standard schema and will be assigned a component, a
          severity, an owner and a service-level objective.
        </p>
        <p className="text-muted-foreground/80 mt-2 text-[13.5px]">
          You will not be contacted. There is no status page.
        </p>

        {Number.isFinite(id) && (
          <p className="border-border text-muted-foreground mt-5 border-t pt-5 font-mono text-[13px]">
            Reference CD-{String(id).padStart(6, '0')}
          </p>
        )}

        <div className="mt-6">
          <Button asChild variant="outline">
            <Link to="/">File another</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
