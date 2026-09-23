# The Complaints Department

A DigitalOcean **MARS** (Managed Agents Runtime Services) demo.

A QR code on screen points at a plain form: *"Complain about anything. One
sentence."* Every submission becomes a sober enterprise ticket against a fixed
schema — title, component, severity, affected users, suggested owner, SLA, and
a deadpan one-line root cause hypothesis — and lands on a live wall the room is
watching.

> "The coffee here is cold" → **P3**, component `Beverages`, owner `Facilities`,
> root cause: *thermal loss in the carafe-to-cup handoff.*

---

## Quick start (local)

```bash
npm install
cp .env.example .env     # set INFERENCE_API_KEY and ADMIN_PASSWORD
npm run db:init
npm run dev
```

| URL | What it is |
| --- | --- |
| `http://localhost:3000/` | The public form. This is what the QR points at. |
| `http://localhost:3000/qr` | Full-screen QR code. Project this. |
| `http://localhost:3000/admin` | Operations dashboard (stats, tickets, summary). |
| `http://localhost:3000/admin/wall` | The live card wall. Project this too. |

Sign in to `/admin` with `ADMIN_PASSWORD`.

### Rehearsing without an audience

```bash
node scripts/seed.js --fake -n 20   # instant, no API calls, deterministic
node scripts/seed.js -n 12          # real classification, real latency
npm run db:reset -- --yes           # wipe between run-throughs
```

---

## Two ingest modes

`INGEST_MODE` decides how a grievance becomes a ticket. The app is otherwise
identical in both.

### `local` — development

```
browser → POST /complain → app inserts complaint
                         → app calls DigitalOcean serverless inference
                         → app writes the ticket to SQLite
                         → watcher → SSE → dashboard
```

One process, one SQLite file. Use this to build. You still need a DigitalOcean
credential, because inference runs there.

### `mars` — the demo

```
browser → POST /complain → app inserts complaint
                         → app POSTs a signed webhook to a Harness Runtime trigger
                                     ↓
                         fresh microVM session, isolated per complaint
                                     ↓
                         classifies, then writes the ticket row itself
                         via Action Gateway → Managed Postgres
                                     ↓
app polls Postgres → watcher → SSE → dashboard
```

The app never sees the ticket get written. That is the point: 200 people can
submit at once, the web tier stays a web server, and the room watches dozens of
isolated sandboxes spin up and finish.

**Why polling.** In `mars` mode the `INSERT` happens inside an agent's sandbox
on another machine. The database is the only thing both sides can observe, so
`src/lib/ticket-watcher.js` polls it and fans out over SSE. The same loop covers
`local` mode for free.

---

## Inference

Every model call — the app's in `local` mode, and the Harness Agent's in `mars`
mode — goes through **DigitalOcean serverless inference** at
`https://inference.do-ai.run`. Nothing talks to `api.anthropic.com`.

The service speaks the Anthropic Messages API and accepts either `x-api-key` or
`Authorization: Bearer`, so [`src/lib/inference.js`](src/lib/inference.js) uses
the official Anthropic SDK with nothing but a `baseURL` swap. The Harness Agent
gets there the same way, via `ANTHROPIC_BASE_URL` in its manifest.

Model ids are **DigitalOcean slugs**, not Anthropic ids:

```bash
doctl serverless-inference models list
```

`anthropic-claude-opus-5` is the default. `anthropic-claude-haiku-4.5` is
roughly 3× faster and noticeably blander — the deadpan is most of the joke, so
spend the latency.

### Two things worth knowing

**`output_config.format` is silently ignored.** Structured outputs return
free-form prose with no error and a `200`. This is why classification uses a
**forced tool call** (`tool_choice: {type: "tool"}`) instead — that path is
honoured in full, `enum` constraints included. Verified directly against the
endpoint; don't "simplify" it back to structured outputs.

**Rate limits are per-team and visible on every response.** Measured at 240
requests/minute and 5M tokens/minute. A 200-person room submitting at once fits,
but not twice in the same minute — `RATE_MAX` on the public form is the backstop.

---

## The write boundary

The brief asks for the agent's write tool to "allow for that one table and deny
for everything else". A tool policy over a raw SQL connection cannot enforce
that, so [`db/grants.postgres.sql`](db/grants.postgres.sql) enforces it where it
cannot be argued with — Postgres itself. The agent connects as `mars_writer`:

| Object | Permission |
| --- | --- |
| `tickets` | `INSERT` only |
| `complaints` | `UPDATE (status, error, session_id)` only — no `SELECT` |
| `summaries` | none |
| everything else | none, including future tables |

No `DELETE`, no `DROP`, no read access to complaint bodies it was not handed.

The scheduled summary agent gets a second role, `mars_reporter`: `SELECT` on
`tickets` and `INSERT` on `summaries`, nothing more. It never sees a complaint
body and cannot edit the tickets it reports on.

On top of that, the manifests set `permissions.default: deny` and allow exactly
one tool (`action_code`), with a read-only filesystem and egress restricted to
the inference host plus the VPC.

---

## Layout

