# Orch v2 Upgrade — Design Spec

Date: 2026-08-31 · Status: rework round 2 (Codex r1 REWORK → r2 FAIL → this
revision) · Baseline: orch v0.6.0 (`2684655`)

## Threat model (governs every enforcement claim)

The hook wall defends against a **sloppy or drifting agent** — one that
forgets the contract, picks a too-cheap tier, or claims done without
evidence. It does NOT defend against an adversarial agent that forges
state, and it does not survive harness faults: **a Claude Code PreToolUse
hook that times out (10 s budget), crashes, or exits non-2 lets the action
through.** Every ENFORCED label below therefore means "verified
independently of agent-written state, *conditional on successful hook
execution*." Gate hooks are written to protect that condition: all script
errors caught and converted to exit 2, no network calls, no unbounded git
operations. Where the operator needs unconditional blocking, the harness's
own permission deny-rules are the tool, not orch hooks — documented in
README.

Label vocabulary: **ENFORCED** (hook verifies against locked config /
repo state) · **ADVISORY** (guardrail that catches drift; spoofable or
bypassable by intent) · **INSTRUCTED** (skill-text rule with no hook).
The status table at the end of this spec labels every mechanism.

## Goal

Four workstreams, shipped in order, each independently releasable:

1. **Contract v2** — domain × model-tier matrix (governance data)
2. **Enforcement** — hook additions that consume it
3. **Coordination** — fleet roster + vehicle abstraction (herdr-pluggable)
4. **Board sync** — one-way BOARD.md → GitHub Issues mirror

Design principle: skills write records at decision time; hooks verify at
action time; hooks **recompute anything security-relevant from locked
config** rather than trusting agent-written records.

## Non-goals

- No coordination runtime (no orca; the harness's `Workflow` tool is the
  DAG engine). No peer-to-peer delegate messaging.
- No tier caps (floors only). No adversarial-grade attestation (trusted-
  runner evidence manifests, hook-owned session state beyond the per-
  session route record) — deferred epic, added per-gate if bypass shows
  up in practice.
- No GitHub → BOARD.md pull, no Projects v2 columns.

---

## 1. Contract v2 — domain × model matrix

Optional per-domain `tiers` block in delegate.md's role vocabulary
(`low | mid | high | frontier`), never model names:

```json
"numerics": { "paths": ["src/..."], "expertise": "...",
  "decide": "ai", "ship": "commit",
  "tiers": { "work": "mid", "review": "high" } }
```

- `work` = floor for implement/edit dispatches. `review` = floor for
  review verdicts — **INSTRUCTED** (the go skill applies it at verdict
  time; no hook can tell a work brief from a review brief).
- Absent `tiers` = today's advisory tier table. No migration needed.
- Strictest-wins across multi-domain matches: **highest** floor.
- **Schema versioning:** new field `contract.schemaVersion: 2`. The
  existing `contract.version` is documented as what it already is — a
  monotonic edit **revision** — and keeps incrementing per edit. Absent
  `schemaVersion` = schema 1 regardless of revision. `schemaVersion: 2`
  is also the **enforcement activation switch** (§ Migration).
- **Lock bundle:** the lock's atomic-replace rule extends from `contract`
  alone to the bundle `{contract, models}`, replaced **wholesale** — no
  key-level merging of project model entries into a locked map. Rank
  order low<mid<high<frontier validated at load; a model name appearing
  at multiple ranks resolves to the highest (fail-strict).
- **Lock failure semantics (r2):** the loader returns
  `{present, corrupt, value}` per locked section instead of erasing
  provenance. Rules: lock present+corrupt → every guard whose locked
  authority is unrecoverable fails **closed** (updating
  `tests/test-lock.js`, which currently pins destructive-guard
  fail-open; CHANGELOG documents the break). Lock carries a tiered
  `contract` but no complete valid `models` map → tier gate fails
  closed ("locked contract requires a locked model map").

Touches: `skills/setup/SKILL.md`, `skills/go/SKILL.md`,
`skills/go/delegate.md`, `hooks/lib/config.js`, README.

## 2. Enforcement hooks

All: `config.js` loader, `appendAudit` on every ALLOW/BLOCK, lockable,
error-trapped to exit 2 (see threat model).

### 2.1 Tier gate — new `hooks/tier-gate.js`

