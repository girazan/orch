# 🎛️ orch

**You decide once which decisions are yours. The AI handles the rest — and
can't ship past the line you drew.**

You have intent and judgment, but only inside your specialty. Frontier AI
now thinks and judges too, but every model has a budget and a price. orch
splits work along both limits: you write down which domains are really
yours, and in the ones that aren't, a *second* AI — different model, fresh
conversation — stands in as the judge, because two independent readers beat
one human nodding at code they can't evaluate. Frontier plans and rules,
high-end reviews, mid-tier executes, cheap does the mechanical work.

*The map of who's specialized in what is the contract.*

## 📦 Install

```
/plugin marketplace add girazan/orch
/plugin install orch@orch
```

## 📜 The contract

One file, `.claude/orch.json`, at your repo root:

```json
"contract": {
  "version": 1,
  "domains": {
    "numerics": { "paths": ["src/Solver/**"],  "expertise": "physics, units — mine",
                  "decide": "human", "ship": "none" },
    "web-ui":   { "paths": ["src/Hmi.Web/**"], "decide": "ai", "ship": "push" },
    "tests":    { "paths": ["tests/**"],       "decide": "ai", "ship": "commit" }
  }
}
```

- A domain is a **territory of expertise**, not a risk tier. `numerics` is
  `decide: human` because your judgment is real there; making you sign off
  on `web-ui` would be theater.
- `ship` is a ladder: `push` ⊃ `commit` ⊃ `none`. **Omission never grants** —
  anything matching no domain parks for you, and the AI drafts an amendment
  (an ADR) that only you can ratify.
- Mirror it into `~/.claude/orch-lock.json` and the locked copy *replaces*
  any project copy — the project file is agent-writable, the lock file isn't.

## ⌨️ Three commands

| Command | When | What |
|---|---|---|
| 🔐 `/orch:setup` | once per repo | interviews you into a contract, offers lock mirroring, ratifies ADRs |
| 🎯 `/orch:goal` | per piece of work | shapes a one-page brief: goal, metric, done-condition, kill criteria |
| 🚦 `/orch:go` | every session after | reads the board and contract, picks its own phase (route → work → ship, or a whole unattended loop), stops only where your contract says |

There is no bare `/orch`. [Architecture diagram →](docs/orch-architecture.html)

## 🧱 Seven hooks — enforced, not remembered

| Hook | Plain meaning |
|---|---|
| 🚢 `contract-ship-gate` | Deny-by-default git surface: every command is refused unless it's read/local or a `commit`/`push` your contract covers — judged by what's actually in your repo, never by the command's arguments. |
| 💣 `block-destructive-git` | No `push --force`, `reset --hard`, branch deletion, `gh pr merge`, or mutating `gh api`. |
| 🔒 `block-protected-dirs` | Folders you declare untouchable stay untouchable. |
| 🔍 `fact-force` | First edit to a critical file is refused until the AI states callers, the test that'd catch a mistake, and the number justifying it. |
| 🧹 `session-hygiene` | No clocking out of a heavy session without writing down what happened. |
| ⛽ `context-monitor` | Low-fuel gauge: one "finish up" warning, one "save state now". Each fires once. |
| 🔄 `run-on-commit` | Re-runs a command you choose after each commit, so derived artifacts never go stale. |

⚠️ **What that costs, honestly:** the AI can't `pull`, `merge`, `rebase`,
`cherry-pick`, `revert`, `tag`, `commit --amend`, use an alias, or touch
`remote`/`config`/`submodule`/`clone` — while a contract is active. It also
can't commit while a domain you reserved is dirty, or make a branch's first
push with no resolvable remote default. Every block names you as the
override. And it is **not a sandbox**: it reads the commands the AI types,
so a script that runs `git` from inside is out of its sight.

## 🧾 What it leaves behind

`.claude/orch-audit.jsonl` — one machine-written line per gate decision ·
`Ruling:` lines — one per autonomous call, with what it costs if wrong ·
`docs/adr/` — structural decisions, filed `proposed` when the AI decides
alone, surfacing every session until you ratify or reject them.

## ⚙️ Configure

Everything in `.claude/orch.json` is optional; hooks with no config no-op.
`block-destructive-git` and `context-monitor` are on by default;
`contract-ship-gate` activates with a `contract` block — except that a
corrupt `orch.json` blocks shipping until fixed, since a broken config must
never silently disable a guard.

```json
{
  "contract": { "...": "see above" },
  "workflow": { "tools": { "research": "your-deep-research-tool" } },
  "models": { "frontier": "opus", "high": "opus", "mid": "sonnet", "low": "haiku" },
  "protectedDirs": ["acceptance"],
  "factForce": { "pathRegex": "(Solver|Kernel)", "facts": ["Every caller (grep, not memory).", "The red test.", "The reproduced number.", "Units."] },
  "sessionHygiene": { "trailPaths": ["tmp/dossiers", "docs/BOARD.md"], "minEdits": 8 },
  "contextMonitor": { "window": 200000, "preAlarm": 0.40, "trip": 0.25 },
  "runOnCommit": { "command": "graphify", "args": ["update", "."] },
  "destructiveGit": { "extraPatterns": [{ "pattern": "taskkill\\s+/f\\s+/im", "name": "mass process kill" }] }
}
```

## 📖 Glossary

**front** one ongoing piece of work (workstream) · **board** the status
table, one row per front (kanban) · **dossier** a front's running notebook ·
**ledger line** one-line summary of one work round · **review ladder**
staged checking, cheap → expensive (quality gates) · **merge gate** the
three questions before keeping a change (definition of done) · **noise
clause** moved less than the usual wobble = not an improvement (statistical
significance) · **hook wall** rules enforced by programs, not by asking
nicely (policy-as-code) · **contract** your map of who decides and who
ships (decision rights / RACI) · **ADR** architecture decision record ·
**ship grant** how far the AI may push on its own (deploy permission).

## 🙏 Lineage

Ideas adapted, with thanks: fresh-context re-review loops (Kenton Varda) ·
dual-reviewer convergence and delivery gates (affaan-m/ECC) · test-quality
audit and context monitoring (gsd-build/get-shit-done) · ledger lines and
the simplicity criterion (karpathy/autoresearch) · routing pipelines and git
guardrails (mattpocock/skills) · `Ruling:` lines (obra/superpowers).

MIT
