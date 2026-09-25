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

**19. The docs have fallen behind the code.** Audited rather than guessed —
every item below is a confirmed gap as of this writing, and most of it is
one day's work landing faster than the prose describing it.

README:

- the Reset button is not mentioned at all
- the deploy diagram shows four things `deploy.sh` creates; it now creates
  five. The reset trigger is missing from it.

docs/ARCHITECTURE.md:

- the reset trigger is absent entirely — the only occurrence of "reset" is
  `reset.js` in the file listing
- `agents/summary-voice.txt` is not in the layout, so nothing explains why
  the summary's instructions live outside both places that use them
- the `scripts/` listing predates `clear-issues.sh` and `check-github.sh`
- the complaint flow diagram does not show `preload_tools`, so it still
  implies a discovery step that no longer happens

docs/PLATFORM-NOTES.md is missing the three findings that cost the most to
learn:

- `preload_tools` exposes gateway tools with their schemas and removes the
  `action_search` round-trip
- **the actor split** — `harness-runtime create` runs as the username,
  a trigger-started session runs as the account UUID, and they resolve
  different Action Gateway connections. This is the single most expensive
  thing discovered in this project and it is written down nowhere but here.
- connection `status` is unreliable in both directions (see #16)

The rule this keeps violating: a document that is confidently wrong is worse
than one that is missing, because it is trusted. Worth a pass that checks
claims against the code rather than reading for plausibility — the last such
pass found four flatly false statements in ARCHITECTURE alone.

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
