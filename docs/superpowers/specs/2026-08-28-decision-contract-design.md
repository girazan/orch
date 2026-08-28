# orch v0.3.0 — The Decision Contract

Date: 2026-08-28 · Status: rev 6 — round-3 review (Opus, empirical; Codex
run died) FAIL with converged scope; operator chose fix-and-build. Final
document review; the built artifact gets a fresh code review.

## Premise

The human decides ONCE which decisions are theirs; everything else the AI
decides, reviews, and ships itself — every decision leaves a record, and when
reality doesn't fit the contract, the AI drafts the amendment and the human
ratifies it. Orchestrated, planned, reviewed, and gated by frontier AI;
executed by suited cheap AI; shipped by AI or human per contract; enforced by
hooks.

## §1 Contract schema

`.claude/orch.json` at the REPO ROOT (discovered via `git rev-parse
--show-toplevel` and consulted first; if the root has no orch.json the
loader's `process.cwd()` fallback can only ADD gating — a contract found
there activates the gate; it can never deactivate a root contract). **Security
note:** the project file is agent-writable; `/orch:setup` offers to mirror
the contract into `~/.claude/orch-lock.json`. A locked `contract` REPLACES
the project's contract block atomically (never merged key-by-key — an
additive merge would let the project file add new permissive domains
beside the locked ones). Other lock keys keep the existing deep-merge.

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

- Domains are expertise territories, not risk tiers — and the map is
  SYMMETRIC: it records where the human's judgment is real (those stay
  `decide: human`) and where it isn't (forcing approval there is theater).
  In human-unspecialized `decide: ai` domains, cross-model review in fresh
  contexts is the stand-in for human judgment — that is what the review
  ladder's dual-review step is FOR.
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

## §2 Ship-gate hook — deny-by-default git surface

New `hooks/contract-ship-gate.js`, PreToolUse on Bash|PowerShell, wired in
`hooks/hooks.json` alongside `block-destructive-git`. Design principle
(round-2 review outcome): a shell command cannot be parsed permissively
and soundly — so when an active contract exists, the git surface is
DENY-BY-DEFAULT, and file resolution NEVER parses command arguments.

**Ordering:** repo root first (`git rev-parse --show-toplevel` from
`j.cwd`; not a repo → exit 0), then config from the ROOT only, then
classification, then resolution. All git calls use
`-c core.quotePath=false`.

**Classification — quote-aware end to end.** The WHOLE command is
tokenized first (`"…"`/`'…'` spans become single tokens carrying their
content); segments are then built by splitting the TOKEN STREAM on
unquoted separators — `|`, `;`, `&`, newline, and the grouping/keyword
forms `{`, `}`, `(`, `)`, `then`, `do`, `else`, `fi`, `done`, `if`,
`for`, `while`. Quoted text can therefore never create a segment
(`git commit -m "wip; git push later"` is ONE commit segment) and
grouping can never hide one (`{ cd x && git push; }` splits).
- Per git segment, the SUBCOMMAND is the first non-flag token after the
  git word (`-c` skips its value). A subcommand containing quotes or `$`
  is never a known word → falls to deny.
- READ/LOCAL ALLOWLIST (segment ignored): status · log · diff · show ·
  fetch · add · rm · mv · restore · switch · checkout · branch · stash ·
  rev-parse · ls-files · ls-remote · describe · blame · shortlog · reflog ·
  grep · apply · help · version. Round-3 prune, entries REMOVED because
  they can ship or retarget: `submodule` (`foreach 'git push'`) ·
  `worktree` · `clone` · `init` · `archive` · `format-patch` · `remote`
  (`set-url origin` redirects approved pushes) · `config` (aliases,
  push.default) · `clean`.
- GATED: `commit` (rank 1) · `push` (rank 2). Required grant = MAX rank
  across all segments. `commit --amend` is DENIED, not gated — it is a
  history rewrite; the amend-union code path does not exist.
