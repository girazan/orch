# Decision Contract (orch v0.3.0) Implementation Plan — rev 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Rev 3 implements the operator-approved deny-by-default redesign after the
round-2 dual review (both FAIL): read-allowlisted git surface, state-based
file resolution (never parses command arguments), fixed audit path,
root-only config, atomic locked-contract replacement, unconditional
die-path auditing, quote-preserving tokenizer, gh verb gating,
closed-before-loop precedence.

**Goal:** Domain-based decision contract, deny-by-default ship-gate hook, three-depth decision records, 3-command skill surface.

**Architecture:** Contract at repo root `.claude/orch.json` (lock-replaceable). New PreToolUse hook: when an active contract exists, git subcommands outside a read/local allowlist are denied; `commit`/`push` are gated by repo STATE (staged ∪ dirty ∪ unpushed — argument parsing is never trusted); gh mutation verbs denied. Skills: `/orch:setup`, `/orch:goal`, `/orch:go`.

**Tech Stack:** Node.js (no deps) hooks; plugin skill markdown; `node` test scripts.

**Spec:** `docs/superpowers/specs/2026-08-28-decision-contract-design.md` (rev 5)

## Global Constraints

- Hooks: dependency-free Node, `'use strict'`, 10s timeout, `${CLAUDE_PLUGIN_ROOT}` wiring.
- Enums: `decide: ai|human` · `ship: none|commit|push` (RANK 0/1/2). ADR `Status: proposed|accepted|rejected|superseded`.
- Grammar (verbatim everywhere): BRIEF `goal:/metric:/done:/domains:/kill:`; `ROUTE: <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>`.
- Audit path is FIXED: `<repo-root>/.claude/orch-audit.jsonl`. Not configurable (a configurable path was a verified bypass).
- Test expectations are "script exits 0" — never a hardcoded N/N count. Every suite fakes `HOME`/`USERPROFILE`. Scratch repos: `commit.gpgsign=false`, `core.autocrlf=false`. Every suite must pass twice in a row.
- Commit per task; push only in the final task.

---

### Task 1: `lib/config.js` — audit helper, corrupt signal, atomic locked contract

**Files:**
- Modify: `hooks/lib/config.js`
- Create: `.gitignore`, `tests/test-audit.js`

**Interfaces:**
- Produces: `appendAudit(root, entry)` — appends `{ts, ...entry}` to `<root>/.claude/orch-audit.jsonl`; never throws. `AUDIT_REL = '.claude/orch-audit.jsonl'` exported constant. `loadConfig(j)` — as today, plus: non-enumerable `__corrupt: true` when a candidate orch.json exists but fails to parse; and if the LOCK contains an own `contract` key, the result's `contract` is the lock's contract VERBATIM (atomic replace — project domains cannot survive beside it); all other lock keys keep deep-merge.

- [ ] **Step 1: Create `.gitignore`**

```
tests/scratch-*/
```

- [ ] **Step 2: Write the failing test**

Create `tests/test-audit.js`:

```js
// appendAudit + AUDIT_REL + __corrupt + atomic locked contract.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'scratch-audit');
const FAKEHOME = path.join(dir, 'home');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(dir, 'proj', '.claude'), { recursive: true });
process.env.USERPROFILE = FAKEHOME; process.env.HOME = FAKEHOME;
const { appendAudit, AUDIT_REL, loadConfig } = require('../hooks/lib/config');
const PROJ = path.join(dir, 'proj');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

appendAudit(PROJ, { action: 'push', verdict: 'ALLOW' });
appendAudit(PROJ, { action: 'push', verdict: 'BLOCK' });
const lines = fs.readFileSync(path.join(PROJ, AUDIT_REL), 'utf8').trim().split('\n');
check('two lines appended at fixed path', lines.length === 2);
const e0 = JSON.parse(lines[0]);
check('ts stamped', typeof e0.ts === 'string' && !isNaN(Date.parse(e0.ts)));
check('fields kept', e0.action === 'push' && e0.verdict === 'ALLOW');

let threw = false;
try { appendAudit('Z:\\no\\such\\dir\\ever', { a: 1 }); } catch { threw = true; }
check('bad dir never throws', !threw);

fs.writeFileSync(path.join(PROJ, '.claude', 'orch.json'), '{ not json');
check('__corrupt on bad json', loadConfig({ cwd: PROJ }).__corrupt === true);
fs.writeFileSync(path.join(PROJ, '.claude', 'orch.json'),
  JSON.stringify({ contract: { version: 9, domains: { evil: { paths: ['**'], decide: 'ai', ship: 'push' } } }, other: 1 }));
check('no __corrupt on good json', loadConfig({ cwd: PROJ }).__corrupt !== true);

fs.writeFileSync(path.join(FAKEHOME, '.claude', 'orch-lock.json'),
  JSON.stringify({ contract: { version: 1, domains: { core: { paths: ['src/**'], decide: 'human', ship: 'none' } } } }));
const merged = loadConfig({ cwd: PROJ });
check('locked contract replaces project contract', merged.contract.version === 1);
check('project-added domain does NOT survive lock', merged.contract.domains.evil === undefined);
check('non-contract keys still merge', merged.other === 1);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node tests/test-audit.js`
Expected: crash — `appendAudit is not a function`.

