# Five-Role Orchestration on Herdr — Brainstorm

Date: 2026-09-04 · Status: **brainstorm r2** — operator decisions in §5;
r2 re-cuts the unit of work (goal = lane, milestone = board header) and
splits review into an in-session checker and an independent gate, both
launched from the working session (§2.8, r2.1); r2.2 adds steps for big
goals with gate review per step (§2.7); r2.3 closes the open questions
(§5.11–15) and adds recipes (§7); r2.4 gives milestones a command (§5.16); r2.5 records the project hierarchy (§8); r2.6 the skill routing map (§9); r2.7 domains = features, prioritise verb, no sixth command (§5.18–20); r2.8 loop vehicle, pulse line, no-progress rule, fresh Dev per step (§5.21–24). Written against origin/main;
local main's `board-gh` work (GitHub Issues as the board) is referenced
where vocabulary overlaps.
No review round yet · Baseline: orch v0.7.0 (`6043bb4`) · Companion to
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
| milestone | the board **header line** (long-horizon objective) | exact — r2: not a lane |
| goal (ordered, acceptance criteria) | a **lane**: campaign `C<n>` + BRIEF (`done:` is the acceptance criterion) | exact — r2: goal = lane (§2.7) |
| `status.md` (under one screen) | `docs/BOARD.md` lane table (detail lives in worklogs) | exact, incl. the size rule |
| `plan.md` (header + one section per goal) | board lane table (which goals) + one worklog per goal (`tmp/worklogs/C<n>-<name>.md`) | exact once goal = lane |
| `adr/NNN-*.md`, Director answers filed as ADRs | `docs/adr/NNNN-<slug>.md`, `proposed\|accepted` | exact; Director answer = `accepted` on write |
| `handoffs/<role>-<goal>.md` (≤40 lines) | worklog ledger + session-end handoff (done / next / entry phase / blockers) | **missing as a file** |
| `reviews/<goal>.md` (pass\|fail + blocking reasons) | verdict prose in worklog; C2's proposed `VERIFY:` line | **missing as a file** |
| `blocked` pane → Director attaches | board `blocked` + named unblock-owner + YOU lane item | exact |
| fast path | goal's "clear + small → write BRIEF directly"; route's "mechanical → cheapest tier, single review" | exact |
| `herdr agent start / prompt / wait / read` | fleet-context hook already shells to `herdr agent list/read`; v2 §3.2 vehicle adapter {id, reader, probe, teardown} | plumbing exists, orchestration over it does not |

Reading of the table: the artifact is not a rival design. It is orch's
work phase re-cut so that **each role is a pane, and each hand-back is a
file**. The three things orch lacks are: handoff files, review files,
and a Coordinator that is allowed to be cheap. (r1 listed per-goal
acceptance criteria as a fourth; with goal = lane the BRIEF's `done:`
line already is one.)

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
(statelessness, §2.6). r2.3, from Ralphinho: the hand-back to Dev
carries the review file **plus** the failing test output and any
conflict context — never the verdict alone, never a bare retry.

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

### 2.7 Milestone-shaped `plan.md` vs lane-shaped worklog (r2: goal = lane)

Herdr has one plan per milestone with a goal section each, and its
Architect decomposes the milestone. r1 mirrored that: milestone = lane,
goals = sub-sections of the worklog. The operator's correction: a
milestone is a **long-horizon objective**; everything the Coordinator
dispatches to a Dev is goal-sized; therefore **goal ≈ lane**.

That is orch as it already exists. A lane with a BRIEF is goal-sized —
one `goal:`, one `done:`, one `kill:` — and the board header line
(`ORCH BOARD · orch · make orch learn from what ships…`) is already the
long-horizon objective. So:

- **Milestone = board header**, `M<n> · <objective>`. Owned by the
  Director: scope and priority are theirs by contract. One active
  milestone per board; a milestone changes when the header changes.
- **Goal = lane**, what `/orch:goal` creates today. The BRIEF is the
  goal section; `done:` is its acceptance criterion; the worklog is its
  plan and ledger. No `## Goals` sub-structure, no third file.
