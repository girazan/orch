# orch

Make your AI prove its work — and know exactly which decisions it's allowed
to make without you. Built by a process engineer and Claude for a codebase
where a wrong "looks good, merged!" costs real time and real money — and
shaped so you don't need a software-engineering background to use it.

**The frame:** you have intent and judgment, but only inside your specialty
and only for so many hours a week. Frontier AI now thinks and judges too, not
just types — but every model has a token budget and a price. orch splits the
work along those two limits. You write down, once, which domains are really
yours (the ones you're specialized in) and which aren't (the ones where
"reviewing the AI's work" would just be you nodding at code you can't
evaluate). In the domains that aren't yours, a *second* AI — a different
model, in a fresh conversation, with no memory of the first one's reasoning —
stands in as the judge: two independent readers catching each other's blind
spots beats one unqualified human rubber-stamping. Across the model roster,
the frontier model thinks (plans, routes, casts the final verdict), a
high-end model reviews (the fresh-context second opinion), a mid-tier model
executes, and a cheap model does the purely mechanical work — then a
frontier or high-end model reviews again before anything lands. You get the
report afterward, exactly as your contract says. Intent and judgment from
you; judgment and labor from the machines; and a written map of who's
specialized in what. **The map is the contract.**

## The premises

- **A claim isn't proof.** When an AI says "done", that's a claim. orch
  checks it — before work starts, when work comes back, before a change is
  kept, and before the AI runs unattended.
- **Rules the AI can't argue with beat rules it might forget.** The
  important ones are enforced by small programs (hooks), not polite
  instructions.
- **Cheap checks before expensive ones.** Does it build? Do tests pass? Only
  then does anyone spend review time on it.
- **Fresh eyes find new problems; the same eyes just re-confirm old beliefs.**
  A review inside the thread that wrote the code only checks what it already
  thought was fine.
- **The worker never grades its own homework.** Unattended runs succeed only
  when something external — a test, a probe, an exit code — says so.
- **A number moving less than its usual jitter isn't improvement.** The
  honest verdict is "inconclusive," and inconclusive never ships.
- **The AI judges well but hasn't learned everything.** When a goal depends
  on facts outside both the repo and the model's training — a post-cutoff
  API, a vendor's niche behavior, a paper — an optional research pass runs
  first, sources cited and confidence graded, so the plan stands on
  evidence, not a confident guess.

## Install

```
/plugin marketplace add girazan/orch
/plugin install orch@orch
```

## The contract

One file, `.claude/orch.json`, at your repo root:

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

Each domain is a territory of expertise, not a risk tier — `numerics` above
stays `decide: human` because that's where your judgment is real; `web-ui`
is `decide: ai` because forcing your sign-off there would just be theater.
`ship` is a ladder — `push` includes `commit` includes `none` — and there is
no `ship: merge`; the AI drafts amendments to this file as ADRs (see
Records, below) and you ratify them, but it never edits its own contract.
**Omission never grants anything** — work that matches no domain is treated
as the strictest case and parks for you.

One honest sentence on scope: the ship-gate hook gates the git *commands the
AI types* — deny-by-default outside a short read/local allowlist, and it
judges a commit or push by what's actually sitting in your repo — staged,
dirty, unpushed — never by the command's arguments, so argument tricks
(quoting, aliases, a `cd` mid-command) have nothing to fool. It is not a
sandbox: a script that runs `git` from inside is out of its sight. The lock
file and you are the lines behind it.

**What deny-by-default costs you, day to day:** the AI can't `pull`,
`merge` (including `--continue`), `rebase`, `cherry-pick`, `revert`, `am`,
`tag`, `commit --amend`, use a git alias, or run `remote` / `config` /
`submodule` / `worktree` — ever, contract or no. It also can't push when
nothing is pending, commit while a domain you reserved for yourself is
dirty, or make the very first push of a new branch if no remote default is
resolvable. Every one of those blocks names you, specifically, as the
override — if you truly want it done, you run it yourself.

## Three commands

- **`/orch:setup`** — once per repo. Interviews you into a contract (3-6
  starting domains), offers to mirror it into the lock file so no repo file
  can quietly loosen it, sets up `workflow.tools`, and is the only place
  that ratifies or rejects the AI's proposed contract amendments (ADRs).
- **`/orch:goal`** — once per new piece of work ("front"). Shapes a one-page
  brief (goal, metric, done-condition, domains touched, kill criteria) —
  routing to a brainstorm or a plan when the work calls for it, running a
  cited research pass first when the goal depends on facts the AI can't
  verify on its own — and puts the front on the board.
- **`/orch:go`** — everything else, every session after that. Reads the
  board, the front's notes, and the contract; decides the current phase on
  its own (route the work → do the work → ship it, or run a whole
  unattended loop) and stops only where the contract says a human must.
  There is no bare `/orch` — it's always one of these three.

## Records

Every decision leaves a trail, at three depths:

- **Audit line** — `.claude/orch-audit.jsonl`. One line per ship-gate
  decision (allowed, blocked, why), machine-written, never edited by hand.
- **`Ruling:` lines** — one per autonomous decision of consequence: what was
  decided, why, and what it costs if it's wrong. Written into the front's
  notes as the AI works, so you can audit its judgment later without
  replaying the whole session.
- **ADRs** — `docs/adr/NNNN-<slug>.md`. Anything that shapes structure, or
  the contract itself, gets one. When the AI decides alone, the ADR is
  always filed `proposed` — it surfaces at the top of your next `/orch:go`
  session until you ratify, reject, or replace it via `/orch:setup`.

## Seven hooks

The rules that are *enforced*, not remembered:

| Hook | Plain meaning |
|---|---|
| `block-destructive-git` | The AI can't run git commands that destroy work (`push --force`, `reset --hard`, deleting branches, discarding files) — and, as of this release, can't remote-merge a PR (`gh pr merge`) or make a mutating GitHub API call either. If you truly want one, you run it yourself. |
| `contract-ship-gate` | The AI can't ship outside the grant your contract gives it: every git command is denied unless it's on a short read/local allowlist (everyday local file ops like `add`, `restore`, `switch`, `stash` — nothing that ships) or is a `commit`/`push` your contract's `ship` value actually covers. If you truly want it shipped, you run the command yourself. |
| `block-protected-dirs` | Folders you declare untouchable stay untouchable — answer keys, ground-truth data, targets the AI is graded against. |
| `fact-force` | "Look before you touch": the first edit to a file you marked critical is refused until the AI states who calls that code, what test would catch a mistake, and what measurement justifies the change. Then the edit goes through. |
| `session-hygiene` | The AI can't clock out of a heavy work session without writing down what happened somewhere durable. |
| `context-monitor` | A low-fuel gauge for the AI's memory: one early "finish what you're doing" warning, one later "save your state NOW" warning. Each fires once — nagging trains itself ignored. |
| `run-on-commit` | After each commit, quietly re-runs a command you choose (like rebuilding a code map) so derived stuff never goes stale. |

## Configure

Per project: `<project>/.claude/orch.json`. Everything is optional; hooks
that need config no-op without it. `block-destructive-git` and
`context-monitor` are on by default; `contract-ship-gate` only activates
once you add a `contract` block.

```json
{
  "contract": {
    "version": 1,
    "domains": {
      "numerics": { "paths": ["src/Solver/**"], "decide": "human", "ship": "none" },
      "web-ui":   { "paths": ["src/Hmi.Web/**"], "decide": "ai",    "ship": "push" }
    }
  },
  "workflow": { "tools": { "research": "your-deep-research-tool" } },
  "protectedDirs": ["acceptance"],
  "factForce": {
    "pathRegex": "(Solver|Kernel|Continuity)",
    "scopeRegex": "(^|[\\\\/])src[\\\\/]",
    "facts": ["Every caller (grep, not memory).", "The red test.", "The reproduced number.", "Units on every quantity."]
  },
  "sessionHygiene": { "trailPaths": ["tmp/dossiers", "tmp/HANDOFF.md", "docs/BOARD.md"], "minEdits": 8 },
  "contextMonitor": { "window": 200000, "preAlarm": 0.40, "trip": 0.25 },
  "runOnCommit": { "command": "graphify", "args": ["update", "."] },
  "destructiveGit": { "extraPatterns": [{ "pattern": "taskkill\\s+/f\\s+/im", "name": "mass process kill" }] }
}
```

**Lock file (optional):** `~/.claude/orch-lock.json` — same shape as
`orch.json`, but it wins over every project's config. Use it to make sure no
per-repo file (yours, or one an agent wrote) can quietly switch a guard off:

```json
{ "destructiveGit": { "enabled": true } }
```

A locked `contract` is the strong version of this: it *replaces* the
project's `contract` block entirely rather than merging into it, so a
project file can never sneak in an extra permissive domain beside the ones
you locked. `/orch:setup` offers to mirror your contract into the lock file
the moment any domain is `decide: human` — worth doing, since the project
copy is agent-writable and the lock copy isn't.

## Glossary — our word → plain meaning → (industry term, if you want it)

| Our word | Plain meaning | Industry term |
|---|---|---|
| front | one ongoing piece of work | workstream / epic |
| board | the status table, one row per front | kanban board |
| dossier | the running notebook for one front | experiment log |
| ledger line | one-line summary of one work round | structured log entry |
| hand-back | work an AI returns claiming it's done | deliverable / PR |
| review ladder | staged checking, cheap → expensive | quality gates |
| merge gate | the three questions before keeping a change | definition of done |
| noise clause | "moved less than the usual wobble = not an improvement" | statistical significance |
| judge independence | the worker doesn't grade its own homework | the test-oracle problem |
| hook wall | rules enforced by programs, not by asking nicely | guardrails / policy-as-code |
| fact-force | look before you touch | (no standard term) |
| board theater | a status board that lies | cf. "security theater" |
| contract | your one-time map of who decides and who ships, per domain | decision rights matrix / RACI |
| ADR | a written record of a structural decision, proposed until you ratify it | architecture decision record |
| ship grant | how far the AI is allowed to push a change on its own | deploy permission |

## Lineage

Ideas adapted, with thanks: fresh-context re-review loops (Kenton Varda's
Fable/Sol observations) · dual-reviewer convergence, fact-force gating,
delivery gates, loop design review (affaan-m/ECC) · test-quality audit,
artifact EXISTS→SUBSTANTIVE→WIRED levels, context monitoring
(gsd-build/get-shit-done) · ledger-line experiment records and the simplicity
criterion (karpathy/autoresearch) · routing pipelines and git guardrails
(mattpocock/skills) · `Ruling:` lines (obra/superpowers).

## License

MIT