- [ ] **Step 4: Implement in `hooks/lib/config.js`**

Replace `loadConfig` and add the helpers; keep `readStdin`, `deepMerge`, `loadLock` as-is:

```js
const AUDIT_REL = path.join('.claude', 'orch-audit.jsonl');

function loadConfig(j) {
  let cfg = {};
  let corrupt = false;
  const roots = [];
  if (j && j.cwd) roots.push(j.cwd);
  roots.push(process.cwd());
  for (const r of roots) {
    const p = path.join(r, '.claude', 'orch.json');
    try {
      if (fs.existsSync(p)) { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); break; }
    } catch {
      // Bad config never breaks a hook — but silently losing the guards the
      // user configured is worse than noise. Warn; blocking hooks see the
      // corruption and fail closed instead of running ungated.
      console.error(`orch: WARNING — ${p} is not valid JSON; configured guards are INACTIVE until fixed.`);
      corrupt = true;
      break;
    }
  }
  const lock = loadLock();
  let out = lock ? deepMerge(cfg, lock) : cfg;
  // A locked contract REPLACES the project's — an additive merge would let
  // the agent-writable project file add permissive domains beside it.
  if (lock && Object.prototype.hasOwnProperty.call(lock, 'contract')) out.contract = lock.contract;
  if (corrupt) Object.defineProperty(out, '__corrupt', { value: true });
  return out;
}

function appendAudit(root, entry) {
  // Audit is best-effort evidence, never a point of failure for the hook.
  const p = path.resolve(root || process.cwd(), AUDIT_REL);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.error(`orch: WARNING — audit write failed (${p}): ${e.message}`);
  }
}

module.exports = { readStdin, loadConfig, appendAudit, AUDIT_REL };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test-audit.js`
Expected: exit 0, all pass.

- [ ] **Step 6: Commit**

```bash
git add .gitignore hooks/lib/config.js tests/test-audit.js
git commit -m "feat: fixed-path audit helper, corrupt-config signal, atomic locked contract"
```

---

### Task 2: In-repo regression suites (fully inlined)

**Files:**
- Create: `tests/test-lock.js`, `tests/test-destructive.js`

- [ ] **Step 1: Create `tests/test-lock.js`** (complete body — no external references):