- EVERYTHING ELSE — merge, rebase, cherry-pick, revert, am, pull, tag,
  aliases, unknown or quote-mangled subcommands — fail CLOSED.
- RETARGET RULE (final form, round-3): any unquoted token matching
  `cd|chdir|pushd|popd|sl|Set-Location|Push-Location` ANYWHERE in the
  command, or `GIT_DIR`/`GIT_WORK_TREE` appearing ANYWHERE in the raw
  string, while any gated/denied action exists → fail CLOSED. Same for
  `-C`/`--git-dir`/`--work-tree` on a non-allowlisted git segment.
  Enumerating shell forms lost three review rounds in a row; the rule is
  now "any directory-changing token", not a list of spellings we've seen.
- `gh` is NOT this hook's concern (round-3 cut — wrong layer, leaky both
  ways). The remote-ship holes it covered move to `block-destructive-git`
  as two built-in denylist rules: `gh pr merge` and `gh api` with a
  mutating method (`-X POST|PUT|PATCH|DELETE` / `--method …`).

**File resolution — repo STATE, never command arguments:**
- `commit` → staged ∪ unstaged-tracked (`diff --cached --name-only` ∪
  `diff --name-only`). Always-union is deliberate: a strict superset of
  every commit variant (`-a`, pathspec, `--only`, `--include`, quoted
  paths), so no argument parsing exists to bypass. Consequence, stated
  plainly: a dirty human-domain file blocks ANY commit until dealt with —
  fail-closed's honest price.
- `push` → the commit set ∪ `diff <base>..HEAD --name-only` (diff, never
  log) where `<base>` = `@{push}` → `@{u}` → `symbolic-ref
  refs/remotes/origin/HEAD` → **`ls-remote --symref origin HEAD`** (round
  3: neither init+remote-add nor clone reliably creates origin/HEAD, and
  without this fallback the first push of every branch — the normal agent
  workflow — was dead) → merge-base with the resolved default. None
  resolvable → fail CLOSED ("the first push is the operator's"). Push args
  beyond a narrow shape (flags outside `-u`/`--set-upstream`/`-q`/
  `--quiet`/`-v`/`--verbose`; any token with `:` — quoted included; >2
  positionals; positional 2 ≠ current branch/HEAD) → fail CLOSED.
- The audit file is filtered OUT of the resolved set right after
  resolution — it is exempt from domain mapping AND absent from logged
  `files` arrays; if it was the only pending file, that is the
  "nothing gateable" die.
- Git subprocess stderr is captured, never inherited — a blocked push
  prints ONE message: ours.

**Fail-closed inventory (exit 2, EVERY exit audited when a repo root is
resolvable — the oversized/no-payload path resolves root from
`process.cwd()` via rev-parse and SKIPS the audit line, with a stderr
note, when no root exists; an audit written into an unrelated directory
is worse than none):** oversized
payload · root `.claude/orch.json` unparseable · `contract` key present but
invalid (own-property enum checks; `domains` must be a plain object of
valid entries — `{"contract":{}}` is invalid, not inactive) · denied
subcommand/verb · retargeting · non-narrow push args · unresolvable base ·
empty resolved file set. INACTIVE (exit 0): no `contract` key, or
`contract.domains` present-and-valid but empty `{}` — documented as the
only silent pass-throughs.

**Verdict mechanics:** strictest grant across all files; the audit file
(fixed path, see §3) is exempt from domain mapping so evidence can never
deadlock its own gate; governing domain tracked independently of rank;
audit `action` field carries the REAL label (commit/push/denied:<word>).

**Honesty clause (spec + README):** this gates command strings passed to
the shell tool. Indirection the string doesn't reveal — scripts that run
git, interpreters, binaries — is out of scope by design; the lock file,
the read-allowlist's deny-by-default posture, and the operator are the
lines behind it.

