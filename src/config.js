import 'dotenv/config';

function bool(v, dflt = false) {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, dflt) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
}

const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
const ingestMode = (process.env.INGEST_MODE || 'local').toLowerCase();

export const config = {
  port: int(process.env.PORT, 3000),
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  admin: {
    password: process.env.ADMIN_PASSWORD || 'complaints',
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
    cookieName: 'cd_admin',
    // Eight hours: long enough for a conference day.
    maxAgeMs: 8 * 60 * 60 * 1000,
  },

  db: {
    driver, // 'sqlite' | 'postgres'
    sqlitePath: process.env.SQLITE_PATH || './data/complaints.db',
    url: process.env.DATABASE_URL || '',
  },

  ingest: {
    mode: ingestMode, // 'local' | 'mars'
    webhookUrl: process.env.MARS_WEBHOOK_URL || '',
    webhookSecret: process.env.MARS_WEBHOOK_SECRET || '',
    ticketTable: process.env.MARS_TICKET_TABLE || 'tickets',
  },

  // DigitalOcean serverless inference. Anthropic-compatible Messages API, so
  // the Anthropic SDK is used as the client with a swapped baseURL.
  inference: {
    baseUrl: process.env.INFERENCE_BASE_URL || 'https://inference.do-ai.run',
    apiKey: process.env.INFERENCE_API_KEY || process.env.DIGITALOCEAN_ACCESS_TOKEN || '',
    // A DigitalOcean model slug, not an Anthropic model id.
    // See: doctl serverless-inference models list
    model: process.env.INFERENCE_MODEL || 'anthropic-claude-opus-5',
  },

  // Used by the dashboard to show live MARS session counts.
  digitalocean: {
    token: process.env.DIGITALOCEAN_ACCESS_TOKEN || '',
  },

  // How often the dashboard polls the DB for rows the agent wrote directly.
  pollIntervalMs: int(process.env.POLL_INTERVAL_MS, 1500),

  // Rate limiting on the public form, so one enthusiast cannot drown the demo.
  rateLimit: {
    windowMs: int(process.env.RATE_WINDOW_MS, 60_000),
    max: int(process.env.RATE_MAX, 12),
    enabled: bool(process.env.RATE_LIMIT_ENABLED, true),
  },
};

export function validateConfig() {
  const problems = [];

  if (!['sqlite', 'postgres'].includes(config.db.driver)) {
    problems.push(`DB_DRIVER must be "sqlite" or "postgres", got "${config.db.driver}"`);
  }
  if (config.db.driver === 'postgres' && !config.db.url) {
    problems.push('DB_DRIVER=postgres requires DATABASE_URL');
  }
  if (!['local', 'mars'].includes(config.ingest.mode)) {
    problems.push(`INGEST_MODE must be "local" or "mars", got "${config.ingest.mode}"`);
  }
  if (config.ingest.mode === 'local' && !config.inference.apiKey) {
    problems.push(
      'INGEST_MODE=local requires INFERENCE_API_KEY (a DigitalOcean model access key, or a PAT with all scopes)',
    );
  }
  if (config.ingest.mode === 'mars' && !config.ingest.webhookUrl) {
    problems.push('INGEST_MODE=mars requires MARS_WEBHOOK_URL');
  }
  if (config.isProd && config.admin.sessionSecret === 'dev-only-change-me') {
    problems.push('SESSION_SECRET is still the default — set a real one in production');
  }

  return problems;
}
