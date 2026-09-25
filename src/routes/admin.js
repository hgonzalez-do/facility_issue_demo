import express from 'express';
import { config } from '../config.js';
import {
  listTickets,
  listComplaints,
  stats,
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

/* ── session ────────────────────────────────────────────────────────────── */

adminRouter.get('/me', (req, res) => {
  res.json({ authenticated: verifyToken(req.cookies?.[config.admin.cookieName]) });
});

adminRouter.post('/login', (req, res) => {
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  setSessionCookie(res);
  res.json({ authenticated: true });
});

adminRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

/* ── everything below requires a session ────────────────────────────────── */

adminRouter.use(requireAdmin);

adminRouter.get('/stats', async (req, res, next) => {
  try {
    res.json(await stats());
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/sessions', async (req, res) => {
  try {
    res.json((await sessionCensus()) ?? { total: 0, running: 0, paused: 0, other: 0 });
  } catch {
    // A dashboard that 500s because the census failed is worse than one
    // showing a dash.
    res.json({ total: 0, running: 0, paused: 0, other: 0 });
  }
});

adminRouter.get('/tickets', async (req, res, next) => {
  try {
    const limit = Math.min(200, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50);
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
    res.json(
      await listTickets({
        q: String(req.query.q ?? '').trim(),
        component: String(req.query.component ?? ''),
        severity: String(req.query.severity ?? ''),
        limit,
        offset,
      }),
    );
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/complaints', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? '');
    res.json({ complaints: await listComplaints({ status: status || null, limit: 200 }) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/summaries', async (req, res, next) => {
  try {
    res.json({ summaries: await listSummaries(10) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/summaries/run', async (req, res) => {
  try {
    res.json(await generateSummary());
  } catch (err) {
    console.error('[admin] summary failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Vocabularies for the filter dropdowns. */
adminRouter.get('/vocab', (req, res) => {
  res.json({ components: COMPONENTS, severities: SEVERITIES });
});
