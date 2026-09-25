# Backlog

Known work on the demo, roughly in the order it is worth doing. Each item
says what is wrong and why it matters, because most of these are things that
look fine until they are not.

## Blocking

**21. Trigger executions run one at a time — per trigger.** Measured
2026-09-25: three complaints submitted within one second finished at +74s,
+135s and +192s. The execution list shows `running pending pending`, then
`succeeded running pending`. Two earlier bursts (seven and five
submissions, 2026-09-23) show the same staircase, so it is systematic.

As deployed this makes the README's central claim false. It says 200 people
can submit at once and "dozens of isolated sandboxes spin up"; in fact the
*n*th person waits about *n* minutes, and a full room never drains.

**The limit is per-trigger, not per-team, and that makes it ours to fix.**
Two throwaway triggers fired in the same second both sat at `running`
together for a full minute. Firing each of them twice gave
`probe-a=[running pending] probe-b=[running pending]` — two concurrent
runs, one per trigger. So *N* intake triggers buy exactly *N* concurrent
complaints, with no quota request and no platform change.

The work:

- `deploy.sh` creates `complaints-dept-intake-1..N` from the one manifest
  it already renders, instead of a single trigger. The prompt is unchanged;
  only the name differs.
- `src/lib/mars.js` holds a list of (url, secret) pairs rather than one,
  and `fireWebhook` picks round-robin. A complaint does not care which
  shard runs it.
- `scripts/check-github.sh` reads execution history from shard 1, or from
  all of them.
- Pick *N* from the room: at ~60s per run, *N*=8 clears 8 complaints a
  minute, which covers a busy Q&A. *N*=16 if the room is large. Triggers
  are free to create; only running sessions cost.

Two things to confirm before committing to a number: whether a per-team
ceiling appears at higher *N* (only two shards have been tested), and that
the inference service's 240 req/min still holds — it is far above what
*N*=16 can generate, so this is a formality.

Until it ships, the honest framing on stage is that the wall is a queue
with a one-minute service time, not a thundering herd.

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

docs/PLATFORM-NOTES.md now covers the actor split, the unreliable `status`
field and `preload_tools`. Still missing: the reset trigger, and the fact
that `DELETE` is the only way to re-authorize a connection the API believes
is healthy.

The rule this keeps violating: a document that is confidently wrong is worse
than one that is missing, because it is trusted. Worth a pass that checks
claims against the code rather than reading for plausibility — the last such
pass found four flatly false statements in ARCHITECTURE alone.

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

**17. Runs take ~60s of work, and the stated reason was wrong.**
*(Re-measured 2026-09-25; the old entry blamed `pip install`, which is
false.)* A single run breaks down like this, read from the session log:

| | |
| --- | --- |
| `pip install psycopg[binary]` | **1.9s** |
| INSERT ticket + UPDATE complaint | 1.3s |
| `github_create_issue` | 2.5s |
| `github_add_issue_labels` | 2.1s |
| link the issue back to the ticket | 1.1s |
| everything else (`echo`, heredoc) | 0.2s |
| **total tool execution** | **~9–11s** |
| **total run** | **~57–74s** |

So roughly 85% of a run is not tool execution at all. It is sandbox startup
plus model generation: the agent emits 1,400–2,600 output tokens across
7–15 round-trips, and each round-trip is a call to
`inference.do-ai.run`. The database work — install included — is about
**4s, or 6% of a run**.

Two consequences.

*Moving the database write to an HTTP endpoint would not help.* It would
save maybe 3 of those 4 seconds, add an App Platform dependency to the
ticket write, and cost the Postgres grants in `db/grants.postgres.sql` —
which are the one boundary in this demo that cannot be argued with. Not
worth it. (Asked and answered; recorded here so it is not re-proposed.)

*A custom sandbox template saves 1.9s, not 40.* BYOT is real — `doctl
harness-runtime template create --base-template coding-opencode
--source-oci-ref …` rebases your own OCI image onto the platform base — and
it would still let egress drop PyPI (see #7). But as a latency fix it is
now a rounding error. Do it for #7, not for speed.

The actual lever is round-trips and output tokens:

- Run #1 of the three used `todowrite` seven times, took 15 steps, emitted
  2,621 tokens and cost **$0.33**. Runs #2 and #3 used it zero times, took
  10 and 7 steps, and cost **$0.18** and **$0.13**. Telling the prompt not
  to keep a todo list is free and roughly halves the cost.
- Even the leanest run (7 steps, 1,404 tokens) still took ~57s, so
  round-trips alone do not explain it. Worth timing a single bare inference
  call against `qwen3.8-max` to separate model latency from sandbox
  startup before optimising further.

Cost note while it is measured: **$0.13–$0.33 per complaint**. A 200-person
room is $26–66 in inference alone.

**14. The `.envrc` token** has been sitting in cleartext since the start and
is now the live credential for this stack. Rotate it.
