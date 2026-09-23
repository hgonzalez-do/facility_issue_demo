import express from 'express';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { submitComplaint } from '../lib/ingest.js';

export const publicRouter = express.Router();

const MAX_LENGTH = 280;

/** Crude in-memory throttle. Resets on restart, which is fine for one talk. */
const hits = new Map();

function rateLimited(ip) {
  if (!config.rateLimit.enabled) return false;

  const now = Date.now();
  const { windowMs, max } = config.rateLimit;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);

  // Opportunistic cleanup so the map does not grow for the whole event.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
  }

  return recent.length > max;
}

publicRouter.get('/', (req, res) => {
  res.render('form', { error: null, body: '' });
});

publicRouter.post('/complain', async (req, res) => {
  const body = String(req.body?.body ?? '').trim();

  if (!body) {
    return res.status(400).render('form', {
      error: 'The form requires a complaint. That is the whole form.',
      body: '',
    });
  }

  if (body.length > MAX_LENGTH) {
    return res.status(400).render('form', {
      error: `One sentence, please. That was ${body.length} characters; the limit is ${MAX_LENGTH}.`,
      body: body.slice(0, MAX_LENGTH),
    });
  }

  if (rateLimited(req.ip)) {
    return res.status(429).render('form', {
      error: 'Your grievances are being processed. Please allow the queue to drain.',
      body: '',
    });
  }

  try {
    const complaint = await submitComplaint({ body, source: 'web' });
    return res.redirect(`/thanks?id=${complaint.id}`);
  } catch (err) {
    console.error('[public] submit failed:', err.message);
    return res.status(500).render('form', {
      error: 'Intake is temporarily unavailable. Your dissatisfaction has been noted informally.',
      body,
    });
  }
});

publicRouter.get('/thanks', (req, res) => {
  const id = Number.parseInt(String(req.query.id ?? ''), 10);
  res.render('thanks', { id: Number.isFinite(id) ? id : null });
});

/** QR code pointing at the public form — project this on the screen. */
publicRouter.get('/qr.svg', async (req, res) => {
  const target = String(req.query.url || `${req.protocol}://${req.get('host')}/`);
  try {
    const svg = await QRCode.toString(target, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0b1220', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('cache-control', 'public, max-age=300').send(svg);
  } catch (err) {
    res.status(500).type('text/plain').send(`could not render QR: ${err.message}`);
  }
});

/** Full-screen QR for the projector. */
publicRouter.get('/qr', (req, res) => {
  const target = `${req.protocol}://${req.get('host')}/`;
  res.render('qr', { target });
});

publicRouter.get('/healthz', (req, res) => {
  res.json({ ok: true, mode: config.ingest.mode });
});
