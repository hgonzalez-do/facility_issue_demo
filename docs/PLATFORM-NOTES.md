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

**A trigger runs one execution at a time, but triggers are independent of
each other.** Fire the same webhook three times in one second and the
execution list reads `running pending pending`, then
`succeeded running pending`. Fire two *different* triggers in the same
second and both sit at `running` together. Firing each of two triggers
twice gives one `running` and one `pending` on each — concurrency is 1 per
trigger, and shards do not contend.

There is no concurrency field on a trigger, and the docs' Limits page
404s, so this is worth re-measuring on your own team rather than trusting
the numbers here. The check costs nothing:

```bash
doctl harness-runtime triggers list-executions <id> --output json \
  | jq -r 'sort_by(.created_at) | .[] | "\(.created_at) \(.status)"'
```

The practical consequence: if you need *N* concurrent runs of the same
agent, create *N* triggers from one manifest and round-robin across them.
Do not expect a single trigger to fan out. That is what this demo does —
`INTAKE_SHARDS` triggers, verified at 8 concurrent, with eight complaints
submitted in the same two seconds all finishing inside 89 seconds.

One trap when you plumb the shard list through an App Platform spec: JSON
like `[{"url": ...}]` is also valid YAML flow-sequence syntax, so inlining it
bare gets parsed as an array and the update fails with `cannot unmarshal
array into Go struct field ... of type string`. Base64 it, the way the
cluster CA already is.

**A session's log outlives the session.** `doctl harness-runtime logs
<session>` 404s within minutes of a trigger run finishing, but the
execution record keeps the whole transcript in `output_text`, with a
duration on every tool call. That is the only way to see where a headless
run spent its time:

```bash
curl -s -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" \
  ".../v2/agents/triggers/<trigger>/executions/<execution>" | jq -r .output_text
```

Prefer the REST endpoint to `doctl ... get-execution --output json` here:
the CLI emits the transcript's control characters unescaped, so `jq` rejects
its own output.

**`validate` ignores keys it does not know.** `template:`,
`sandbox_template:`, `template_id:` and `sandbox:` all return "Manifest
looks valid" on a manifest that has none of those fields defined. It checks
the fields it recognises rather than rejecting the ones it does not, so a
misspelled key is a silent no-op — the same failure shape as a trigger that
is never updated.

**Custom sandbox images exist (BYOT).** `doctl harness-runtime template
create --name X --base-template coding-opencode --source-oci-ref
registry.digitalocean.com/reg/img:tag` rebases your image onto the platform
base. Useful for dropping PyPI from the egress allowlist. Not useful for
latency: installing `psycopg[binary]` costs 1.9s of a ~60s run.

## Action Gateway

**A trigger-started session and a session you create run as different
actors.** `doctl harness-runtime create` runs as your DigitalOcean
*username*; a session started by a trigger runs as your account *UUID*.
Action Gateway resolves a connection by actor, so the two see different
connections — a GitHub connection authorized against one is invisible to the
other, and the only symptom is that the tool reports "requires an OAuth
connection" while the connection you are looking at says `active`.

This is the most expensive thing in this document. It means a probe session
cannot validate the credential the demo actually uses, that
`scripts/connect-github.sh` has to target the UUID specifically, and that
anything the app needs an agent to do with a third-party credential has to
go through a trigger rather than a session the app creates. The reset button
is a webhook trigger for exactly this reason.

Check which is which:

```bash
curl -s -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" \
  https://api.digitalocean.com/v2/action-gateway/sessions | \
  jq -r '.sessions[] | "\(.actorId)  \(.name)"'
```

Sessions named `ht-exec-*` are trigger-started.

**A connection's `status` field is wrong in both directions.** It read
`active` for two days while every tool call failed, and read `pending`
through a run that succeeded. It is not a lie you can correct for by
inverting it — the record and the OAuth token behind it simply expire
independently.

Nothing should branch on it. `scripts/check-github.sh` reads the webhook
trigger's own execution history instead, because that is evidence from the
actor that actually runs the demo. A probe session that calls a tool is
worse than the status field, not better: it looks rigorous and tests the
wrong actor.

When the token has expired but the record says `active`, the API refuses to
mint a new authorization link. `DELETE /v2/action-gateway/connections/{id}`
returns the record to `revoked`, after which a `POST` will issue one.

**`preload_tools` removes the discovery step.** Listing tools under
`do.actions` restricts what a session may call; `preload_tools` additionally
hands the model their input schemas, so it calls them directly instead of
running `action_search` first. One fewer round-trip and one fewer failure
mode per run:

```yaml
tools:
  - do.actions:
      tools: [github_create_issue, github_add_issue_labels]
      preload_tools: [github_create_issue, github_add_issue_labels]
```

Tool names in `preload_tools` must be individual tools — Harness Runtime
YAML does not accept toolbelt references there. Use the slug
(`github_create_issue`), not the bare name: `create_issue` also exists in
the Jira and Linear toolkits.

**Permission rules name gateway tools as `do.actions/<tool>`**, and
`enforcement` defaults to `strict` for deny rules — a rule naming a tool the
adapter does not declare fails session creation rather than being ignored.

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
