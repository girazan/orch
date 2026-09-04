# Five-Role Orchestration on Herdr — Brainstorm

Date: 2026-09-04 · Status: **brainstorm, operator questions decided**
(§5; no review round yet) · Baseline: orch v0.7.0 (`6043bb4`) · Companion to
`2026-08-31-orch-v2-upgrade-design.md` §3 (Coordination) — this note is
what §3.2's `workflow.coordinator: "herdr"` vehicle could grow into.

## Why this note exists

An external brainstorm (the "Agent orchestration architecture (Herdr)"
artifact, reproduced verbatim in §A) describes a five-role hierarchy —
Director, Coordinator, Architect, Dev, Reviewer — where every AI role
runs as an interactive TUI in a Herdr pane and state lives in shared
files, never in pane scrollback. orch already has most of the *pieces*
(contract, board, worklogs, ADRs, review ladder, delegate tiers, a
herdr-aware fleet watchdog) but arranges them around **one frontier
orchestrator that never delegates a verdict**. The artifact arranges them
around **a cheap, stateless Coordinator that never holds a verdict**.

This note maps one onto the other, names where they genuinely disagree,
proposes what orch should adopt, and records the operator's decisions on
the questions only they could answer (§5). It deliberately does not pick
releases or write hook code.

## 1. Crosswalk — same thing, two vocabularies

| Herdr artifact | orch today | Fit |
|---|---|---|
| Director (human) | operator: `decide: human` domains, YOU lane, ADR ratification via `/orch:setup` | exact |
| Coordinator | `/orch:go` driver (phase pick, dispatch, board writes) | partial — go also holds judgment (§2.1) |
| Architect | `/orch:goal` shaping + go **route** phase + ADR authoring | partial — orch splits it across two skills |
| Dev | delegate implementer, `tiers.work` floor, resident `impl-C<n>` pane (`delegate.md`) | exact |
| Reviewer | review ladder step 2: high tier, different model family, fresh context, verdict-only, READ-ONLY | near — Herdr's reviewer *runs tests* (§2.3) |
| in-session sub-agents | throwaway subagents (`delegate.md` one-shot row) | exact |
| milestone | campaign `C<n>` + BRIEF | exact |
| goal (ordered, acceptance criteria) | ROUTE item (`C<n> \| bucket \| item`) + BRIEF `done:` | partial — ROUTE items have no per-item acceptance criteria |
| `status.md` (under one screen) | `docs/BOARD.md` lane table (detail lives in worklogs) | exact, incl. the size rule |
| `plan.md` (header + one section per goal) | worklog `tmp/worklogs/C<n>-<name>.md` + board `## ROUTE` | partial — plan is split across two files |
| `adr/NNN-*.md`, Director answers filed as ADRs | `docs/adr/NNNN-<slug>.md`, `proposed\|accepted` | exact; Director answer = `accepted` on write |
| `handoffs/<role>-<goal>.md` (≤40 lines) | worklog ledger + session-end handoff (done / next / entry phase / blockers) | **missing as a file** |
| `reviews/<goal>.md` (pass\|fail + blocking reasons) | verdict prose in worklog; C2's proposed `VERIFY:` line | **missing as a file** |
| `blocked` pane → Director attaches | board `blocked` + named unblock-owner + YOU lane item | exact |
| fast path | goal's "clear + small → write BRIEF directly"; route's "mechanical → cheapest tier, single review" | exact |
| `herdr agent start / prompt / wait / read` | fleet-context hook already shells to `herdr agent list/read`; v2 §3.2 vehicle adapter {id, reader, probe, teardown} | plumbing exists, orchestration over it does not |

Reading of the table: the artifact is not a rival design. It is orch's
work phase re-cut so that **each role is a pane, and each hand-back is a
file**. The four things orch lacks are: per-goal acceptance criteria,
handoff files, review files, and a Coordinator that is allowed to be
cheap.

## 2. Where the two designs actually disagree

