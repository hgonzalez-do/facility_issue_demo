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

Every card on that wall is a webhook, a fresh microVM, an LLM call, a database
write, a GitHub issue, and a live push to the browser — in about twenty
seconds, however many of them arrive at once.

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
    participant AG as Action Gateway
    participant GH as GitHub issues
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
    Note over VM,PG: ticket first — everything after this is a bonus

    VM->>AG: github_create_issue
    AG->>GH: credential added here, never in the sandbox
    GH-->>AG: issue number + url
    AG-->>VM: issue number + url
    VM->>AG: github_add_issue_labels
    VM->>PG: link the issue to the ticket
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
    C["./scripts/connect-github.sh<br/><small>OAuth — you click this one</small>"] --> AG["GitHub connection<br/><small>Action Gateway holds the credential</small>"]
```

Re-running is safe; every step checks for what it already made.

Then one step that cannot be automated, because it is OAuth — authorizing
GitHub, so the agents can file issues:

```bash
./scripts/connect-github.sh    # prints a link; open it, approve
```

Skip it and the demo still works, minus the issues. `deploy.sh` tells you
which of the two states you are in rather than assuming.

**Cost while it's up:** about $5/mo for the app and $15/mo for the database,
plus per-session compute and tokens. `./destroy.sh` removes all of it.

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

**Rehearsing.** `node scripts/seed.js --fake -n 20` fills the wall instantly:
no agents, no cost, deterministic rows. Use it for layout and for checking
the projector.

Dropping `--fake` runs the real thing — one microVM and one GitHub issue per
complaint. That is a genuine dress rehearsal, and it is the only way to
rehearse the agent, but it spends sandbox time and leaves real issues in the
tracker. `npm run db:reset -- --yes` wipes the database between run-throughs
(it names the cluster before it does anything); the issues you close or
delete yourself.

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
    V -->|Action Gateway| GH["GitHub issues"]
    A["App Platform<br/><small>still running</small>"] -->|reads| PG
```

Submissions still fire the live trigger and still spawn real microVMs; only
the web tier has moved. There is no in-process shortcut — the agent's
instructions live in `agents/complaint-prompt.txt` and that is the only copy,
so what you test is what the demo runs.

Iterating on that prompt: edit it, `./deploy.sh` to push it to the trigger,
then submit. For layout and CSS work, `node scripts/seed.js --fake -n 20`
fills the wall instantly without touching an agent.

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
- **Each ticket also opens a GitHub issue**, labelled by severity and
  component, through Action Gateway — which holds the credential and
  supplies it when the tool runs, so no GitHub token ever reaches the
  sandbox. The database row is written first and the issue second, so a
  tracker failure costs a link, not a ticket.
- **Authorize GitHub with `./scripts/connect-github.sh`, not the control
  panel.** Action Gateway resolves a connection by *actor*, and a
  trigger-started session runs as your DigitalOcean account UUID — not your
  username. A connection authorized against any other actor is invisible
  here, and the only symptom is issues silently never appearing. The script
  always targets the right one.
- **The form is rate limited**, and the inference service allows 240
  requests/minute per team. A full room fits; a full room twice in one minute
  does not.

---

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the app is put together
- [docs/PLATFORM-NOTES.md](docs/PLATFORM-NOTES.md) — what the platform actually
  does, as opposed to what you would reasonably assume
