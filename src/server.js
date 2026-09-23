import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, validateConfig } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { startTicketWatcher, startSessionWatcher } from './lib/ticket-watcher.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { apiRouter } from './routes/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const problems = validateConfig();
if (problems.length) {
  console.error('\nConfiguration problems:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nSee .env.example. Copy it to .env and fill in the blanks.\n');
  process.exit(1);
}

const app = express();

// App Platform terminates TLS upstream; trust it so req.protocol and req.ip
// reflect the real client rather than the proxy.
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(root, 'views'));

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(express.static(path.join(root, 'public'), { maxAge: config.isProd ? '1h' : 0 }));

app.use('/api', apiRouter);
app.use('/admin', adminRouter);
app.use('/', publicRouter);

app.use((req, res) => {
  res.status(404).render('error', { message: 'No such page. Complain about it if you like.' });
});

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).render('error', {
    message: config.isProd ? 'Something went wrong.' : String(err.stack || err.message),
  });
});

const stops = [];

async function main() {
  await initDb();
  stops.push(startTicketWatcher());
  stops.push(startSessionWatcher());

  const server = app.listen(config.port, () => {
    const base = `http://localhost:${config.port}`;
    console.log('');
    console.log('  The Complaints Department is open.');
    console.log('');
    console.log(`    form       ${base}/`);
    console.log(`    QR (proj)  ${base}/qr`);
    console.log(`    dashboard  ${base}/admin`);
    console.log(`    wall       ${base}/admin/wall`);
    console.log('');
    let dbHost = 'unknown';
    try {
      dbHost = new URL(config.db.url).host;
    } catch {
      /* startup validation already rejected an unusable URL */
    }
    console.log(`    ingest: ${config.ingest.mode}   database: ${dbHost}`);
    console.log('');
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} — shutting down`);
    for (const stop of stops) stop();
    server.close();
    await closeDb().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