```js
// v0.2.0 lock semantics regression. Fake HOME throughout.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'block-destructive-git.js');
const SCRATCH = path.join(__dirname, 'scratch-lock');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
const LOCK = path.join(FAKEHOME, '.claude', 'orch-lock.json');
const PROJCFG = path.join(PROJ, '.claude', 'orch.json');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
fs.mkdirSync(path.dirname(PROJCFG), { recursive: true });

function run(cmd, sid) {
  const payload = JSON.stringify({ session_id: sid, cwd: PROJ, tool_input: { command: cmd } });
  try {
    execFileSync('node', [HOOK], { input: payload,
      env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}
function rmIf(p) { try { fs.unlinkSync(p); } catch {} }
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const CMD = 'git reset --hard HEAD~1';

rmIf(PROJCFG); rmIf(LOCK);
check('default blocks reset --hard', run(CMD, 't1') === 2);
fs.writeFileSync(PROJCFG, JSON.stringify({ destructiveGit: { enabled: false } }));
check('project enabled:false disables guard', run(CMD, 't2') === 0);
fs.writeFileSync(LOCK, JSON.stringify({ destructiveGit: { enabled: true } }));
check('lock overrides project disable', run(CMD, 't3') === 2);
fs.writeFileSync(LOCK, '{ not json');
check('corrupt lock falls back to project cfg', run(CMD, 't4') === 0);
fs.writeFileSync(PROJCFG, JSON.stringify({
  destructiveGit: { enabled: true, extraPatterns: [{ pattern: 'taskkill\\s+/f', name: 'mass kill' }] } }));
fs.writeFileSync(LOCK, JSON.stringify({ destructiveGit: { enabled: true } }));
check('deep merge keeps project extraPatterns', run('taskkill /f /im dotnet.exe', 't5') === 2);
rmIf(PROJCFG);
fs.writeFileSync(LOCK, JSON.stringify({ destructiveGit: { extraPatterns: [{ pattern: 'rm\\s+-rf\\s+/', name: 'rm -rf root' }] } }));
check('lock-only extraPatterns active', run('rm -rf /etc', 't6') === 2);
rmIf(LOCK);
check('benign command passes with no lock', run('git status', 't7') === 0);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Create `tests/test-destructive.js`** (same harness shape, fake HOME, no config files):

```js
// destructive-git guard smoke. Fake HOME so the real lock never interferes.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'block-destructive-git.js');
const SCRATCH = path.join(__dirname, 'scratch-destr');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });

