# Decision Contract (orch v0.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the decision contract (domain-based decide/ship rules), a deterministic ship-gate hook, a three-depth decision-record system (audit/Ruling/ADR), and restructure the skill into 3 commands with orch-decided phases.

**Architecture:** The contract lives in each project's `.claude/orch.json` (lock-file protected). A new PreToolUse hook gates `git commit/push/merge` by mapping touched files → domains → strictest ship grant. Skills split into `/orch:setup`, `/orch:goal`, and bare `/orch` (thin state machine loading `route.md`/`go.md`/`ship.md`/`loop.md` on demand).

**Tech Stack:** Node.js (no deps) hooks, Claude Code plugin skill markdown, plain-JS test scripts run with `node`.

**Spec:** `docs/superpowers/specs/2026-08-28-decision-contract-design.md`

## Global Constraints

- Hooks are dependency-free Node.js, `'use strict'`, CRLF-agnostic, ~10s timeout, wired via `${CLAUDE_PLUGIN_ROOT}` in `hooks/hooks.json`.
- Blocking hooks fail CLOSED (exit 2) on oversized (>1MB) or unverifiable input; a missing `contract` block means no-op (exit 0) so v0.2.0 installs are unaffected.
- Comment style: comments state constraints/why, never what-the-next-line-does.
- Skill/phase files: dense, exact, imperative — they are model instructions, not human docs. README: plain language, metaphors, glossary register.
- Tests: standalone `node` scripts using a scratch git repo + fake `USERPROFILE`/`HOME`; never touch the real `~/.claude/orch-lock.json`. Existing suites (7-case lock, 12-case hook matrix) must stay green.
- Commit after every task; do not push until the final task.

---

### Task 1: Audit append helper in `hooks/lib/config.js`

**Files:**
- Modify: `hooks/lib/config.js`
- Test: `tests/test-audit.js` (new; repo gets a `tests/` dir this release — move is NOT required for existing scratch tests)

**Interfaces:**
- Produces: `appendAudit(j, cfg, entry)` — `j` is the hook payload (uses `j.cwd`), `cfg` the loaded config, `entry` a plain object. Writes one JSON line (with `ts` ISO timestamp added) to `cfg.auditPath || '.claude/orch-audit.jsonl'` resolved against `j.cwd` (fallback `process.cwd()`). Never throws; on write failure prints a stderr warning and returns. Exported alongside `readStdin`, `loadConfig`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-audit.js`:

```js
// appendAudit: writes one JSON line with ts; bad dir warns, never throws.
'use strict';
const fs = require('fs');
const path = require('path');
const { appendAudit } = require('../hooks/lib/config');

const dir = path.join(__dirname, 'scratch-audit');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

appendAudit({ cwd: dir }, {}, { action: 'push', verdict: 'ALLOW' });
appendAudit({ cwd: dir }, {}, { action: 'push', verdict: 'BLOCK' });
const lines = fs.readFileSync(path.join(dir, '.claude', 'orch-audit.jsonl'), 'utf8').trim().split('\n');
check('two lines appended', lines.length === 2);
const e0 = JSON.parse(lines[0]);
check('ts stamped', typeof e0.ts === 'string' && !isNaN(Date.parse(e0.ts)));
check('fields kept', e0.action === 'push' && e0.verdict === 'ALLOW');

appendAudit({ cwd: dir }, { auditPath: 'custom/audit.jsonl' }, { a: 1 });
check('auditPath honored', fs.existsSync(path.join(dir, 'custom', 'audit.jsonl')));

let threw = false;
try { appendAudit({ cwd: 'Z:\\no\\such\\dir\\ever' }, {}, { a: 1 }); } catch { threw = true; }
check('bad dir never throws', !threw);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-audit.js`
Expected: crash — `appendAudit is not a function`.

- [ ] **Step 3: Implement `appendAudit` in `hooks/lib/config.js`**

Add before `module.exports` and export it:

```js
function appendAudit(j, cfg, entry) {
  // Audit is best-effort evidence, never a point of failure for the hook.
  const root = (j && j.cwd) || process.cwd();
  const p = path.resolve(root, (cfg && cfg.auditPath) || path.join('.claude', 'orch-audit.jsonl'));
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, line);
  } catch (e) {
    console.error(`orch: WARNING — audit write failed (${p}): ${e.message}`);
  }
}

module.exports = { readStdin, loadConfig, appendAudit };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-audit.js`
Expected: `4/4 pass`.

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/config.js tests/test-audit.js
git commit -m "feat: appendAudit helper — best-effort jsonl audit trail"
```

---

### Task 2: `hooks/contract-ship-gate.js` + wiring

