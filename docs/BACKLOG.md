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

**9. The public form ships a ~123 KB gzipped React bundle.** That lands on
200 phones at once on venue wifi. It is the one page worth serving as plain
HTML.

**10. The summary prompt exists twice.** `src/lib/summarize.js` and
`agents/summary-prompt.txt` state the same job. That exact duplication put
the wrong example into tickets once already. Cron triggers have no
manual-run endpoint, so the rehearsal button needs an in-process path;
spawning a one-off session from the summary agent config would close it.

**11. No cron trigger is deployed.** The closing executive summary has never
run on its schedule. Set `SUMMARY_CRON` and rehearse it.

**18. A reset button in the admin UI.** Wipe tickets, complaints and
summaries, clear the tracker, and re-align the ticket sequence — without
dropping to a terminal between rehearsals. Currently three manual steps, one
of which needs a number looked up by hand.

Two things make this more than a button.

*It is destructive, and it sits next to the thing being projected.* A stray
click mid-talk wipes the wall. Type-the-stack-name to confirm, the way
`destroy.sh` does, rather than a plain "are you sure".

*The app cannot delete GitHub issues, and should not be able to.* **Decided:
the button closes issues, it does not delete them.** Action Gateway's GitHub
toolkit has `update_issue`, so a one-off session can close everything open.
It has no delete — GitHub only exposes that through GraphQL `deleteIssue`,
which is not in the catalogue and needs admin on the repository.

That asymmetry is the right way round. The running demo should not be able
to erase its own audit trail, and the web tier should not hold a credential
that could. Closing is reversible; deleting is not.

Deletion stays a human action, and now has a script:
`./scripts/clear-issues.sh`. It runs as the operator's own `gh` login —
a credential the deployed app never sees — asks for typed confirmation,
probes GitHub for the next issue number afterwards, and re-aligns the ticket
sequence to match. That last part is the fiddly bit the button would
otherwise inherit: numbers are never reused, so clearing the tracker does
not reset the counter.

Still to build: the button itself, the one-off session that closes issues,
and a way for the app to learn the next issue number without a GitHub
credential of its own.

**15. Intake has no detail view.** Clicking a complaint should open its
progress in real time — submitted, webhook fired, session started,
classified, ticket written, issue opened — with elapsed time per stage,
ticking while it is in flight. This is the clearest way to show that each
complaint gets its own microVM and how long that actually takes.

The data is not all there yet. `complaints` has `submitted_at` and `status`;
`tickets` has `created_at`. Nothing records when the session started or when
the issue was opened. Two options:

- add timestamp columns (cheap, additive, matches the existing migration
  style) and have the agent write them; or
- read the real thing from
  `GET /v2/agents/triggers/{id}/executions/{execution_id}`, which carries
  `status`, `session_id`, `created_at` and `updated_at`, plus per-tool
  timings in its output. Richer, and it is DigitalOcean's own telemetry
  rather than our approximation — a better story for this demo. It needs the
  complaint id correlated to an execution, which the webhook payload already
  carries.

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
