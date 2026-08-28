---
name: setup
description: >
  Onboard a repo onto the orch contract, edit contract domains, mirror the
  contract into the lock file, configure workflow tools, and ratify or
  reject proposed ADRs. The only place the contract changes.
---

# /orch:setup — contract governance

The contract is the operator's ONE decision: which domains are theirs.
You interview, draft, and apply edits the operator approves — never
without them.

## First run on a repo

1. Scan the repo (top-level dirs, build files, README) and propose 3-6
   candidate domains with paths.
2. For each: whose expertise? `decide: ai | human` ·
   `ship: push | commit | none` (push ⊃ commit ⊃ none; there is no merge
   grant — history writers are hook-blocked, the operator runs them).
   Record the WHY as `expertise` — future classification reads it to
   break ties.
3. Remind: omission never grants — unmatched work parks and proposes an
   amendment. Don't aim for total coverage on day one.
4. Write `.claude/orch.json` → `contract` with `"version": 1`.
5. OFFER LOCK MIRRORING: the project file is agent-writable; mirroring
   `contract` into `~/.claude/orch-lock.json` makes the lock's contract
   REPLACE the project's entirely (atomic — a project file cannot add
   domains beside a locked contract). Strongly recommend when any domain
   is `decide: human`. Every later contract edit therefore happens in the
   LOCK copy, applied by the operator (it is their file); the project copy
   becomes documentation. Also offer guard locks, e.g.
   `{"destructiveGit": {"enabled": true}}`.
6. Offer `workflow.tools` (defaults: fuzzy → superpowers:brainstorming,
   big → superpowers:writing-plans; native fallbacks otherwise).

## Editing an existing contract

Show current domains as a table. Apply the approved change; bump
`contract.version` by 1; record the change as an accepted ADR (one-line
context: what changed, why). If the contract is lock-mirrored, update the
lock copy too — the operator applies that edit (it is their file).

## Ratifying ADRs

List `docs/adr/*` with `Status: proposed`. For each: show the amendment,
ask accept / reject / defer. Accept → apply the contract edit + version
bump, flip to `Status: accepted`. Reject → `Status: rejected` + one-line
reason. Defer → leave; it resurfaces in `/orch:go`. A later ADR replacing
an accepted one flips the old to `Status: superseded`.