**Files:**
- Create: `hooks/contract-ship-gate.js`
- Modify: `hooks/hooks.json` (PreToolUse Bash|PowerShell group)
- Test: `tests/test-ship-gate.js`

**Interfaces:**
- Consumes: `readStdin`, `loadConfig`, `appendAudit` from `./lib/config`.
- Produces: exit 0 (allow / no-op) or exit 2 + stderr block message. Audit entries `{action, files, domain, verdict, by:"hook"}` and `{event:"contract_changed", from, to, by:"hook"}`.

Behavior (from spec §1–§3):

- Detect `git`/`git.exe` segment containing subcommand `commit`, `push`, or `merge` (`SEG = '[^\n|;&]*'` style, same as block-destructive-git). `merge --abort/--continue/--quit` is not a ship — ignore.
- No `cfg.contract` or no `cfg.contract.domains` → exit 0 silently.
- Resolve touched files (run `git -C <j.cwd>` via `child_process.execFileSync`, 5s timeout):
  - commit → `diff --cached --name-only`; `commit -a` also unions `diff --name-only`.
  - push → `diff @{u}..HEAD --name-only`; on error (no upstream) → `log HEAD --not --remotes --name-only --format=` (dedupe).
  - merge → first non-flag arg after `merge` is the ref → `diff HEAD...<ref> --name-only`; no ref found → fail closed.
  - Any git invocation error (other than the push fallback chain) → fail CLOSED with "cannot resolve touched files".
  - Empty resolved list → exit 0 (nothing to gate; git itself will no-op).
- Glob → regex: split pattern on `/`; `**` → `.*`, `*` → `[^/]*`, `?` → `[^/]`, other chars regex-escaped; anchor `^...$`; match against forward-slashed repo-relative paths. `**/*.md`-style patterns must work.
- Grant ranks: `none=0, commit=1, merge=2, push=3`; action ranks `commit=1, merge=2, push=3`. Per-file grant = MIN over all matching domains (strictest); file matching no domain → 0. Overall grant = MIN over files. Action rank > overall grant → BLOCK naming ≤5 offending files, the governing domain (or "unmatched"), and who ships.
- Oversized stdin → exit 2 (blocking hook, fail closed). Corrupt contract (domains present but `decide`/`ship` values outside the enums, or paths not an array) → exit 2 with "contract invalid — fix .claude/orch.json".
- Contract hash: md5 of `JSON.stringify(cfg.contract)` stored at `os.tmpdir()/orch-contract-<md5(cwd)>`; on mismatch append `contract_changed` audit line with `from`/`to` = previous/current `contract.version` ("unknown" when absent) plus `versionBumped: from !== to`. First sighting writes the state file silently.
- Every ALLOW and BLOCK appends an audit line before exiting.

- [ ] **Step 1: Write the failing test**

Create `tests/test-ship-gate.js` — builds a scratch git repo, writes contracts, feeds payloads:

```js
// Ship-gate matrix (spec §6). Scratch repo; fake HOME so the real lock never interferes.
'use strict';
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'contract-ship-gate.js');
const SCRATCH = path.join(__dirname, 'scratch-ship');
const FAKEHOME = path.join(SCRATCH, 'home');
const REPO = path.join(SCRATCH, 'repo');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(REPO, '.claude'), { recursive: true });

function g(...args) { return execFileSync('git', ['-C', REPO, ...args]).toString(); }
g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');

function writeContract(domains) {
  fs.writeFileSync(path.join(REPO, '.claude', 'orch.json'),
    JSON.stringify({ contract: { version: 1, domains } }));
}
function run(cmd) {
  const payload = JSON.stringify({ session_id: 's', cwd: REPO, tool_input: { command: cmd } });
  try {
    execFileSync('node', [HOOK], { input: payload,
      env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe','pipe','pipe'] });
    return { code: 0 };
  } catch (e) { return { code: e.status, err: String(e.stderr) }; }
}
function stage(rel, content) {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content || 'x');
  g('add', rel);
}
let pass = 0, fail = 0, n = 0;
function check(name, cond, extra) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}${extra ? ' — ' + extra : ''}`); }
}

const DOMAINS = {
  docs:  { paths: ['docs/**', '**/*.md'], decide: 'ai', ship: 'push' },
  tests: { paths: ['tests/**'], decide: 'ai_with_ruling', ship: 'commit' },
  core:  { paths: ['src/core/**'], decide: 'human', ship: 'none' },
};

// 1. no contract -> no-op even for core files
fs.writeFileSync(path.join(REPO, '.claude', 'orch.json'), '{}');
stage('src/core/a.js');
check('no contract = no-op', run('git commit -m x').code === 0);

// 2. commit allowed: tests grant commit
writeContract(DOMAINS);
g('commit', '-q', '-m', 'seed');
stage('tests/t.js');
check('tests domain allows commit', run('git commit -m x').code === 0);