- **Decomposing a milestone into goals is a Director act.** The
  Coordinator may *propose* the next goal (a proposed ADR or a YOU-lane
  item, exactly today's parking mechanism); it never creates a lane on
  its own.
- **The Architect is goal-sized and optional.** It shapes one lane when
  the goal is fuzzy or big — which is the goal skill's shaping route
  today (fuzzy → brainstorming; clear + big → plan section; clear +
  small → BRIEF directly; debugging → no shaping at all). Herdr's
  "Architect plans the whole milestone" step disappears.

Dev still receives only its lane's BRIEF plus named ADRs — the "never
reads the full plan" rule now holds because the full plan is the board,
and Dev never reads the board.

**Big goals: steps (r2.2, decided §5.9–5.10).** A goal may be small,
big, or open-ended. All three are one lane; what changes is whether the
lane has **steps**:

| Goal shape | Architect | Plan section | Unit of review |
|---|---|---|---|
| small (clear, fits one Dev context) | none | none | the goal: `M1.G3.R<r>` |
| big (clear, too big for one context) | mandatory | ordered steps `S1…Sn`, each with an `accept:` line and `-> outcome`; the last step's `accept:` *is* the BRIEF's `done:` | **the step**: `M1.G3.S2.R<r>` |
| open-ended ("either, but iterative") | mandatory | two lists: `steps` (sharp, each with `accept:`) and `fog` (suspected decisions not yet sharp — Wayfinder's "not yet specified"); after each step passes, the Architect (or Dev, when cheap) graduates fog into the next step; a step may carry `decide: human` (HITL) at step level | the step |

- A step is a **board item** — on the GitHub board that main ships
  (`board-gh`), it is one sub-issue of the goal issue, and the last one
  carries the `gate:` marker. `S<k>` is the step's ordinal inside the
  goal, so a review file reads without opening GitHub.
- Dev is a **fresh pane per step** by default (§5.24): context reset
  each step, the worklog as memory between them; resident only across
  fix rounds 1–2 inside a step, or when `delegate.md`'s asset-or-
  liability rule says its context is worth keeping. Step commits land
  where the contract grants `ship: commit`.
- The **gate review runs per step**, which is the whole point: every
  reviewed diff stays small, the three-round cap has a chance, and a
  failed step stops the lane before the next step builds on it. The
  **merge gate runs once**, at goal end, on the BRIEF's metric.
- The plan review `R0` checks the split itself: steps ordered, each
  fits one Dev context, the last `accept:` equals `done:`.
- **Too big even for steps** — the size budget is the tripwire: a plan
  section that cannot stay under ~300 lines or needs more than ~7 steps
  is not one goal. The Architect then proposes a split into several
  lanes under the same milestone in its handoff, as a proposed ADR; the
  Director approves (creating lanes is theirs, §5.7). Herdr's rule
  applies one level down: if a *step* cannot fit, the Architect split
  it wrong.

### 2.8 Review: in-session checker vs independent gate (r2)

Operator's point: Dev works TDD-style once the spec is fixed, and an
Architect debugging a plan needs fast iteration; a Reviewer pane per
round is too slow for that inner loop, so the reviewer should be spawned
in-session by Dev and by the Architect.

Agreed — with one distinction that keeps orch's first-line thesis (*two
independent readers*) intact: **launched by** and **briefed by** are
separable. `delegate.md`'s rule that subagents never spawn their own
reviewers exists because a reviewer briefed by the one being judged
inherits its framing, and the judged party then reads its own verdict
as it likes. Neither problem is about which process forks the reviewer.
So both review kinds are launched from inside Dev's or the Architect's
session; what differs is who writes the brief and what the output may
touch (decided, §5.8):

| | Checker (inner loop) | Gate reviewer |
|---|---|---|
| launched by | Dev or Architect, in-session, as often as wanted | Dev or Architect, in-session, when they believe the goal (or plan) is done |
| briefed by | the caller, freely | **nobody** — a fixed command, `orch review G<k>` (`--plan` for `R0`), assembles the brief: rubric file, `git diff <base>..<sha>`, the handoff, the BRIEF; the caller's only input is "I'm ready" |
| runtime | throwaway subagent; any tier; may share the caller's framing | fresh context spawned by the command with `ORCH_ROLE=reviewer` overriding the parent pane's role; `tiers.review` floor; second reviewer from `models.review-alt` when the route says `dual`; no pane (nobody attaches to a reviewer; INCONCLUSIVE reaches the Director through the file) |
| rubric | whatever the caller asks: run the suite, red-green check, "poke at this diff" | `review-goal.md` / `review-plan.md` (§3.4), tests on a detached worktree (§2.3) |
| output | advice in the caller's context; ledger line at most | `docs/reviews/M<n>.G<k>.R<r>.md` — Dev reads it to fix on fail; the Coordinator reads it to flip on pass and counts rounds from the files |
| status | ADVISORY — review as a *tool* | the *gate* — flips the lane, cited by the ship gate |

What this buys: no Coordinator round trip between "done" and "judged",
so the inner loop stays fast, and the Coordinator gets *more* stateless —
it reacts to review files appearing rather than scheduling reviews.
What it costs: the fixed command is now load-bearing. It must be the
only path that runs with `ORCH_ROLE=reviewer`, and its brief template
must not accept caller text. Both are testable.

The role guardrail (§3.2) is what makes this a mechanism rather than a
habit: a checker spawned inside a dev-role pane inherits `ORCH_ROLE=dev`,
so the hook denies it (and Dev) any write under `docs/reviews/`. Only
the process the review command spawns carries the reviewer role, and
only it can produce the file the Coordinator reads.

## 3. What orch would adopt

### 3.1 Files

Keep orch's paths (git-tracked board and ADRs are non-negotiable — the
board's `git log` is the goal journal). Add two directories:

```
docs/BOARD.md  → on main: GitHub board # milestone → goal issue G<n> → items (steps); `board-gh read` is the one-screen view
docs/adr/NNNN-<slug>.md                # unchanged; Director answers → accepted
tmp/worklogs/G<k>-<name>.md            # the goal's plan: BRIEF · (optional plan section) · ledger
tmp/handoffs/M<n>.G<k>[.S<j>]-<role>.md   # ≤40 lines: changed · blocked · decided
docs/reviews/M<n>.G<k>[.S<j>].R<r>.md     # pass|fail · blocking reasons (each cites done: or the step's accept:) · notes
```

Reviews are git-tracked because they are the evidence the ship gate and
the v2 GATE block point at; handoffs are scratch (they exist to be read
once by the next role). Decided (§5.4). With goal = lane both multiply
per lane rather than per sub-goal — fine for reviews, and one more
reason handoffs stay scratch.

**Id grammar (decided §5.5, amended §5.7 and §5.10):** `M<n>` milestone
· `G<k>` goal = lane (the goal issue's number on the GitHub board —
global, never reused) · `S<j>` step (ordinal inside the goal; only for
goals with a plan section) · `R<r>` review round. Examples: `M1.G3.R2`
(small goal, second review) · `M1.G3.S2.R1` (big goal, step 2, first
review) · `M1.G3.R0` (plan review). **Rename consequence (r2.2):** main
already ships lanes as `G<n>` and the milestone as GitHub's Milestone,
so nothing renames on the lane side. One conflict remains: main titles
milestones `C<n> …`, this spec says `M<n>` — see Still open.

### 3.2 Role-scoped guardrails (new; the interesting part)

The Coordinator starts every pane with a role it knows. Pass it down as
`ORCH_ROLE=coordinator|architect|dev|reviewer` in the pane's environment
at `herdr agent start`. Hooks that already run on every tool call can
then read the role and enforce the artifact's "does not" column — the
first time orch could enforce *who* does something, not only *what*.

| Rule | Mechanism | Label |
|---|---|---|
| Reviewer "does not fix what it finds" | PreToolUse `Edit\|Write` denied when `ORCH_ROLE=reviewer` (except under `docs/reviews/`); ship gate denies `commit`/`push` for reviewer regardless of contract | ENFORCED* |
| Only the gate reviewer writes a verdict (r2, §2.8) | `Edit\|Write` under `docs/reviews/` denied for every role but `reviewer`; a checker subagent inherits its parent pane's role; only `orch review` sets `ORCH_ROLE=reviewer`, with a brief template that takes no caller text | ENFORCED* (role) · INSTRUCTED + test (template) |
| Coordinator "never reads code / full plan" | PreToolUse `Read` outside `docs/BOARD.md`, `tmp/handoffs/`, `docs/reviews/`, `.claude/orch.json` denied for coordinator | ENFORCED* (advisory value: catches drift, not intent) |
| Every role ends by writing its handoff | Stop hook (`session-hygiene` extension): pane with a role and edits but no `tmp/handoffs/<goal>-<role>.md` newer than session start → refuse to stop once, name the file | ENFORCED* |
| Size budgets: board one screen, worklog plan section ≤300 lines / ≤7 steps, handoff ≤40 | Stop-time line counts on the files the session touched; over budget → "not one goal, propose a lane split" | ADVISORY |
| Dev "does not change scope or plan" | Dev denied `Edit\|Write` on the worklog's BRIEF block and on `docs/BOARD.md`; ledger appends allowed | ENFORCED* for paths, INSTRUCTED for meaning |
| Architect "does not write production code" | Dev-domain paths denied for architect; `docs/adr/`, worklog allowed | ENFORCED* |
| Verdict is `pass\|fail` with reasons tied to `done:` / plan steps | Coordinator refuses to advance on a review file missing the grammar; test in `test-grammar.js` | INSTRUCTED + grammar test |
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
| Architect | `frontier` | high | goal-sized, optional (§2.7); the only role that changes a BRIEF |
| Gate reviewer | `tiers.review` floor, never below `high`; second from `models.review-alt` (decided, §5.3) | high | launched from Dev's or the Architect's session via `orch review`, never briefed by them (§2.8) |
| Checker | any tier the caller picks | — | in-session tool of Dev/Architect; advisory (§2.8) |
| Dev | `tiers.work` floor ∨ the BRIEF's ROUTE `tier:` — **strictest wins** | as needed | this *is* the "Dev model per goal" answer: route phase proposes, contract floors it, Coordinator applies |

### 3.4 Two rubrics, one role (artifact open point 2)

Agree with the recommendation. `skills/go/review-plan.md` (does the
shaped plan cover the BRIEF? is `done:` machine-checkable? is the plan
section over budget?) — used as `R0` only for goals the Architect
shaped — and `skills/go/review-goal.md` (today's ladder: mechanical →
test-quality audit → judgment → artifact reality check). Same gate
reviewer prompt skeleton, different rubric file.

### 3.5 What orch keeps that the artifact dropped

- **Metric + noise band + three-leg merge gate.** `done:` answers "did
  we build it"; `metric:` with its noise band answers "did it help". A
  goal passes review on the first and passes the merge gate on the
  second before its lane flips `merged`.
- **Kill criteria.** The artifact has none. `kill:` stays in the BRIEF;
  the Coordinator checks it before each dispatch.
- **Rulings + audit log.** Every autonomous decision by Coordinator or
  Architect still writes a `Ruling:` line and an audit entry.
- **Contract ADR amendment path** for unmatched domains — the artifact's
  "Architect interviews the Director" is the same mechanism with a
  friendlier name.

## 4. The Herdr flow, restated in orch terms (r2)

1. Director sets the milestone: the board header, `M1 · <objective>`.
   Director creates goals as lanes via `/orch:goal` (the Coordinator may
   propose the next one; only the Director creates it) and starts the
   Coordinator pane, one per repo.
2. Coordinator picks the focus lane `G<k>` by today's rule (named lane >
   most recently touched worklog > first non-blocked). Kill check against
   `kill:`; capacity check against the fleet roster.