### 2.1 Who holds judgment

orch `delegate.md`: "The orchestrator (you) always runs frontier-tier
judgment; delegating YOUR verdicts is never allowed." Herdr: the
Coordinator "does not design, implement, or re-review technically"; it
reads `pass | fail` from a file.

These are compatible once you notice the Herdr design moved frontier
judgment *into two panes* (Architect plans, Reviewer judges) and left the
Coordinator as glue. The cost orch pays today is a frontier model doing
dispatch bookkeeping for a whole session; the cost Herdr pays is that no
single agent sees the whole picture.

**Proposal.** Keep both invariants by restating them per role:
- Verdicts are produced only at `tiers.review` or above (Reviewer pane).
- The Coordinator never *produces* a verdict; it *reads* one. It may
  still refuse to act on a malformed one (missing blocking reasons, no
  acceptance-criterion reference) — that is dispatch hygiene, not review.
- INCONCLUSIVE stays tri-state and still goes to the Director (orch rule
  today), which answers "who arbitrates when nobody has the whole
  picture": the human, exactly as the contract already says.

### 2.2 One reviewer vs the dual-reviewer rule

orch: high-consequence hand-backs get a **second** reviewer from a
different model family, fresh context, same rubric; both must PASS.
Herdr: one Reviewer pane per plan or goal.

**Proposal.** Reviewer is one role, one-or-two panes. The route/plan
names the shape (`review: single|dual`) from the contract's
`tiers.review` and the route's consequence class; the Coordinator starts
that many panes. Nothing in the Herdr flow breaks — step 5.3 just says
"panes" instead of "a pane".

### 2.3 Read-only reviewer vs "Reviewer must run tests"

orch's judgment reviewer is READ-ONLY because it *shares the working
tree* with the implementer (`git show`/`git diff` only; never checkout,
stash, or edit). Herdr's reviewer must run tests, not only read — and a
test run is a write to `node_modules`, build dirs, coverage files.

**Proposal.** Split what orch's ladder already splits: the MECHANICAL
step (build + scoped tests + test-quality audit + green-can-go-red) runs
in the **Reviewer pane** but against a **detached `git worktree`** of the
reviewed SHA, so the Reviewer never touches Dev's tree. `block-destructive-git`
already forbids the dangerous alternatives (stash, reset). The
`reviews/<goal>.md` file then carries the runner's verdict line as
evidence — which is exactly what the v2 PR-gate's `GATE: regression:`
leg wants to cite.

### 2.4 No fix-loop cap in the Herdr flow

Herdr step 5.4: "Fail → Dev pane with the review", unbounded. orch: cap
3, stall rule (a surviving finding or an equal-or-higher new finding →
escalate), round 3 = fresh implementer one tier up.

**Proposal.** Keep orch's rule and give it to the Coordinator — it is
dispatch logic, so it lands in the right role for once. The Coordinator
counts rounds from `reviews/<goal>.md` history, not from memory
(statelessness, §2.6).

### 2.5 Shipping is absent from the artifact

The artifact never says who commits or pushes. orch's whole enforcement
story is the ship gate: deny-by-default git, judged on repo state per
contract domain.

**Proposal.** Nothing new to invent. Each Herdr pane is a Claude Code
session with the plugin loaded, so **every pane is hooked
independently**: Dev commits its goal only where the contract grants
`ship: commit` on the touched domains; the Coordinator pushes at
milestone close only under `ship: push`; a Reviewer pane never ships
(§3.2 makes that a hook, not a habit). The v2 evidence protocol (GATE
block bound to the last work commit) is what the Coordinator writes at
step 6.

### 2.6 Coordinator statelessness vs go's "read everything"

Herdr: read `status.md`, take one action, write `status.md`, wait;
restartable at any point. go today: read board, *whole worklog*, all
proposed ADRs, contract — then pick a phase.

go is already close. The gap is the worklog: a Coordinator that reads
the full plan cannot stay under its context budget, and the artifact's
budget table says it never should.