// 3. push blocked: tests grant stops at commit
g('commit', '-q', '-m', 't');
check('tests domain blocks push', run('git push').code === 2);

// 4. implied grant: docs push grant allows commit
stage('docs/readme-notes.txt');
check('push grant implies commit', run('git commit -m x').code === 0);
g('commit', '-q', '-m', 'd');

// 5. core blocks even commit
stage('src/core/b.js');
const r5 = run('git commit -m x');
check('core (ship none) blocks commit', r5.code === 2);
check('block names domain', /core/.test(r5.err || ''));
g('reset', '-q', 'HEAD', 'src/core/b.js');

// 6. strictest across files: docs + core staged -> block
stage('docs/x.txt'); stage('src/core/b.js');
check('strictest wins across files', run('git commit -m x').code === 2);
g('reset', '-q', 'HEAD');

// 7. no-match file -> block (omission never grants)
stage('mystery/z.bin');
check('unmatched path blocks', run('git commit -m x').code === 2);
g('reset', '-q', 'HEAD');

// 8. glob **/*.md matches nested
stage('deep/nest/notes.md');
check('**/*.md nested match allows commit', run('git commit -m x').code === 0);
g('commit', '-q', '-m', 'md');

// 9. corrupt contract (bad ship enum) -> fail closed
writeContract({ docs: { paths: ['docs/**'], decide: 'ai', ship: 'yeet' } });
stage('docs/y.txt');
check('invalid ship enum fails closed', run('git commit -m x').code === 2);

// 10. merge without ref -> fail closed
writeContract(DOMAINS);
check('merge no-ref fails closed', run('git merge').code === 2);

// 11. merge --abort ignored
check('merge --abort not gated', run('git merge --abort').code === 0);

// 12. non-git command ignored
check('non-git ignored', run('node -v').code === 0);

// 13. audit lines written (allow + block present)
const audit = fs.readFileSync(path.join(REPO, '.claude', 'orch-audit.jsonl'), 'utf8');
check('audit has ALLOW', /"verdict":"ALLOW"/.test(audit));
check('audit has BLOCK', /"verdict":"BLOCK"/.test(audit));

// 14. contract change logged
writeContract({ ...DOMAINS, extra: { paths: ['extra/**'], decide: 'ai', ship: 'push' } });
run('git commit -m x'); // any gated call re-hashes
const audit2 = fs.readFileSync(path.join(REPO, '.claude', 'orch-audit.jsonl'), 'utf8');
check('contract_changed logged', /contract_changed/.test(audit2));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-ship-gate.js`
Expected: crash — hook file does not exist.

- [ ] **Step 3: Implement `hooks/contract-ship-gate.js`**

```js
// PreToolUse (Bash|PowerShell) — the contract's ship gate. Maps a git
// commit/push/merge to the touched files, files to contract domains, and
// blocks any action exceeding the strictest matching grant.
// BLOCKING hook: fails CLOSED on oversized payloads, unresolvable file
// lists, and invalid contracts — an unverifiable ship is a blocked ship.
// No contract configured = no-op, so pre-contract installs are unaffected.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { readStdin, loadConfig, appendAudit } = require('./lib/config');

const { j, oversized } = readStdin();
if (oversized) {
  console.error('BLOCKED (orch ship-gate): oversized hook payload — command unverifiable, refusing.');
  process.exit(2);
}
if (!j) process.exit(0);
const cmd = (j.tool_input && (j.tool_input.command || '')) || '';
if (!cmd) process.exit(0);

const cfg = loadConfig(j);
const contract = cfg.contract;
if (!contract || !contract.domains || !Object.keys(contract.domains).length) process.exit(0);

const SEG = '[^\n|;&]*';
const G = '\\bgit(?:\\.exe)?\\b' + SEG;
let action = null;
if (new RegExp(G + '\\bcommit\\b').test(cmd)) action = 'commit';
else if (new RegExp(G + '\\bpush\\b').test(cmd)) action = 'push';
else if (new RegExp(G + '\\bmerge\\b').test(cmd) &&
         !new RegExp(G + '\\bmerge\\b' + SEG + '--(abort|continue|quit)\\b').test(cmd)) action = 'merge';
if (!action) process.exit(0);

function die(msg) {
  console.error(`BLOCKED (orch ship-gate): ${msg}`);
  process.exit(2);
}

// Contract validity gates everything below — a malformed contract must not
// silently grant.
const RANK = { none: 0, commit: 1, merge: 2, push: 3 };
for (const [name, d] of Object.entries(contract.domains)) {
  if (!Array.isArray(d.paths) || !(d.ship in RANK) ||
      !['ai', 'ai_with_ruling', 'human'].includes(d.decide)) {
    die(`contract invalid (domain "${name}") — fix .claude/orch.json`);
  }
}