3. **Shape, only if needed.** Fuzzy or big goal →
   `herdr agent start architect-G<k> --env ORCH_ROLE=architect`. The
   Architect researches, interviews (≤5 questions, each blocks the
   pane; answers → accepted ADRs), writes the plan section into the
   worklog and its ADRs, may spawn checkers while it iterates, then runs
   `orch review G<k> --plan` → `docs/reviews/M1.G<k>.R0.md`; fail → it
   revises and re-runs; pass → it writes
   `tmp/handoffs/M1.G<k>-architect.md`, done. Clear or debugging goal →
   skip this step entirely.
4. `herdr agent start impl-G<k> --env ORCH_ROLE=dev`, prompt = the
   eight-section brief (`delegate.md`) whose CONTEXT names only this
   lane's worklog + listed ADRs and whose MUST DO opens with the step's
   `recipe:` stages (§7). Dev implements TDD-style, spawning
   checkers as it likes, commits where the contract grants `ship:
   commit`, writes its handoff, then runs `orch review G<k>` — for a
   goal with steps, per step: `orch review G<k> --step S<j>` after each.
5. The command spawns the gate reviewer(s) with `ORCH_ROLE=reviewer`
   (`review-goal.md`, detached worktree of Dev's SHA, second reviewer
   from `review-alt` when the route says `dual`) →
   `docs/reviews/M1.G<k>[.S<j>].R<r>.md`. Dev waits for the file.