**Disclosure (README-mandatory):** deny-by-default costs the agent,
daily: `pull` · `merge` (incl. `--continue`) · `rebase` · `cherry-pick` ·
`revert` · `am` · `tag` · `commit --amend` · every git alias · `remote` /
`config` / `submodule` / `worktree` subcommands · any push when nothing
is pending · any commit while a human-domain file is dirty · the first
push of a branch when no remote default is resolvable. Each block names
the operator as the override. This list ships in the README, not only in
block messages.

## §3 Decision records — one system, three depths

| Depth | Artifact | When |
|---|---|---|
| audit line | `<repo-root>/.claude/orch-audit.jsonl` — FIXED path, deliberately not configurable (a configurable path was a verified gate bypass: point it at a protected file and the self-exemption ships it); local-first, gitignoring `.claude/` is fine; if tracked, gate-exempt per §2 | EVERY ship-gate exit — ALLOW, BLOCK, and every fail-closed path — `{ts, action, files, domain, verdict, reason?, by:"hook"}`; the skill mirrors Rulings as `{by:"ruling"}` lines |
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
| closed | board row `merged` → report and stop; a shipped front never re-enters ship, and a merged front never enters loop | inline |
| loop | operator's current message asks for an autonomous run (explicit input, the one non-artifact trigger) | `loop.md` |
| route | BRIEF exists, no `ROUTE:` line — includes the knowledge-gap re-check: if routing surfaces facts the AI can't derive or verify, the research route (§7) runs before the ROUTE line is written | inline |
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

