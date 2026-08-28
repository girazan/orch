# orch v0.3.0 — The Decision Contract

Date: 2026-08-28 · Status: approved by operator (sectioned review in-session,
rev 3: 3 commands + orch-decided internal phases)

## Premise

The human decides ONCE which decisions are theirs; everything else the AI
decides, reviews, and ships itself — every decision leaves a record, and when
reality doesn't fit the contract, the AI drafts the amendment and the human
ratifies it. Orchestrated, planned, reviewed, and gated by frontier AI;
executed by suited cheap AI; shipped by AI or human per contract; enforced by
hooks.

## §1 Contract schema

`.claude/orch.json`, new `contract` block (protected by the existing
`~/.claude/orch-lock.json` deep-override):

```json
"contract": {
  "version": 1,
  "domains": {
    "numerics": { "paths": ["src/Solver/**", "src/Kernel/**"],
                  "expertise": "process physics, conservation, units — operator's specialty",
                  "decide": "human",          "ship": "none"   },
    "web-ui":   { "paths": ["src/Hmi.Web/**"],
                  "expertise": "standard web patterns, no domain physics",
                  "decide": "ai",             "ship": "push"   },
    "tests":    { "paths": ["tests/**"],
                  "decide": "ai_with_ruling", "ship": "commit" }
  }
}
```

- Domains are expertise territories, not risk tiers. `expertise` is read by
  the AI to classify ambiguous changes: semantics over globs when they
  conflict ("touches web-ui paths but changes a setpoint calc → numerics").
- `decide`: `ai` | `ai_with_ruling` | `human`.
- `ship`: `push` ⊃ `merge` ⊃ `commit` ⊃ `none` (each grant implies the weaker).
- Multi-match → strictest wins. No match / conflict → strictest (human/none)
  AND the learn-loop fires (§3). No configurable default — omission never
  grants.
- INCONCLUSIVE review/merge verdicts always go to the human regardless of
  domain.

## §2 Ship-gate hook

New `hooks/contract-ship-gate.js`, PreToolUse on Bash|PowerShell, wired in
`hooks/hooks.json` alongside (not inside) `block-destructive-git`.

- Detects `git commit` / `git push` / `git merge` (incl. `git.exe`, `-C`,
  global opts — same segment-matching style as block-destructive-git).
- Resolves touched files: commit → `git diff --cached --name-only`; push →
  `git diff @{u}..HEAD --name-only` (no upstream → all commits on branch);
  merge → `git diff <target>...HEAD --name-only` of the merged ref.
- Maps every file to matching domain(s); strictest grant across ALL files
  governs. Action exceeds grant → exit 2, message names files, domain, and
  who ships ("numerics grants none — operator ships this").
- Fail CLOSED: unresolvable file list, corrupt contract JSON, oversized
  (>1MB) payload. No `contract` block configured → no-op (v0.2.0 installs
  unaffected).
- Every decision (ALLOW and BLOCK) appends an audit line (§3).

## §3 Decision records — one system, three depths

| Depth | Artifact | When |
|---|---|---|
| audit line | `.claude/orch-audit.jsonl` (path configurable, git-tracked) | every ship-gate call: `{ts, action, files, domain, verdict, by:"hook"}`; skill mirrors Rulings as `{by:"ruling"}` lines |
| `Ruling:` line | front's dossier + audit mirror | small autonomous call inside one front (decision · why · cost if wrong) |
| ADR | `docs/adr/NNNN-<slug>.md` | anything shaping structure, contracts, or future decisions — including contract amendments |

ADR authorship and status:
- Pair mode (human + AI decide together) → `status: accepted` on write.
- Autopilot (AI alone) → ALWAYS `status: proposed`; unratified ADRs surface
  in bare `/orch`; human ratifies (→ accepted) or rejects via `/orch:setup`.
  The plugin never edits its own contract.

Contract versioning: the ship-gate keeps a hash of the contract block in temp
state; on change it writes a `contract_changed` audit line with old→new
`version`. An edit without a version bump is flagged in the audit line, not
blocked (the editor may be the human).

Learn-loop: change matches no domain (or domains conflict) → work parks
(strictest) AND the AI writes a proposed ADR containing a ready-to-paste
amendment (proposed domain, paths, expertise, decide/ship, rationale). Human
accepts the ADR via `/orch:setup` → contract edited → version bumped.

## §4 Skill surface — three commands, orch-decided phases