6. fail → Dev reads the file and fixes; round rule from §2.4 applies
   per step (the Coordinator counts rounds from the files: resume ×2,
   then fresh Dev one tier up, then stall → Director). pass on a step →
   the Coordinator ticks the board item and Dev moves to the next step
   (open-ended goals: the Architect appends one first). pass on the
   last step, or on a small goal → Dev's handoff says so and Dev
   finishes; the Coordinator reads the review, runs the merge gate
   (three legs, once per goal) on this lane, writes the GATE block,
   ships per `ship:`, closes the goal, tears the panes down.
7. Coordinator proposes the next goal or, when the milestone's goals are
   all `merged`, writes the milestone summary against the Milestone's
   `done:` line and blocks. The Director closes it with
   `/orch:milestone close` (§5.16).

The single-orchestrator mode (today's `/orch:go` in one session) stays
the default. This flow activates behind `workflow.coordinator: "herdr"`,
exactly the switch v2 §3.2 already reserved.

## 5. Operator decisions (2026-09-04)

Asked and answered; recorded here so the next revision does not reopen
them. 7 and 8 came from the operator's r2 review of r1.

1. **Coordinator tier — frontier first.** Lower to `mid` only after the
   §3.2 role-scoped hooks exist and one milestone has run clean under
   them.
2. **One Coordinator per repo.** go's one-session-one-focus rule stays;
   the existing lane focus rule picks which goal it drives.
3. **Second reviewer family — new `models.review-alt` key.** Pinned once
   in `.claude/orch.json` (e.g. Codex); `review: dual` always uses it.
   Locking a tiered contract locks this key with the rest of the models
   map (v2 lock bundle rule).
4. **Reviews git-tracked, handoffs scratch.** `docs/reviews/` is
   ship-gate evidence; `tmp/handoffs/` is read once and gitignored.
5. **Id grammar `M<n>.G<k>.R<r>`.** Milestone, goal, review round —
   `M1.G3.R2`. Amended by 7: `M` is the board header, `G` the lane.
6. **Feed the v2 fleet roster, do not replace it.** Every
   `herdr agent start` also writes a roster entry with `vehicle: "herdr"`
   and the role, so `/orch:board`'s FLEET footer shows panes and roles.
7. **Goal = lane; milestone = board header (r2).** A milestone is the
   long-horizon objective; everything the Coordinator dispatches is
   goal-sized. The Architect is goal-sized and optional. Lanes rename
   `C<n>` → `G<n>`; `M<n>` is added to the header.
8. **Review splits into checker and gate (r2, amended r2.1).** Dev and
   Architect spawn in-session checkers freely (advisory). The gate
   reviewer is *launched* from their session too, via a fixed
   `orch review` command they cannot brief; it runs with
   `ORCH_ROLE=reviewer`, needs no pane, and is the only writer of
   `docs/reviews/` — enforced by the role hook. Chosen over
   Coordinator-launched (slower) and Dev-briefed (no independent
   reader).
9. **Big goals get steps; gate review per step, merge gate once per goal
   (r2.2).** A step is a board item (sub-issue). Dev is a resident pane
   working steps in order. Open-ended goals write the first few steps
   and append as they go. Over ~300 lines or ~7 steps → not one goal,
   propose a lane split to the Director.
10. **Id gains a step level: `M<n>.G<k>.S<j>.R<r>` (r2.2).** `S` =
   step, the ordinal of the item inside the goal. Small goals omit it.

11. **Milestone prefix is `M<n>` (r2.3).** main's `board-gh` currently
   titles milestones `C<n> …`; that changes to `M<n>` in board-gh, the
   go and goal skills, and the README glossary — one small commit on
   main, owner's (YOU-lane item, not done here).
12. **Plan review stays `R0` (r2.3).** Code rounds start at `R1`;
   unshaped goals simply have no `R0`.
13. **`orch review` registers its reviewer in the fleet roster (r2.3).**
   Role `reviewer`, entry written at spawn, removed on exit — visible in
   the FLEET footer and to the fleet-context watchdog.
14. **`S<j>` is the step's ordinal in the plan section (r2.3).** Readable
   and sortable; inserting or reordering steps does not renumber
   existing review files (they keep the number they were written with).
15. **Recipes are in: §7 (r2.3).** Seven one-page recipes selected per
   goal or step at route time; stages map to installed skills; gates
   and hooks are recipe-independent.
16. **Milestones get a home: `/orch:milestone` (r2.4).** Director-only
   fifth command; refused in any pane with `ORCH_ROLE` set. A milestone
   is exactly three fields on the GitHub Milestone — title
   `M<n> · <objective>`, description `target: <date> · done:
   <observable>`, due date — and nothing else: no brief, metric, kill
   line or review (those are goal-level). Verbs: `define` (three-question
   interview → writes the Milestone; the board-gh `add-milestone` verb
   underneath), `split` (proposes ordered candidate goals with a rough
   size, creates nothing; each accepted one is handed to `/orch:goal`),
   `close` (shows the Coordinator's summary against `done:`, closes the
   Milestone on acknowledgement — the flow's step 7 finally has an
   ending). README: "five commands — three act on work, one on scope,
   one looks."
   r2.5 additions: `split` seeds candidate goals from the Project's
   **Feature** options (a feature is a noun, a goal is a change with a
   `done:` line — one feature may need two goals, one goal may cut
   across features); the BRIEF gains a `feature: <option>` line that
   step items inherit at `add-item` unless overridden; step items gain
   `accept:` and `recipe:` body lines beside today's `outcome:` and
   `gate:`, so acceptance criterion and workflow type live on GitHub,
   not only in the worklog. See §8 for the full hierarchy.
17. **Skill routing is one map keyed by stage (r2.6).** `workflow.prefer`
   + `workflow.tools`; explicit → preferred installed → native; resolved
   skill recorded in the ROUTE line; gate rubric extended never
   replaced; Coordinator has no row. Table in §9.
18. **Domains are features — one vocabulary (r2.7).** The contract's
   domain names ARE the Project's Feature options. Contract is the
   source, board the mirror: `/orch:board init` seeds Feature options
   from domain names; `/orch:setup` adding or renaming a domain updates
   the option; nobody edits Feature options by hand. The BRIEF's
   `feature:` is its primary `domains:` entry; a goal spanning several
   domains names the primary on the goal and each step item carries its
   own Feature. Route classification (paths, expertise, strictest-wins)
   is unchanged. (Operator's call over a two-vocabulary bridge; the
   cost accepted: a feature rename is a contract edit + lock update.)
19. **Reprioritising (r2.7).** Steps within a goal: `board-gh move
   <item> --bucket …` (exists) — Architect at plan time, Coordinator when
   fog graduates. Goals within a milestone: `/orch:milestone prioritize`
   — Director's; writes the order as the goals' Priority values, and
   the Coordinator's lane-pick rule reads that order before
   "most recently touched".
20. **No sixth command (r2.7).** One command per *who*, verbs for *what*:
   setup = contract · milestone = scope · goal = one piece of work · go =
   drive · board = look. Recipes are never commands (a `/orch:tdd` would
   skip the route phase where the contract check lives). `orch review`
   stays a script, not a skill, so nobody can brief it.
21. **Heartbeat vehicle for the Coordinator (r2.8).** `workflow.coordinator`
   gains a third value: `native | loop | herdr`. `loop` = `/loop <interval>
   /orch:go` in a plain session — a stateless Coordinator with no Herdr;
   the cheapest way to run the §6 hand-run. (From explainx's
   loop-orchestrator: a heartbeat is a persistent presence returning to
   the same standing context with durable memory, not a cron job.)
22. **Pulse line (r2.8).** Every Coordinator tick appends one audit entry
   `{ts, by:"pulse", lane, action|"idle"}` — including "nothing to do" —
   so silence is distinguishable from death. `/orch:board`'s stale flag
   reads last-pulse age, not last-edit age. Pulses never ticket noise:
   surface, don't auto-act.
23. **No-progress detection (r2.8).** Loop preflight item 6 and a fix-loop
   rule: the same error text, an empty diff, or the same failing test
   twice in a row → stop and park (loop) / escalate (fix loop). Broader
   than the stall rule, which only sees review findings.
24. **Fresh Dev per step (r2.8).** Default flipped: a big goal gets a
   fresh Dev pane per step with the worklog as memory (Ralph-style
   context reset, progress on disk); the pane is resident only across
   fix rounds 1–2 within a step. `delegate.md`'s asset-or-liability rule
   still allows carrying a pane over when its context is an asset.
   Cost stated plainly: parallel loops trade the Director's flow for
   steady stress — the touchpoint list in §4 is the mitigation.

Nothing surfaced by the decisions is still open. What the hand-run in
§6 should still measure is listed there.

## 7. Recipes — the workflow type is a route-time choice (r2.3)

Studied for this section: ECC (`affaan-m/ECC`, in particular its
`autonomous-loops` skill and the Ralphinho DAG) and `mattpocock/skills`
(`implement`, `tdd`, `diagnosing-bugs`, `wayfinder`, `triage`). They sit
at different layers: Pocock's repo is **disciplines** (small,
model-invoked, one kind of work each; user-invoked commands merely
sequence them), ECC is a **catalog and harness OS** (286 skills, rules,
hooks, learning) whose one transferable idea is Ralphinho's *pipeline
depth chosen by unit complexity*; orch is **governance**. orch's
lineage already credits both. The combination that respects all three:

**A recipe is the named sequence of stages between the BRIEF and the
gate.** It is chosen per goal, or per step of a big goal, in the route
phase, and written into the ROUTE line as `recipe:<name>`. It changes
*what the working role does* and *what the gate rubric adds*. It never
changes what orch enforces: contract and ship gate, role hooks, gate
reviewer independence, review files, ids, size budgets are identical
under every recipe.

| recipe | shape it fits | stages (BRIEF → gate) | gate rubric adds | evidence in the ledger |
|---|---|---|---|---|
| `spec` | fuzzy or big; spec-driven | brainstorm/grill → spec → `R0` plan review → steps | plan covers `done:`; each step's `accept:` machine-checkable | plan section, `R0` file |
| `tdd` | clear behaviour, testable seams | red test at the agreed seam → green → refactor | green-can-go-red (revert fix, test must fail) | the red run's output before the green |
| `iterate` | a number to move, cause unknown | hypothesis (written first) → change → measure → keep\|revert\|flat | delta outside the noise band; `⚠complexity` weighed | `iter <n> · before → after` lines (today's ledger grammar) |
| `debug` | something is broken | reproduce → hypothesis → bisect/inspect → fix → regression test | a test that was **red before the fix** exists; root cause named, no band-aid | the repro command + its output, red then green |
| `research` | knowledge gap | search → grade sources → findings note | sources cited and graded; no code changed | `research:` section in the worklog |
| `cleanup` | slop after a feature landed | separate pass, separate agent: remove redundant checks, dead code, tests of the language | behaviour preserved: existing tests unchanged and green; the diff **deletes** | test verdict line, `-`/`+` line counts |
| `fast` | trivial, spec-complete | implement → test | — (mechanical step only) | test verdict line |

Rules that keep this from becoming a catalog:

- **One page per recipe**, in `skills/go/recipes/<name>.md`: the stage
  list, which discipline each stage invokes, the rubric additions, the
  evidence required. A recipe that needs more than one page is two
  recipes, or a discipline that belongs downstream.
- **orch writes no disciplines.** Each stage names a skill through the
  existing `workflow.tools` map, defaulting to what is installed:
  `superpowers:brainstorming` / `writing-plans` /
  `test-driven-development` / `systematic-debugging`, or Pocock's
  `tdd` / `diagnosing-bugs` / `research` / `grilling`, else the native
  fallback the goal skill already has. Swapping a discipline is a config
  edit, not a plugin release.
- **Mixing is per step, not per goal.** A big goal may route step 1 as
  `research`, step 2 as `spec`, steps 3–5 as `tdd`, and a late step as
  `debug` — the Architect writes `recipe:` beside each step's `accept:`
  line; the Coordinator applies it to the Dev brief.
- **The gate reads the recipe.** `orch review G<k> [--step S<j>]` loads
  `review-goal.md` plus the recipe's rubric additions, so a `debug` step
  is judged on "was the test red first" and an `iterate` step on "is it
  outside the band" — without the reviewer being told anything by Dev.

Three smaller borrows, folded in where they land:

- **Ralphinho's retry rule** (never just retry; feed the failure
  context forward): the fix-loop hand-back to Dev carries the review
  file *plus* the failing test output and any conflict context, not the
  verdict alone. → §2.4.
