# The Complaints Department

A live demo for DigitalOcean **Managed Agents Runtime Services**.

A QR code on screen points at a form with one field: *"Complain about anything.
One sentence."* Every submission spawns its own microVM, which takes the
grievance completely seriously and files it as an enterprise incident ticket.
The room watches its own nonsense land on a wall in real time.

> *"The lift plays jazz."*
> → **P4** · Elevators & Vertical Transit · owner Facilities · SLA 168h
> **Unsolicited Ambient Music Genre Broadcast Within Vertical Transit Infrastructure**
> *Elevator audio subsystem defaulted to jazz preset following maintenance cycle firmware reset.*

Every card on that wall is a webhook, a fresh sandbox, an LLM call, a database
write, and a live push to the browser.

---

## What happens when someone submits

```mermaid
sequenceDiagram
    autonumber
    actor Guest as Phone in the room
    participant App as App Platform
    participant Trig as Harness Runtime trigger
    participant VM as microVM session
    participant Inf as DO inference
    participant PG as Managed Postgres
    participant Wall as The wall

    Guest->>App: one sentence
    App->>PG: store complaint
    App-->>Guest: thank-you page
    Note over App,Guest: instant — nothing waits on the agent

    App->>Trig: signed webhook
    Trig->>VM: start a fresh sandbox
    VM->>Inf: classify this grievance
    Inf-->>VM: title, component, severity, owner, SLA, root cause
    VM->>PG: INSERT the ticket
    Note over VM: sandbox is discarded

    Wall->>PG: poll
    PG-->>Wall: new ticket
    Note over Wall: card lands, counter ticks
```

The web tier never sees the ticket get written. That is the whole point: 200
people can submit at once and it stays a web server while the room watches
dozens of isolated sandboxes spin up and finish.

---

## Deploy it

You need `doctl` (authenticated), `node` 22+, `jq`, and a GitHub repo the
DigitalOcean GitHub app can read.

```bash
cp .env.example .env     # DIGITALOCEAN_ACCESS_TOKEN, GITHUB_REPO, ADMIN_PASSWORD
./deploy.sh
```

```mermaid
flowchart TD
    D["./deploy.sh"] --> PG[("Managed Postgres<br/><small>schema · mars_writer · mars_reporter</small>")]
    D --> WH["Webhook trigger<br/><small>one microVM per complaint</small>"]
    D --> CR["Cron trigger<br/><small>closing summary — optional</small>"]
    D --> APP["App Platform<br/><small>form · dashboard · wall</small>"]
```

Re-running is safe; every step checks for what it already made. When you're
done: `./destroy.sh`.

**Cost while it's up:** about $5/mo for the app and $15/mo for the database,
plus per-session compute and tokens. Tear it down after the talk.

---

## Run the demo

| Screen | URL |
| --- | --- |
| Project this first | `/qr` — full-screen QR pointing at the form |
| Project this during | `/admin/wall` — the live card wall |
| For you | `/admin` — volumes, filters, the summary |

Sign in with `ADMIN_PASSWORD`.

**The arc.** Put the QR up and let the room submit. Cards start landing within
a few seconds and keep landing. The session counter on the wall climbs as
sandboxes spin up — that's the scale story, without anyone saying the word.
Close with the executive summary: total tickets, top three components, and a
straight-faced headcount ask for Facilities. Either let the cron trigger fire
it on schedule, or press **Generate now** on `/admin/summary`.

**Rehearsing.** `node scripts/seed.js --fake -n 20` fills the wall instantly
with no API calls. Drop `--fake` for real classification. `npm run db:reset --
--yes` wipes between run-throughs — it targets the deployed cluster, and says
so before it does anything.

---

## Running it locally

There is no local database. A local run points at the cluster you deployed,
so what you develop against is what the demo runs on — and it is also how you
present if the venue blocks your App Platform URL.

```bash
npm install
./scripts/link-local.sh > .env.local
npm run dev
```

```mermaid
flowchart LR
    L["npm run dev<br/><small>localhost:3000</small>"] -->|reads| PG[("Managed Postgres")]
    L -->|signed webhook| T["Harness Runtime trigger"]
    T --> V["microVM session"]
    V -->|writes| PG
    A["App Platform"] -->|reads| PG
```

Submissions still fire the live trigger and still spawn real microVMs; only
the web tier has moved. Set `INGEST_MODE=local` in `.env.local` to classify
in-process instead — faster to iterate on the prompt, same database.

---

## Worth knowing

- **Nothing fails closed.** Model output is snapped to the controlled
  vocabulary rather than validated strictly — a slightly-wrong ticket beats a
  missing one in front of an audience.
- **Submissions are data, not instructions.** Anything trying to give the
  agent orders gets filed under `Human Factors`.
- **The agent's database role can insert a ticket and close a complaint, and
  nothing else** — it cannot read what anyone wrote. Enforced by Postgres
  grants, asserted at deploy time.
- **The form is rate limited**, and the inference service allows 240
  requests/minute per team. A full room fits; a full room twice in one minute
  does not.

---

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the app is put together
- [docs/PLATFORM-NOTES.md](docs/PLATFORM-NOTES.md) — what the platform actually
  does, as opposed to what you would reasonably assume
- [docs/ProblemStatement.md](docs/ProblemStatement.md) — the original brief
