# Platform notes

Everything here was found by running the demo against DigitalOcean, not by
reading documentation. Each one cost about an hour. They are written down so
the next person does not pay twice.

## Harness Runtime

**MARS validates `ANTHROPIC_API_KEY` against Anthropic for the `claude-code`
adapter**, ignoring every base-URL override. A DigitalOcean model key 401s and
the session never starts. `opencode` takes the credential at face value — which
is why this demo uses it.

**`opencode` needs `/v1` on `ANTHROPIC_BASE_URL`.** It appends `/messages`
where the Anthropic SDK appends `/v1/messages`. Without it every call 404s onto
a DigitalOcean maintenance page that reads exactly like an outage.

**`HARNESS_INFERENCE_BASE_URL` is not read by `opencode`.** Set it anyway — it
is the documented platform key — but `ANTHROPIC_BASE_URL` is what takes effect.

## The sandbox

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

## Postgres grants

**A `WHERE` clause is a read.** `UPDATE complaints ... WHERE id = %s` needs
`SELECT` on `id`, and `INSERT ... RETURNING id` needs it on `tickets.id`.
Denying them surfaces as a bare "permission denied for table", and — worse —
the exception rolls back the surrounding transaction, so a successful INSERT
disappears with it. Both are column-level grants.

## App Platform

**App Platform needs `github:`, not `git: repo_clone_url:`** for a private
repo, even with the DigitalOcean GitHub app installed.

## Prompting

**Keep concrete examples out of the agent prompt.** The first version
illustrated the transform with "The coffee here is cold", and the agent duly
filed a beverage ticket against a complaint about plastic plants.
