---
name: goal
description: >
  Create or edit a front: shape the goal into a one-page BRIEF (goal,
  metric, done-condition, contract domains touched, kill criteria) using
  the routed shaping tool, and register the front on the board.
---

# /orch:goal — define a front

The BRIEF is the interface: whatever tool shapes the idea, the output
lands in this exact format at the top of the front's dossier
(`tmp/dossiers/<front>.md`):

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
| clear + big | superpowers:writing-plans if installed, else a plan section in the dossier |
| clear + small | no shaping — write the BRIEF directly |

`workflow.tools` in `.claude/orch.json` overrides the defaults.

Native fallback — exactly three questions, one at a time:
1. What number (or observable) tells us this worked?
2. What must NOT change while we chase it?
3. When would you kill this front rather than keep iterating?

## Register

Add the front's row to BOARD.md (status: ready) and commit the board
edit. Classify the `domains:` line against the contract now — if any part
is `decide: human`, tell the operator where they will be needed. Then
hand to `/orch:go` (phase: route).
