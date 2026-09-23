-- The Complaints Department — PostgreSQL schema (DigitalOcean Managed Postgres).
-- Mirrors db/schema.sqlite.sql. Keep the two in step.

CREATE TABLE IF NOT EXISTS complaints (
  id            BIGSERIAL   PRIMARY KEY,
  body          TEXT        NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT        NOT NULL DEFAULT 'web',
  -- pending | processing | ticketed | failed
  status        TEXT        NOT NULL DEFAULT 'pending',
  error         TEXT,
  -- MARS session that processed this complaint, when INGEST_MODE=mars
  session_id    TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id                     BIGSERIAL   PRIMARY KEY,
  complaint_id           BIGINT      REFERENCES complaints(id),
  title                  TEXT        NOT NULL,
  component              TEXT        NOT NULL,
  severity               TEXT        NOT NULL,
  affected_users         INTEGER     NOT NULL,
  suggested_owner        TEXT        NOT NULL,
  sla_hours              INTEGER     NOT NULL,
  root_cause_hypothesis  TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id             TEXT
);

CREATE TABLE IF NOT EXISTS summaries (
  id             BIGSERIAL   PRIMARY KEY,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_tickets  INTEGER     NOT NULL,
  -- JSON: [{"component": "Beverages", "count": 12}, ...]
  top_components TEXT        NOT NULL,
  headcount_ask  TEXT        NOT NULL,
  narrative      TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_complaints_status  ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_component  ON tickets(component);
