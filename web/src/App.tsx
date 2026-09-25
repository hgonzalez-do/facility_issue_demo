import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { AdminShell } from '@/components/AdminShell';
import { useLiveFeed } from '@/lib/useLiveFeed';
import { api } from '@/lib/api';

import Form from '@/pages/Form';
import Thanks from '@/pages/Thanks';
import Qr from '@/pages/Qr';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Tickets from '@/pages/Tickets';
import Intake from '@/pages/Intake';
import SummaryPage from '@/pages/SummaryPage';
import Wall from '@/pages/Wall';

/** Everything behind the password, sharing one SSE connection. */
function Admin() {
  const { tickets, stats, sessions, live, summaryTick } = useLiveFeed([], 24);
  const { pathname } = useLocation();

  // The wall is projected, so it gets the whole screen — no nav, no chrome.
  if (pathname === '/admin/wall') return <Wall />;

  return (
    <AdminShell live={live}>
      <Routes>
        <Route index element={
          <Dashboard stats={stats} sessions={sessions} tickets={tickets} summaryTick={summaryTick} />
        } />
        <Route path="tickets" element={<Tickets />} />
        <Route path="complaints" element={<Intake />} />
        <Route path="summary" element={<SummaryPage summaryTick={summaryTick} />} />
      </Routes>
    </AdminShell>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');

  useEffect(() => {
    api
      .me()
      .then((r) => setState(r.authenticated ? 'in' : 'out'))
      .catch(() => setState('out'));
  }, []);

  if (state === 'checking') return <div className="dark bg-background min-h-dvh" />;
  if (state === 'out') return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Form />} />
        <Route path="/thanks" element={<Thanks />} />
        <Route path="/qr" element={<Qr />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/*" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster theme="dark" position="bottom-right" />
    </BrowserRouter>
  );
}