```
src/
  server.js              Express app, startup, graceful shutdown
  config.js              Env parsing + startup validation
  db/
    index.js             Driver-agnostic query layer
    sqlite.js            Local driver (node:sqlite, no native build)
    postgres.js          Managed Postgres driver
  lib/
    ticket-schema.js     The fixed schema, the vocabularies, the system prompt
    inference.js         DigitalOcean serverless inference client
    classify.js          Grievance → ticket (forced tool call)
    summarize.js         The closing executive summary
    mars.js              Webhook signing + the session census
    ingest.js            Submission pipeline for both modes
    ticket-watcher.js    DB poll → event bus
    events.js            In-process fan-out to SSE
    auth.js              Signed-cookie admin session
  routes/                public · admin · api (SSE)
views/                   EJS, no build step
public/                  CSS + the SSE client
db/                      Schemas for both engines, plus the grants
agents/                  Harness Agent manifests + trigger prompts
                         complaint-agent.yaml   webhook: one session per grievance
                         summary-agent.yaml     cron: the closing summary
scripts/                 init · seed · reset
```

Both drivers speak `?` placeholders; the Postgres driver rewrites them to
`$1..$n`. Keep `db/schema.sqlite.sql` and `db/schema.postgres.sql` in step.

---

## Notes for the stage

- **Nothing fails closed.** Model output is snapped to the controlled
  vocabulary rather than validated strictly (`coerceTicket`), because a
  slightly-wrong ticket beats a missing one in front of an audience.
- **Prompt injection is handled as content.** A submission that tries to give
  instructions gets filed under `Human Factors` rather than obeyed.
- **The form is rate limited** (`RATE_MAX` per `RATE_WINDOW_MS` per IP) so one
  enthusiast cannot drown the demo.
- **SSE reconnects with backoff**, so restarting the server mid-talk recovers
  quietly rather than leaving a dead wall.
- **`/admin` and `/api` are the only protected routes.** The form is public by
  design.

---

## Deploying

```bash
cp .env.example .env     # DIGITALOCEAN_ACCESS_TOKEN, GITHUB_REPO, ADMIN_PASSWORD
./deploy.sh
```

Creates a Managed Postgres cluster, applies the schema and both
least-privilege roles, creates the Harness Runtime webhook trigger (and the
cron trigger if `SUMMARY_CRON` is set), then deploys the App Platform service.
Re-running is safe — every step checks for what it already made. `./destroy.sh`
removes all of it.

### Running the UI locally against the deployed stack

If the App Platform URL is awkward to reach — corporate policy, no venue
internet — you can keep the real database and the real agents and just move
the web tier:

```bash
./scripts/link-local.sh > .env.local
npm run dev
```

`.env.local` overrides `.env`, pointing the app at the Managed Postgres
cluster and the live webhook trigger. Submissions still spawn real microVMs.

---

## What the platform actually does

Everything here was found by running it. Each one cost an hour, so they are
written down.

**MARS validates `ANTHROPIC_API_KEY` against Anthropic for the `claude-code`
adapter**, ignoring every base-URL override. A DigitalOcean model key 401s and
the session never starts. `opencode` takes the credential at face value — which
is why this demo uses it.

**`opencode` needs `/v1` on `ANTHROPIC_BASE_URL`.** It appends `/messages`
where the Anthropic SDK appends `/v1/messages`. Without it every call 404s onto
a DigitalOcean maintenance page that reads exactly like an outage.

**`HARNESS_INFERENCE_BASE_URL` is not read by `opencode`.** Set it anyway — it
is the documented platform key — but `ANTHROPIC_BASE_URL` is what takes effect.

**`action_code` runs in a different sandbox from the agent** and receives none
of the session's `env` or `secrets` — only `SESSION_ID`, `TEAM_ID` and
friends. Anything needing a credential has to run in the agent's own shell.

**The sandbox image has no Postgres client** — no `psql`, no `psycopg2`, no
node `pg`. The agent installs one per run, which is why PyPI is reachable.

**`egress.allow_hosts` only passes HTTP(S).** Postgres on 25060 times out with
the host allowlisted, and the agent reports a plausible, wrong "check your
trusted sources". `allow_ips` opens the port — in a directly-created session.
In a trigger-started session it still times out, so the manifests ship
`egress: unrestricted` with the reasoning in a comment.

**VPC attachment is rejected in every region** available to this team, so the
sandbox reaches Managed Postgres over the public endpoint. Consequently the
cluster must keep an **empty trusted-source list**: the first rule turns the
allowlist on and locks the sandboxes out.

**`permissions` is mandatory for fresh triggers** (headless runs cannot use
the `ask` default), but `opencode` declares no capability for named tool rules,
so `default: allow` plus a writable workspace is what binds.

**A `WHERE` clause is a read.** `UPDATE complaints ... WHERE id = %s` needs
`SELECT` on `id`, and `INSERT ... RETURNING id` needs it on `tickets.id`.
Denying them surfaces as a bare "permission denied for table", and — worse —
the exception rolls back the surrounding transaction, so a successful INSERT
disappears with it. Both are column-level grants.

**App Platform needs `github:`, not `git: repo_clone_url:`** for a private
repo, even with the DigitalOcean GitHub app installed.

**Keep concrete examples out of the agent prompt.** The first version
illustrated the transform with "The coffee here is cold", and the agent duly
filed a beverage ticket against a complaint about plastic plants.