Human-facing commands are exactly the human moments; the workflow phases are
internal states bare `/orch` walks itself, loading per-phase files on demand
(the herdr.md progressive-disclosure pattern). Roles framing throughout:
frontier AI orchestrates, plans, reviews, gates; suited cheap AI executes;
shipping per contract.

| Command | Does | When |
|---|---|---|
| `/orch:setup` | onboarding ritual: write/edit contract domains, lock file, `workflow.tools`; ratify/reject proposed ADRs | first install on a repo; contract governance |
| `/orch:goal` | brief ritual (goal · metric · done-condition · domains touched · kill criteria) + shaping route (§7) | new front, or editing a front's goal/metric |
| `/orch` (bare) | reads board + dossier artifacts + unratified ADRs → decides the current phase → acts → reports ≤5 lines + what's next | the session driver — everything after goal definition |

Phase files under `skills/orch/`, loaded ONLY when bare `/orch` enters that
phase (SKILL.md itself stays a thin state machine):

| Phase file | Loaded when | Content |
|---|---|---|
| `route.md` | front has BRIEF but no `ROUTE:` line | classify change → domain → decide/ship + tool pick; STOPS at operator approval when the domain requires it |
| `go.md` | routed, work not complete | delegation, review ladder (incl. empty-result gate + tri-state verdicts), record discipline |
| `ship.md` | ledger evidence ready | 3-leg merge gate + contract ship check + audit line |
| `loop.md` | operator asks for an autonomous run | 5-check preflight + launch journal — always a PROPOSAL the operator approves; preflight unskippable |

Chain enforced by artifacts, not memory: `:goal` writes the brief → route
phase requires a brief and writes a `ROUTE:` line → go phase requires the
`ROUTE:` line → ship phase requires ledger evidence. Bare `/orch` refuses to
advance past a missing artifact and points back — skipped steps are visible,
never silent.

Carried over unchanged from v0.2.0 into the relevant surfaces: board
vocabulary incl. needs_attention + evidence-before-done (bare, ship.md),
review ladder + stall rule (go.md), merge gate + noise clause (ship.md),
preflight (loop.md), handoff/session-end + hook-wall summary (bare, go.md).

## §5 README reframe

Rewritten around the operator's seven premises; opens with "you decide once
what the AI may decide"; the contract is the front door, the 7 commands are
the daily surface, ladder/gates/hooks presented as the machinery enforcing
it. Plain-language register and glossary retained.

## §6 Tests

- Ship-gate matrix (~14): allow/deny per action, implied-grant chain,
  strictest-wins multi-domain, no-match denial, corrupt contract fail-closed,
  no-contract no-op, lock-file overriding a domain, audit-line written on
  allow and block, contract-hash-change line, no-upstream push resolution.
- Regression: existing 7-case lock matrix + 12-case hook matrix stay green.
- Skill-chain check (manual): bare `/orch` refuses cleanly to enter a phase
  whose predecessor artifact is missing, and points back.

## §7 Workflow layer — Brief → Front → Iterations

Continuous flow, no timeboxes. The BRIEF format is the interface; the shaping
tool is routed by `/orch:goal`, not re-decided per task:

| Task shape | Default tool | Fallback |
|---|---|---|
| fuzzy / new ground | `superpowers:brainstorming` | orch's native brief ritual (template + 3 shaping questions) |
| clear + big | `superpowers:writing-plans` | native plan section |
| clear + small | skip shaping, route directly | — |
| human names a tool | that tool — per-task override always wins | — |

Optional `workflow.tools` map in orch.json overrides defaults (e.g. for Matt
Pocock-style plugins). Whatever tool runs, its output lands as the BRIEF at
the top of the front's dossier. Then: front on BOARD.md → iterations (ledger
lines) → done-condition or kill.

## Files touched

| File | Change |
|---|---|
| `hooks/contract-ship-gate.js` | NEW (~120 ln) |
| `hooks/hooks.json` | +1 wiring |
| `hooks/lib/config.js` | + audit append helper |
| `skills/orch/SKILL.md` | becomes the thin state machine (bare `/orch`) |
| `skills/orch/{route,go,ship,loop}.md` | NEW ×4, phase files loaded on demand |
| `skills/{setup,goal}/SKILL.md` | NEW ×2, the other human-facing commands |
| `README.md` | rewritten around the premises + 3 commands |
| `.claude-plugin/plugin.json` | 0.3.0 |
