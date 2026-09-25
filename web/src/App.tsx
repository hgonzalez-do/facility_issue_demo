import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from '@/lib/api';

// The public pages load eagerly: a phone in the room should download the
// form and nothing else.
import Form from '@/pages/Form';
import Thanks from '@/pages/Thanks';
import Qr from '@/pages/Qr';

// Everything behind the password is split out. The admin pulls in a table,
// a toaster and the live feed, none of which a person filing a complaint
// has any use for — and 200 of them are on the same venue wifi at once.
const Admin = lazy(() => import('@/pages/Admin'));
const Login = lazy(() => import('@/pages/Login'));

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

/** Blank rather than a spinner: the admin chunk lands in well under a second. */
const Blank = <div className="dark bg-background min-h-dvh" />;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Form />} />
        <Route path="/thanks" element={<Thanks />} />
        <Route path="/qr" element={<Qr />} />
        <Route
          path="/admin/login"
          element={<Suspense fallback={Blank}><Login /></Suspense>}
        />
        <Route
          path="/admin/*"
          element={
            <RequireAuth>
              <Suspense fallback={Blank}><Admin /></Suspense>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
