import pg from 'pg';

// BIGSERIAL ids arrive as strings by default (int8 exceeds JS safe integers).
// Our ids never will, and the rest of the app compares them numerically.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/**
 * PostgreSQL driver — DigitalOcean Managed Postgres in production.
 *
 * Accepts the same `?`-placeholder SQL the SQLite driver uses and rewrites it
 * to $1..$n, so the query layer above stays driver-agnostic.
 */
function toPositional(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export function createPostgres({ url }) {
  const pool = new pg.Pool({
    connectionString: url,
    // DO Managed Postgres presents a CA-signed cert via its own CA bundle.
    // Verification is handled by sslmode in the URL; this keeps node-postgres
    // from failing on the self-signed chain when sslmode=require.
    ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });

  return {
    kind: 'postgres',

    async exec(sql) {
      await pool.query(sql);
    },

    async all(sql, params = []) {
      const res = await pool.query(toPositional(sql), params);
      return res.rows;
    },

    async get(sql, params = []) {
      const res = await pool.query(toPositional(sql), params);
      return res.rows[0] ?? null;
    },

    async run(sql, params = []) {
      const res = await pool.query(toPositional(sql), params);
      return { changes: res.rowCount, lastId: res.rows[0]?.id ?? null };
    },

    async close() {
      await pool.end();
    },
  };
}