const cwd = j.cwd || process.cwd();
function git(args) {
  return execFileSync('git', ['-C', cwd, ...args], { timeout: 5000 }).toString();
}
function names(out) {
  return [...new Set(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
}

let files;
try {
  if (action === 'commit') {
    files = names(git(['diff', '--cached', '--name-only']));
    if (/\bcommit\b[^\n|;&]*(\s-\w*a|\s--all\b)/.test(cmd)) {
      files = [...new Set([...files, ...names(git(['diff', '--name-only']))])];
    }
  } else if (action === 'push') {
    try { files = names(git(['diff', '@{u}..HEAD', '--name-only'])); }
    catch { files = names(git(['log', 'HEAD', '--not', '--remotes', '--name-only', '--format='])); }
  } else {
    const m = cmd.match(new RegExp(G + '\\bmerge\\b\\s+(?:-\\S+\\s+)*([\\w./-]+)'));
    if (!m) die('cannot determine merged ref — refusing to gate blind.');
    files = names(git(['diff', `HEAD...${m[1]}`, '--name-only']));
  }
} catch (e) {
  die(`cannot resolve touched files (${e.message.split('\n')[0]}) — refusing to gate blind.`);
}
if (!files.length) process.exit(0);

// Contract-change trail: hash mismatch = the rules moved; record it.
const hashFile = path.join(os.tmpdir(), 'orch-contract-' + crypto.createHash('md5').update(cwd).digest('hex'));
const curHash = crypto.createHash('md5').update(JSON.stringify(contract)).digest('hex');
const curVer = contract.version != null ? String(contract.version) : 'unknown';
try {
  const prev = fs.readFileSync(hashFile, 'utf8').split('\n');
  if (prev[0] !== curHash) {
    appendAudit(j, cfg, { event: 'contract_changed', from: prev[1] || 'unknown', to: curVer,
      versionBumped: (prev[1] || 'unknown') !== curVer, by: 'hook' });
  }
} catch {}
try { fs.writeFileSync(hashFile, curHash + '\n' + curVer); } catch {}

function globToRe(glob) {
  const parts = glob.split('/').map(part =>
    part === '**' ? '\u0000' :
    part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'));
  return new RegExp('^' + parts.join('/').replace(/\u0000\//g, '(?:.*/)?').replace(/\u0000/g, '.*') + '$');
}

let overall = 3, governing = null, offenders = [];
for (const f of files) {
  const p = f.replace(/\\/g, '/');
  let grant = null, gDom = null;
  for (const [name, d] of Object.entries(contract.domains)) {
    if (d.paths.some(pat => globToRe(pat).test(p))) {
      if (grant === null || RANK[d.ship] < grant) { grant = RANK[d.ship]; gDom = name; }
    }
  }
  if (grant === null) { grant = 0; gDom = 'unmatched'; }
  if (grant < overall) { overall = grant; governing = gDom; }
  if (grant < RANK[action] || (action === 'commit' && grant < 1)) {
    if (RANK[action] > grant) offenders.push(`${p} (${gDom})`);
  }
}

if (RANK[action] > overall) {
  appendAudit(j, cfg, { action, files, domain: governing, verdict: 'BLOCK', by: 'hook' });
  const who = governing === 'unmatched'
    ? 'no domain matches — omission never grants; propose a contract amendment (ADR) instead'
    : `domain "${governing}" grants "${Object.keys(RANK).find(k => RANK[k] === overall)}" — the operator ships this`;
  die(`git ${action} exceeds contract. ${who}. Files: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ` +${offenders.length - 5} more` : ''}`);
}
appendAudit(j, cfg, { action, files, domain: governing, verdict: 'ALLOW', by: 'hook' });
process.exit(0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-ship-gate.js`
Expected: `16/16 pass` (14 matrix + 2 audit-content sub-checks). Debug any regex/git-plumbing mismatch now — this file is the release's core.

- [ ] **Step 5: Wire into `hooks/hooks.json`**

In the existing `PreToolUse` → `"matcher": "Bash|PowerShell"` group's `hooks` array, append after block-destructive-git:

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/contract-ship-gate.js\"",
  "timeout": 10
}
```

- [ ] **Step 6: Regression: existing suites stay green**

Run: `node tests/test-audit.js`, then the v0.2.0 lock matrix (`node <scratchpad>/test-lock.js` if present; otherwise re-create per its committed history — it lives outside the repo). Confirm: destructive-git still blocks `git reset --hard` with no contract configured.
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add hooks/contract-ship-gate.js hooks/hooks.json tests/test-ship-gate.js
git commit -m "feat: contract ship-gate hook — domains, strictest grant, audit trail"
```

---

### Task 3: Bare `/orch` — thin state machine + four phase files

**Files:**
- Modify: `skills/orch/SKILL.md` (full rewrite)
- Create: `skills/orch/route.md`, `skills/orch/go.md`, `skills/orch/ship.md`, `skills/orch/loop.md`

**Interfaces:**
- Consumes: contract from `.claude/orch.json`; BRIEF + `ROUTE:` + ledger lines in `tmp/dossiers/<front>.md` (paths configurable via `sessionHygiene.trailPaths` conventions); BOARD.md.
- Produces: the artifact chain contract other files reference — BRIEF (written by Task 4's `:goal`), `ROUTE: <domain> · decide:<who> · ship:<grant> · tool:<skill|direct> · <date>` line, ledger lines (existing format), ADR files `docs/adr/NNNN-<slug>.md` with `Status: proposed|accepted|superseded` header.

- [ ] **Step 1: Rewrite `skills/orch/SKILL.md`**

Replace the whole file. Frontmatter `name: orch`; description: "Evidence-gated orchestration driver. Use for any work session: reads the board, dossiers, contract, and unratified ADRs, decides the current phase (route/go/ship/loop), loads that phase file, acts, and reports. The human decides only what the contract reserves for them."

Body (exact content):

```markdown
# /orch — the session driver

Premise: the operator decided ONCE (in `.claude/orch.json` → `contract`)
which domains are theirs. Everything else you decide, review, and ship
yourself — every decision leaves a record. You are the orchestrator:
frontier-tier judgment, verdict-only; suited cheap models execute.

## On every invocation

1. Read: BOARD.md (fronts + statuses) · the active front's dossier ·
   `docs/adr/` for `Status: proposed` entries · the contract.
2. Report ≤5 lines: front, phase, blockers, unratified ADRs, parked items.
3. Decide the phase from ARTIFACTS (never memory), load ONLY that file,
   act:

| Artifacts present | Phase | Load |
|---|---|---|
| no front / no BRIEF | — | tell operator: `/orch:goal` defines work; stop |
| BRIEF, no `ROUTE:` line | route | `route.md` |
| `ROUTE:` line, work unfinished | go | `go.md` |
| ledger evidence ready for the done-condition | ship | `ship.md` |
| operator asked for an autonomous run | loop | `loop.md` |

Never advance past a missing artifact — refuse and point back ("no ROUTE:
line yet — routing now"). Skipped steps are visible, never silent.

## The contract (read it before deciding anything)

- Every change classifies into a domain by `paths`; the `expertise` text
  breaks ties — semantics over globs ("touches web-ui paths but changes a
  setpoint calculation → numerics").
- `decide: human` → STOP and ask before acting. `ai_with_ruling` → act and
  write a `Ruling:` line. `ai` → act.
- Multi-match → strictest wins. No match → treat as human/none AND write a
  proposed ADR with a ready-to-paste amendment (domain, paths, expertise,
  decide/ship, rationale). You NEVER edit the contract yourself.
- INCONCLUSIVE verdicts always go to the operator, any domain.
- The ship-gate hook enforces the ship side deterministically — if it
  blocks you, that is the contract working, not an obstacle to route
  around. The operator overrides by running the command themselves.

## Decision records — three depths

- Audit line (hook writes gate calls; you mirror Rulings there):
  `{ts, action|decision, files|scope, domain, verdict, by:"ruling"}` to
  `.claude/orch-audit.jsonl`.
- `Ruling: <decision> — <why> — <cost if wrong>` in the dossier: small
  autonomous calls inside one front.
- ADR `docs/adr/NNNN-<slug>.md` (`Status:` header): anything shaping
  structure, contracts, or future decisions. Pair mode (operator present
  and agreeing) → `accepted` on write. Autopilot → ALWAYS `proposed`;
  surface unratified ADRs in step 2 every session until resolved via
  `/orch:setup`.

## Session end

Before compaction or clock-out: refresh the handoff file — ① done ② next
action ③ which phase the next session enters ④ blockers + owners. The
session-hygiene hook blocks heavy sessions that skip this.
```

- [ ] **Step 2: Create `skills/orch/route.md`**

```markdown
# Phase: route (BRIEF exists, no ROUTE: line)

1. Classify the front's intended change: match its declared/likely touched
   paths against contract domains; `expertise` text breaks ambiguity;
   strictest wins on multi-match; no match → park + proposed ADR (see
   SKILL.md), stop.
2. Decision signals for HOW to execute:
   - needs a number and cause UNKNOWN → measurement-first iteration
   - mechanical/spec-complete → cheapest tier, single review
   - judgment-heavy / high-consequence (numerics, security, data
     integrity, public contracts) → mid-tier implement + dual review
3. Pick the delegate tier (cheapest the shape allows) and the shaping tool
   already named in the BRIEF; the operator's per-task override always wins.
4. If domain `decide: human` → present plan ≤5 lines and STOP for approval.
   `ai_with_ruling` → write the Ruling, proceed. `ai` → proceed.
5. Append to the dossier:
   `ROUTE: <domain> · decide:<who> · ship:<grant> · tier:<model-tier> · <date>`
   Then enter phase go.
```

- [ ] **Step 3: Create `skills/orch/go.md`**

Content = the v0.2.0 review-ladder + record-discipline sections, verbatim where possible (they were already tested prose), reorganized:

```markdown
# Phase: go (ROUTE: exists, work unfinished)

Delegate execution to the tier named in the ROUTE: line. Reviewers are
verdict-only — a reviewer never implements the fix it proposes. Never
delegated: protected-directory edits, authored values without a cited
source, domain judgment the contract reserves for the operator.

## Review ladder (per hand-back — order is mandatory)

1. MECHANICAL first, cheap tier: empty-result check before anything — if
   the claimed diff is empty or a claimed artifact is absent/zero-length,
   auto-FAIL now; "agent ran, produced nothing" must never cost a review
   round. Then `git diff --stat` + build + scoped tests. Fail → straight
   back to the implementer. Hand-backs that add or change tests also get
   the test-quality audit: ① circular-oracle check (test derives expected
   values from the code under test = proves nothing) ② assertion-strength
   ladder (existence → type → status → value → behavioral; consequential
   verdicts need value-or-behavioral) ③ disabled-test scan (skipped tests
   found in review are findings).
2. JUDGMENT second: diff review by the strongest model, verdict-only.
   High-consequence hand-backs additionally get a second reviewer from a
   different model family in a FRESH context, same rubric — same-thread
   re-review only confirms old findings fixed. Verdicts are tri-state:
   PASS / FAIL / INCONCLUSIVE. INCONCLUSIVE holds for the operator — no
   auto-retry, no forced verdict, no round consumed. Both reviewers must
   PASS; one FAIL fails; one INCONCLUSIVE holds. Artifact reality check:
   claimed additions must pass EXISTS → SUBSTANTIVE → WIRED.
3. LOOP: on FAIL the implementer (never a reviewer) fixes ONLY flagged
   items; step 2 re-runs with fresh contexts. Initial review = round 1;
   cap 3 rounds. Stall (identity-based, never count-based): a finding
   from the previous round survives unresolved, or a new
   equal-or-higher-severity finding appears → escalate to the operator.
   Never merge dirty.

## Record discipline

Every iteration's dossier entry starts with
`iter <n> · <short-sha> · <metric before> → <after> · keep|revert|flat|refuted · <one-line what>`
then prose: hypothesis (written BEFORE the change), what changed, every
number, verdict. Autonomous calls:
`Ruling: <decision> — <why> — <cost if wrong>` (+ mirror to audit jsonl,
`by:"ruling"`). Simplicity criterion: improvement bought with
disproportionate complexity → flag `⚠complexity` for the operator; a flat
result that DELETED code is a win — keep it.

When the ledger satisfies the BRIEF's done-condition → phase ship.
```

- [ ] **Step 4: Create `skills/orch/ship.md`**

```markdown
# Phase: ship (ledger evidence ready)

## Merge gate — all three legs, or park for the operator

1. No regression — the full relevant suite, from the real runner's verdict
   line, never a filtered/wrapped view.
2. Measured improvement on the front's goal metric, exceeding the metric's
   documented noise band (repeated runs, pinned environment). Inside the
   band = INCONCLUSIVE → parks. "Flat but correct" and hygiene-only
   changes park for the operator.
3. Root cause, no band-aid — a patch masking a symptom or hardcoding
   around a defect stops for the operator regardless of green gates.

Evidence + baseline SHA go in the PR body / commit message.

## Contract ship check

The domain's `ship` grant decides who lands it: `none` → hand the operator
the exact command + evidence summary. `commit`/`merge`/`push` → you run
exactly the granted action; the ship-gate hook verifies independently —
if it blocks, re-read the contract instead of retrying variants. Append
the board row flip (evidence-before-done: a row flips to merged ONLY with
a ledger line or artifact path behind it; otherwise needs_attention) and
commit the board change with the work.
```

- [ ] **Step 5: Create `skills/orch/loop.md`**

```markdown
# Phase: loop (operator asked for an autonomous run)

Always a PROPOSAL — present the loop plan, get explicit approval, only
then launch. Preflight is unskippable.

Topology check first (advisory): loop-shaped means multiple uncertain
iterations against a metric. Single-pass or 2-3 known steps → say so and
do it directly instead.

Refuse to launch until all five hold (any ✗ → fix the prompt file first):
1. Machine-decidable completion promise — a probe/test/exit-code decides,
   never the loop's prose claim.
2. Boundaries stated — what the loop must NOT touch (protected dirs,
   authored values, the gates themselves, the contract).
3. Iteration cap AND spend budget set — the loop dies on whichever trips
   first, not only when context runs low.
4. Judge independence — the verdict comes from an external check's output,
   never the loop grading its own work.
5. Numeric ambiguity checklist (binary): inputs + units · the oracle ·
   tolerance vs noise band · measurement protocol · abort conditions.

In-loop rules: big calls (structure/contract-shaped) → proposed ADR, keep
going only if the work doesn't depend on the answer; otherwise park the
front and continue elsewhere. The ship-gate caps what the loop can land
regardless of what it believes.

Launch journal: on printing the loop command, append to the dossier:
`LAUNCH <date> · <prompt file> · max-iter <n> · budget <tokens> · promise <string>`
```

- [ ] **Step 6: Sanity-check skill loading**

Run: `node -e "const fs=require('fs');['SKILL.md','route.md','go.md','ship.md','loop.md'].forEach(f=>{const t=fs.readFileSync('skills/orch/'+f,'utf8');if(!t.length)throw f;console.log(f,t.split('\n').length,'lines')})"`
Expected: five files listed; SKILL.md well under its old 200+ lines (target ≤90).

- [ ] **Step 7: Commit**

```bash
git add skills/orch/
git commit -m "feat: bare /orch state machine + route/go/ship/loop phase files"
```

---

### Task 4: `/orch:setup` and `/orch:goal` skills

**Files:**
- Create: `skills/setup/SKILL.md`, `skills/goal/SKILL.md`

**Interfaces:**
- Consumes: contract schema (Task 2's validation enums), ADR format (Task 3), BRIEF format below.
- Produces: BRIEF format consumed by route.md: dossier header block with `goal:` `metric:` `done:` `domains:` `kill:` lines.

- [ ] **Step 1: Create `skills/setup/SKILL.md`**

Frontmatter `name: setup`; description: "Onboard a repo onto the orch contract, edit contract domains, configure the lock file and workflow tools, and ratify or reject proposed ADRs. Contract governance — the only place the contract changes."

```markdown
# /orch:setup — contract governance

The contract is the operator's ONE decision: which domains are theirs.
You interview, draft, and apply edits the operator approves. The plugin
(you included) never changes the contract without explicit operator
approval in this ritual.

## First run on a repo

1. Scan the repo (top-level dirs, build files, README) and propose 3-6
   candidate domains with paths.
2. For each, ask the operator: whose expertise? Fill:
   `decide: ai | ai_with_ruling | human` · `ship: push|merge|commit|none`
   (push ⊃ merge ⊃ commit ⊃ none). Record their WHY as the `expertise`
   text — it is what future classification reads to break ties.
3. Remind: omission never grants — anything unmatched parks and proposes
   an amendment. Do not aim for total coverage on day one.
4. Write `.claude/orch.json` → `contract` with `"version": 1`. Offer the
   lock file (`~/.claude/orch-lock.json`) for guards that must survive any
   project config, e.g. `{"destructiveGit": {"enabled": true}}`.
5. Offer `workflow.tools` overrides (defaults: fuzzy →
   superpowers:brainstorming, big → superpowers:writing-plans; native
   fallbacks otherwise).

## Editing an existing contract

Show the current domains as a table first. Apply the requested change,
bump `contract.version` by 1, and note the change in an accepted ADR
(one line context: what changed and why).

## Ratifying ADRs

List `docs/adr/*` with `Status: proposed`. For each: show its amendment,
ask accept / reject / defer. Accept → apply the contract edit, bump
version, flip the ADR to `Status: accepted`. Reject → flip to
`Status: rejected` with a one-line reason. Defer → leave, it resurfaces
in bare `/orch`.
```

- [ ] **Step 2: Create `skills/goal/SKILL.md`**

Frontmatter `name: goal`; description: "Create or edit a front: shape the goal into a one-page BRIEF (goal, metric, done-condition, contract domains touched, kill criteria) using the routed shaping tool, and register the front on the board."

```markdown
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

Native fallback — ask exactly three questions, one at a time:
1. What number (or observable) tells us this worked?
2. What must NOT change while we chase it?
3. When would you kill this front rather than keep iterating?

## Register

Add the front's row to BOARD.md (status: ready) and commit the board
edit. Classify the BRIEF's `domains:` line against the contract now — if
any part has `decide: human`, tell the operator where they will be needed.
Then hand to bare `/orch` (phase: route).
```

- [ ] **Step 3: Verify plugin skill discovery**

Run: `node -e "const fs=require('fs');['setup','goal'].forEach(d=>{const t=fs.readFileSync('skills/'+d+'/SKILL.md','utf8');if(!/^---/.test(t))throw d+' missing frontmatter';console.log(d,'ok')})"`
Expected: both ok. (Plugin skills surface as `/orch:setup`, `/orch:goal` from the plugin name + skill name.)

- [ ] **Step 4: Commit**

```bash
git add skills/setup/ skills/goal/
git commit -m "feat: /orch:setup (contract governance) + /orch:goal (brief ritual)"
```

---

### Task 5: README reframe

**Files:**
- Modify: `README.md` (full rewrite; keep Install section and hook table content, reframed)

- [ ] **Step 1: Rewrite `README.md`**

Structure (write fully, plain-language register; keep `girazan/orch` install lines and MIT):

1. Title + one-para premise: "You decide once which decisions are yours. orch handles the rest — planned, reviewed, and gated by a frontier AI, executed by cheaper AI, shipped by whoever your contract says, with small programs (hooks) enforcing the rules the AI cannot talk its way past."
2. "Why" — the operator's seven premises as short bullets (mental pain of many sessions; not every decision needs a human; workflows are hard, so orch decides the workflow; modern AI can judge; supervised autopilot; model specialization and price; multi-model review converges, never ends — so cap it and gate it).
3. The contract — the §1 JSON example verbatim + three plain sentences: domains are "whose expertise is this", omission never grants, the AI drafts amendments (ADRs) and you ratify.
4. Three commands table: `/orch:setup` (once per repo), `/orch:goal` (once per front), `/orch` (everything else — it knows the phase and only stops where your contract says).
5. What the AI leaves behind: audit jsonl / Ruling lines / ADRs — one line each.
6. Seven hooks table: v0.2.0 six + `contract-ship-gate` ("the AI physically cannot ship outside its grant — if it truly matters, you run the command yourself").
7. Configure: existing orch.json example + `contract` block + `workflow.tools` + lock-file paragraph (kept from v0.2.0).
8. Glossary: keep existing bridge rows; add contract → "decision rights matrix / RACI", ADR → "architecture decision record (standard industry term)", ship grant → "deploy permission".

- [ ] **Step 2: Self-check the README**

Run: `node -e "const t=require('fs').readFileSync('README.md','utf8');['contract','/orch:setup','/orch:goal','ship-gate','ADR','glossary'].forEach(k=>{if(!new RegExp(k,'i').test(t))throw 'missing: '+k});console.log('ok',t.split('\n').length,'lines')"`
Expected: ok, roughly 120–180 lines.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README reframed — the decision contract as the front door"
```

---

### Task 6: Version bump, full regression, ship

**Files:**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Bump version and description**

In `.claude-plugin/plugin.json`: `"version": "0.3.0"`; description → "The decision contract for AI-driven work: the human decides once which domains are theirs; frontier AI orchestrates, plans, reviews, and gates; cheap AI executes; shipping is enforced per contract by deterministic hooks; every decision leaves a record (audit trail, Rulings, ADRs)."

- [ ] **Step 2: Full regression**

Run: `node tests/test-audit.js && node tests/test-ship-gate.js`
Expected: all green. Then manual spot-checks:
- Payload `git reset --hard` with no contract → destructive-git still blocks (exit 2).
- Payload `git push` in a contract-less repo → ship-gate exits 0.
- `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json'))"` → parses.

- [ ] **Step 3: Skill-chain smoke check (manual, this session)**

Read `skills/orch/SKILL.md` as if entering with (a) no BRIEF (b) BRIEF only (c) BRIEF+ROUTE. Confirm the table routes each to the right phase file and the refusal text points backward. Fix wording inline if any state is ambiguous.

- [ ] **Step 4: Commit and push**

```bash
git add .claude-plugin/plugin.json
git commit -m "orch v0.3.0 — the decision contract"
git push
```

---

## Self-Review (done at planning time)

- Spec coverage: §1 → Task 2 validation + Task 4 setup; §2 → Task 2; §3 → Tasks 1–3 (audit helper, hook lines, ADR/Ruling text in phase files, ratification in setup); §4 → Tasks 3–4; §5 → Task 5; §6 → Tasks 1, 2, 6; §7 → Task 4 goal skill. No gaps.
- Placeholders: none — all code and skill text is written out.
- Type consistency: `appendAudit(j, cfg, entry)` used identically in Tasks 1–2; `RANK`/enums match between hook and setup skill text; BRIEF/ROUTE line formats match between goal, route.md, and SKILL.md tables.
