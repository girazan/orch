# orch

Evidence-gated orchestration for Claude Code. Built by a process engineer and
Claude for running agents on a production-adjacent numerics codebase, where
"the agent said it's done" is not evidence and a wrong merge costs real
measurement time.

**The premise:** an agent's DONE is a claim. This plugin turns claims into
evidence at four gates — routing, review, merge, loop launch — and enforces
the boundaries with deterministic hooks instead of prompt prose.

```
 route ──▶ implement ──▶ ①mechanical ──▶ ②judgment ──▶ ③loop(≤3) ──▶ merge gate
              │            build+tests     verdict-only,   identity-    3 legs +
              ▼            + test-quality  fresh-context   based stall  noise
         HOOK WALL         audit           dual review                  clause
   destructive-git ⛔ · protected dirs ⛔ · fact-force gate ·
   session hygiene (Stop) · context alarms (40/25) · run-on-commit
```

## Install

```
/plugin marketplace add girazan/orch
/plugin install orch@orch
```

## What you get

**One skill** — `/orch`: the operating contract. Review ladder (mechanical →
judgment → capped loop), 3-leg merge gate with a measurement-noise clause,
board conventions (a tracked `BOARD.md` whose git history is the campaign
journal), ledger-line + `Ruling:` record discipline, a five-check preflight
for autonomous loops, and a fixed handoff shape.

**Six hooks** — deterministic enforcement:

| Hook | Event | Behavior |
|---|---|---|
| `block-destructive-git` | PreToolUse | Blocks `push --force`, `reset --hard`, `branch -D`, `clean -f`, `stash pop/drop/clear`, `checkout .` — catches `-C`, `git.exe`, long flags. Fail-closed. Denials condense after 3/session. |
| `block-protected-dirs` | PreToolUse | Refuses writes into configured directories (acceptance targets, ground truth). Fail-closed. |
| `fact-force` | PreToolUse | First edit to a critical-surface file each session is DENIED with a fact checklist (callers, red test, reproduced number, units); the retry passes. Investigation beats self-evaluation. |
| `session-hygiene` | Stop | A heavy edit session cannot end while every configured trail file is untouched today. Blocks once. |
| `context-monitor` | PostToolUse | Two-stage context alarm: pre-alarm ("finish this iteration") at 40% remaining, trip ("checkpoint now") at 25%. Each fires once. Alarm-rationalized: every message names an action. |
| `run-on-commit` | PostToolUse | Runs a configured command detached after commits (keep a knowledge graph / codemap fresh automatically). |

## Configure

Per project: `<project>/.claude/orch.json`. Everything is optional; hooks that
need config no-op without it. The destructive-git block and context monitor
are on by default.

```json
{
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

## Design choices

- **Blocking hooks fail CLOSED** on oversized/unparseable input; advisory
  hooks fail open. An abnormal payload must not waive a guard.
- **Fresh-context dual review, both-must-PASS.** Same-thread re-review only
  confirms old findings are fixed — it never finds new ones. Two model
  families catch what one family's blind spot misses.
- **Identity-based stall detection.** Finding *counts* aren't comparable
  across fresh reviewers; a surviving finding is.
- **Noise clause on merges.** On a noisy metric, a single before/after number
  inside the noise band is INCONCLUSIVE, not an improvement.
- **Judge independence for loops.** A loop that writes its own verdict always
  converges to "done."
- **Alarm rationalization.** Every alert names the action available at that
  moment and fires once; a standing alarm trains itself ignored.

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
