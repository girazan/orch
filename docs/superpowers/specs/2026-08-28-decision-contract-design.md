# orch v0.3.0 — The Decision Contract

Date: 2026-08-28 · Status: approved rev 3; rev 4 incorporates dual-review
findings (Codex-Sol + Opus, both FAIL verdicts, all confirmed findings fixed)

## Premise

The human decides ONCE which decisions are theirs; everything else the AI
decides, reviews, and ships itself — every decision leaves a record, and when
reality doesn't fit the contract, the AI drafts the amendment and the human
ratifies it. Orchestrated, planned, reviewed, and gated by frontier AI;
executed by suited cheap AI; shipped by AI or human per contract; enforced by
hooks.

## §1 Contract schema

`.claude/orch.json`, new `contract` block. **Security note:** the project
file is agent-writable; for guarantees against self-loosening, `/orch:setup`
offers to mirror the contract into `~/.claude/orch-lock.json`, which
deep-overrides the project copy (existing lock mechanism — lock always wins).

```json
"contract": {
  "version": 1,
  "domains": {
    "numerics": { "paths": ["src/Solver/**", "src/Kernel/**"],
                  "expertise": "process physics, conservation, units — operator's specialty",
                  "decide": "human", "ship": "none"   },
    "web-ui":   { "paths": ["src/Hmi.Web/**"],
                  "expertise": "standard web patterns, no domain physics",
                  "decide": "ai",    "ship": "push"   },
    "tests":    { "paths": ["tests/**"],
                  "decide": "ai",    "ship": "commit" }
  }
}
```

- Domains are expertise territories, not risk tiers.
- `decide`: `ai` | `human`. There is no middle value: EVERY autonomous
  decision of consequence requires a `Ruling:` line (record discipline),
  so "ai with ruling" is the only kind of `ai` there is.
- `ship`: `push` ⊃ `commit` ⊃ `none` (each grant implies the weaker). There
  is no `merge` grant — a merge you cannot push is inert, and merge/rebase
  machinery is where gate bypasses live; history-rewriting commands are
  blocked outright (§2).
- Multi-match → strictest wins, on both axes (`human` beats `ai`; lower ship
  rank beats higher). No match / conflict → strictest (human/none) AND the
  learn-loop fires (§3). No configurable default — omission never grants.
- **Enforcement boundary (stated honestly):** the hook enforces the PATH
  axis deterministically. The `expertise` text binds the AI's own routing
  judgment (semantics over globs when they conflict) — that is skill-layer
  defense in depth, not hardware; the hook never claims to read semantics.
- INCONCLUSIVE review/merge verdicts always go to the human regardless of
  domain.

## §2 Ship-gate hook

New `hooks/contract-ship-gate.js`, PreToolUse on Bash|PowerShell, wired in
`hooks/hooks.json` alongside `block-destructive-git`.