**Proposal.** Coordinator reads `status.md` (board), the *latest*
handoff, the *latest* review. Everything else is fetched by the role that
needs it (Architect reads the codebase; Dev reads its goal section).
This is the strongest argument for handoffs and reviews being **files
with predictable names** rather than blocks inside a growing worklog.

### 2.7 Milestone-shaped `plan.md` vs lane-shaped worklog + board ROUTE

Herdr has one plan per milestone with a goal section each. orch spreads
the same information across the worklog (BRIEF) and the board's ROUTE
section (items across buckets, several lanes at once).

**Proposal.** Do not introduce a third file. Declare: **the worklog *is*
`plan.md`** for its lane — BRIEF on top, then `## Goals` with one section
per goal carrying `accept:` lines (the missing acceptance criteria), then
the ledger. The board's ROUTE stays the cross-lane map; goals and ROUTE
items share a stable id (`M3.G2`) so the board can flip `✓` per goal.
Dev receives only its `## Goals › G2` section plus named ADRs — the
"never reads the full plan" rule holds by construction.

## 3. What orch would adopt

### 3.1 Files

Keep orch's paths (git-tracked board and ADRs are non-negotiable — the
board's `git log` is the campaign journal). Add two directories:

```
docs/BOARD.md                          # = status.md; one screen; per-goal ✓
docs/adr/NNNN-<slug>.md                # unchanged; Director answers → accepted
tmp/worklogs/M<n>-<name>.md            # = plan.md: BRIEF · ## Goals (accept: lines) · ledger
tmp/handoffs/M<n>.G<k>-<role>.md       # ≤40 lines: changed · blocked · decided
docs/reviews/M<n>.G<k>.R<r>.md         # pass|fail · blocking reasons (each cites an accept: line) · notes
```

Reviews are git-tracked because they are the evidence the ship gate and
the v2 GATE block point at; handoffs are scratch (they exist to be read
once by the next role). Decided (§5.4).

**Id grammar (decided, §5.5):** `M<n>` milestone · `M<n>.G<k>` goal ·
`M<n>.G<k>.R<r>` review round — e.g. `M3.G2.R1`. The plan review is
`M<n>.G0.R<r>`. `M` replaces today's `C<n>` lane prefix because the unit
of work is the *milestone*, not the campaign; the campaign→milestone
rename is a vocabulary change across board, goal, go and the grammar
tests (same shape as the v0.4.0 renames), so it ships as its own step
with a legacy-`C<n>` read path, not inside this brainstorm.

### 3.2 Role-scoped guardrails (new; the interesting part)

The Coordinator starts every pane with a role it knows. Pass it down as
`ORCH_ROLE=coordinator|architect|dev|reviewer` in the pane's environment
at `herdr agent start`. Hooks that already run on every tool call can
then read the role and enforce the artifact's "does not" column — the
first time orch could enforce *who* does something, not only *what*.

| Rule from the artifact | Mechanism | Label |
|---|---|---|
| Reviewer "does not fix what it finds" | PreToolUse `Edit\|Write` denied when `ORCH_ROLE=reviewer` (except under `docs/reviews/`); ship gate denies `commit`/`push` for reviewer regardless of contract | ENFORCED* |
| Coordinator "never reads code / full plan" | PreToolUse `Read` outside `docs/BOARD.md`, `tmp/handoffs/`, `docs/reviews/`, `.claude/orch.json` denied for coordinator | ENFORCED* (advisory value: catches drift, not intent) |
| Every role ends by writing its handoff | Stop hook (`session-hygiene` extension): pane with a role and edits but no `tmp/handoffs/<goal>-<role>.md` newer than session start → refuse to stop once, name the file | ENFORCED* |
| Size budgets: status one screen, goal ≤300 lines, handoff ≤40 | Stop-time line counts on the files the session touched | ADVISORY |
| Dev "does not change scope or plan" | Dev denied `Edit\|Write` on the worklog's BRIEF/`## Goals` header and on `docs/BOARD.md`; ledger appends allowed | ENFORCED* for paths, INSTRUCTED for meaning |
| Architect "does not write production code" | Dev-domain paths denied for architect; `docs/adr/`, worklog allowed | ENFORCED* |
| Verdict is `pass\|fail` with reasons tied to acceptance criteria | Coordinator refuses to advance on a review file missing the grammar; test in `test-grammar.js` | INSTRUCTED + grammar test |
| Architect interview cap (five questions) | count `blocked` questions in the pane's handoff; after cap, decide and file ADR with `assumption:` | INSTRUCTED |