function run(cmd) {
  const payload = JSON.stringify({ session_id: 's', cwd: PROJ, tool_input: { command: cmd } });
  try {
    execFileSync('node', [HOOK], { input: payload,
      env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
check('push --force blocked', run('git push --force') === 2);
check('reset --hard blocked', run('git reset --hard') === 2);
check('git.exe -C variant blocked', run('git.exe -C x reset --hard') === 2);
check('stash pop blocked', run('git stash pop') === 2);
check('status allowed', run('git status') === 0);
check('plain push allowed', run('git push') === 0);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run both**

Run: `node tests/test-lock.js && node tests/test-destructive.js`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/test-lock.js tests/test-destructive.js
git commit -m "test: inline lock + destructive-git regression suites in-repo"
```

---

### Task 3: `hooks/contract-ship-gate.js` (deny-by-default) + wiring

**Files:**
- Create: `hooks/contract-ship-gate.js`
- Modify: `hooks/hooks.json`
- Test: `tests/test-ship-gate.js`

**Interfaces:**
- Consumes: `readStdin`, `loadConfig`, `appendAudit`, `AUDIT_REL`.
- Produces: exit 0/2; audit entries on EVERY exit except the inactive-contract and no-git-content exits: `{action, files?, domain?, verdict, reason?, by:"hook"}` where `action` ∈ `commit|push|denied:<word>|retarget|invalid` (the real label, never a default).

- [ ] **Step 1: Implement `hooks/contract-ship-gate.js`** (implementation first this round; the test file in Step 2 is the spec §6 matrix and is the acceptance authority):

```js
// PreToolUse (Bash|PowerShell) — the contract's ship gate.
// DENY-BY-DEFAULT: with an active contract, git subcommands outside a
// read/local allowlist are refused; commit/push are gated by repo STATE
// (staged ∪ dirty ∪ unpushed) — command arguments are never trusted for
// file resolution, so quoting/pathspec/alias games have nothing to bypass.
// Fail CLOSED on: corrupt/invalid config, retargeting (cd/-C/GIT_DIR),
// denied verbs, non-narrow push args, unresolvable base, empty file set,
// oversized payload. Inactive (no contract key, or valid empty domains)
// is the only silent pass-through. Every other exit writes an audit line.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { readStdin, loadConfig, appendAudit, AUDIT_REL } = require('./lib/config');

const RANK = { none: 0, commit: 1, push: 2 };
const READ_ALLOW = new Set(['status','log','diff','show','fetch','add','rm','mv','restore','switch',
  'checkout','branch','stash','rev-parse','ls-files','ls-remote','describe','blame','shortlog',
  'reflog','remote','worktree','submodule','init','clone','config','clean','grep','apply',
  'format-patch','archive','help','version']);
const GH_READ = new Set(['view','list','status','checks','diff']);

const { j, oversized } = readStdin();
const cmd = (j && j.tool_input && (j.tool_input.command || '')) || '';

function tokens(seg) {
  // Quote-preserving: "a b" and 'a b' become single tokens WITH their
  // content — quoted refspecs/pathspecs are seen, never deleted.
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
  return out;
}

function classify(command) {
  const res = { action: 0, denied: null, retarget: false, amend: false };
  const hasEnvRetarget = /GIT_DIR|GIT_WORK_TREE/.test(command);
  const hasCd = /(^|[|;&\n])\s*(cd|pushd|Set-Location)\b/i.test(command);
  for (const seg of command.split(/[|;&\n]+/)) {
    const t = tokens(seg);
    const gi = t.findIndex(x => /^git(\.exe)?$/i.test(x));
    if (gi >= 0) {
      let sub = null, retarget = false;
      for (let i = gi + 1; i < t.length; i++) {
        const x = t[i];
        if (x === '-c' || x === '-C') { if (x === '-C') retarget = true; i++; continue; }
        if (/^--?(git-dir|work-tree)/.test(x)) { retarget = true; continue; }
        if (x.startsWith('-')) continue;
        sub = x; break;
      }
      if (sub === null) continue; // bare `git` / flags only: git errors by itself
      if (READ_ALLOW.has(sub)) continue; // retarget flags on read ops are harmless
      if (retarget) { res.retarget = true; }
      if (sub === 'commit') {
        res.action = Math.max(res.action, 1);
        if (t.includes('--amend')) res.amend = true;
      } else if (sub === 'push') {
        res.action = Math.max(res.action, 2);
        res.pushSeg = t.slice(gi + 1);
      } else {
        // Unknown, aliased, quote-mangled, or history-writing subcommand.
        res.denied = res.denied || `git ${sub}`;
      }
    }
    const ghi = t.findIndex(x => /^gh(\.exe)?$/i.test(x));
    if (ghi >= 0) {
      const verb = t.slice(ghi + 1).find(x => !x.startsWith('-'));
      const sub2 = t.slice(ghi + 1).filter(x => !x.startsWith('-'))[1];
      const v = GH_READ.has(sub2) ? sub2 : GH_READ.has(verb) ? verb : null;
      if (!v) res.denied = res.denied || `gh ${verb || ''} ${sub2 || ''}`.trim();
    }
  }
  if ((res.action > 0 || res.denied) && (hasEnvRetarget || hasCd)) res.retarget = true;
  return res;
}

const cls = cmd ? classify(cmd) : { action: 0, denied: null, retarget: false };
if (!oversized && cls.action === 0 && !cls.denied) process.exit(0);

const cwd = (j && j.cwd) || process.cwd();
let root = null;
try { root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 5000 }).toString().trim(); }
catch {}
const cfg = loadConfig({ cwd: root || cwd });
const contract = cfg.contract;
const label = cls.denied ? `denied:${cls.denied}` : cls.action === 2 ? 'push' : 'commit';

function die(reason, extra) {
  appendAudit(root || cwd, { action: (extra && extra.action) || label, ...(extra || {}), verdict: 'BLOCK', reason, by: 'hook' });
  console.error(`BLOCKED (orch ship-gate): ${reason}`);
  process.exit(2);
}

if (oversized) die('oversized hook payload — command unverifiable.', { action: 'invalid' });
if (cfg.__corrupt) die('.claude/orch.json is not valid JSON — the contract cannot be read; fix it first.', { action: 'invalid' });
if (!contract) process.exit(0);
// Contract key present: validate the WHOLE shape before any inactive/no-op decision.
if (typeof contract !== 'object' || contract === null || Array.isArray(contract) ||
    typeof contract.domains !== 'object' || contract.domains === null || Array.isArray(contract.domains)) {
  die('contract present but malformed — fix .claude/orch.json', { action: 'invalid' });
}
for (const [name, d] of Object.entries(contract.domains)) {
  if (!d || typeof d !== 'object' ||
      !Object.prototype.hasOwnProperty.call(RANK, d.ship) ||
      !['ai', 'human'].includes(d.decide) ||
      !Array.isArray(d.paths) || !d.paths.every(p => typeof p === 'string')) {
    die(`contract invalid (domain "${name}") — fix .claude/orch.json`, { action: 'invalid' });
  }
}
if (!Object.keys(contract.domains).length) process.exit(0); // valid, deliberately inactive
if (!root) die('not inside a git repository yet a git ship action was issued — refusing to gate blind.', { action: 'invalid' });

if (cls.retarget) die('cd/pushd/-C/--git-dir/GIT_DIR retargeting alongside a gated git action — this gate covers one repo; the operator runs cross-repo commands.', { action: 'retarget' });
if (cls.denied) die(`${cls.denied} is not on the contract's git surface (read/local commands, commit, push). The operator runs it, or an ADR grants a workflow that needs it.`);

function git(args) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { timeout: 5000 }).toString();
}
function names(out) {
  return [...new Set(out.split(/\r?\n/).map(s => s.replace(/[\r\n]+$/, '')).filter(Boolean))];
}

