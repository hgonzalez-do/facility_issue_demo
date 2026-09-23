import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { createSqlite } from './sqlite.js';
import { createPostgres } from './postgres.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(here, '..', '..', 'db');

let driver = null;

export function db() {
  if (!driver) throw new Error('database not initialised — call initDb() first');
  return driver;
}

export async function initDb({ applySchema = true } = {}) {
  if (driver) return driver;

  driver =
    config.db.driver === 'postgres'
      ? createPostgres({ url: config.db.url })
      : createSqlite({ file: config.db.sqlitePath });

  if (applySchema) {
    const file = config.db.driver === 'postgres' ? 'schema.postgres.sql' : 'schema.sqlite.sql';
    await driver.exec(await fs.readFile(path.join(schemaDir, file), 'utf8'));
  }

  return driver;
}

export async function closeDb() {
  if (driver) await driver.close();
  driver = null;
}

/* ── row normalisation ──────────────────────────────────────────────────────
   SQLite hands back ISO strings, Postgres hands back Date objects. Everything
   above this file expects ISO strings, so flatten here rather than in views. */

function iso(v) {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapComplaint(r) {
  if (!r) return null;
  return { ...r, id: Number(r.id), submitted_at: iso(r.submitted_at) };
}

function mapTicket(r) {
  if (!r) return null;
  return {
    ...r,
    id: Number(r.id),
    complaint_id: r.complaint_id == null ? null : Number(r.complaint_id),
    affected_users: Number(r.affected_users),
    sla_hours: Number(r.sla_hours),
    created_at: iso(r.created_at),
  };
}

function mapSummary(r) {
  if (!r) return null;
  let top = [];
  try {
    top = JSON.parse(r.top_components);
  } catch {
    top = [];
  }
  return { ...r, id: Number(r.id), generated_at: iso(r.generated_at), top_components: top };
}

/* ── complaints ─────────────────────────────────────────────────────────── */

export async function insertComplaint({ body, source = 'web' }) {
  const row = await db().get(
    'INSERT INTO complaints (body, source) VALUES (?, ?) RETURNING *',
    [body, source],
  );
  return mapComplaint(row);
}

export async function getComplaint(id) {
  return mapComplaint(await db().get('SELECT * FROM complaints WHERE id = ?', [id]));
}

export async function markComplaint(id, { status, error = null, sessionId = null }) {
  await db().run(
    `UPDATE complaints
        SET status = ?,
            error = ?,
            session_id = COALESCE(?, session_id)
      WHERE id = ?`,
    [status, error, sessionId, id],
  );
}

export async function listComplaints({ status = null, limit = 100 } = {}) {
  const rows = status
    ? await db().all(
        'SELECT * FROM complaints WHERE status = ? ORDER BY id DESC LIMIT ?',
        [status, limit],
      )
    : await db().all('SELECT * FROM complaints ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map(mapComplaint);
}

/* ── tickets ────────────────────────────────────────────────────────────── */

export async function insertTicket(t) {
  const row = await db().get(
    `INSERT INTO tickets
       (complaint_id, title, component, severity, affected_users,
        suggested_owner, sla_hours, root_cause_hypothesis, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      t.complaint_id ?? null,
      t.title,
      t.component,
      t.severity,
      t.affected_users,
      t.suggested_owner,
      t.sla_hours,
      t.root_cause_hypothesis,
      t.session_id ?? null,
    ],
  );
  return mapTicket(row);
}

/**
 * Tickets newer than `afterId`, oldest first. This is how the dashboard picks
 * up rows regardless of who wrote them — this process in local mode, or a MARS
 * agent writing straight to Postgres through Action Gateway in mars mode.
 */
export async function ticketsAfter(afterId, limit = 100) {
  const rows = await db().all(
    `SELECT t.*, c.body AS complaint_body
       FROM tickets t
       LEFT JOIN complaints c ON c.id = t.complaint_id
      WHERE t.id > ?
      ORDER BY t.id ASC
      LIMIT ?`,
    [afterId, limit],
  );
  return rows.map(mapTicket);
}

export async function listTickets({ q = '', component = '', severity = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];

  if (q) {
    where.push('(LOWER(t.title) LIKE LOWER(?) OR LOWER(t.root_cause_hypothesis) LIKE LOWER(?) OR LOWER(c.body) LIKE LOWER(?))');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (component) {
    where.push('t.component = ?');
    params.push(component);
  }
  if (severity) {
    where.push('t.severity = ?');
    params.push(severity);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await db().all(
    `SELECT t.*, c.body AS complaint_body
       FROM tickets t
       LEFT JOIN complaints c ON c.id = t.complaint_id
       ${clause}
      ORDER BY t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const { n } = await db().get(
    `SELECT COUNT(*) AS n
       FROM tickets t
       LEFT JOIN complaints c ON c.id = t.complaint_id
       ${clause}`,
    params,
  );

  return { tickets: rows.map(mapTicket), total: Number(n) };
}

export async function maxTicketId() {
  const row = await db().get('SELECT COALESCE(MAX(id), 0) AS n FROM tickets');
  return Number(row.n);
}

/* ── stats ──────────────────────────────────────────────────────────────── */

export async function stats() {
  const [totals, byComponent, bySeverity, owners] = await Promise.all([
    db().get(
      `SELECT
         (SELECT COUNT(*) FROM complaints)                          AS complaints,
         (SELECT COUNT(*) FROM tickets)                             AS tickets,
         (SELECT COUNT(*) FROM complaints WHERE status = 'pending')    AS pending,
         (SELECT COUNT(*) FROM complaints WHERE status = 'processing') AS processing,
         (SELECT COUNT(*) FROM complaints WHERE status = 'failed')     AS failed`,
    ),
    db().all(
      'SELECT component, COUNT(*) AS count FROM tickets GROUP BY component ORDER BY count DESC, component ASC',
    ),
    db().all(
      'SELECT severity, COUNT(*) AS count FROM tickets GROUP BY severity ORDER BY severity ASC',
    ),
    db().all(
      'SELECT suggested_owner, COUNT(*) AS count FROM tickets GROUP BY suggested_owner ORDER BY count DESC, suggested_owner ASC LIMIT 10',
    ),
  ]);

  const num = (o, k) => Number(o?.[k] ?? 0);

  return {
    complaints: num(totals, 'complaints'),
    tickets: num(totals, 'tickets'),
    pending: num(totals, 'pending'),
    processing: num(totals, 'processing'),
    failed: num(totals, 'failed'),
    byComponent: byComponent.map((r) => ({ component: r.component, count: Number(r.count) })),
    bySeverity: bySeverity.map((r) => ({ severity: r.severity, count: Number(r.count) })),
    byOwner: owners.map((r) => ({ owner: r.suggested_owner, count: Number(r.count) })),
  };
}

/* ── executive summaries ────────────────────────────────────────────────── */

export async function insertSummary({ totalTickets, topComponents, headcountAsk, narrative }) {
  const row = await db().get(
    `INSERT INTO summaries (total_tickets, top_components, headcount_ask, narrative)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
    [totalTickets, JSON.stringify(topComponents), headcountAsk, narrative],
  );
  return mapSummary(row);
}

export async function latestSummary() {
  return mapSummary(await db().get('SELECT * FROM summaries ORDER BY id DESC LIMIT 1'));
}

export async function listSummaries(limit = 10) {
  const rows = await db().all('SELECT * FROM summaries ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map(mapSummary);
}
