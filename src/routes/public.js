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

publicRouter.post('/api/complain', async (req, res) => {
  const body = String(req.body?.body ?? '').trim();

  if (!body) {
    return res.status(400).json({ error: 'The form requires a complaint. That is the whole form.' });
  }
  if (body.length > MAX_LENGTH) {
    return res.status(400).json({
      error: `One sentence, please. That was ${body.length} characters; the limit is ${MAX_LENGTH}.`,
    });
  }
  if (rateLimited(req.ip)) {
    return res.status(429).json({
      error: 'Your grievances are being processed. Please allow the queue to drain.',
    });
  }

  try {
    const complaint = await submitComplaint({ body, source: 'web' });
    return res.status(201).json({ id: complaint.id });
  } catch (err) {
    console.error('[public] submit failed:', err.message);
    return res.status(500).json({
      error: 'Intake is temporarily unavailable. Your dissatisfaction has been noted informally.',
    });
  }
});

/** QR code pointing at the public form — projected by the /qr page. */
publicRouter.get('/qr.svg', async (req, res) => {
  const target = String(req.query.url || `${req.protocol}://${req.get('host')}/`);
  try {
    const svg = await QRCode.toString(target, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('cache-control', 'public, max-age=300').send(svg);
  } catch (err) {
    res.status(500).type('text/plain').send(`could not render QR: ${err.message}`);
  }
});

publicRouter.get('/healthz', (req, res) => {
  res.json({ ok: true });
});
