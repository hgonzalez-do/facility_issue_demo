-- ─────────────────────────────────────────────────────────────────────────────
-- Least-privilege role for the MARS agent.
--
-- This is the "allow that one table, deny everything else" boundary from the
-- brief, enforced where it cannot be argued with: Postgres itself. The agent's
-- action_code sandbox connects as `mars_writer`, which can insert a ticket and
-- mark a complaint done. It cannot read complaint bodies it was not handed, it
-- cannot touch `summaries`, and it cannot DELETE or DROP anything at all.
--
-- Applied by deploy.sh. ${MARS_DB_PASSWORD} is substituted at deploy time.
-- ─────────────────────────────────────────────────────────────────────────────

-- Start from nothing. PUBLIC gets CREATE on `public` by default in PG < 15;
-- revoke it so a new role cannot create its own scratch tables.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mars_writer') THEN
    CREATE ROLE mars_writer LOGIN PASSWORD '${MARS_DB_PASSWORD}';
  ELSE
    ALTER ROLE mars_writer LOGIN PASSWORD '${MARS_DB_PASSWORD}';
  END IF;
END
$$;

-- Nothing inherited, nothing assumed.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM mars_writer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mars_writer;
REVOKE ALL ON SCHEMA public FROM mars_writer;

-- See the schema, and nothing more.
GRANT USAGE ON SCHEMA public TO mars_writer;

-- The one table it may write.
GRANT INSERT ON TABLE tickets TO mars_writer;
GRANT USAGE  ON SEQUENCE tickets_id_seq TO mars_writer;

-- One column of SELECT, and only one. `INSERT ... RETURNING id` reads the
-- value back, which Postgres treats as a SELECT and refuses without this —
-- the failure surfaces as a flat "permission denied for table tickets", which
-- looks nothing like the RETURNING clause that caused it. Column-level, so the
-- agent still cannot read a single ticket it or anyone else has filed.
GRANT SELECT (id) ON TABLE tickets TO mars_writer;

-- Close the loop on the complaint it was handed: three columns, no more.
GRANT UPDATE (status, error, session_id) ON TABLE complaints TO mars_writer;

-- And SELECT on `id` alone, for the same reason as tickets.id above: the
-- agent's statement is `UPDATE complaints ... WHERE id = %s`, and a WHERE
-- clause is a read. Without this the UPDATE is denied, which would be fine
-- on its own — except the denial raises inside psycopg's connection context
-- manager, which rolls the transaction back and silently takes the perfectly
-- good INSERT with it. The visible symptom is tickets that intermittently
-- never appear, which looks like anything but a missing column grant.
-- Complaint bodies stay unreadable: `body` is not granted.
GRANT SELECT (id) ON TABLE complaints TO mars_writer;

-- Explicitly denied, for the avoidance of doubt and for anyone reading this
-- over your shoulder at the conference:
--   complaints : no SELECT, no INSERT, no DELETE
--   tickets    : no SELECT, no UPDATE, no DELETE
--   summaries  : no access of any kind
-- Future tables default to no access, since PUBLIC was revoked above.

-- ─────────────────────────────────────────────────────────────────────────────
-- Second least-privilege role, for the scheduled summary agent.
--
-- It needs to read ticket volumes and write one summary row. It does not need
-- to see a single complaint body, and it must not be able to edit the tickets
-- it is reporting on.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mars_reporter') THEN
    CREATE ROLE mars_reporter LOGIN PASSWORD '${MARS_REPORTER_PASSWORD}';
  ELSE
    ALTER ROLE mars_reporter LOGIN PASSWORD '${MARS_REPORTER_PASSWORD}';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM mars_reporter;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mars_reporter;
REVOKE ALL ON SCHEMA public FROM mars_reporter;

GRANT USAGE ON SCHEMA public TO mars_reporter;

-- Aggregate over tickets, write one summary. Nothing else.
GRANT SELECT ON TABLE tickets   TO mars_reporter;
GRANT INSERT ON TABLE summaries TO mars_reporter;
GRANT USAGE  ON SEQUENCE summaries_id_seq TO mars_reporter;

-- Explicitly denied:
--   complaints : no access of any kind — it never sees what people wrote
--   tickets    : no INSERT, no UPDATE, no DELETE
--   summaries  : no SELECT, no UPDATE, no DELETE — append-only