\* conditional on successful hook execution — same threat model as the
v2 spec (sloppy agent, not adversary). A pane launched without
`ORCH_ROLE` is today's un-roled session and gets today's behavior, so
this is additive and zero-migration.

### 3.3 Role ↔ tier ↔ model

The artifact names models; orch names roles and pins them once in
`models`. Map, and resolve the artifact's first open point in passing:

| Herdr role | orch tier | effort | Notes |
|---|---|---|---|
| Coordinator | `frontier` (decided, §5.1); candidate for `mid` once §3.2 hooks exist and one milestone has run clean | medium | cheapness is *earned* by the guardrails, not assumed |
| Architect | `frontier` | high | the only role that changes the plan |
| Reviewer | `tiers.review` floor, never below `high`; second pane pinned by a new `models.review-alt` key (decided, §5.3) | high | per §2.2 |
| Dev | `tiers.work` floor ∨ Architect's per-goal `tier:` line — **strictest wins** | as needed | this *is* the "Dev model per goal" answer: Architect proposes in the goal section, contract floors it, Coordinator applies |

### 3.4 Two rubrics, one role (artifact open point 2)

Agree with the recommendation. `skills/go/review-plan.md` (does the
decomposition cover the BRIEF? are `accept:` lines machine-checkable? is
any goal over budget?) and `skills/go/review-goal.md` (today's ladder:
mechanical → test-quality audit → judgment → artifact reality check).
Same Reviewer pane prompt skeleton, different rubric file.

### 3.5 What orch keeps that the artifact dropped

- **Metric + noise band + three-leg merge gate.** Per-goal acceptance
  criteria answer "did we build it"; the BRIEF's `metric:`/`done:`
  answer "did it help". Both stay; goals satisfy acceptance, the
  *milestone* satisfies the merge gate.
- **Kill criteria.** The artifact has none. `kill:` stays in the BRIEF;
  the Coordinator checks it before each goal dispatch.
- **Rulings + audit log.** Every autonomous decision by Coordinator or
  Architect still writes a `Ruling:` line and an audit entry.
- **Contract ADR amendment path** for unmatched domains — the artifact's
  "Architect interviews the Director" is the same mechanism with a
  friendlier name.

## 4. The Herdr flow, restated in orch terms

1. Operator writes the BRIEF via `/orch:goal` (or types the milestone into
   the board header) and starts the Coordinator pane.
2. Coordinator: `herdr agent start architect-M3 --env ORCH_ROLE=architect`,
   prompt = BRIEF + contract excerpt; `wait --until done|blocked`.
3. Architect: research route if a knowledge gap exists; interview (≤5
   questions, each blocks the pane; answers → accepted ADRs); writes
   `## Goals` with `accept:` and `tier:` per goal; writes ADRs; writes
   `tmp/handoffs/M3.G0-architect.md`; done.
4. Coordinator starts Reviewer pane(s) with `review-plan.md`. fail →
   Architect pane with the review file. pass → continue.
