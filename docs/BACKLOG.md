# Backlog

Known work on the demo, roughly in the order it is worth doing. Each item
says what is wrong and why it matters, because most of these are things that
look fine until they are not.

## Blocking

*Nothing currently blocking.*

## Correctness — things that report success while broken

**3. `connect-github.sh --force` cannot force anything.** The API refuses to
mint a link while it believes the connection is healthy, which is exactly
when you need one. `DELETE /v2/action-gateway/connections/{id}` works and
returns the record to `revoked`, so the flag should revoke and recreate.

**4. Ticket and issue numbers drift apart.** GitHub never reuses a number, so
any run where the issue step fails leaves the two counters one apart forever.
`db:reset --start-at N` re-aligns, but nothing detects the drift — you would
find out mid-talk.

## Hardening — newly possible

**5. Scope the GitHub tool to one repository.** Permission rules accept
argument conditions in `match`. Today nothing stops the agent filing into any
repository the connection can reach.

**6. Revisit `permissions.default: deny`.** Ruled out earlier because a deny
rule naming `action_code` was rejected and a blanket deny costs the agent its
shell. The docs now describe `enforcement: best-effort` as the escape hatch.

**7. Re-tighten egress.** Currently `unrestricted`, because `allow_hosts` only
passes HTTP(S) and the `allow_ips` form that worked in a directly-created
session still timed out on 25060 in a trigger-started one. Worth retesting.

## Demo quality

**11. No cron trigger is deployed.** The closing executive summary has never
run on its schedule. Set `SUMMARY_CRON` and rehearse it.

**20. Consider replacing doctl with a client library.** `deploy.sh` and the
helper scripts shell out to `doctl` about twenty times, seventeen of which
are `harness-runtime triggers`. Parsing a CLI has cost real time on this
project, and every one of these was found by something breaking rather than
by reading a man page:

- `databases create` accepts no `--format` or `--no-header`
- `--wait` writes progress to stdout, so the output of a `--output json`
  create is not JSON
- `databases connection` returns an object where `databases list` returns an
  array; the same `jq` expression cannot read both
- `apps spec get --output json` returns YAML — the JSON flag is `--format`
- `harness-runtime remove` has no `--force`, and failed silently for a
  whole session while diagnostic sandboxes accumulated
- `triggers create` nests `webhook_url` under `.webhook` but `webhook_secret`
  at the top level

**PyDo covers what we need**, which is the part worth knowing before
dismissing it: `agents/custom_triggers.py`, `agents/custom_sessions.py`, a
`gateway` module, and `connections`, `tools` and `toolbelts` namespaces. It
was updated three days before this was written.

Two things argue against it, though.

*It is Python, and this is a Node project.* Today a person needs `node`,
`doctl`, `jq` and `gh`. Adding a Python runtime and a virtualenv to a demo
whose whole pitch is "clone it and run deploy.sh" is a real cost, paid by
everyone who tries it.

*MARS support is hand-written, not generated.* Those trigger and session
modules live under `custom_`, and `agents/sessions` and `agents/triggers`
appear nowhere in the bundled OpenAPI spec. So that surface is maintained by
hand and can lag the platform — which, on a product changing this fast, is
the same exposure as `doctl` with an extra language.

There is a third option the title does not name, and it is probably the
right one: **call the REST API from Node**. The app already does, for the
session census and for reading Action Gateway connections, and
`check-github.sh` is the only script that genuinely needs a sandbox rather
than an HTTP call. That gets structured responses with no new language and
no reliance on anyone's client keeping up.

What would decide it: how much of `deploy.sh` is CLI-parsing versus
orchestration. If it is mostly the former, porting to `fetch` in Node is a
contained job and removes a class of bug. If deploy.sh is doing genuine
shell work — waiting, retrying, prompting — it may be fine where it is.

## Loose ends

**12. A stale `hgonzalez` Action Gateway connection** reports `active` and is
not usable — a probe as that actor gets "requires an OAuth connection".
Trigger sessions run as the account UUID and never touch it, so it does
nothing except read healthy while being broken. Delete it:
`DELETE /v2/action-gateway/connections/{id}`.

**16. Connection status is unreliable in both directions.** The record read
`active` for two days while every call failed, and read `pending` while
calls succeeded. Never branch on it; `scripts/check-github.sh` reads trigger
run history instead.

**17. Runs take 60–125s end to end.** *(Deferred — revisit after the talk.)* Most of it is the agent installing a
Postgres client per run, since the sandbox image ships none. A custom
sandbox template with `psycopg` baked in would cut it, and would let egress
drop PyPI (see #7).

**13. Five test issues** from 23 September remain in the tracker.

**14. The `.envrc` token** has been sitting in cleartext since the start and
is now the live credential for this stack. Rotate it.
