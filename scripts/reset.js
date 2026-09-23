#!/usr/bin/env node
/** Wipes every row. Schema stays. Use between rehearsals. */
import { initDb, closeDb, db } from '../src/db/index.js';
import { config } from '../src/config.js';

const force = process.argv.includes('--yes') || process.argv.includes('-y');
if (!force) {
  console.error('This deletes every complaint, ticket and summary.');
  console.error(`Target: ${config.db.driver === 'postgres' ? 'Managed Postgres' : config.db.sqlitePath}`);
  console.error('\nRe-run with --yes to confirm.');
  process.exit(1);
}

await initDb();
await db().exec('DELETE FROM summaries');
await db().exec('DELETE FROM tickets');
await db().exec('DELETE FROM complaints');

if (config.db.driver === 'sqlite') {
  await db().exec("DELETE FROM sqlite_sequence WHERE name IN ('complaints','tickets','summaries')");
} else {
  await db().exec('ALTER SEQUENCE complaints_id_seq RESTART WITH 1');
  await db().exec('ALTER SEQUENCE tickets_id_seq RESTART WITH 1');
  await db().exec('ALTER SEQUENCE summaries_id_seq RESTART WITH 1');
}

console.log('Wiped.');
await closeDb();