Matchers are **anchored exacts**: `^Agent$`, `^Workflow$`, `^SendMessage$`
(r2 — a bare `Task` dispatch tool does not exist in current Claude Code;
an unanchored `Task` regex would catch `TaskCreate`/`TaskUpdate`).

**Route record (r2 — per-session):**
`<git-common-dir>/orch/route-<sessionId>.json`, atomic write:

```json
{ "lane": "C3", "domains": ["numerics", "hmi"],
  "worklog": "tmp/worklogs/C3-HDS.md",
  "repo": "<toplevel path>", "contractRevision": 7,
  "routedAt": "<iso>" }
```

Written by phase route (the skill instructs domains must equal the
BRIEF's `domains:` line), rewritten on re-route, deleted on lane merge.
Concurrent sessions each own their file; the hook reads only the record
matching the payload's `session_id`. **No floors stored**: the hook
recomputes floors from the locked contract for the named domains and
takes the highest. A mis-named domain in the record can still lower the
computed floor — that record is agent-written, so the tier gate's status
is **ADVISORY overall, ENFORCED for the requested-model-vs-floor
comparison given the routed domains**.

Checks on `Agent` dispatch while this session's record exists and any
matched domain has `tiers`:

- `model` param required — missing/unknown → BLOCK "name the model
  explicitly." Guarantee covers the **requested** model only (runtime
  substitution out of scope, documented).
- requested model → rank via locked `models`; rank < work floor → BLOCK.
- `Workflow` (r2): the hook cannot see per-stage models AND one workflow
  may run up to 16 concurrent agents — on a routed lane, Workflow is
  refused unless the work floor is `low` **and** `fleet.capacity ≥ 16`.
  The spec states this plainly: with the default capacity 6, Workflow is
  unavailable on routed lanes; raising capacity is the operator's call.
- `SendMessage` (r2 — closes the re-brief bypass): the roster stores each
  resident's granted rank at spawn; a `SendMessage` to a roster-known
  resident whose rank is below the session's current work floor → BLOCK
  "resident under-tiered for this route; spawn at floor."
- No route record for this session → ALLOW (not an orch-routed session).

Fleet ceiling (**ADVISORY**): counts non-terminal roster entries; over
`fleet.capacity` (default 6) → BLOCK "park or tear down first." TOCTOU
overshoot-by-one between concurrent sessions accepted and documented. No
roster file → no-op (activates at v0.9.0).

### 2.2 PR gate — extend `hooks/contract-ship-gate.js`

`gh pr create` is a **push-rank ship action**: any touched domain with
`ship: none|commit` blocks PR creation. Accepted grammar (r2): plain
`gh pr create` with only message/title/body/draft/label flags;
`--base`/`--head`/`--repo`/fork forms and any flag the parser doesn't
recognize → fail closed with "operator runs cross-target PRs." Implicit
push offers are refused: push first, then PR.

**Evidence protocol (r2 — commit-bound, two commits):**

1. Work commits land (plain index commits — see §2.3).
2. Ship phase writes the GATE block into the worklog, subject-bound to
   the last work commit, and commits worklog+board together (the
   "evidence commit"):

```
GATE: subject:<code commit SHA>
regression: <suite verdict ref>
metric:     <before → after vs noise band>
rootcause:  <ruling/ADR ref>
```

3. At `gh pr create`, the hook reads the worklog **from HEAD's tree**
   (not the working copy), takes the last GATE block, and verifies:
   `subject:` is an ancestor of HEAD · every commit after `subject`
   touches only worklog/board/ADR paths (evidence-only tail) · all three
   legs non-empty. Any miss → BLOCK naming the leg or the stray commit.

Status: **ENFORCED** for the commit-topology checks; the legs' *truth*
is **ADVISORY** (agent-written worklog — sloppy-agent model).

### 2.3 Evidence-lint — inside `contract-ship-gate.js`'s commit path

(r2 — bound to the actual commit set:) On a commit that flips a
BOARD.md row to `merged`, the evidence must be **in the same commit**:
the check runs against the exact staged index (`git diff --cached`;
pathspec commits resolved from the command line), not `staged ∪ dirty`.
A staged merged-flip without a staged worklog ledger line or an artifact
path in the row → BLOCK. Commits with `-a`/pathspec forms that the
parser cannot resolve to a definite set → BLOCK "stage explicitly."
Status: **ENFORCED** (evidence presence), truth ADVISORY.

