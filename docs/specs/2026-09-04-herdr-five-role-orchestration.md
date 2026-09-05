# Five-Role Orchestration on Herdr — Design Spec

Date: 2026-09-05 · Status: **r3** — rework after three reviews (Opus REWORK,
Codex FAIL, operator's ChatGPT-Codex verdict; §13) · Baseline: `main` with
the GitHub board (`board-gh`), orch v0.7.0 + unreleased · Companion to
`2026-08-31-orch-v2-upgrade-design.md`, whose **threat model and label
vocabulary this spec inherits verbatim**: hooks defend against a sloppy
agent, not an adversary; every guarantee is conditional on the hook
running; **ENFORCED\*** = a hook verifies against locked config or repo
state · **ADVISORY** = catches drift, bypassable by intent · **INSTRUCTED**
= skill text only. r3 additionally names the v2 spec's second caveat that
r2 dropped: hooks see direct tool calls (`Read`/`Edit`/`Write`, the typed
`Bash` line); scripts, wrappers and native I/O are out of their sight.

Decisions are numbered 1–29 in §11; earlier revisions' text is superseded
by this document wherever they differ. The input artifact is in §A.

## 1. Target architecture at a glance

```
 DIRECTOR (you)        scope: milestone · goals · contract · ADRs · decide:human · stalls
     │  /orch:setup  /orch:milestone  /orch:goal          needed only where amber
     ▼
 COORDINATOR           native | loop (/loop 10m /orch:go) | herdr pane · one per repo
   reads board · latest handoff · latest review · the focus goal's worklog (append GATE)
   never code, never a verdict · one action per tick · pulse line · proposes goals, never creates
     │ starts panes with ORCH_ROLE=…  (a guardrail, not a credential — §6)
     ├─► ARCHITECT   goal-sized, only if fuzzy/big · plan: steps + fog · recipe per step · ADRs · ≤5 Qs
     ├─► DEV         fresh pane per step · execution recipe → skills · checkers (a capability) · commits per contract
     └─► GATE        spawned by `orch review` · verdict file whose header the evidence lint recomputes (§5)

 UNITS   M1 milestone (GitHub Milestone)  ─ G3 goal (issue)  ─ S2 step (sub-issue)  ─ R1 review round
 STATE   GitHub board · worklog · docs/adr · tmp/handoffs (scratch) · docs/reviews (evidence) · audit log
 GATES   contract ship rank ★ · review evidence lint ★ · destructive git ★ · role guardrails (advisory)
```

**Stated risk (from the operator's Codex verdict):** over-orchestration —
too many formal roles can cost more coordination than the coding they
coordinate. Mitigations, all in this spec: the Architect is optional, the
`fast` recipe exists, the `loop` vehicle needs no Herdr, the checker is a
capability not a role, dispatch confirmation is a mode that turns off, and
§12's hand-run counts crossings before any hook is written.

## 2. Vocabulary (normative)

| term | means | on GitHub | in an id |
|---|---|---|---|
| **milestone** | long-horizon objective, the Director's; any number open at once | Milestone: `M<n> · <objective>` · description `target: <YYYY-MM-DD> · done: <observable>` · due = target | `M<n>` |
| **goal** | one finite deliverable; one BRIEF; one Dev at a time | issue labeled `orch:goal`; body = BRIEF; `G<n>` = issue number | `G<n>` |
| **step** | one ordered piece of a big goal's plan; the unit Dev builds and the gate judges | sub-issue of the goal; body `text · outcome: · gate: · accept: · recipe:`; label `orch:item` | `S<j>` |
| **review round** | one gate verdict on a goal or step | file `docs/reviews/M<n>.G<k>[.S<j>].R<r>[-<slot>].md` | `R<r>` |
| **domain** | a territory of expertise in the contract (paths · expertise · decide · ship · tiers); **also the workstream** | Project **Feature** option, mirrored from the contract | never |
| **lane** | *retired.* Where the token survives in pinned grammar (`ROUTE: lane:G<n>`, `focus: G<n>`) it means "the goal" | — | — |
| **checker** | a capability of Dev or Architect: an in-session subagent asked for fast feedback; advisory | — | — |

Id rules: `M<n>`, `G<n>` are GitHub numbers, never reused. `S<j>` is
**assigned at creation and never renumbered** (decision 14, amended r3):
inserting a step before S2 creates S4, and the board's display order comes
from Priority + creation, not from `j`. A shaped goal's plan review is `R0`;
code rounds start at `R1`. Dual review writes two files, `R1-1` and `R1-2`.

Examples: `M1.G3.R2` (small goal, second round) · `M1.G3.S2.R1` (big goal,
step 2, first round) · `M1.G3.R0` (plan review) · `M1.G3.S2.R1-2` (second
reviewer of a dual round).

## 3. Roles

| role | runs as | tier | owns | never (mechanism, label) |
|---|---|---|---|---|
| Director | you; attaches to a pane only when it blocks | — | milestones, goals, contract, ADR ratification, `decide: human` calls, stalls | route tasks, review code (INSTRUCTED) |
| Coordinator | one per repo; `native` (today's session) · `loop` (`/loop <interval> /orch:go`) · `herdr` pane | frontier first; `mid` once one milestone ran clean (d.1) | pick one goal per tick, dispatch, gate bookkeeping, board status, pulse | read code (ADVISORY: direct `Read` outside its allowlist refused; `Bash` reads are not seen); design, implement, produce a verdict (INSTRUCTED) |
| Architect | pane per goal, `ORCH_ROLE=architect`, only when the goal is fuzzy or big | frontier | research, plan section (steps + fog), `recipe:` per step, ADRs, ≤5 questions | write dev-domain paths (ADVISORY, direct `Edit`/`Write` only) |
| Dev | **fresh pane per step** (d.24), `ORCH_ROLE=dev`; resident across fix rounds 1–2 | `tiers.work` floor ∨ the route's tier, strictest wins | one step (or one small goal), its tests, its handoff, commits where `ship: commit` | change the BRIEF or the plan (INSTRUCTED; the BRIEF is an issue body only `board-gh` verbs mutate); write `docs/reviews/` (ADVISORY path rule + ENFORCED\* evidence lint, §5) |
| Gate reviewer | subagent spawned by `orch review`; no pane; roster entry while it runs | `tiers.review`, never below `high`; second slot from `models.review-alt` | the verdict file | fix what it finds, ship anything (ADVISORY path rules; ship gate ENFORCED\* regardless) |

Context budget: Coordinator reads the board (via `board-gh read`), the
latest handoff, the latest review, and the **focus goal's worklog** (r3:
required to write the GATE block — it was missing from r2's allowlist).
Architect reads its goal's BRIEF, the codebase via research, prior ADRs.
Dev reads its goal's worklog, named ADRs, the files it edits. The gate
reviewer reads the BRIEF, the diff range, the handoff, test output.

## 4. State — one normative table

| what | where | written by | read by | notes |
|---|---|---|---|---|
| contract, models, `workflow.{coordinator,prefer,tools,dispatch}` | `.claude/orch.json`, mirrored to `~/.claude/orch-lock.json` | Director via `/orch:setup` | hooks, every skill | lock replaces `{contract, models}` wholesale (v2) |
| board | **GitHub only**: Milestone → goal issue → step sub-issues; Project fields Status · Priority · Feature · Pipeline | `board-gh` verbs only | `board-gh read` | `docs/BOARD.md` is gone (main CHANGELOG); r2 references to it are void |
| milestone | GitHub Milestone, three fields (§2) | `add-milestone` (Director-only) | `milestones`, `/orch:goal` step 1 | **M/C compatibility:** `milestoneRank` accepts `^[MC](\d+)`; new titles are `M<n>`; existing `C<n>` milestones are never renamed by orch; `add-milestone` numbers from max(M, C)+1 |
| goal BRIEF | goal issue body: `goal · metric · done · domains · feature · kill` | `add-goal --brief` | everyone | `feature:` = primary domain; `add-goal` **parses it from the brief file** and sets the Project Feature from it (no separate `--feature` to drift) |
| Feature options | Project field | `init` seeds from domain names when absent; `/orch:setup` **syncs** on domain add/rename (adds options; never deletes; renames add the new name and leave the old, reported) | `add-goal`, `add-item` | **Pipeline policy (r3):** `init` no longer seeds Pipeline from domains — absent → created with `general`; present → read verbatim, pass-through, operator's meaning |
| step | sub-issue body + fields | `add-item` by Architect (or the goal skill for small goals); never by Dev | Dev, gate | `recipe:` is fixed at plan time and covered by `R0`; Dev cannot alter it (see §5 on why this matters) |
| item Status | Project single-select `Todo · In progress · In review · Done` | Coordinator: `set-status` at dispatch (`In progress`); `orch review` sets `In review` on launch; Coordinator `done` on pass, `set-status In progress` on fail | `fold.js` | **exact fold transitions (r3):** goal status is derived by `fold.js` from goal state + labels + item Status **only**; reviews never fold directly — they drive the item Status/label changes above. `inconclusive` → `attention G<n> "inconclusive: <review file>"` → folds `needs_attention` → Director |
| worklog | `tmp/worklogs/G<n>-<name>.md`: BRIEF copy · plan section (steps, fog) · ledger · ROUTE line · GATE block | Architect (plan), Dev (ledger), Coordinator (ROUTE, GATE) | Dev, gate, Coordinator (focus goal only) | scratch, not git |
| handoff | `tmp/handoffs/M<n>.G<k>[.S<j>]-<role>.md`, ≤40 lines | every role at exit | the next role, Coordinator | scratch; **one filename grammar** (r2's §3.2 variant is void) |
| review | `docs/reviews/M<n>.G<k>[.S<j>].R<r>[-<slot>].md` | gate reviewer only | Dev (on fail), Coordinator | git-tracked evidence; header grammar in §5 |
| session marker | `<git-common-dir>/orch/session-<sessionId>.json` `{role, goal, step, startedAt}` | whoever starts the pane (Coordinator's launcher, or the go skill at session start) | Stop hook, role guardrails | gives Stop the lane and start time r2's handoff rule lacked |
| audit | `.claude/orch-audit.jsonl` | hooks, skills, Coordinator (`by:"pulse"`) | `/orch:board` | stale flag = age of last pulse |
| fleet roster | `<git-common-dir>/orch/fleet.json` (v2 §3.1) | pane launchers; `orch review` adds/removes its reviewer entry itself (a subprocess with no lifecycle hook — ADVISORY) | `/orch:board` FLEET footer | |

**Lane pick, one rule everywhere (r3; supersedes §4/d.2/d.19/d.25 of r2
and the go skill's recency rule):**
1. the goal the operator named (`/orch:go G8`);
2. else goals whose status is `running` or `review` (finish in-flight work);
3. else by Priority bucket across milestones (`Now` under M2 beats `Next` under M1);
4. within a bucket, lower milestone number, then lower issue number.
"Most recently touched worklog" is retired as a rule.

## 5. Review protocol

Two kinds of review, distinguished by **what is verifiable**, not by who
launches them — r2's "launched by / briefed by" split does not survive the
env-inheritance finding (§13, Opus A1/A2, Codex 1).

| | Checker | Gate |
|---|---|---|
| what it is | a capability: Dev or Architect asks a subagent for fast feedback, any brief, any tier | the verdict that flips a step or goal |
| launched by | Dev / Architect, in-session, freely | Dev / Architect run `orch review G<k> [--step S<j>] [--plan]` when they believe the unit is done |
| brief | the caller's | assembled by the script: rubric file(s) + `git diff <base>..<sha>` + handoff + BRIEF. **This is a convention, not a guarantee** — the caller could run its own subagent. What makes the gate a gate is the next row. |
| output | advice in the caller's context; ledger line at most | `docs/reviews/…` with a **verifiable header** (below) |
| status | ADVISORY | verdict content ADVISORY (sloppy-agent model); header **ENFORCED\*** by the evidence lint |

**Review file grammar**

```
review: M1.G3.S2.R1[-<slot>]
rubric: review-goal.md@<sha256 of skills/go/review-goal.md at HEAD> [+ recipes/tdd.md@<sha256>]
range: <base-sha>..<head-sha>          # the exact diff the reviewer was handed
model: <name> · tier: <role>
verdict: pass | fail | inconclusive
reasons:                               # fail/inconclusive: each cites done: or the step's accept:
- …
notes:                                 # non-blocking
```

**Evidence lint (ENFORCED\*, the only enforced review claim):** when the
Coordinator runs `done <item>` after a pass, or `close-goal G<n>`, the
ship-gate path recomputes from repo state: (a) the rubric hash equals the
file at HEAD, (b) `<head-sha>` is an ancestor of HEAD and `<base-sha>` is an
ancestor of `<head-sha>`, (c) every commit in `<base>..<head>` is on the
goal's branch and the range covers all commits since the previous pass for
this goal, (d) the verdict line parses. Any miss blocks the transition and
names the leg. A forged file that satisfies all four is a *correct* review
file of the right diff; what remains unverifiable (the reviewer's judgment)
is the same ADVISORY leg the v2 GATE block already has.

Rules, all INSTRUCTED unless noted:
- **Verdict is tri-state.** `inconclusive` goes to the Director via
  `attention` (§4), never auto-retried, no round consumed (orch rule today).
- **Dual review** (`review: dual` in the ROUTE line, from `tiers.review`
  and the route's consequence class): the script spawns two reviewers,
  the second from `models.review-alt`, writing `R<r>-1` and `R<r>-2`.
  Aggregation: both pass → pass; any fail → fail; else inconclusive.
- **Rubric selection is not caller text.** `recipe:` on a step is written
  by the Architect at plan time and reviewed under `R0`; Dev never runs
  `add-item`. For small goals the route phase writes it. The rubric hash
  in the header then pins which rubric was used.
- **Tests run on a detached worktree** created by the script under
  `<git-common-dir>/orch/wt/<review-id>/` and removed on exit. `git
  worktree add --detach <that path> <sha>` and `git worktree remove`
  are added to the ship gate's read/local allowlist **only for that path
  prefix** (plan 4); everything else about worktrees stays refused.
- **Fix rounds** (Coordinator counts from files): rounds 1–2 resume the
  same Dev pane with the review file **plus the failing test output and
  any conflict context** (Ralphinho: never a bare retry); round 3 = fresh
  Dev one tier up; a finding that survives two rounds, or the same
  error/empty diff twice (d.23) → stall → Director.
- The reviewer's roster entry is written and removed by `orch review`
  itself (ADVISORY; a crashed script leaves a ghost the roster's stale
  rule prunes).

## 6. Guardrails — relabeled

`ORCH_ROLE` is process env: set by whoever launches a pane, inherited by
every subagent, settable by the pane itself. It is therefore **never a
credential**. Role guardrails catch a sloppy agent's drift; they do not
stop intent, and they see only direct tool calls. Every row below except
the last is **ADVISORY**.

| rule | mechanism | label |
|---|---|---|
| reviewer does not edit or ship | PreToolUse `Edit\|Write` refused outside `docs/reviews/` when `ORCH_ROLE=reviewer`; ship gate refuses commit/push for that role | ADVISORY (role) · ship gate itself ENFORCED\* |
| only a reviewer writes `docs/reviews/` | `Edit\|Write` under `docs/reviews/` refused unless `ORCH_ROLE=reviewer` | ADVISORY — see evidence lint |
| coordinator reads no code | `Read` refused outside: `tmp/handoffs/`, `docs/reviews/`, `.claude/orch.json`, the focus goal's worklog (from the session marker) | ADVISORY (Bash reads unseen) |
| architect writes no production code | `Edit\|Write` refused on paths matching any contract domain's `paths` when `ORCH_ROLE=architect`; `docs/adr/`, worklog allowed | ADVISORY |
| dev changes no scope | `Edit\|Write` refused on the worklog's BRIEF block (first block) when `ORCH_ROLE=dev`; the issue-body BRIEF is protected by "only `board-gh` verbs mutate it" | ADVISORY + INSTRUCTED |
| no Stop without a handoff | Stop hook: session marker present with a role, ≥1 `Edit\|Write` in the transcript since `startedAt`, and no `tmp/handoffs/M<n>.G<k>[.S<j>]-<role>.md` newer than `startedAt` → refuse once, name the file | ADVISORY (fail-open on missing marker) |
| size budgets | Stop-time line counts: plan section ≤300 lines / ≤7 steps, handoff ≤40 | ADVISORY |
| verdict grammar, ≤5 questions, recipe stage order | skill text; grammar test pins the strings | INSTRUCTED |
| **review evidence** | evidence lint at `done`/`close-goal` (§5) | **ENFORCED\*** |
| ship rank, destructive git, protected dirs, read-before-write | unchanged from today | ENFORCED\* |

A pane launched without a role, or with a wrong one, gets today's
behavior plus at most a wrong advisory refusal; nothing security-relevant
depends on the role. The direct-tool caveat applies to every row.

## 7. Flow — one goal

1. **Director**: `/orch:milestone define` once per objective; `/orch:goal`
   per goal (the Coordinator may propose one in a YOU item; only the
   Director creates it). The goal skill parses `feature:` from the BRIEF
   and registers the issue under a milestone.
2. **Coordinator** (per tick): read; pick the goal by §4's rule; kill
   check (`kill:` line); capacity check (fleet ceiling); pulse.
3. **Shape, only if fuzzy or big**: Architect pane. Research route if a
   knowledge gap; ≤5 questions (pane blocks; answers → accepted ADRs);
   plan section = `steps` (each `accept:` + `recipe:` from the *shaping*
   or *execution* groups, §8) + `fog` (sharp-enough-to-name, not yet
   ticketed); `add-item` per step; checkers as it likes; `orch review
   G<k> --plan` → `R0`; fail → revise and re-run; pass → handoff, done.
   Clear or debugging goal → the route phase writes `recipe:` and skips
   this step.
4. **Dispatch** (d.29): if `workflow.dispatch: "confirm"` (default), the
   Coordinator asks the Director with a five-line proposal (goal/step ·
   role/tier/recipe · task line · touched domains and ship grant · caps)
   and options Go / Edit brief / Skip / Stop; `"auto"` writes the same
   five lines to the audit log and proceeds. Then: fresh pane
   `impl-G<k>-S<j>`, `ORCH_ROLE=dev`, session marker written, item Status
   → `In progress`, brief = the eight-section `delegate.md` brief whose
   MUST DO opens with the recipe's stages and whose CONTEXT names only
   this goal's worklog + listed ADRs.
5. **Dev**: works the step (checkers freely), commits where the contract
   grants `ship: commit`, writes its handoff, runs `orch review …`. Dev
   may **propose** a fog graduation or a new step in its handoff; it
   never adds one (that is the Architect's, re-paned briefly by the
   Coordinator — d.9 amended).
6. **Gate**: the script sets item Status `In review`, spawns the
   reviewer(s), writes the file(s). Coordinator reads the verdict: pass →
   `done <item>` (evidence lint runs) → next step, or for the last step
   / a small goal → step 7; fail → hand-back per §5 rounds; inconclusive
   → `attention` → Director.
7. **Merge gate, once per goal**: ① full suite verdict line ② metric
   beats its noise band ③ root cause, no band-aid → GATE block in the
   worklog (`subject:<sha> · regression · metric · rootcause`) → ship per
   the contract's grant (`none` → hand the Director the command) →
   `close-goal G<k> --evidence` (evidence lint + ledger check) → pane
   torn down, roster cleared.
8. **Milestone**: when every goal under `M<n>` is merged the Coordinator
   writes a one-line summary against the milestone's `done:` into the
   goal-less YOU item "close M<n>"; `/orch:milestone close` shows it, asks
   for acknowledgement, appends `closed: <date> · summary: <line>` to the
   milestone description and closes it. A milestone with zero goals is
   refused ("nothing was done under it").

Loop vehicle: `workflow.coordinator: "loop"` runs step 2 on every tick
via `/loop <interval> /orch:go`; a `confirm`-mode question blocks the
tick, which is the intended escalation. Herdr vehicle: same steps, with
`herdr agent start … --env ORCH_ROLE=… ` as the launcher and `wait
--until done|blocked`.

## 8. Recipes — two groups, chosen at route or plan time

A recipe is the named sequence of stages between the BRIEF and the gate.
It changes what the working role does and which rubric file the gate
hashes; it never changes hooks, the evidence lint, or the ship gate.

| group | recipe | fits | stages | gate rubric adds |
|---|---|---|---|---|
| **shaping** (Architect) | `spec` | fuzzy or big | brainstorm/grill → spec → `R0` → steps | plan covers `done:`; each `accept:` checkable |
| | `research` | knowledge gap | search → grade sources → findings note | sources cited and graded; no code |
| **execution** (Dev) | `tdd` | clear behaviour, testable seams | red at the seam → green → refactor | green-can-go-red |
| | `debug` | something is broken | reproduce → hypothesis → bisect → fix → regression test | a test that was red before the fix; root cause named |
| | `iterate` | a number to move, cause unknown | hypothesis first → change → measure → keep/revert | delta outside the noise band; `⚠complexity` weighed |
| | `cleanup` | slop after a feature landed | separate pass, separate agent | tests unchanged and green; the diff deletes |
| | `fast` | trivial, spec-complete | implement → test | mechanical step only |

Routing: a fuzzy goal starts with a shaping recipe and its steps carry
execution recipes; a goal may use several across its life. One page per
recipe in `skills/go/recipes/<name>.md`; a recipe needing more than a page
is two recipes or a discipline that belongs downstream. Recipes are never
commands (d.20).

## 9. Skill routing — one map keyed by stage

```json
"workflow": {
  "coordinator": "native | loop | herdr",
  "dispatch":    "confirm | auto",
  "prefer":      ["superpowers", "mattpocock", "native"],
  "tools":       { "debug": "mattpocock:diagnosing-bugs" }
}
```

Resolution: explicit `tools[stage]` → first provider in `prefer` with the
stage installed → orch's native fallback. The resolved skill is written
into the ROUTE line (`skill:<name>`) so a session records what ran; a
missing preferred skill falls back and says so.

| stage | role | superpowers | mattpocock | native |
|---|---|---|---|---|
| define milestone | Director | brainstorming | grilling | three questions |
| grill / shape | Architect | brainstorming | grill-with-docs, grilling | three questions |
| spec | Architect | writing-plans | to-spec | plan section |
| split to steps | Architect | writing-plans | to-tickets; wayfinder for fog | plan section |
| domain model | Architect | — | domain-modeling | ADR |
| tdd | Dev | test-driven-development | tdd | ladder step 1 |
| debug | Dev | systematic-debugging | diagnosing-bugs | ladder step 1 |
| research | Architect, Dev | — | research | web search → grade sources |
| cleanup | Dev | — | — | native de-sloppify prompt |
| merge conflicts | Dev | — | resolving-merge-conflicts | stop, park |
| gate rubric | Gate | verification-before-completion (checklist) | code-review (second axis) | `review-goal.md`, **always**, hashed |
| handoff | every role | — | handoff | four-line handoff |

Providers shape craft, never safety: no hook reads this map; the gate
rubric is extended, never replaced; the Coordinator has no row.

## 10. Commands

Five, one per *who*, verbs for *what* (d.20). `orch review` is a script,
not a skill — so that its brief assembly is code, not prose.

| command | who | verbs / phases |
|---|---|---|
| `/orch:setup` | Director | contract, models, workflow, lock; **syncs Feature options on domain change** |
| `/orch:milestone` | Director only — the skill refuses when `ORCH_ROLE` is set, and the verbs below refuse too (both ADVISORY; they exist so a roled pane cannot drift into scope) | `define` (three questions → `add-milestone`) · `split` (proposes goals from Feature options, creates nothing) · `prioritize` (`move G<n> <bucket>` on goals) · `close` (summary shown, acknowledgement asked, `close-milestone`) |
| `/orch:goal` | Director; Coordinator proposes | shape (§8 shaping recipes) → BRIEF → `add-goal` (parses `feature:`) → `add-item` per step (`--accept`, `--recipe`) |
| `/orch:go` | Coordinator (or today's single session) | route → work → ship; `loop` |
| `/orch:board` | anyone | `init` (Project, labels, Feature seed) · read · `html` |

`board-gh` verbs added by plan 1: `add-milestone`, `close-milestone`; `move`
extended to goals (no separate `prioritize` verb — Opus B8). All three go
through the write module: lock check, `withLock`, journal, and the role
refusal **before** `replay()`.

## 11. Decisions (ledger; r3 wording is authoritative)

1. Coordinator frontier first; `mid` after one clean milestone.
2. One Coordinator per repo.
3. Second reviewer family via `models.review-alt`.
4. Reviews git-tracked, handoffs scratch.
5. Ids `M.G[.S].R[-slot]`.
6. Panes feed the v2 fleet roster.
7. Goal is the unit of work; milestone is the GitHub Milestone; Architect goal-sized and optional. *(r3: "lane" retired as a word; nothing renames on the lane side — main already ships `G<n>`.)*
8. Checker vs gate. *(r3: checker is a capability; the gate is defined by its verifiable header, not by who launches it.)*
9. Big goals get steps; gate per step; merge gate once per goal. *(r3: fresh Dev per step, see 24; fog graduation is the Architect's, Dev proposes.)*
10. Step level in ids.
11. Milestone prefix `M<n>`; `C<n>` ranks and is never renamed.
12. Plan review is `R0`.
13. `orch review` registers its reviewer in the roster (ADVISORY).
14. `S<j>` assigned at creation, never renumbered *(r3 amendment).*
15. Recipes are in (§8).
16. `/orch:milestone` with three-field milestones; `feature:` on the BRIEF; `accept:`/`recipe:` on steps.
17. Skill routing keyed by stage (§9).
18. Domains are features: Feature options mirror contract domain names; `init` seeds, `setup` syncs; **Pipeline no longer seeded from domains** *(r3).*
19. Reprioritising: `move` for items and goals; Priority-first lane pick *(r3: one rule, §4).*
20. No sixth command; recipes are never commands.
21. Coordinator vehicles: `native | loop | herdr`.
22. Pulse line per tick; stale = pulse age.
23. No-progress detection, N = 2.
24. Fresh Dev per step by default; resident across rounds 1–2.
25. Milestones run concurrently; Coordinator singular; Priority wins across milestones.
26. *(r3)* "Lane" retired from the vocabulary; domain = workstream, metadata not identity.
27. *(r3)* Checker is a capability, not a role.
28. *(r3)* Recipes grouped as shaping vs execution.
29. *(r3)* Dispatch confirmation mode `workflow.dispatch: confirm|auto`, default `confirm`, five-line proposal via AskUserQuestion; `auto` logs the same lines.

## 12. What would prove this is right

Before any hook is written: run one real milestone of two or three goals,
one of them big, on the `loop` vehicle with `dispatch: confirm`, panes
launched with `ORCH_ROLE` set and nothing enforcing it. Count: role
crossings of the "never" column; handoff line counts; whether the
Coordinator needed anything outside its allowlist; checker rounds per gate
round; recipes used and any step that wanted a missing one; how many
dispatch confirmations you actually changed. Those numbers order plan 3,
decide d.1 and d.29's defaults, and tell whether seven recipes is right.

## 13. Delivery and review provenance

Plans on `main`: (1) milestone + vocabulary · (2) recipes + skill routing ·
(3) role guardrails (ADVISORY) + session marker + Stop rule · (4) `orch
review` + evidence lint + worktree allowlist · (5) coordinator vehicles
(loop, then herdr) + dispatch confirm. 1 first; 2 ∥ 3; 4 after 3; 5 after 3+4.

r3 answers: **Opus** A1/A2 (§5–6 relabel, evidence lint), A3 (§4 fold),
A4 (§4 one rule), A5/A9 (§2, §4 M/C), A6 (§4 GitHub-only), A7 (§5 rubric
not caller text), A8 (§6 BRIEF row), A10 (§4 Pipeline), A11 (§5
worktree), A12–A18 (single grammars, counts, order); **Codex** 1–3 (as
above), 4 (Coordinator worklog), 5 (d.9/d.24), 6 (fog is Architect's), 7
(tri-state), 8 (dual slots + aggregation), 9–13 (state table, S ids), 14
(session marker), 15 (count); **operator's Codex verdict** (lane, checker,
recipe groups, over-orchestration risk). Reviewer findings on the plan are
answered in plan r2.

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
