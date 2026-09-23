#!/usr/bin/env node
import { initDb, closeDb } from '../src/db/index.js';
import { config } from '../src/config.js';

await initDb();
console.log(`Schema applied (${config.db.driver}).`);
await closeDb();