### 2.4 Guard locks

**No weakening:** everything `block-destructive-git.js` blocks today
stays blocked by default — stash mutation, force-push (with-lease
included), `reset --hard` unconditionally. New, **opt-in**, in
`hooks/block-destructive-ops.js`: name-scoped process kills
(`taskkill /im`, `Stop-Process -Name`). Documented: regex matching
covers direct shell syntax only (scripts/aliases/native APIs bypass —
ADVISORY by nature).

## 3. Coordination — fleet roster + vehicles

### 3.1 Fleet roster — `<git-common-dir>/orch/fleet.json`

Current-state roster; history lives in the audit log (gains
dispatch/teardown/rebrief entries).

```json
{ "delegates": [ {
  "name": "impl-C3", "lane": "C3", "role": "mid", "vehicle": "native",
  "status": "running|done|failed|torn-down",
  "ownerSessionId": "<id>", "agentId": "<runtime id, bound at start>",
  "brief": "tmp/worklogs/C3-HDS.md#brief-4",
  "createdAt": "<iso>", "lastSeen": "<iso>" } ] }
```

- **Concurrency (r2):** read-modify-write serialized by an exclusive
  lockfile (`O_EXCL` create, bounded retry, stale-lock takeover after
  30 s) — temp+rename alone does not serialize updates. Located in the
  git common dir so all worktrees share it.
- **Lifecycle producers (r2):** entry created at `Agent` PreToolUse
  (reservation); `agentId` bound and `lastSeen` initialized by the
  `SubagentStart` hook event; `lastSeen` refreshed and terminal status
  set by `SubagentStop`; session-end hook marks the session's residents
  `torn-down`. Liveness is **stale-heartbeat inference**, never a
  definitive oracle: `running` + `lastSeen` older than
  `fleet.staleMinutes` (default 60) renders as ghost; `/orch:go` step 1
  offers to prune ghosts, and prunes terminal entries when their lane
  merges.
- Status: **ADVISORY** state (a lost concurrent update is possible; the
  audit log keeps both events).

### 3.2 Vehicles — `workflow.coordinator: "native" | "herdr"` (default native)

| Work shape | native | herdr |
|---|---|---|
| one-shot | `Agent` throwaway | same |
| resident | background `Agent` + `SendMessage`, worklog as memory | herdr pane (`impl-C3`) |
| DAG fan-out | `Workflow` — only with floor `low` AND capacity ≥ 16 (§2.1) | falls back to native |

Herdr delegates register with `vehicle: "herdr"`; herdr launches go
through the shell and bypass the tier gate (**documented, ADVISORY**).
Vehicle adapter contract: {runtime id, context/transcript reader or
`null`, status probe, teardown op}; herdr's context reader is `null`.

### 3.3 Config keys

`fleet.capacity` (ceiling, default 6) and `fleet.staleMinutes` — distinct
from the existing `fleetContext.maxAgents` (polling width, default 12,
unchanged). The roster is an **additional** source for
`fleet-context.js` (native entries resolve transcripts via `agentId`);
its existing discovery scan stays.

### 3.4 Waits & escalation — unchanged

Task notifications + the existing fix-loop ladder. `/orch:board` gains a
`FLEET` footer from the roster; ghosts flagged.

## 4. Board sync — one-way GitHub mirror

BOARD.md canonical; GitHub is a rendering. Push only. Status:
**ADVISORY** end-to-end (external service, non-transactional).

- **Row schema:** fifth column — `C3 | HDS | running | <blocker> | #142`;
  `board.schemaVersion` comment line marks the 5-column form; 4-column
  rows still parse (issue = none).
- Identity: issue body carries `<!-- orch-lane:C3 -->`; before any
  mutation the script verifies repo + marker + `orch:lane` label.
  Duplicate matches → STOP, mutate nothing.
- **Transactionality (r2):** precondition — clean index and clean
  BOARD.md, else refuse. The script mutates a board copy in memory,
  writes remote changes first while journaling each mutation to
  `<common-dir>/orch/sync-journal.jsonl` (idempotent resume after a
  rate-limit or auth failure mid-run), then writes BOARD.md and commits
  **exactly `docs/BOARD.md`** by pathspec via the shared ship-policy
  code path (not a nested un-hooked shell). Cross-clone duplicate
  creation (two machines syncing at once) is documented as possible —
  the local lock only serializes one clone.