if (cls.action === 2) {
  // Narrow push shape, evaluated on quote-preserved tokens.
  const ALLOWED_FLAGS = new Set(['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose']);
  const pt = (cls.pushSeg || []).slice((cls.pushSeg || []).indexOf('push') + 1);
  const flags = pt.filter(x => x.startsWith('-'));
  const pos = pt.filter(x => !x.startsWith('-'));
  let branch = null;
  try { branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(); } catch {}
  if (flags.some(f => !ALLOWED_FLAGS.has(f)) || pt.some(x => x.includes(':')) ||
      pos.length > 2 || (pos.length === 2 && pos[1] !== branch && pos[1] !== 'HEAD')) {
    die('push arguments outside the narrow shape (plain / <remote> / -u <remote> <current-branch>) — the operator runs it.');
  }
}

let files = [];
try {
  // STATE-based, always-union: strict superset of anything a commit/push
  // variant could land. No argument parsing exists to bypass.
  files.push(...names(git(['diff', '--cached', '--name-only'])));
  files.push(...names(git(['diff', '--name-only'])));
  if (cls.amend) files.push(...names(git(['diff', 'HEAD^', 'HEAD', '--name-only'])));
  if (cls.action === 2) {
    let base = null;
    for (const ref of ['@{push}', '@{u}']) {
      try { base = git(['rev-parse', ref]).trim(); break; } catch {}
    }
    if (!base) {
      try {
        const def = git(['symbolic-ref', 'refs/remotes/origin/HEAD']).trim();
        base = git(['merge-base', 'HEAD', def]).trim();
      } catch {}
    }
    if (!base) die("push base unresolvable (no upstream, no origin default) — the first push is the operator's.");
    files.push(...names(git(['diff', `${base}..HEAD`, '--name-only'])));
  }
} catch (e) {
  die(`cannot resolve repo state (${String(e.message).split('\n')[0]}) — refusing to gate blind.`);
}
files = [...new Set(files)];
if (!files.length) {
  die("nothing resolvable to gate — empty/fileless mutations (--allow-empty, tag moves) are the operator's.");
}