5. Per goal `G<k>`, in order:
   1. Kill check against `kill:`; capacity check against the fleet roster.
   2. `herdr agent start impl-M3 --env ORCH_ROLE=dev`, prompt = the
      eight-section brief (`delegate.md`) whose CONTEXT names only
      `## Goals › G<k>` + listed ADRs.
   3. Dev implements, tests, commits if the contract grants it, writes
      handoff, done.
   4. Reviewer pane(s) with `review-goal.md`, on a detached worktree of
      Dev's SHA; writes `docs/reviews/M3.G<k>.R<n>.md`.
   5. fail → round rule from §2.4 (resume ×2, then fresh one tier up,
      then escalate to Director). pass → Coordinator flips the goal `✓`
      on the board and commits the board; tears down both panes.
6. All goals pass → Coordinator runs the milestone merge gate (three
   legs), writes the GATE block, ships per `ship:`, flips the lane
   `merged`, blocks for the Director.

The single-orchestrator mode (today's `/orch:go` in one session) stays
the default. This flow activates behind `workflow.coordinator: "herdr"`,
exactly the switch v2 §3.2 already reserved.

## 5. Operator decisions (2026-09-04)

Asked and answered in one round; recorded here so the next revision does
not reopen them.

1. **Coordinator tier — frontier first.** Lower to `mid` only after the
   §3.2 role-scoped hooks exist and one milestone has run clean under
   them.
2. **One Coordinator per repo.** go's one-session-one-focus rule stays;
   the existing lane focus rule picks which milestone it drives.
3. **Second reviewer family — new `models.review-alt` key.** Pinned once
   in `.claude/orch.json` (e.g. Codex); `review: dual` always uses it.
   Locking a tiered contract locks this key with the rest of the models
   map (v2 lock bundle rule).
4. **Reviews git-tracked, handoffs scratch.** `docs/reviews/` is
   ship-gate evidence; `tmp/handoffs/` is read once and gitignored.
5. **Id grammar `M<n>.G<k>.R<r>`.** Milestone, goal, review round —
   `M3.G2.R1`. `M` replaces `C`; see §3.1 for the rename consequence.
6. **Feed the v2 fleet roster, do not replace it.** Every
   `herdr agent start` also writes a roster entry with `vehicle: "herdr"`
   and the role, so `/orch:board`'s FLEET footer shows panes and roles.

Still open (not asked; surfaced by the decisions): whether the
campaign→milestone rename lands before or with the first `M`-numbered
board, and whether `G0` is the right home for the plan review.

## 6. What would prove this is right

Before any hook is written: run one real milestone by hand — Coordinator
as a human typing the `herdr` commands, the four AI roles as panes with
`ORCH_ROLE` set but nothing enforcing it. Count: how many times a role
crossed its "does not" column; how many lines each handoff needed;
whether the Coordinator ever *needed* the full plan. Those three numbers
decide §3.2's priority order and §5.1's answer. Log them in this lane's
worklog as the brainstorm's first ledger line.

---

## A. Input — the artifact, verbatim

> # Agent orchestration architecture (Herdr)
>
> ## Summary
>
> A five-role hierarchy for delivering software milestones with AI agents. Herdr is the substrate: each role except the human runs as an interactive TUI in a Herdr pane, and the Coordinator drives the others through the Herdr CLI (start, prompt, wait, read). State lives in shared files, never in pane scrollback. Dev is the lowest Herdr-level session; anything below Dev is an in-session sub-agent.
>
> ## Roles
>
> | Role | Runtime | Effort | Owns | Does not |
> |---|---|---|---|---|
> | Director (human) | Attaches to panes | — | Direction, priorities, scope, irreversible decisions | Route tasks or review code |
> | Coordinator | Herdr pane, Fable 5.1 | medium | Dispatch, gating, milestone status | Design, implement, or re-review technically |
> | Architect | Herdr pane, Fable 5.1 | high | Research, decomposition, plan, ADRs | Write production code |
> | Dev | Herdr pane, goal-sized | as needed | Implementing one goal, tests, handoff note | Change scope or plan |
> | Reviewer | Ephemeral Herdr pane, Opus or Codex | high | Verdict on a plan or a goal | Fix what it finds |
>
> Dev may spawn in-session sub-agents for exploration or parallel edits. Sub-agents return short findings; they never receive the full plan or write handoffs.
>
> ## Communication
>
> **Herdr carries signals and prompts.**
> - Coordinator uses `herdr agent start` to open a role pane, sends the prompt, then `herdr agent wait --until done` (or `blocked`).
> - After a wait resolves, the Coordinator reads the role's handoff file, not the pane. Pane reads (`herdr pane read --lines N`) are for debugging only.
> - Any agent that needs the Director stops and asks a question. Herdr marks the pane `blocked`; the Director attaches, answers, detaches. There is no other escalation channel.
>
> **Files carry state.**
> ```
> .orchestration/
>   status.md        # milestone, current goal, blockers — under one screen
>   plan.md          # header (goals, order, status) + one section per goal
>   adr/NNN-*.md     # decisions, including Director answers to Architect questions
>   handoffs/
>     <role>-<goal>.md   # what changed, what is blocked, what was decided
>   reviews/
>     <goal>.md      # pass | fail, blocking reasons, non-blocking notes
> ```
>
> ## Flow
>
> 1. Director writes a milestone into `status.md` and prompts the Coordinator.
> 2. Coordinator starts the Architect pane with the milestone.
> 3. Architect researches, interviews the Director if needed (blocks; answers go into an ADR), writes `plan.md` decomposed into ordered goals with acceptance criteria, writes ADRs, then writes a handoff and finishes.
> 4. Coordinator starts a Reviewer pane for the plan. Fail → back to Architect with the review. Pass → continue.
> 5. For each goal in order:
>    1. Coordinator starts a Dev pane with the goal section only, plus relevant ADRs.
>    2. Dev implements, runs tests, writes a handoff, finishes.
>    3. Coordinator starts a Reviewer pane with the goal section, the diff, and the handoff. Reviewer runs tests and returns a verdict.
>    4. Fail → Dev pane with the review. Pass → Coordinator updates `status.md`, closes both panes.
> 6. When all goals pass, Coordinator writes the milestone summary and blocks for the Director.
>
> **Fast path.** For a small, well-understood goal the Coordinator may skip the Architect and go directly to Dev. The goal must still have written acceptance criteria and still goes through review.
>
> ## Contract
>
> - **Escalation.** Architect decides reversible technical questions alone and records them in an ADR. Scope, priority, cost, and irreversible choices go to the Director. Architect interviews are capped (e.g. five questions); after the cap it decides and records assumptions.
> - **Handoffs.** Every role ends by writing its handoff file. No role forwards another role's output into a prompt; the next role reads files on demand.
> - **Size budgets.** `status.md` under one screen. A goal section under ~300 lines. A handoff under ~40 lines. If a goal cannot fit, the Architect split it wrong.
> - **Review.** Verdict is `pass` or `fail`. Fail requires blocking reasons tied to acceptance criteria. Reviewer must run tests, not only read. Non-blocking notes are recorded but do not fail the goal.
> - **Coordinator statelessness.** The Coordinator reads `status.md`, takes one action, writes `status.md`, and waits. It may be restarted at any point without loss.
> - **Done.** A goal is done when its review passes. A milestone is done when all goals pass and the Director acknowledges.
>
> ## Context budget per role
>
> | Role | Reads | Never reads |
> |---|---|---|
> | Coordinator | `status.md`, latest handoff, latest review | Full plan, code, pane scrollback |
> | Architect | Milestone, codebase (via research), prior ADRs | Other goals' handoffs |
> | Dev | Its goal section, relevant ADRs, files it edits | Full plan, other goals |
> | Reviewer | Goal section, diff, handoff, tests output | Unrelated repo areas |
>
> ## Open points
>
> - Choice of Dev model per goal (fixed vs picked by Coordinator).
> - Whether the Reviewer for plans and for code should have different rubrics (recommended: yes, two prompt templates, one role).
> - Herdr-specific plumbing can be borrowed from the existing `herdr-orchestration` skill rather than rewritten.