- **Wayfinder's fog** for open-ended goals: the plan section of an
  "either, but iterative" goal has two lists — `steps` (sharp enough to
  have an `accept:`) and `fog` (suspected decisions, not yet sharp).
  Ticket a step "when the question is already sharp, even if blocked".
  Wayfinder's HITL/AFK marker per ticket maps onto the contract's
  `decide: human|ai` applied at step level. → §2.7.
- **Triage labels** `ready-for-agent` / `ready-for-human` are the YOU
  lane as issue labels on the GitHub board. → board-gh, later.

Not borrowed, on purpose: ECC's language packs, rules bundles, instinct
learning and multi-harness adapters (catalog weight orch does not want),
and Pocock's `implement` as a command (orch's Dev brief plus a recipe
already is that sequence).

## 6. What would prove this is right

Before any hook is written: run one real milestone of two or three goals
by hand — Coordinator as a human typing the `herdr` commands, the AI
roles as panes with `ORCH_ROLE` set but nothing enforcing it. Count: how
many times a role crossed its "does not" column; how many lines each
handoff needed; whether the Coordinator ever *needed* a worklog; how
many checker rounds Dev ran per gate round (r2 — tells whether the
inner/outer split pays); which recipes were actually used and whether
any step wanted one that does not exist (r2.3 — tells whether seven is
too many or too few). Those numbers decide §3.2's priority order,
§5.1's answer and the last open question in §5. Log them in this lane's
worklog as the brainstorm's first ledger line.

