# orch v0.6.0 — Numbered Lanes & the Route Board

Date: 2026-08-29 · Status: approved by operator (sectioned review
in-session; §2 revised to the route-map form after reviewing the live
i-start-ots board)

## Premise

Campaigns need identities that survive speech ("C3 is blocked") and a
board that answers *"what's the path to done and where am I on it"* —
forward-looking, not a history chart. The owner's non-delegable work is
itself a lane: what the contract parks for the human should be visible as
a track, not scattered in prose.

## §1 Lane identity — `C<n> · <name>`

- `/orch:goal` assigns the next number: max existing on the board + 1,
  never reused, survives archival.
- Appears everywhere the campaign does: board row `C3 · solver-drift`,
  worklog `tmp/worklogs/C3-solver-drift.md`, ROUTE lines gain `lane:C<n>`,
  session reports and fleet-context alerts say `C3`.
- ROUTE grammar becomes:
  `ROUTE: lane:C<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>`
- Legacy boards: `/orch:board` or `/orch:go` numbers unnumbered rows on
  first touch, in row order, announcing it; worklogs are renamed only when
  next written to (no bulk migration).

## §2 `/orch:board` — the read-only fourth command

Never acts, never writes (single exception: legacy numbering, announced).
The command story becomes "three that act, one that looks."

Primary view — ROUTE MAP, rendered as in-chat ASCII:

- Time buckets named by the operator (`NOW`, `SEP W1`, `SEP W2-3`, …) —
  labels, never fabricated dates.
- One track per lane; items per bucket with `├─▶` dependency arrows;
  milestones as `✅` endpoints (`HDS DONE ✅`).
- **YOU track** — a standing owner lane. Every `decide: human` parked
  item and operator-only action (merge clicks, sign-offs) lands here
  automatically; the operator may add items by hand.
- Annotations fold in the approved tracking extras:
  · ⚠ stale flag on a track (same status past `board.staleDays`,
    default 3, from git log on the board file)
  · metric position under the track header (`4.1 → 2.3, target <2`,
    from the last ledger line vs the BRIEF)
  · gate-activity digest in the NOW column (`4 ships · 1 block ·
    2 Rulings`, from the audit jsonl since the operator's last board
    commit)
  · proposed-ADR ages in the footer (`ADR-0007 proposed 6d ⚠`)
- GATES footer: standing invariants (contract-derived + operator lines).
- TODAY'S QUEUE: final line, execution order for this session.

`/orch:board html` runs `scripts/board-html.js` (shipped, dependency-free
node) emitting one self-contained page — same data, horizontal tracks,
dark/light. No server; the operator opens or serves the file. The history
timeline considered in an earlier draft is DROPPED — the route map with
done items marked is the history, read left to right.

## §3 Route data home — `## ROUTE` in `docs/BOARD.md`

The board file stays the single source; git log on it stays the campaign
journal. New section grammar (one line per item):

```
## ROUTE
buckets: NOW · SEP W1 · SEP W2-3 · SEP W4-OCT W2 · OCT W3-4
C1 | SEP W2-3 | PT0053 two-cycle diagnose+fix | -> CONVERGE-SETTLED
C1 | SEP W2-3 | certify exit 0 | milestone: HDS DONE
YOU | NOW | merge clicks + push mains |
YOU | SEP W1 | #1909 bottoms walk (~45 min) |
```

- `|`-separated: lane · bucket · item · optional `->` dependency/outcome
  or `milestone:` marker. Done items get a leading `✓`.
- `/orch:goal` seeds a lane's route from the BRIEF (asks for buckets the
  first time a board has none).
- `/orch:go` updates item status as work lands (marks `✓`, moves the
  TODAY'S QUEUE) and auto-appends `decide: human` parks to the YOU lane.
- `/orch:board` only renders.

## §4 Surface changes

| File | Change |
|---|---|
| `skills/board/SKILL.md` | NEW — the render ritual: read board + worklogs + audit + ADRs, emit the route map; never act |
| `scripts/board-html.js` | NEW — board → self-contained HTML |
| `tests/test-board-html.js` | NEW — fixture board in, assert tracks/metrics/stale flags out |
| `skills/goal/SKILL.md` | lane numbering + route seeding |
| `skills/go/SKILL.md` | report line gains ⚠ stale + ADR ages; ROUTE grammar gains `lane:`; YOU-lane auto-append on human parks |
| `skills/go/delegate.md` | references lanes as `C<n>` |
| `README.md` | four commands ("three act, one looks"), board example |
| `.claude-plugin/plugin.json` | 0.6.0 |

Hooks untouched — the board is a skill+script feature; no new enforcement.

## §5 Testing

`test-board-html.js`: fixture `BOARD.md` + worklog + audit jsonl →
generated HTML contains each track, bucket headers, metric strings, ⚠ on
the stale lane, YOU-lane items, ADR footer; runs twice (rerun-safe);
malformed ROUTE lines are skipped with a rendered notice, never a crash.
ASCII rendering is skill-driven (model-rendered), review-checked like the
other skill texts. Existing six suites must stay green (no hook changes —
by construction, but run them).
