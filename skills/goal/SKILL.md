---
name: goal
description: >
  Create or edit a campaign: shape the goal into a one-page BRIEF (goal,
  metric, done-condition, contract domains touched, kill criteria) using
  the routed shaping tool, and register the campaign on the board.
  Do NOT use for running work on an existing campaign (/orch:go), for
  contract or domain edits (/orch:setup), or for viewing progress
  (/orch:board).
---

# /orch:goal — define a campaign

The BRIEF is the interface: whatever tool shapes the idea, the output
lands in this exact format at the top of the campaign's worklog
(`tmp/worklogs/C<n>-<name>.md` — see Register for the number):

    BRIEF
    goal:    <one sentence>
    metric:  <the number that moves + how it is measured>
    done:    <machine-checkable condition>
    domains: <contract domains this will touch>
    kill:    <when to stop pouring effort in>

## Shaping route (operator's named tool always wins)

| Shape | Tool |
|---|---|
| fuzzy / new ground | superpowers:brainstorming if installed, else the 3 questions below |
| clear + big | superpowers:writing-plans if installed, else a plan section in the worklog |
| clear + small | no shaping — write the BRIEF directly |
| knowledge gap | `workflow.tools.research` if configured (deep-research tool); else native: web search → grade sources → findings note |

`workflow.tools` in `.claude/orch.json` overrides the defaults.

**Research route (optional):** before writing the BRIEF ask — does this
goal depend on facts the AI can neither derive from the repo nor verify
from training (post-cutoff APIs, niche domain facts, papers, vendor
specifics)? If yes, run the research pass first; its output lands as a
`research:` section in the worklog (sources cited, confidence graded) and
the BRIEF cites it. If no, skip — research is a route, never a mandatory
phase.

Native fallback — exactly three questions, one at a time:
1. What number (or observable) tells us this worked?
2. What must NOT change while we chase it?
3. When would you kill this campaign rather than keep iterating?

## Register

1. Assign the lane number: max `C<n>` on `docs/BOARD.md` + 1 (numbers are
   never reused and survive archival). The campaign is `C<n> · <name>`
   everywhere from here on; its worklog is `tmp/worklogs/C<n>-<name>.md`.
   Create `tmp/worklogs/` and `docs/adr/` now if missing — nothing else
   scaffolds them.
2. Add the row to `docs/BOARD.md` (status: ready) and commit the edit.
3. Seed the route: if the board has no `## ROUTE` section, ask the
   operator for bucket labels once (e.g. `NOW · SEP W1 · SEP W2-3`), then
   add one item line per known step from the BRIEF:
   `C<n> | <bucket> | <item> |` — with `-> <outcome>` where a step feeds
   the next, and `milestone: <label>` on the done-condition item. Owner
   actions the BRIEF implies (merge clicks, sign-offs) go to the YOU lane:
   `YOU | <bucket> | <item> |`.
4. Classify the `domains:` line against the contract now — if any part is
   `decide: human`, tell the operator where they will be needed. Then hand
   to `/orch:go` (phase: route).

Complete when: the BRIEF sits at the top of the worklog, the board row
exists (status: ready) and is committed, and the ROUTE section has the
lane's items.
