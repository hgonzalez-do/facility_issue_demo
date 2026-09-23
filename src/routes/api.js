import express from 'express';
import { config } from '../config.js';
import { stats, listTickets } from '../db/index.js';
import { bus, EVENTS } from '../lib/events.js';
import { requireAdmin } from '../lib/auth.js';

export const apiRouter = express.Router();

apiRouter.use(requireAdmin);

apiRouter.get('/stats', async (req, res, next) => {
  try {
    res.json(await stats());
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/tickets', async (req, res, next) => {
  try {
    const limit = Math.min(200, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50);
    res.json(await listTickets({ limit }));
  } catch (err) {
    next(err);
  }
});

/**
 * Server-sent events: new tickets, moving stats, and the MARS session census.
 *
 * Everything here originates from the watcher loops in ticket-watcher.js, so a
 * ticket written by an agent in another microVM reaches the projector the same
 * way one written in-process does.
 */
apiRouter.get('/stream', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // App Platform sits behind a buffering proxy; this asks it not to.
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('hello', { mode: config.ingest.mode });

  const onTicket = (t) => send(EVENTS.TICKET, t);
  const onStats = (s) => send(EVENTS.STATS, s);
  const onSessions = (s) => send(EVENTS.SESSIONS, s);
  const onSummary = (s) => send(EVENTS.SUMMARY, s);
  const onComplaint = (c) => send(EVENTS.COMPLAINT, c);

  bus.on(EVENTS.TICKET, onTicket);
  bus.on(EVENTS.STATS, onStats);
  bus.on(EVENTS.SESSIONS, onSessions);
  bus.on(EVENTS.SUMMARY, onSummary);
  bus.on(EVENTS.COMPLAINT, onComplaint);

  // Proxies drop idle connections; a comment frame every 20s keeps it warm.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    bus.off(EVENTS.TICKET, onTicket);
    bus.off(EVENTS.STATS, onStats);
    bus.off(EVENTS.SESSIONS, onSessions);
    bus.off(EVENTS.SUMMARY, onSummary);
    bus.off(EVENTS.COMPLAINT, onComplaint);
  });
});
