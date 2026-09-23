import express from 'express';
import { config } from '../config.js';
import {
  listTickets,
  listComplaints,
  stats,
  latestSummary,
  listSummaries,
} from '../db/index.js';
import { COMPONENTS, SEVERITIES } from '../lib/ticket-schema.js';
import { generateSummary } from '../lib/summarize.js';
import { sessionCensus } from '../lib/mars.js';
import {
  checkPassword,
  clearSessionCookie,
  requireAdmin,
  setSessionCookie,
  verifyToken,
} from '../lib/auth.js';

export const adminRouter = express.Router();

/**
 * Short cluster name for the dashboard's pipeline tile. DigitalOcean appends
 * `-do-user-<account>-<n>` to every hostname, which is noise on a projector.
 */
function dbHostLabel() {
  try {
    return new URL(config.db.url).host.split('.')[0].replace(/-do-user-\d+-\d+$/, '');
  } catch {
    return 'postgres';
  }
}

/* ── login ──────────────────────────────────────────────────────────────── */

adminRouter.get('/login', (req, res) => {
  if (verifyToken(req.cookies?.[config.admin.cookieName])) return res.redirect('/admin');
  res.render('login', { error: null, next: String(req.query.next ?? '/admin') });
});

adminRouter.post('/login', (req, res) => {
  const next = String(req.body?.next ?? '/admin');
  // Only ever redirect within this app.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/admin';

  if (!checkPassword(req.body?.password)) {
    return res.status(401).render('login', { error: 'Incorrect password.', next: safeNext });
  }

  setSessionCookie(res);
  res.redirect(safeNext);
});

adminRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/admin/login');
});

/* ── everything below requires a session ────────────────────────────────── */

adminRouter.use(requireAdmin);

adminRouter.get('/', async (req, res, next) => {
  try {
    const [s, recent, summary] = await Promise.all([
      stats(),
      listTickets({ limit: 12 }),
      latestSummary(),
    ]);

    let sessions = null;
    try {
      sessions = await sessionCensus();
    } catch {
      sessions = null; // A dashboard that 500s because the census failed is worse.
    }

    res.render('dashboard', {
      stats: s,
      recent: recent.tickets,
      summary,
      sessions,
      mode: config.ingest.mode,
      dbHost: dbHostLabel(),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/tickets', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const perPage = 25;

    const filters = {
      q: String(req.query.q ?? '').trim(),
      component: String(req.query.component ?? ''),
      severity: String(req.query.severity ?? ''),
      limit: perPage,
      offset: (page - 1) * perPage,
    };

    const { tickets, total } = await listTickets(filters);

    res.render('tickets', {
      tickets,
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
      filters,
      components: COMPONENTS,
      severities: SEVERITIES,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/complaints', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? '');
    const complaints = await listComplaints({ status: status || null, limit: 200 });
    res.render('complaints', { complaints, status });
  } catch (err) {
    next(err);
  }
});

/** The projector view: a live wall of cards, nothing else. */
adminRouter.get('/wall', async (req, res, next) => {
  try {
    const [s, recent] = await Promise.all([stats(), listTickets({ limit: 12 })]);
    res.render('wall', { stats: s, recent: recent.tickets, mode: config.ingest.mode });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/summary', async (req, res, next) => {
  try {
    res.render('summary', { summaries: await listSummaries(10) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/summary/run', async (req, res) => {
  try {
    const summary = await generateSummary();
    if (req.get('accept')?.includes('application/json')) return res.json(summary);
    res.redirect('/admin/summary');
  } catch (err) {
    console.error('[admin] summary failed:', err.message);
    if (req.get('accept')?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.status(500).render('error', {
      message: `Could not generate the summary: ${err.message}`,
    });
  }
});