## 8. Project hierarchy — level · object · id · who creates it · command (r2.5)

| level | GitHub object | id / grammar | created by | command |
|---|---|---|---|---|
| repo | Project v2 + labels + `.claude/orch.json` | Priority = `Now·Next·Later`; Feature options = contract domain names (mirrored); Pipeline options | Director | `/orch:board init` · `/orch:setup` |
| milestone | Milestone (title · description · due) | `M1 · <objective>` · `target: <date>` · `done: <observable>` | Director | `/orch:milestone define` (→ `split` proposes goals, `prioritize` orders them, `close` acknowledges) |
| goal = lane | Issue, label `orch:goal`, body = BRIEF | `G3` (= issue #) · `goal · metric · done · domains · kill · feature:` | Director (Coordinator may propose) | `/orch:goal` (Architect shapes if fuzzy/big) |
| step | sub-issue; fields Priority, Feature, Pipeline | `S2` (ordinal) · body `text · outcome: · gate: · accept: · recipe:` | Architect (goal skill seeds small goals) | `add-item` |
| YOU item | sub-issue, label `orch:you` | `<action>` | Coordinator (parks owner work) | `add-item --you` |
| review round | `docs/reviews/` file | `M1.G3[.S2].R<r>` · `pass\|fail` · reasons | Gate reviewer | `orch review G3 [--step S2]` — launched by Dev/Architect, briefed by nobody |
| status | Status field `Todo · In progress · In review · Done`; `orch:blocked` + `blocked: <owner>` comment | folded from items + reviews | Coordinator | `set-status · set-blocker · attention · close-goal` (close needs ledger evidence) |

Who may write what (★ = role hook, else instructed):

| | Director | Coordinator | Architect | Dev | Gate |
|---|---|---|---|---|---|
| Project / contract | ✎ | – | – | – | – |
| Milestone | ✎ | read | read | – | – ★ agents refused |
| Goal issue (BRIEF) | ✎ | propose | shape | – ★ | – |
| Step items | – | status | ✎ add | – | – |
| YOU items | do | ✎ add | – | – | – |
| Feature / Pipeline | – | – | ✎ | – | – (inherited from `feature:`) |
| Status / blocker | – | ✎ | – | – | – |
| `docs/reviews/` | – | read | read | read | ✎ ★ sole writer |
| code | – | – ★ | – ★ | ✎ | – ★ |

Commands, five: `/orch:setup` (once per repo, Director) · `/orch:milestone`
(define · split · close, Director only) · `/orch:goal` (one goal → BRIEF +
issue + seeded steps, Director; Coordinator proposes) · `/orch:go` (drive
one lane, Coordinator or today's single session) · `/orch:board` (init
once, then look).

## 9. Skill routing — one map keyed by stage (r2.6, decided)

Recipes (§7) are sequences of **stages**; roles (§1) are who runs a
stage; providers are who implements it. The map is keyed by stage, so
a recipe change never touches config, a provider swap is one line, and
orch keeps the sequence and the gates while borrowing the craft. It
extends today's `workflow.tools` (two keys) rather than adding a system.

```json
"workflow": {
  "prefer": ["superpowers", "mattpocock", "native"],
  "tools":  { "debug": "mattpocock:diagnosing-bugs" }
}
```

Resolution: explicit `tools[stage]` → first provider in `prefer` that has
the stage installed → orch's native fallback. A resolver script (`orch
tools`) prints the resolved table; the route phase writes the resolved
skill into the ROUTE line, so a session records which skill actually ran.

| stage | role | superpowers | mattpocock | native fallback |
|---|---|---|---|---|
| define milestone | Director | brainstorming | grilling | three questions |
| grill / shape | Architect | brainstorming | grill-with-docs, grilling | three questions |
| spec | Architect | writing-plans | to-spec | plan section |
| split to steps | Architect | writing-plans | to-tickets; wayfinder for fog | plan section |
| domain model | Architect | — | domain-modeling | ADR |
| tdd | Dev | test-driven-development | tdd | ladder step 1 |
| debug | Dev | systematic-debugging | diagnosing-bugs | ladder step 1 |
| research | Architect, Dev | — | research | web search → grade sources |
| cleanup | Dev | — | — | native (de-sloppify prompt) |
| merge conflicts | Dev | — | resolving-merge-conflicts | stop, park for owner |
| gate rubric | Gate | verification-before-completion (checklist) | code-review (second axis) | `review-goal.md`, **always** |
| handoff | every role | — | handoff | the four-line handoff |

Rules:

- **Providers shape craft, never safety.** Ship gate, role hooks and the
  review-file rule do not read this map; it needs no lock.
- **The gate rubric is extended, never replaced** — that rubric is where
  the independence rule lives.
- **Verify at resolution time.** Skill names drift across plugin
  versions; a missing preferred skill falls back and says so in the
  ROUTE line (the config's existing rename-notice pattern).
- **The Coordinator has no row.** If it ever wants a skill, judgment has
  leaked back into it.

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
