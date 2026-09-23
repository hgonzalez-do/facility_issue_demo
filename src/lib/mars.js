import crypto from 'node:crypto';
import { config } from './../config.js';

const DO_API = 'https://api.digitalocean.com';

/**
 * Signs a payload the way DigitalOcean's `custom` webhook provider expects.
 *
 * Scheme `do-signature-v1`:
 *   HMAC-SHA256(secret, "<unix_seconds>" + "." + <raw body bytes>)  -> hex
 *   header value: "t=<unix_seconds>,v1=<hex>"
 *
 * The receiver applies a 300-second tolerance on the timestamp, so a badly
 * skewed clock on the sender looks exactly like a bad secret. Worth knowing at
 * 9am on a conference stage.
 */
export function signPayload(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac('sha256', secret);
  mac.update(Buffer.from(String(timestamp)));
  mac.update(Buffer.from('.'));
  mac.update(Buffer.from(rawBody));
  return `t=${timestamp},v1=${mac.digest('hex')}`;
}

/** Constant-time comparison of two signature header values. */
export function verifySignature(rawBody, secret, header, toleranceSeconds = 300) {
  if (!header) return false;

  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2),
  );

  const ts = Number.parseInt(parts.t ?? '', 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  const expected = signPayload(rawBody, secret, ts);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Fires one complaint at the Harness Runtime webhook trigger.
 *
 * Each delivery starts a fresh session in its own microVM. We do not wait for
 * the ticket — the agent writes it straight to Postgres, and the dashboard's
 * watcher notices the new row. That decoupling is the whole point: 200 people
 * can submit at once and this process stays a web server.
 */
export async function fireWebhook({ complaintId, body, table }) {
  const { webhookUrl, webhookSecret, ticketTable } = config.ingest;
  if (!webhookUrl) throw new Error('MARS_WEBHOOK_URL is not set');

  const payload = JSON.stringify({
    complaint_id: complaintId,
    complaint: body,
    table: table || ticketTable,
    submitted_at: new Date().toISOString(),
  });

  const headers = { 'content-type': 'application/json' };
  if (webhookSecret) {
    const sig = signPayload(payload, webhookSecret);
    // doctl advertises X-DigitalOcean-Signature; the DO webhook SDK reads
    // do-signature. Send both — they carry the same value.
    headers['X-DigitalOcean-Signature'] = sig;
    headers['do-signature'] = sig;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`webhook trigger returned ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json().catch(() => ({}));
}

/**
 * Live session census for the dashboard — the "scale story without saying the
 * word scale". Counts sessions by status across the team.
 */
export async function sessionCensus() {
  if (!config.digitalocean.token) return null;

  const res = await fetch(`${DO_API}/v2/agents/sessions`, {
    headers: {
      authorization: `Bearer ${config.digitalocean.token}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`sessions API returned ${res.status}`);

  const { sessions = [] } = await res.json();

  const tally = { total: sessions.length, running: 0, paused: 0, other: 0 };
  for (const s of sessions) {
    const status = String(s.status || '').replace('SESSION_STATUS_', '').toLowerCase();
    if (['running', 'ready', 'starting', 'creating', 'active'].includes(status)) tally.running += 1;
    else if (status === 'paused') tally.paused += 1;
    else tally.other += 1;
  }

  return tally;
}