**Command classification — per SEGMENT, strictest across the whole line:**
split the command on `|`, `;`, `&`, newline; classify every segment; the
required grant is the MAX action rank found in ANY segment (`git commit &&
git push` requires push). `git`/`git.exe` with `-C`, `--git-dir`,
`--work-tree`, or a `GIT_DIR=`/`GIT_WORK_TREE=` env prefix in the segment →
fail CLOSED (the hook gates exactly one repo: the session's; re-targeting is
the operator's move).

**Gated actions (only two, resolved precisely):**
- `commit` → files = staged (`diff --cached --name-only`); `-a`/`--all` or a
  pathspec/`--only`/`--include`/`--interactive`/`--patch` → union with
  unstaged tracked changes (`diff --name-only`) — a strict superset errs
  closed; `--amend` → union with `diff HEAD^ HEAD --name-only`.
- `push` → allowed grammar is narrow: plain `git push`, `git push <remote>`,
  `git push [-u] <remote> <current-branch>`. Files = `git diff <base>..HEAD
  --name-only` (diff, never log — log is empty for merge commits) where
  `<base>` = `@{push}` → `@{u}` → merge-base with the remote default branch.
  No remote/base resolvable → fail CLOSED (first push is the operator's).
  Refspecs (`a:b`), `--all`, `--mirror`, `--tags`, `--delete`, `--force*` →
  fail CLOSED.

**Blocked outright when a contract exists** (history writers and remote
ships whose file-sets can't be resolved safely): `git merge` (incl.
`--continue`), `rebase`, `cherry-pick`, `revert`, `am`, `gh pr merge`.
Message: operator runs it, or a contract amendment (ADR) grants a
workflow that needs it.

**Fail-closed inventory (all exit 2, all audited):** oversized payload ·
`.claude/orch.json` exists but is unparseable (corrupt config must never
silently disable the gate) · contract present but invalid (schema check
uses own-property lookups — `"ship":"toString"` is invalid, enums exact) ·
unresolvable file list · **empty resolved file list** (`--allow-empty` and
friends mutate history filelessly; git itself refuses true no-ops, so
blocking empties costs nothing and closes the hole) · blocked-command list
above. No `contract` block in a parseable config → no-op (exit 0), so
pre-contract installs are unaffected.

**Mechanics:** repo root discovered via `git rev-parse --show-toplevel`
from `j.cwd` (config + globs are root-relative; monorepo subdir sessions
still find the contract); all git calls use `-c core.quotePath=false`
(non-ASCII paths must match globs, not their escaped quoting); the
configured audit file itself is always-granted (evidence writing can never
deadlock the gate that writes it); strictest grant across all files
governs; the governing domain is tracked independently of rank so ALLOW
audit lines always name it.

## §3 Decision records — one system, three depths

| Depth | Artifact | When |
|---|---|---|
| audit line | `.claude/orch-audit.jsonl` (path configurable; local-first — gitignoring `.claude/` is fine; if tracked, the file is gate-exempt per §2) | EVERY ship-gate exit — ALLOW, BLOCK, and every fail-closed path — `{ts, action, files, domain, verdict, reason?, by:"hook"}`; the skill mirrors Rulings as `{by:"ruling"}` lines |
| `Ruling:` line | front's dossier + audit mirror | every autonomous decision of consequence: `Ruling: <decision> — <why> — <cost if wrong>` |
| ADR | `docs/adr/NNNN-<slug>.md`, header `Status: proposed | accepted | rejected | superseded` | anything shaping structure, contracts, or future decisions — including every contract amendment |

ADR authorship and status:
- Pair mode (human + AI decide together) → `Status: accepted` on write.
- Autopilot (AI alone) → ALWAYS `Status: proposed`; unratified ADRs surface
  in `/orch:go`'s session report; human ratifies (accepted), rejects
  (rejected), or replaces later (superseded) via `/orch:setup`. The plugin
  never edits its own contract.

Contract history: `git log -p .claude/orch.json` IS the change record —
no hash/tmp-state machinery. Convention: every contract edit bumps
`version` and cites an ADR; `/orch:setup` enforces the convention at
edit time.

Learn-loop — fires from EVERY unmatched/conflicting classification, both
skill-side (route time) and hook-side (a ship-gate BLOCK naming
`unmatched`): work parks (strictest) AND the AI writes a proposed ADR with
a ready-to-paste amendment (domain, paths, expertise, decide/ship,
rationale). Human accepts via `/orch:setup` → contract edited → version
bumped.

## §4 Skill surface — three commands, orch-decided phases

Plugin skills always namespace as `orch:<name>` (there is no bare `/orch` —
`ponytail:ponytail` precedent), so the driver is **`/orch:go`**:

| Command | Does | When |
|---|---|---|
| `/orch:setup` | onboarding ritual: write/edit contract domains (offer lock-file mirroring), `workflow.tools`; ratify/reject proposed ADRs; every contract edit bumps version + cites an ADR | first install on a repo; contract governance |
| `/orch:goal` | brief ritual (goal · metric · done-condition · domains touched · kill criteria) + shaping route (§7) | new front, or editing a front's goal/metric |
| `/orch:go` | reads board + dossier + proposed ADRs → decides the current phase by ORDERED precedence → acts → reports ≤5 lines + what's next | the session driver — everything after goal definition |

`skills/go/SKILL.md` holds the state machine AND the two thin phases
(route, ship) inline; only the heavy phases load on demand:

| Phase | Precedence (first match wins) | Where |
|---|---|---|
| loop | operator's current message asks for an autonomous run (explicit input, the one non-artifact trigger) | `loop.md` |
| closed | board row `merged` → report and stop; a shipped front never re-enters ship | inline |
| route | BRIEF exists, no `ROUTE:` line | inline |
| work | `ROUTE:` line exists, done-condition not yet evidenced in ledger | `work.md` |
| ship | ledger lines satisfy the BRIEF's done-condition | inline |
| (none) | no front / no BRIEF → point to `/orch:goal`, stop | inline |

Canonical artifact grammar (single source — every reader/writer uses it
verbatim):
- BRIEF (dossier header): `goal:` `metric:` `done:` `domains:` `kill:`
- `ROUTE: <domain> · decide:<ai|human> · ship:<none|commit|push> ·
  tier:<model-tier> · approved:<operator|auto> · <date>` — for
  `decide: human`, the line is written ONLY after operator approval
  (`approved:operator`); the approval artifact IS the ROUTE line.
- Ledger: `iter <n> · <short-sha> · <before> → <after> ·
  keep|revert|flat|refuted · <what>` · `Ruling: <decision> — <why> —
  <cost if wrong>`
- ADR header: `Status: proposed|accepted|rejected|superseded`

Chain: BRIEF → ROUTE: → ledger evidence → ship. `/orch:go` refuses to
advance past a missing artifact and points back.

Carried over unchanged from v0.2.0: board vocabulary incl. needs_attention
+ evidence-before-done, review ladder (empty-result gate, tri-state
verdicts, identity-based stall), merge gate + noise clause, preflight,
handoff/session-end.

## §5 README reframe

Rewritten around the operator's seven premises; opens with "you decide once
what the AI may decide"; the contract is the front door, the 3 commands
(`/orch:setup`, `/orch:goal`, `/orch:go`) are the daily surface,
ladder/gates/hooks the machinery. Plain-language register and glossary
retained. The enforcement claim is stated honestly: the hook wall gates
this repo's git commit/push and blocks history-rewriters; it is not a
sandbox.

## §6 Tests

Ship-gate matrix (~30): per-segment strictest (`commit && push`) · allow/
deny per action · implied grant (push⊃commit) · strictest-wins multi-domain
· unmatched denial · nested `**/*.md` + anchoring (`docs2/` misses
`docs/**`) · corrupt orch.json fail-closed · invalid enum (incl.
`"toString"`) fail-closed · empty-domains no-op vs no-contract no-op ·
`-C`/`--git-dir`/`GIT_DIR=` fail-closed · refspec/`--all`/`--mirror`/
`--tags`/`--delete` fail-closed · blocked-command list (merge, rebase,
cherry-pick, gh pr merge) · `--allow-empty` blocked · `commit -a` union ·
pathspec-commit superset · `--amend` union · push via merge-base (merge
commit contents included; diff-not-log) · no-remote fail-closed · governing
domain named on all-push ALLOW · audit line on every exit incl. die paths ·
audit-file self-exemption · lock-file domain override · oversized payload.
Test harness: `commit.gpgsign=false` + `core.autocrlf=false` set in scratch
repos; scratch dirs gitignored; teardown chmods `.git` objects before rm
(Windows EPERM).

Regression: lock matrix (ported into `tests/`) + destructive-git smoke
(in `tests/`) stay green. Wiring test asserts the ship-gate entry exists in
`hooks.json`'s PreToolUse Bash|PowerShell group with correct command path.

Skill-chain check (manual): `/orch:go` phase precedence walks correctly for
(a) no BRIEF (b) BRIEF only (c) BRIEF+ROUTE (d) evidence-complete
(e) board-merged; each refusal points backward.

## §7 Workflow layer — Brief → Front → Iterations

Continuous flow, no timeboxes. The BRIEF format is the interface; the
shaping tool is routed by `/orch:goal`, not re-decided per task:

| Task shape | Default tool | Fallback |
|---|---|---|
| fuzzy / new ground | `superpowers:brainstorming` | orch's native brief ritual (template + 3 shaping questions) |
| clear + big | `superpowers:writing-plans` | native plan section |
| clear + small | skip shaping, route directly | — |
| human names a tool | that tool — per-task override always wins | — |

Optional `workflow.tools` map in orch.json overrides defaults. Whatever
tool runs, its output lands as the BRIEF at the top of the front's dossier.
Then: front on BOARD.md → iterations (ledger lines) → done-condition or
kill.

## Files touched

| File | Change |
|---|---|
| `hooks/contract-ship-gate.js` | NEW (~150 ln) |
| `hooks/hooks.json` | +1 wiring |
| `hooks/lib/config.js` | + audit append helper + corrupt-config signal |
| `skills/orch/` | REMOVED (renamed) |
| `skills/go/SKILL.md` | NEW — driver: state machine + route/ship inline |
| `skills/go/{work,loop}.md` | NEW ×2, heavy phases on demand |
| `skills/{setup,goal}/SKILL.md` | NEW ×2 |
| `tests/` | NEW in-repo: audit, ship-gate, lock (ported), destructive-git smoke |
| `README.md` | rewritten around the premises + 3 commands |
| `.claude-plugin/plugin.json` | 0.3.0 |
