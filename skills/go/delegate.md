# Delegation — who runs the work, and where

Loaded from route (tier pick) and work (dispatch). Roles, never model
names — pin roles to your runtime's actual models once, in
`.claude/orch.json`:

```json
"models": { "frontier": "opus", "high": "opus", "mid": "sonnet", "low": "haiku" }
```

Absent config, use the runtime's tiers by capability. The orchestrator
(you) always runs frontier-tier judgment; delegating YOUR verdicts is
never allowed.

## Tier table (task shape → tier, cheapest that fits)

| Task shape | Tier |
|---|---|
| transcription from a complete spec/plan (the code is written down; the work is typing + testing) · single-file mechanical fix · scan/grep/read recon | low |
| implementation from prose requirements · multi-file coordination · test authoring · fix rounds 1–3 | mid |
| review of a risky/subtle diff · adversarial verification · second-opinion verdicts | high |
| design, routing, final verdicts, anything that changes the plan | frontier (you) |

Turn count beats token price: a cheap model that takes 3× the turns on
multi-step work costs more — mid is the floor for prose-brief
implementers and reviewers.

## Delegation surface (context lifetime → vehicle)

| Work shape | Vehicle |
|---|---|
| one-shot: read, scan, verify, single task with a clean brief | throwaway subagent — spawns, reports, exits; brief carries EVERYTHING it needs (it inherits nothing) |
| a front taking brief after brief — context worth keeping alive between briefs | resident pane (herdr-style) if your runtime has one: a ROLE with a name and a lifetime tied to the front. No resident runtime → fresh subagents with the DOSSIER as the persistent memory |
| verdicts, gates, plan changes | never delegated below high; the orchestrator interprets every verdict itself |

Subagents never spawn their own reviewers — review comes from the
orchestrator after the hand-back, or it double-pays every seat.

## Fix-loop escalation (matches the review ladder's cap 3)

Rounds 1–2: RESUME the same implementer — its context holds the task and
its own choices. Round 3 (last before the stall rule escalates): fresh
implementer one tier UP, handed the brief + the findings + "a prior
implementer attempted this; you own it now." A loop that survives two
resumes usually means the implementer cannot see its own problem — fresh
eyes and a capability bump in one move, before the operator has to hear
about it.