- Status change → label swap + one-line comment, only when observed
  remote state differs. `merged` row → close issue with evidence line.
- **Authority:** `board.sync.enabled` honored from the **lock file
  only**; project copy is documentation. The board skill's read-only
  contract gains the explicit carve-out: `sync` writes GitHub + the
  board's issue column, nothing else. Argument-array process execution.
- **First run = adopt mode:** map lanes to issues (create-if-missing),
  NO status comments, NO closures; `--dry-run` prints every intended
  call.

## Sequencing, migration & releases

**Activation switch (r2 — replaces the unimplementable ROUTE-date
grandfather rule):** marker/GATE/tier enforcement activates only when
`contract.schemaVersion == 2`. Flipping it is a deliberate
`/orch:setup` migration step with a preview (which lanes lack markers,
which worklogs lack GATE blocks); until then v0.8 hooks no-op on v1
contracts. In-flight lanes are re-routed (cheap: one route phase) as
part of the migration checklist.

| Release | Ships |
|---|---|
| v0.7.0 | Contract v2: `schemaVersion`, lock bundle + failure semantics, setup interview, docs |
| v0.8.0 | tier-gate (Agent/Workflow/SendMessage), PR gate + evidence protocol, evidence-lint, guard additions; GATE/marker grammar in go skill |
| v0.9.0 | fleet roster + lifecycle hooks, vehicles, fleet-context integration, FLEET footer |
| v0.10.0 | board-sync.js + journal, board `sync` verb, 5-column rows |

## Status table (r2)

| Mechanism | Status | Verified input | Known bypass |
|---|---|---|---|
| tier floor vs requested model | ENFORCED* | locked contract+models, tool_input.model | mis-routed domains in record; herdr; runtime substitution |
| Workflow refusal on tiered routes | ENFORCED* | locked config, capacity | herdr |
| SendMessage resident floor | ENFORCED* | roster rank at spawn | roster is advisory state |
| fleet ceiling | ADVISORY | roster count | TOCTOU, herdr |
| PR gate: ship rank, commit topology | ENFORCED* | locked contract, git graph | wrapper scripts (README limitation) |
| GATE legs' truth | ADVISORY | agent-written worklog | invented refs |
| evidence-lint (presence in commit) | ENFORCED* | staged index | none known at commit time |
| review floor | INSTRUCTED | — | any |
| destructive-git guards | ENFORCED* | command text | scripts/aliases |
| process-kill guards | ADVISORY | command text | scripts/native APIs |
| roster state | ADVISORY | lifecycle hooks | lost concurrent update |
| board sync | ADVISORY | journal + markers | cross-clone race |

\* conditional on successful hook execution (see threat model).

## Testing

Per-hook ALLOW/BLOCK fixture matrices, grammar contract tests, schema
round-trips, plus fault cases: two concurrent sessions (per-session
markers, roster lockfile, sync lock) · lockfile stale-takeover ·
atomic-write interruption · ghost delegates (no SubagentStop) ·
worktree common-dir resolution · omitted/unknown model params ·
Workflow-on-tiered-route at capacity 6 and 16 · SendMessage to
under-tiered resident · GATE subject not-ancestor / non-evidence tail
commit · `-a` and pathspec commits vs evidence-lint · corrupt lock and
partial lock bundle fail-closed (updating `tests/test-lock.js`) ·
hook-crash-→-exit-2 trap test · wrapper-command bypass
documented-not-blocked · duplicate GitHub issues → STOP · sync journal
resume after simulated rate-limit · argument-array quoting. Every
fail-closed path gets a test proving it blocks.

## Review provenance

Codex (gpt-5.6-sol, read-only, fresh context per round):
r1 REWORK (6C/10M/1m) → threat model chosen by operator (sloppy agent,
honest labels), full rework. r2 FAIL (4C/6M/1m on the rework; 9/17 r1
findings RESOLVED, 8 PARTIAL) → this revision: per-session route
records, SendMessage gating, commit-bound two-commit evidence protocol,
hook-execution conditionality, lock failure semantics, Workflow/capacity
contradiction stated, roster lockfile + lifecycle hooks, transactional
sync journal, schemaVersion activation switch, anchored matchers,
status table. Round 3 pending.