Opens with the symmetric-limits frame (operator-authored, rephrased):
humans have intent and judgment but only inside their specialty and only
for so many hours; frontier AI now thinks and judges, not just acts, but
every model has a token budget and a price. orch splits work along those
limits — the contract records where the human's judgment is real AND where
it isn't; in human-unspecialized domains, cross-model fresh-context review
is the stand-in judge ("two independent judges catching each other's blind
spots beats one human nodding at code they can't evaluate"). The model
ladder by tier: frontier thinks (plans, routes, final verdict) · high-end
reviews (fresh-context second opinion) · mid-tier executes · low-end does
the mechanical — then frontier/high-end reviews again before anything
lands; the human gets the report after, per contract. Closing line of the
frame: intent and judgment from the human, judgment and labor from the
machines, and a written map of who's specialized in what — the map is the
contract.

One added premise bullet: AI judges well but hasn't learned everything —
when a goal depends on facts outside both the repo and the model's
training, an optional research pass (cited, confidence-graded) runs before
the work, so the plan stands on sources, not confident guesses.

Then: the seven premises condensed, the contract JSON, the 3 commands
(`/orch:setup`, `/orch:goal`, `/orch:go`), records, the seven-hook table,
configure, glossary. Plain-language register retained. Enforcement stated
honestly: the hook wall gates this repo's git commit/push and blocks
history-rewriters; it is not a sandbox.

## §6 Tests

The plan's test scripts are the authority on the exact check count — the
expected outcome is "script exits 0", never a hardcoded N/N (count drift
was a round-2 finding). Ship-gate matrix must cover: per-segment strictest
(`commit && push`, both orders) · allow/deny per action · implied grant ·
strictest-wins multi-domain · unmatched denial · nested `**/*.md` +
anchoring (`docs2/`) · corrupt orch.json fail-closed · invalid contract
shapes fail-closed (`{"contract":{}}`, `domains:null`, null domain entry,
`"ship":"toString"`, non-array paths) · empty `domains:{}` inactive vs no
contract key inactive · retarget fail-closed (`-C`, `--git-dir`,
`GIT_DIR=`, `cd …&&`, `pushd`) · deny-by-default (alias `git ci`, quoted
`git p'u'sh`, `$C` expansion, `pull`, `tag`, unknown) · blocked verbs
(merge incl. `--continue`, rebase, cherry-pick, revert, am) · gh (pr merge
denied, `api -X PUT` denied, `pr view` allowed) · push shape (refspec incl.
QUOTED `"feature:main"`, `--all`, `--mirror`, `--tags`, `--delete`,
`--force`, unknown flags denied; plain/`-u origin <branch>` allowed) ·
`--allow-empty` blocked via empty-set rule · always-union commit (dirty
human-domain file blocks plain commit — the documented trade-off) ·
`--amend` union · push via merge-base with a merge commit (diff-not-log
proven) · no-remote fail-closed · governing named on all-push ALLOW ·
audit line present for ALLOW, policy BLOCK, and die paths incl. oversized
(unconditional audit) · audit-file exemption (fixed path) · locked
contract REPLACES project contract (project-added domain dies under lock).
Harness: `commit.gpgsign=false`, `core.autocrlf=false`; fake
`HOME`/`USERPROFILE` in EVERY suite (audit + destructive included); scratch
dirs gitignored; chmod-before-rm teardown; suite runs green twice in a row.

Regression: lock matrix + destructive-git smoke, both fully inlined
in-repo under `tests/` (no external references). Wiring test asserts the
ship-gate entry in `hooks.json`'s PreToolUse Bash|PowerShell group.

Skill-chain check (manual): `/orch:go` precedence for (a) no BRIEF
(b) BRIEF only (c) BRIEF+ROUTE (d) evidence-complete (e) board-merged
(f) merged + "run overnight" message → closed, not loop.

## §7 Workflow layer — Brief → Front → Iterations

Continuous flow, no timeboxes. The BRIEF format is the interface; the
shaping tool is routed by `/orch:goal`, not re-decided per task:

| Task shape | Default tool | Fallback |
|---|---|---|
| fuzzy / new ground | `superpowers:brainstorming` | orch's native brief ritual (template + 3 shaping questions) |
| clear + big | `superpowers:writing-plans` | native plan section |
| clear + small | skip shaping, route directly | — |
| knowledge gap (see below) | research tool from `workflow.tools.research` (e.g. a feynman-style deep-research agent or a GSD-style research phase) | native research pass: web search + source-grade + findings note |
| human names a tool | that tool — per-task override always wins | — |

**Research route (OPTIONAL, knowledge-gap triggered):** models judge well
but haven't learned everything — post-cutoff APIs, niche domain facts,
papers, vendor specifics. At `/orch:goal` time (and again at route time if
work surfaces one), test: does this goal depend on facts the AI can
neither derive from the repo nor verify from training? If yes, run a
research pass FIRST; its output lands as a `research:` section in the
dossier (sources cited, confidence graded), and the BRIEF's `goal:`/
`done:` lines cite it. If no, skip — research is a route, never a
mandatory phase. Authored values without a cited source remain
never-delegated regardless.

Optional `workflow.tools` map in orch.json overrides defaults. Whatever
tool runs, its output lands as the BRIEF at the top of the front's dossier.
Then: front on BOARD.md → iterations (ledger lines) → done-condition or
kill.

## Files touched

| File | Change |
|---|---|
| `hooks/contract-ship-gate.js` | NEW (~170 ln) |
| `hooks/block-destructive-git.js` | +2 built-in rules: `gh pr merge`, mutating `gh api` |
| `hooks/hooks.json` | +1 wiring |
| `hooks/lib/config.js` | + audit helper (fixed path) + corrupt-config signal + locked-contract atomic replace |
| `.gitignore` | NEW — scratch test dirs |
| `skills/orch/` | REMOVED (renamed) |
| `skills/go/SKILL.md` | NEW — driver: state machine + route/ship inline |
| `skills/go/{work,loop}.md` | NEW ×2, heavy phases on demand |
| `skills/{setup,goal}/SKILL.md` | NEW ×2 |
| `tests/` | NEW in-repo: audit, ship-gate, lock (ported), destructive-git smoke |
| `README.md` | rewritten around the premises + 3 commands |
| `.claude-plugin/plugin.json` | 0.3.0 |
