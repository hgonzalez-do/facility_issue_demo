import dotenv from 'dotenv';

// .env is the committed-shape config; .env.local overrides it and wins.
// scripts/link-local.sh writes .env.local to point a local run at the
// deployed Managed Postgres and the live webhook trigger.
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

function bool(v, dflt = false) {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, dflt) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
}

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

  // DigitalOcean Managed Postgres, in every environment. There is no local
  // database: `scripts/link-local.sh` points a local run at the deployed
  // cluster, so what you develop against is what the demo runs on.
  db: {
    url: process.env.DATABASE_URL || '',
  },

  // Every complaint goes to Harness Runtime. There is no in-process path:
  // the agent's instructions live in agents/complaint-prompt.txt and are run
  // by the trigger, so there is only one prompt and only one thing to test.
  ingest: {
    webhookUrl: process.env.MARS_WEBHOOK_URL || '',
    // Fires the reset agent, which closes open issues in the tracker.
    // Optional: without it the reset button still wipes the database.
    resetWebhookUrl: process.env.RESET_WEBHOOK_URL || '',
    resetWebhookSecret: process.env.RESET_WEBHOOK_SECRET || '',
    // Fires the close agent, which closes one ticket's GitHub issue.
    // Optional: without it the Close button still closes the ticket.
    closeWebhookUrl: process.env.CLOSE_WEBHOOK_URL || '',
    closeWebhookSecret: process.env.CLOSE_WEBHOOK_SECRET || '',
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

  if (!config.db.url) {
    problems.push(
      'DATABASE_URL is not set. For a local run against the deployed cluster: ./scripts/link-local.sh > .env.local',
    );
  }
  if (!config.ingest.webhookUrl) {
    problems.push(
      'MARS_WEBHOOK_URL is not set. For a local run against the deployed trigger: ./scripts/link-local.sh > .env.local',
    );
  }
  if (!config.inference.apiKey) {
    problems.push(
      'INFERENCE_API_KEY is not set (a DigitalOcean model access key, or a PAT with all scopes)',
    );
  }
  if (config.isProd && config.admin.sessionSecret === 'dev-only-change-me') {
    problems.push('SESSION_SECRET is still the default — set a real one in production');
  }

  return problems;
}
