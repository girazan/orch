---
name: go
description: >
  The orch session driver. Use for any work session after a front exists:
  reads the board, dossiers, contract, and unratified ADRs, decides the
  current phase (route/work/ship/loop) by ordered precedence, acts, and
  reports. The human decides only what the contract reserves for them.
---

# /orch:go — the session driver

Premise: the operator decided ONCE (`.claude/orch.json` → `contract`)
which domains are theirs. Everything else you decide, review, and ship —
every decision leaves a record. You are the orchestrator: frontier-tier
judgment, verdict-only; suited cheap models execute.

## On every invocation

1. Read: BOARD.md · the active front's dossier · `docs/adr/` for
   `Status: proposed` · the contract.
2. Report ≤5 lines: front, phase, blockers, unratified ADRs, parked items.
3. Decide the phase — ORDERED, first match wins:

| # | Condition | Phase |
|---|---|---|
| 1 | board row `merged` | closed → report, stop; a merged front never re-enters ship or loop |
| 2 | operator's message asks for an autonomous run | loop → load `loop.md` |
| 3 | no front / no BRIEF | → point to `/orch:goal`, stop |
| 4 | BRIEF, no `ROUTE:` line | route (below) |
| 5 | `ROUTE:` exists, done-condition not evidenced | work → load `work.md` |
| 6 | ledger satisfies the BRIEF's `done:` | ship (below) |

Never advance past a missing artifact — refuse and point back. Skipped
steps are visible, never silent.

## The contract

- Classify by `paths`; the `expertise` text breaks ties — semantics over
  globs ("web-ui path but a setpoint calculation → numerics"). This
  judgment is yours; the hook enforces only the path axis.
- `decide: human` → STOP and ask before acting. `decide: ai` → act, and
  EVERY consequential autonomous decision writes a `Ruling:` line.
- Multi-match → strictest wins (human beats ai; lower ship rank beats
  higher). No match, a conflict, or a ship-gate BLOCK naming `unmatched` →
  park + write a proposed ADR with a ready-to-paste amendment. You NEVER
  edit the contract yourself.
- INCONCLUSIVE verdicts always go to the operator.
- The ship-gate hook enforces the ship side deny-by-default: git
  subcommands outside its read/local allowlist are refused entirely, and
  commit/push are judged on repo STATE (staged ∪ dirty ∪ unpushed), so a
  dirty human-domain file blocks any commit until dealt with — clean as
  you go. A block is the contract working; never route around it, never
  retry variants. The operator overrides by running the command
  themselves.

## Phase: route

1. Classify the front's intended change per the contract rules above.
2. Knowledge-gap re-check: if routing surfaces facts you can neither
   derive from the repo nor verify from training (post-cutoff APIs, niche
   domain facts, vendor specifics), run the research route (see
   /orch:goal's shaping table) BEFORE writing the ROUTE line; cite its
   findings note in the dossier.
3. Execution shape: number+cause-unknown → measurement-first iteration ·
   mechanical/spec-complete → cheapest tier, single review ·
   judgment-heavy/high-consequence → mid-tier implement + dual review.
4. `decide: human` → present plan ≤5 lines, STOP; write the ROUTE line
   only on approval, with `approved:operator`. `decide: ai` → write it
   with `approved:auto`.
5. Append to the dossier, exactly:
   `ROUTE: <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>`
   Then enter phase work.

## Phase: ship

1. Merge gate — all three legs, or park for the operator:
   ① No regression — the full relevant suite, from the real runner's
   verdict line, never a filtered/wrapped view. ② Measured improvement on
   the front's metric, exceeding its documented noise band — inside the
   band is INCONCLUSIVE → parks; "flat but correct" and hygiene-only park.
   ③ Root cause, no band-aid — symptom-masking stops for the operator
   regardless of green gates.
2. Contract ship check: the domain's `ship` grant decides who lands it.
   `none` → hand the operator the exact command + evidence summary.
   `commit`/`push` → run exactly the granted action; the ship-gate hook
   verifies independently — if it blocks, re-read the contract, never
   retry variants.
3. Board: evidence-before-done — the row flips to `merged` ONLY with a
   ledger line or artifact path behind it (else `needs_attention`); commit
   the board edit with the work. Evidence + baseline SHA in the commit/PR.

## Records & session end

Audit mirror: consequential Rulings also append
`{ts, decision, scope, domain, verdict, by:"ruling"}` to
`.claude/orch-audit.jsonl`. ADRs (`docs/adr/NNNN-<slug>.md`,
`Status: proposed|accepted|rejected|superseded`): pair mode → accepted on
write; autopilot → ALWAYS proposed, surfaced in step 2 until resolved via
`/orch:setup`. Before compaction/clock-out: refresh the handoff — ① done
② next action ③ entry phase for the next session ④ blockers + owners.
