import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite driver — local development only.
 *
 * Presents the same {all, get, run, exec} surface as the Postgres driver so
 * everything above src/db/ is driver-agnostic. Both drivers speak `?`
 * placeholders; the Postgres driver rewrites them to $1..$n.
 */
export function createSqlite({ file }) {
  const dir = path.dirname(file);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // The demo fires a lot of concurrent writes; wait rather than throw SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000');

  return {
    kind: 'sqlite',

    async exec(sql) {
      db.exec(sql);
    },

    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },

    async get(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },

    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes, lastId: Number(info.lastInsertRowid) };
    },

    async close() {
      db.close();
    },
  };
}
