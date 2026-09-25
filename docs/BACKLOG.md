# Backlog

Known work on the demo, roughly in the order it is worth doing. Each item
says what is wrong and why it matters, because most of these are things that
look fine until they are not.

## Blocking

**1. GitHub connection is not authorized.** Until it is, the agent files the
ticket and skips the issue. Run `./scripts/connect-github.sh` and open the
link it prints. Note the actor: a trigger-started session runs as the
DigitalOcean account UUID, not the username, and a connection authorized
against any other actor is invisible here.

## Correctness — things that report success while broken

**2. `deploy.sh` reports GitHub connected when it is not.** It reads the
connection's `status` field, which stayed `active` for two days while every
tool call failed with "requires an OAuth connection". The record and the
token behind it expire independently. The check has to exercise a tool, not
trust a field.

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

**8. Use `preload_tools`.** The agent currently calls `action_search` before
it can file an issue. Preloading exposes the tools with their schemas
directly, removing a round-trip and a failure mode from every complaint —
visible latency, in a demo where the room is watching the wall.

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

**12. A stale `hgonzalez` Action Gateway connection** is still active and
unused. Trigger sessions run as the account UUID, so it does nothing except
mislead whoever looks next.

**13. Five test issues** from 23 September remain in the tracker.

**14. The `.envrc` token** has been sitting in cleartext since the start and
is now the live credential for this stack. Rotate it.
