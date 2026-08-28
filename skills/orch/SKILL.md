---
name: orch
description: >
  Evidence-gated orchestration for agent-driven work. Use when routing a new
  task, reviewing an agent hand-back, deciding whether work may merge, or
  launching an autonomous loop. The agent orchestrates and judges; delegates
  implement; deterministic hooks enforce the boundaries; every claim needs
  evidence.
---

# /orch — evidence-gated orchestration

The operating premise: an agent's "DONE" is a claim, not evidence. This skill
turns claims into evidence at four gates — routing, review, merge, and loop
launch — and keeps a written trail a future session can audit.

## Roles

The orchestrator (strongest model available) keeps for itself: design, verdict
interpretation, and review-gating every hand-back. It delegates execution to
the cheapest tier the task shape allows: mechanical/spec-complete work to a
small model, default implementation to a mid-tier model. **Reviewers are
verdict-only — a reviewer never implements the fix it proposes.** Never
delegated: edits to protected directories, authored values without a cited
source, domain judgment that belongs to the human operator.

## The board

One tracked file (e.g. `docs/BOARD.md`) is the canonical fronts board — a
short status table, one row per front. Edit the row and COMMIT it whenever a
front's status or blocker changes: an uncommitted board edit is an unrecorded
one, and `git log` on the file is the campaign journal. Status vocabulary:
**ready** (shaped, unowned) · **running** · **review** (in the ladder below) ·
**blocked** (MUST name the blocker AND who owns unblocking it) · **merged**.
A front sitting blocked for more than a session without a named unblock-owner
is board theater — surface it, don't recite past it.

**Session start (work sessions):** read the board → report state in ≤5 lines →
propose the next task → operator picks. Detail lives in per-front dossier
files, never in the board.

## Review ladder (per hand-back — order is mandatory)

1. **MECHANICAL first, cheap tier:** `git diff --stat` + build + scoped tests —
   no judgment needed, so spend no judgment-model tokens on it. Fail → straight
   back to the implementer. Hand-backs that add or change tests also get the
   **test-quality audit**: ① circular-oracle check (does the test import the
   code under test AND derive its own expected values from it? an oracle that
   is the SUT proves nothing) ② assertion-strength ladder (existence → type →
   status → value → behavioral; consequential verdicts need value-or-behavioral)
   ③ disabled-test scan (skipped tests found in review are findings).
2. **JUDGMENT second:** diff review by the strongest model, verdict-only.
   High-consequence hand-backs (numerics, security, data integrity, public
   contracts) additionally get a second reviewer from a **different model
   family, in a FRESH context**, with the same PASS/FAIL rubric — same-thread
   re-review only confirms old findings are fixed; it never finds new ones.
   **Both reviewers must PASS; one FAIL fails the hand-back.** Merge both
   finding lists, dedupe, fix all. **Artifact reality check:** anything the
   hand-back claims to have added must pass EXISTS (present) → SUBSTANTIVE
   (not a stub) → WIRED (actually called/registered; an uncalled
   implementation is a finding, not a pass).
3. **LOOP:** on FAIL, the IMPLEMENTER (never a reviewer) fixes ONLY the
   flagged items, then step 2 re-runs with fresh reviewer contexts. The
   initial review is round 1; cap **3 rounds total**. **Stall rule
   (identity-based, never count-based — fresh reviewers split and merge
   findings differently):** stall = any finding from the previous round
   survives unresolved, or a new equal-or-higher-severity finding appears →
   escalate to the operator immediately. Never merge dirty.

## Merge gate (all three legs, or park for the operator)

1. **No regression** — the full relevant suite, from the real runner's verdict
   line, never a filtered/wrapped view of it.
2. **Measured improvement** on the front's goal metric. **Noise clause:** the
   improvement must exceed the metric's documented noise band (repeated runs,
   pinned environment) — a single before/after number inside the noise band is
   INCONCLUSIVE, which parks, never merges. "Flat but correct" and
   hygiene-only changes park for the operator.
3. **Root cause, no band-aid** — a patch that masks a symptom or hardcodes
   around a defect stops for the operator regardless of green gates.

Evidence + baseline SHA go in the PR body.

## Loop preflight (gates EVERY autonomous-loop launch)

Refuse to launch until all five hold (any ✗ → fix the loop's prompt file first):

1. **Machine-decidable completion promise** — a probe/test/exit-code decides
   it, never the loop's prose claim of success.
2. **Boundaries stated** — what the loop must NOT touch (protected dirs,
   authored values without sources, the gates themselves).
3. **Iteration cap set** — and understood as the real safety net.
4. **Judge independence** — the verdict comes from an external check's output,
   never the loop grading its own work (a loop that writes its own verdict
   always converges to "done").
5. **Numeric ambiguity checklist** (binary, no scoring): the prompt explicitly
   states inputs + units · the oracle (which check decides) · tolerance (what
   change size counts, vs the noise band) · measurement protocol (repeats,
   pinned variables) · abort conditions. Ambiguity left here becomes confident
   invalid work overnight.

**Launch journal:** when the loop command is printed, append one line to the
front's dossier: `LAUNCH <date> · <prompt file> · max-iter <n> · promise <string>`.

## Record discipline

Every iteration's dossier entry STARTS with one fixed ledger line —
`iter <n> · <short-sha> · <metric before> → <after> · keep|revert|flat|refuted · <one-line what>`
— then prose: hypothesis (written BEFORE the change), what changed, every
number, verdict. A campaign must be scannable from its ledger lines alone.
Autonomous judgment calls get their own line:
`Ruling: <decision> — <why> — <cost if wrong>`.
**Simplicity criterion:** an improvement bought with disproportionate
complexity is flagged `⚠complexity` for the operator; a flat result that
DELETED code is a simplification win — keep it.

## Handoff & session end

Before any compaction or session end, refresh the working-state handoff file
with exactly: ① done this session ② next action ③ which skill/procedure the
next agent starts with ④ blockers + who owns each. Reference other artifacts
by path — never restate their content. (The session-hygiene hook blocks a
heavy session from ending with no trail written.)

## Hook wall (enforced, not remembered)

This plugin ships deterministic hooks so the rules above survive bad memory:
destructive-git block · protected-directory block · fact-force gate (first
edit to a critical file is denied until callers/red-test/number/units are
stated) · session hygiene (Stop) · two-stage context alarm (pre-alarm: finish
the iteration; trip: checkpoint now) · run-on-commit (keep derived artifacts
fresh). Configure per project in `.claude/orch.json` — see the README. The
blocking hooks fail CLOSED on unverifiable input; advisory hooks fail open.