function globToRe(glob) {
  const parts = glob.split('/').map(part =>
    part === '**' ? '\u0000' :
    part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'));
  return new RegExp('^' + parts.join('/').replace(/\u0000\//g, '(?:.*/)?').replace(/\u0000/g, '.*') + '$');
}

const auditRel = AUDIT_REL.replace(/\\/g, '/');
let overall = 2, governing = null, offenders = [];
for (const f of files) {
  const p = f.replace(/\\/g, '/');
  if (p === auditRel) continue; // hook-authored evidence must never deadlock its own gate
  let grant = null, gDom = null;
  for (const [name, d] of Object.entries(contract.domains)) {
    if (d.paths.some(pat => globToRe(pat).test(p))) {
      if (grant === null || RANK[d.ship] < grant) { grant = RANK[d.ship]; gDom = name; }
    }
  }
  if (grant === null) { grant = 0; gDom = 'unmatched'; }
  if (governing === null || grant < overall) { overall = grant; governing = gDom; }
  if (grant < cls.action) offenders.push(`${p} (${gDom})`);
}
if (governing === null) die('only the audit file is pending — nothing gateable; the operator decides.');

if (cls.action > overall) {
  appendAudit(root, { action: label, files, domain: governing, verdict: 'BLOCK', by: 'hook' });
  const who = governing === 'unmatched'
    ? 'no domain matches — omission never grants; write a proposed ADR amendment instead'
    : `domain "${governing}" grants "${Object.keys(RANK).find(k => RANK[k] === overall)}" — the operator ships this`;
  console.error(`BLOCKED (orch ship-gate): git ${label} exceeds contract. ${who}. Files: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ` +${offenders.length - 5} more` : ''}`);
  process.exit(2);
}
appendAudit(root, { action: label, files, domain: governing, verdict: 'ALLOW', by: 'hook' });
process.exit(0);
```

- [ ] **Step 2: Write the acceptance matrix**

Create `tests/test-ship-gate.js` — same harness conventions as Task 2
(fake HOME, `rmrf` with chmod teardown, `g()` helper, bare remote,
`gpgsign=false`, `autocrlf=false`). Contract fixture:

```js
const DOMAINS = {
  docs:  { paths: ['docs/**', '**/*.md'], decide: 'ai', ship: 'push' },
  tests: { paths: ['tests/**'], decide: 'ai', ship: 'commit' },
  core:  { paths: ['src/core/**'], decide: 'human', ship: 'none' },
  claude: { paths: ['.claude/**'], decide: 'ai', ship: 'push' },
};
```

Checks, in order (each line = one `check()`; keep repo state hygienic —
after every ALLOW-commit check, `g('commit')` + `g('push')` the real thing
so later push checks see a clean base; after every BLOCK check, unstage
and delete the offending file):

INACTIVE / INVALID
1. `{}` config, staged core file, `git commit -m x` → 0 (no contract key)
2. `{"contract":{"domains":{}}}` → 0 (valid, inactive)
3. `{"contract":{}}` → 2 (malformed: no domains)
4. `{"contract":{"domains":null}}` → 2
5. domain entry `null` → 2 (no throw — clean die)
6. `ship:"toString"` → 2 · 7. `ship:"yeet"` → 2 · 8. non-array paths → 2
9. corrupt file `{ nope` → 2 for `git commit -m x` · 10. corrupt + `ls` → 0

BASIC GRANTS (contract = DOMAINS from here on)
11. staged tests file, `git commit -m x` → 0 (allow; then commit+push it)
12. unpushed tests commit, `git push` → 2 (commit grant stops at push)
13. staged docs file, commit → 0 · 14. its push → 0 (push grant)
15. staged core file, commit → 2, stderr names `core`
16. staged docs + core together → 2 (strictest across files)
17. staged unmatched `mystery/z.bin` → 2, stderr mentions ADR/amendment
18. staged `deep/nest/notes.md` → 0 (`**/*.md` nested)
19. staged `docs2/evil.bin` → 2 (anchoring)

ALWAYS-UNION TRADE-OFF
20. clean tree + tracked core file made dirty (unstaged), staged docs
    file, `git commit -m x` → 2 (documented price of state-based gating;
    then `git checkout -- <core file>` to clean)

SEGMENTS / DENY-BY-DEFAULT
21. `git commit -m x && git push` with only commit-grant files → 2
22. `git push && git commit -m x` → 2 (order independent)
23. `git ci -m x` → 2 (alias = unknown) · 24. `git p'u'sh` → 2 (quoted)
25. `C=push; git $C` → 2 (`$C` not a known word)
26. `git pull` → 2 · 27. `git tag v1` → 2
28. `git merge feat` → 2 · 29. `git merge --continue` → 2
30. `git rebase main` → 2 · 31. `git cherry-pick abc` → 2
32. `git revert HEAD` → 2 · 33. `git am patch` → 2
34. `git commit -m "revert the parser fix"` → 0 with clean staged docs
    (blocked words in MESSAGES are fine — subcommand-position matching)
35. `git status` / `git log` / `git checkout -b x` → all 0 (allowlist)

RETARGET
36. `git -C ../other push` → 2 · 37. `git --git-dir=x push` → 2
38. `GIT_DIR=/x git push` → 2 · 39. `cd ../victim && git commit -m x` → 2
40. `cd sub && git status` → 0 (cd + read op is benign)

GH
41. `gh pr merge 5` → 2 · 42. `gh api -X PUT repos/o/r/contents/x` → 2
43. `gh release create v1` → 2 · 44. `gh pr view 5` → 0

PUSH SHAPE
45. `git push origin feature:main` → 2 · 46. `git push origin "feature:main"` → 2 (quoted refspec SEEN)
47. `--all` → 2 · 48. `--mirror` → 2 · 49. `--tags` → 2
50. `--delete br` → 2 · 51. `--force` → 2 · 52. `--follow-tags` → 2 (unknown flag)
53. `git push -u origin <current-branch>` → 0 with pushable state
54. `git commit --allow-empty -m x` on clean tree → 2 (empty set)
55. `--amend` with amended core file in HEAD → 2 (amend union)

MERGE-COMMIT PUSH (diff-not-log)
56. build: branch with docs file, merge into main with `g()` (harness,
    not hook), delete upstream ref so base falls to merge-base → `git
    push` → 0 AND audit files include the merged docs file (prove the
    diff saw merged content)

LOCK REPLACEMENT
57. project adds domain `free: {paths:['free/**'], ship:'push'}`, lock
    mirrors DOMAINS only; staged `free/x.txt`, commit → 2 (project-added
    domain dead under lock; then remove lock)

AUDIT
58. audit file has ALLOW lines with `"domain":` · 59. has BLOCK lines ·
60. has `"action":"denied:git merge"` (real label) · 61. has a `reason`
    line from a die path · 62. oversized payload (>1MB command) → 2 AND
    a new audit line appears (unconditional die audit)
63. stage the audit file itself (`git add -f`) + docs file → commit → 0
    (self-exemption; with `.claude/**` granting push this also passes
    without exemption — so ALSO assert the audit jsonl's own path is
    absent from the logged `files` array, which only the exemption does)

Run expectation everywhere: the script prints `N/N pass` and exits 0 —
never assert a hardcoded total in the plan or in step text.

- [ ] **Step 3: Run the matrix**

Run: `node tests/test-ship-gate.js` — twice.
Expected: exit 0 both times. Debug the hook, never weaken a check.

- [ ] **Step 4: Wire into `hooks/hooks.json`** — append to the PreToolUse `"Bash|PowerShell"` group:

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/contract-ship-gate.js\"",
  "timeout": 10
}
```

- [ ] **Step 5: Wiring + regression**

Run: `node -e "const h=require('./hooks/hooks.json');const g=h.hooks.PreToolUse.find(x=>x.matcher==='Bash|PowerShell');if(!g.hooks.some(k=>k.command.includes('contract-ship-gate')))throw 'not wired';console.log('wired')"`
Then: `node tests/test-audit.js && node tests/test-lock.js && node tests/test-destructive.js`
Expected: wired; all exit 0.

- [ ] **Step 6: Commit**

```bash
git add hooks/contract-ship-gate.js hooks/hooks.json tests/test-ship-gate.js
git commit -m "feat: deny-by-default contract ship-gate — state-based resolution, quote-preserving tokenizer"
```

---

### Task 4: `/orch:go` — driver skill + `work.md` + `loop.md`

**Files:**
- Delete: `skills/orch/`
- Create: `skills/go/SKILL.md`, `skills/go/work.md`, `skills/go/loop.md`

Content is rev 2's Task 4 text with THREE amendments (everything else
verbatim from that revision — frontmatter included in the fences):

1. Phase table — `closed` FIRST, then `loop` (a merged front + "run
   overnight" message must stop, not loop):

```markdown
| # | Condition | Phase |
|---|---|---|
| 1 | board row `merged` | closed → report, stop; a merged front never re-enters ship or loop |
| 2 | operator's message asks for an autonomous run | loop → load `loop.md` |
| 3 | no front / no BRIEF | → point to `/orch:goal`, stop |
| 4 | BRIEF, no `ROUTE:` line | route (below) |
| 5 | `ROUTE:` exists, done-condition not evidenced | work → load `work.md` |
| 6 | ledger satisfies the BRIEF's `done:` | ship (below) |
```

2. Phase: route — insert as new step 2 (renumber the rest):

```markdown
2. Knowledge-gap re-check: if routing surfaces facts you can neither
   derive from the repo nor verify from training (post-cutoff APIs, niche
   domain facts, vendor specifics), run the research route (see
   /orch:goal's shaping table) BEFORE writing the ROUTE line; cite its
   findings note in the dossier.
```

3. "The contract" section — replace the ship-gate sentence with:

```markdown
- The ship-gate hook enforces the ship side deny-by-default: git
  subcommands outside its read/local allowlist are refused entirely, and
  commit/push are judged on repo STATE (staged ∪ dirty ∪ unpushed), so a
  dirty human-domain file blocks any commit until dealt with — clean as
  you go. A block is the contract working; never route around it, never
  retry variants. The operator overrides by running the command
  themselves.
```

- [ ] **Step 1: Write the three files with the amendments** (rev 2 text otherwise verbatim)
- [ ] **Step 2: `git rm -r skills/orch`**
- [ ] **Step 3: Verify frontmatter**

Run: `node -e "const fs=require('fs');const t=fs.readFileSync('skills/go/SKILL.md','utf8');if(!/^---\n/.test(t))throw 'frontmatter';['work.md','loop.md'].forEach(f=>{if(!fs.readFileSync('skills/go/'+f,'utf8').length)throw f});console.log('ok')"`

- [ ] **Step 4: Commit**

```bash
git add -A skills/
git commit -m "feat: /orch:go driver (closed-first precedence, research re-check) + work/loop phases"
```

---

### Task 5: `/orch:setup` and `/orch:goal`

Rev 2's Task 5 verbatim, with ONE amendment in `skills/setup/SKILL.md`
step 5 (lock mirroring) — replace its text with:

```markdown
5. OFFER LOCK MIRRORING: the project file is agent-writable; mirroring
   `contract` into `~/.claude/orch-lock.json` makes the lock's contract
   REPLACE the project's entirely (atomic — a project file cannot add
   domains beside a locked contract). Strongly recommend when any domain
   is `decide: human`. Every later contract edit therefore happens in the
   LOCK copy, applied by the operator (it is their file); the project copy
   becomes documentation. Also offer guard locks, e.g.
   `{"destructiveGit": {"enabled": true}}`.
```

- [ ] **Step 1: Write both skills** · **Step 2: Verify frontmatter (all three skills)** · **Step 3: Commit**

```bash
git add skills/setup/ skills/goal/
git commit -m "feat: /orch:setup (atomic lock mirroring) + /orch:goal"
```

---

### Task 6: README reframe

Rev 2's Task 6 verbatim, with the honesty sentence extended:

> "the hook gates the git commands the AI types — deny-by-default outside
> a read allowlist, state-based so argument tricks don't help. It is not a
> sandbox: a script that runs git from inside is out of its sight. The
> lock file and you are the lines behind it."

- [ ] **Step 1: Rewrite README** · **Step 2: Self-check** (`node -e` grep for contract/orch:setup/orch:goal/orch:go/ship-gate/ADR/lock/deny) · **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README — decision contract front door, honest enforcement claims"
```

---

### Task 7: Version bump, full regression, ship

- [ ] **Step 1: Bump** `.claude-plugin/plugin.json` → `"version": "0.3.0"`, description per rev 2.
- [ ] **Step 2: Full regression** — `node tests/test-audit.js && node tests/test-lock.js && node tests/test-destructive.js && node tests/test-ship-gate.js`, then the ship-gate suite once more (rerun safety). Expected: exit 0 every time.
- [ ] **Step 3: Skill-chain smoke** — walk precedence for (a) no BRIEF (b) BRIEF only (c) BRIEF+ROUTE (d) done evidenced (e) board merged (f) merged + "run overnight" → closed not loop.
- [ ] **Step 4: Commit and push**

```bash
git add .claude-plugin/plugin.json
git commit -m "orch v0.3.0 — the decision contract"
git push
```

---

## Self-Review (post round-2)

- Round-2 Criticals: auditPath bypass → path FIXED (`AUDIT_REL`), config key gone, exemption asserts the logged files (check 63). cd/pushd retarget → classify() command-wide cd/env test + checks 38–40. Config-root ordering → root resolved BEFORE loadConfig. Quote games → quote-preserving tokenizer + subcommand-position matching (checks 23–25, 34, 46). gh scope → verb allowlist (41–44). Lock additive hole → atomic contract replace (Task 1 + check 57). -m heuristic → deleted with always-union (check 20 documents the price; check 34 proves messages are safe). Oversized-die audit → unconditional appendAudit with cwd fallback (check 62). {"contract":{}} → invalid (check 3). actionName → real `label` incl. `denied:<word>` (check 60). loop/closed order → Task 4 amendment. count drift → "exit 0" expectations everywhere. Task 2 external reference → fully inlined. Fake HOME everywhere → all four suites.
- Dead code from rev 2 (bare(), risky regex, unused fs, governing-null unreachable) — none survives: bare()/risky deleted with always-union; fs import dropped; governing-null now reachable only via the audit-exemption edge and is tested (63).
- Formats: BRIEF/ROUTE/ledger/ADR strings unchanged from rev 2 and identical across Global Constraints, Task 4, Task 5.
