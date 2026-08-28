# orch

Make your AI prove its work. Built by a process engineer and Claude for a
codebase where a wrong "looks good, merged!" costs real time and real money —
and shaped so you don't need a software-engineering background to use it.

**The premise:** when an AI says "done", that's a claim, not proof. This
plugin checks the claim at four moments — before work starts, when work comes
back, before a change is kept, and before the AI runs unattended — and the
most important rules are enforced by small programs (hooks) the AI *cannot*
talk its way past, instead of polite instructions it might forget.

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

**One skill** — `/orch`: the working agreement your AI follows. In plain terms:

- **Check work in stages** — cheap checks (does it build? do tests pass?)
  before expensive ones (careful review). For risky changes, a *second* AI
  from a different model family reviews in a fresh conversation — because an
  AI re-reading its own thread only confirms what it already believed.
- **Three questions before any change is kept:** did anything break? did the
  number actually get better — by more than the measurement's usual jitter?
  did we fix the cause, or hide the symptom? Any "no" → a human decides.
- **A status board that can't lie** — one tracked `BOARD.md` file, updated by
  commit, so its git history *is* the project diary.
- **Everything written down** — one summary line per work round, and any
  decision the AI made alone gets a `Ruling:` line (what it decided, why, and
  what it costs if wrong) so you can audit its judgment later.
- **A pre-flight checklist before unattended runs** — including the rule that
  the AI never grades its own homework: something external (a test, a probe,
  an exit code) decides whether it succeeded.

**Six hooks** — the rules that are *enforced*, not remembered:

| Hook | Plain meaning |
|---|---|
| `block-destructive-git` | The AI can't run git commands that destroy work (`push --force`, `reset --hard`, deleting branches, discarding files). If you truly want one, you run it yourself. |
| `block-protected-dirs` | Folders you declare untouchable stay untouchable — answer keys, ground-truth data, targets the AI is graded against. |
| `fact-force` | "Look before you touch": the first edit to a file you marked critical is refused until the AI states who calls that code, what test would catch a mistake, and what measurement justifies the change. Then the edit goes through. |
| `session-hygiene` | The AI can't clock out of a heavy work session without writing down what happened somewhere durable. |
| `context-monitor` | A low-fuel gauge for the AI's memory: one early "finish what you're doing" warning, one later "save your state NOW" warning. Each fires once — nagging trains itself ignored. |
| `run-on-commit` | After each commit, quietly re-runs a command you choose (like rebuilding a code map) so derived stuff never goes stale. |

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

- **When a safety rule can't verify its input, it refuses** (the blocking
  hooks); helper alerts do the opposite and stay quiet. A weird payload must
  never accidentally switch a guard off.
- **Fresh eyes find new problems.** An AI re-reviewing inside the same
  conversation only checks its old findings; a fresh conversation — ideally a
  different model family — finds what the first one is blind to. Both must
  say PASS.
- **"Still broken" beats "how many findings."** Review rounds are judged by
  whether a specific problem survived, not by whether the count went down —
  two reviewers can slice the same problems into different counts.
- **Jitter is not improvement.** If a result moved less than that
  measurement normally wobbles on its own, the honest verdict is
  "inconclusive", and inconclusive never merges.
- **The worker never grades its own homework.** Unattended runs succeed only
  when an external check (a test, a probe, an exit code) says so — a loop
  allowed to declare its own victory always declares it.
- **Alarms that always ring get ignored.** (Borrowed from control-room alarm
  management, where this is a life-safety discipline.) Every alert here names
  the action available at that moment, and fires once.

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
