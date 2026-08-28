# Decision Contract (orch v0.3.0) Implementation Plan — rev 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Rev 2 incorporates the dual-review (Codex-Sol + Opus) findings: per-segment
gating, empty-list fail-closed, narrow push grammar, blocked history
writers, audit-on-every-exit, audit self-exemption, corrupt-config
fail-closed, repo-root discovery, `/orch:go` naming, format unification,
and the adopted cuts (no merge rank, no ai_with_ruling, no hash machinery,
route/ship inline).

**Goal:** Domain-based decision contract, deterministic ship-gate hook, three-depth decision records, 3-command skill surface.

**Architecture:** Contract in `.claude/orch.json` (lock-mirrorable). New PreToolUse hook gates `git commit`/`git push` per shell segment (strictest across the line), blocks history-rewriters, fails closed everywhere else. Skills: `/orch:setup`, `/orch:goal`, `/orch:go` (driver with route/ship inline + `work.md`/`loop.md` on demand).

**Tech Stack:** Node.js (no deps) hooks; plugin skill markdown; `node` test scripts.

**Spec:** `docs/superpowers/specs/2026-08-28-decision-contract-design.md` (rev 4)

## Global Constraints

- Hooks: dependency-free Node, `'use strict'`, 10s timeout, `${CLAUDE_PLUGIN_ROOT}` wiring.
- Ship-gate fail-CLOSED inventory (spec §2): oversized payload · corrupt orch.json · invalid contract (own-property, exact enums) · `-C`/`--git-dir`/`--work-tree`/`GIT_DIR=`/`GIT_WORK_TREE=` · blocked commands (merge incl. `--continue`, rebase, cherry-pick, revert, am, `gh pr merge`) · non-narrow push grammar · unresolvable base/files · EMPTY resolved file list. Every exit — ALLOW, BLOCK, every die — writes an audit line. No contract in parseable config → exit 0.
- Enums: `decide: ai|human` · `ship: none|commit|push` (RANK 0/1/2). ADR `Status: proposed|accepted|rejected|superseded`.
- Canonical grammar (verbatim everywhere): BRIEF `goal:/metric:/done:/domains:/kill:`; `ROUTE: <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>`.
- Scratch repos in tests: `commit.gpgsign=false`, `core.autocrlf=false`; scratch dirs gitignored; never touch real `~/.claude`.
- Commit per task; push only in the final task.

---

### Task 1: `lib/config.js` — audit helper + corrupt-config signal

**Files:**
- Modify: `hooks/lib/config.js`
- Create: `.gitignore`, `tests/test-audit.js`

**Interfaces:**
- Produces: `appendAudit(j, cfg, entry)` — appends `{ts, ...entry}` JSON line to `cfg.auditPath || '.claude/orch-audit.jsonl'` resolved against `j.cwd`; never throws. `resolveAuditPath(j, cfg)` — returns that absolute path (ship-gate needs it for self-exemption). `loadConfig(j)` — unchanged signature, but when a candidate `orch.json` EXISTS and fails to parse, the returned object carries non-enumerable `__corrupt: true` (existing hooks unaffected; ship-gate fails closed on it).

- [ ] **Step 1: Create `.gitignore`**

```
tests/scratch-*/
```

- [ ] **Step 2: Write the failing test**

Create `tests/test-audit.js`:

```js
// appendAudit + resolveAuditPath + __corrupt signal.
'use strict';
const fs = require('fs');
const path = require('path');
const { appendAudit, resolveAuditPath, loadConfig } = require('../hooks/lib/config');

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

check('resolveAuditPath default', resolveAuditPath({ cwd: dir }, {}) ===
  path.resolve(dir, '.claude', 'orch-audit.jsonl'));

let threw = false;
try { appendAudit({ cwd: 'Z:\\no\\such\\dir\\ever' }, {}, { a: 1 }); } catch { threw = true; }
check('bad dir never throws', !threw);

fs.writeFileSync(path.join(dir, '.claude', 'orch.json'), '{ not json');
check('__corrupt on bad json', loadConfig({ cwd: dir }).__corrupt === true);
fs.writeFileSync(path.join(dir, '.claude', 'orch.json'), '{"a":1}');
check('no __corrupt on good json', loadConfig({ cwd: dir }).__corrupt !== true);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node tests/test-audit.js`
Expected: crash — `appendAudit is not a function`.

- [ ] **Step 4: Implement in `hooks/lib/config.js`**

In `loadConfig`'s catch (project file unparseable), after the existing
warning, replace the fall-through so the corrupt signal survives lock
merge:

```js
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
      // user configured is worse than noise. Warn, and let blocking hooks
      // see the corruption so they can fail closed instead of ungated.
      console.error(`orch: WARNING — ${p} is not valid JSON; configured guards are INACTIVE until fixed.`);
      corrupt = true;
      break;
    }
  }
  const lock = loadLock();
  const out = lock ? deepMerge(cfg, lock) : cfg;
  if (corrupt) Object.defineProperty(out, '__corrupt', { value: true });
  return out;
}

function resolveAuditPath(j, cfg) {
  const root = (j && j.cwd) || process.cwd();
  return path.resolve(root, (cfg && cfg.auditPath) || path.join('.claude', 'orch-audit.jsonl'));
}

function appendAudit(j, cfg, entry) {
  // Audit is best-effort evidence, never a point of failure for the hook.
  const p = resolveAuditPath(j, cfg);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.error(`orch: WARNING — audit write failed (${p}): ${e.message}`);
  }
}

module.exports = { readStdin, loadConfig, appendAudit, resolveAuditPath };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test-audit.js`
Expected: `8/8 pass`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore hooks/lib/config.js tests/test-audit.js
git commit -m "feat: audit helper + corrupt-config signal in config loader"
```

---

### Task 2: Port regression suites into `tests/`

**Files:**
- Create: `tests/test-lock.js`, `tests/test-destructive.js`

**Interfaces:**
- Produces: in-repo runnable regression for the v0.2.0 lock behavior and destructive-git guard, so release gates are executable (review finding: previously named suites lived outside the repo).

- [ ] **Step 1: Create `tests/test-lock.js`**

Port of the v0.2.0 lock matrix (fake `USERPROFILE`/`HOME`, scratch project) — 7 checks: default blocks `reset --hard` · project `enabled:false` disables · lock re-enables over project disable · corrupt lock falls back with warning · deep-merge keeps project `extraPatterns` · lock-only `extraPatterns` active · benign command passes with no lock. Structure identical to `tests/test-audit.js` (check/run helpers), hook under test: `hooks/block-destructive-git.js`, payload `{session_id, cwd: PROJ, tool_input:{command}}`, env override `USERPROFILE`/`HOME` → fake home. (The v0.2.0 scratchpad version of this file is the reference; recreate it verbatim with paths relative to `tests/`.)

- [ ] **Step 2: Create `tests/test-destructive.js`**

Six-check smoke, same harness shape, no config files at all (defaults):
block `git push --force` · block `git reset --hard` · block `git.exe -C x reset --hard` · block `git stash pop` · allow `git status` · allow `git push` (no force). Expected exits: 2/2/2/2/0/0.

- [ ] **Step 3: Run both**

Run: `node tests/test-lock.js && node tests/test-destructive.js`
Expected: `7/7 pass`, `6/6 pass`.

- [ ] **Step 4: Commit**

```bash
git add tests/test-lock.js tests/test-destructive.js
git commit -m "test: port lock matrix + destructive-git smoke into repo"
```

---

### Task 3: `hooks/contract-ship-gate.js` + wiring

**Files:**
- Create: `hooks/contract-ship-gate.js`
- Modify: `hooks/hooks.json`
- Test: `tests/test-ship-gate.js`

**Interfaces:**
- Consumes: `readStdin`, `loadConfig`, `appendAudit`, `resolveAuditPath`.
- Produces: exit 0 / exit 2 + stderr; audit entries `{action, files?, domain?, verdict, reason?, by:"hook"}` on EVERY exit path except the two no-op paths (no gated action in command; parseable config without contract).

- [ ] **Step 1: Write the failing test**

Create `tests/test-ship-gate.js`:

```js
// Ship-gate matrix — spec §6 rev 4. Scratch repo; fake HOME isolates the lock.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'contract-ship-gate.js');
const SCRATCH = path.join(__dirname, 'scratch-ship');
const FAKEHOME = path.join(SCRATCH, 'home');
const REPO = path.join(SCRATCH, 'repo');
const REMOTE = path.join(SCRATCH, 'remote.git');

// Windows: git object files are read-only; chmod before rm or EPERM on rerun.
function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const f of fs.readdirSync(p, { recursive: true, withFileTypes: true })) {
    try { fs.chmodSync(path.join(f.parentPath || f.path, f.name), 0o666); } catch {}
  }
  fs.rmSync(p, { recursive: true, force: true });
}
rmrf(SCRATCH);
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(REPO, '.claude'), { recursive: true });

function g(...args) { return execFileSync('git', ['-C', REPO, ...args]).toString().trim(); }
execFileSync('git', ['init', '--bare', '-q', REMOTE]);
g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
g('config', 'commit.gpgsign', 'false'); g('config', 'core.autocrlf', 'false');

function writeContract(domains, extra) {
  fs.writeFileSync(path.join(REPO, '.claude', 'orch.json'),
    JSON.stringify({ contract: { version: 1, domains }, ...(extra || {}) }));
}
function run(cmd) {
  const payload = JSON.stringify({ session_id: 's', cwd: REPO, tool_input: { command: cmd } });
  try {
    execFileSync('node', [HOOK], { input: payload,
      env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0 };
  } catch (e) { return { code: e.status, err: String(e.stderr) }; }
}
function stage(rel) {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x' + Math.random());
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
  tests: { paths: ['tests/**'], decide: 'ai', ship: 'commit' },
  core:  { paths: ['src/core/**'], decide: 'human', ship: 'none' },
  claude: { paths: ['.claude/**'], decide: 'ai', ship: 'push' },
};

// -- no-op paths --
fs.writeFileSync(path.join(REPO, '.claude', 'orch.json'), '{}');
stage('src/core/a.js');
check('no contract = no-op', run('git commit -m x').code === 0);
writeContract({});
check('empty domains = no-op', run('git commit -m x').code === 0);

// -- corrupt config fails closed for ship actions --
fs.writeFileSync(path.join(REPO, '.claude', 'orch.json'), '{ nope');
check('corrupt orch.json blocks commit', run('git commit -m x').code === 2);
check('corrupt orch.json ignores non-ship', run('ls').code === 0);

// -- basic allow/deny --
writeContract(DOMAINS);
g('commit', '-q', '-m', 'seed');
g('remote', 'add', 'origin', REMOTE);
g('push', '-q', '-u', 'origin', 'HEAD');

stage('tests/t1.js');
check('commit grant allows commit', run('git commit -m x').code === 0);
g('commit', '-q', '-m', 't1');
check('commit grant blocks push', run('git push').code === 2);
g('push', '-q'); // operator ships it so later push tests see a clean base

stage('docs/d.txt');
check('push grant implies commit', run('git commit -m x').code === 0);
g('commit', '-q', '-m', 'd1');
check('push grant allows push', run('git push').code === 0);
g('push', '-q');

stage('src/core/b.js');
const r = run('git commit -m x');
check('ship:none blocks commit', r.code === 2);
check('block names domain', /core/.test(r.err || ''));
g('reset', '-q', 'HEAD', 'src/core/b.js'); fs.rmSync(path.join(REPO, 'src/core/b.js'));

// -- strictest across files & segments --
stage('docs/s.txt'); stage('src/core/c.js');
check('strictest wins across files', run('git commit -m x').code === 2);
g('reset', '-q', 'HEAD'); fs.rmSync(path.join(REPO, 'src/core/c.js'));

stage('tests/t2.js');
check('commit && push gates the push', run('git commit -m x && git push').code === 2);
check('push && commit also gated', run('git push && git commit -m x').code === 2);
g('reset', '-q', 'HEAD'); fs.rmSync(path.join(REPO, 'tests/t2.js'));

// -- unmatched / globs --
stage('mystery/z.bin');
const ru = run('git commit -m x');
check('unmatched path blocks', ru.code === 2);
check('unmatched block mentions amendment', /amendment|ADR|unmatched/i.test(ru.err || ''));
g('reset', '-q', 'HEAD'); fs.rmSync(path.join(REPO, 'mystery/z.bin'));

stage('deep/nest/notes.md');
check('**/*.md nested allows', run('git commit -m x').code === 0);
g('commit', '-q', '-m', 'md'); g('push', '-q');

fs.mkdirSync(path.join(REPO, 'docs2'), { recursive: true });
stage('docs2/evil.bin');
check('docs2/ does not match docs/** (anchoring)', run('git commit -m x').code === 2);
g('reset', '-q', 'HEAD'); fs.rmSync(path.join(REPO, 'docs2/evil.bin'));

// -- invalid contract --
writeContract({ docs: { paths: ['docs/**'], decide: 'ai', ship: 'yeet' } });
check('invalid ship enum fails closed', run('git commit -m x').code === 2);
writeContract({ docs: { paths: ['docs/**'], decide: 'ai', ship: 'toString' } });
check('prototype name fails closed', run('git commit -m x').code === 2);
writeContract({ docs: { paths: 'docs/**', decide: 'ai', ship: 'push' } });
check('non-array paths fails closed', run('git commit -m x').code === 2);

// -- retarget / env / blocked commands --
writeContract(DOMAINS);
check('-C retarget fails closed', run('git -C ../other push').code === 2);
check('--git-dir fails closed', run('git --git-dir=x push').code === 2);
check('GIT_DIR env fails closed', run('GIT_DIR=/x git push').code === 2);
check('merge blocked', run('git merge feat').code === 2);
check('merge --continue blocked', run('git merge --continue').code === 2);
check('rebase blocked', run('git rebase main').code === 2);
check('cherry-pick blocked', run('git cherry-pick abc123').code === 2);
check('gh pr merge blocked', run('gh pr merge 5').code === 2);

// -- push grammar --
check('refspec push fails closed', run('git push origin feature:main').code === 2);
check('--all fails closed', run('git push --all').code === 2);
check('--tags fails closed', run('git push --tags').code === 2);
check('--delete fails closed', run('git push origin --delete br').code === 2);
check('--allow-empty commit blocked (empty resolution)', run('git commit --allow-empty -m x').code === 2);

// -- commit variants --
fs.writeFileSync(path.join(REPO, 'docs/d.txt'), 'tracked-mod');
fs.writeFileSync(path.join(REPO, 'src/core/b2.js'), 'dirty-core'); g('add', 'src/core/b2.js');
g('reset', '-q', 'HEAD', 'src/core/b2.js'); // b2 untracked now; make it tracked-dirty:
g('add', 'src/core/b2.js'); g('commit', '-q', '-m', 'seed-core-file', '--no-verify'); g('push', '-q');
fs.writeFileSync(path.join(REPO, 'src/core/b2.js'), 'dirty2');
stage('docs/ok.txt');
check('plain commit ignores unstaged core dirt', run('git commit -m x').code === 0);
check('commit -a unions unstaged (core dirt) -> block', run('git commit -am x').code === 2);
check('pathspec commit unions -> block', run('git commit src/core/b2.js -m x').code === 2);
g('checkout', '-q', '--', 'src/core/b2.js');
g('commit', '-q', '-m', 'ok'); g('push', '-q');

// -- audit --
const auditP = path.join(REPO, '.claude', 'orch-audit.jsonl');
const audit = fs.readFileSync(auditP, 'utf8');
check('audit has ALLOW with domain', /"verdict":"ALLOW"/.test(audit) && /"domain":"/.test(audit));
check('audit has BLOCK', /"verdict":"BLOCK"/.test(audit));
check('die paths audited (reason present)', /"reason":/.test(audit));
// audit self-exemption: audit file is tracked-dirty in .claude/** domain? Stage it plus a docs file:
g('add', '-f', '.claude/orch-audit.jsonl'); stage('docs/z.txt');
check('audit file itself never blocks', run('git commit -m x').code === 0);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-ship-gate.js`
Expected: crash — hook file does not exist.

- [ ] **Step 3: Implement `hooks/contract-ship-gate.js`**

```js
// PreToolUse (Bash|PowerShell) — the contract's ship gate.
// Gates git commit/push per shell SEGMENT (strictest across the line),
// blocks history-rewriters outright, and fails CLOSED on everything it
// cannot verify: corrupt config, invalid contract, repo retargeting,
// non-narrow push grammar, unresolvable or EMPTY file sets. A parseable
// config with no contract block is the only silent pass-through.
// Every non-trivial exit writes an audit line — evidence is the product.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readStdin, loadConfig, appendAudit, resolveAuditPath } = require('./lib/config');

const RANK = { none: 0, commit: 1, push: 2 };
const { j, oversized } = readStdin();

function classify(cmd) {
  // Per-segment: a compound line is as dangerous as its worst segment.
  const segs = cmd.split(/[|;&\n]+/).map(s => s.trim()).filter(Boolean);
  const out = { action: 0, blocked: null, retarget: false, segs: [] };
  const GITW = /\bgit(?:\.exe)?\b/;
  for (const s of segs) {
    if (/\bgh\b.*\bpr\b.*\bmerge\b/.test(s)) { out.blocked = 'gh pr merge'; continue; }
    if (!GITW.test(s)) continue;
    if (/(^|\s)(GIT_DIR|GIT_WORK_TREE)=/.test(s) ||
        /\bgit(?:\.exe)?\b[^\s]*\s+(-C\b|--git-dir\b|--work-tree\b)/.test(s) ||
        /\s-C\s/.test(s.slice(0, s.search(/\b(commit|push|merge|rebase|cherry-pick|revert|am)\b/) + 1 || s.length))) {
      out.retarget = true;
    }
    const m = s.match(/\b(merge|rebase|cherry-pick|revert|am)\b/);
    if (m) { out.blocked = 'git ' + m[1]; continue; }
    if (/\bcommit\b/.test(s)) { out.action = Math.max(out.action, 1); out.segs.push(['commit', s]); }
    if (/\bpush\b/.test(s)) { out.action = Math.max(out.action, 2); out.segs.push(['push', s]); }
  }
  return out;
}

const cmd = (j && j.tool_input && (j.tool_input.command || '')) || '';
const cls = cmd ? classify(cmd) : { action: 0, blocked: null, retarget: false, segs: [] };
const shipish = cls.action > 0 || cls.blocked || oversized;
if (!shipish) process.exit(0);

const cfg = loadConfig(j || {});
const contract = cfg.contract;
const actionName = cls.action === 2 ? 'push' : 'commit';

function die(reason, files, domain) {
  if (contract || cfg.__corrupt) {
    appendAudit(j || {}, cfg, { action: actionName, files, domain, verdict: 'BLOCK', reason, by: 'hook' });
  }
  console.error(`BLOCKED (orch ship-gate): ${reason}`);
  process.exit(2);
}

if (oversized) die('oversized hook payload — command unverifiable.');
if (cfg.__corrupt) die('.claude/orch.json is not valid JSON — the contract cannot be read; fix it first.');
if (!contract || !contract.domains || !Object.keys(contract.domains).length) process.exit(0);

for (const [name, d] of Object.entries(contract.domains)) {
  if (!Object.prototype.hasOwnProperty.call(RANK, d.ship) ||
      !['ai', 'human'].includes(d.decide) ||
      !Array.isArray(d.paths) || !d.paths.every(p => typeof p === 'string')) {
    die(`contract invalid (domain "${name}") — fix .claude/orch.json`);
  }
}
if (cls.retarget) die('git -C/--git-dir/GIT_DIR retargeting — this gate covers one repo; the operator runs cross-repo commands.');
if (cls.blocked) die(`${cls.blocked} — history writers and remote merges are not gateable file-by-file; the operator runs this, or an ADR grants a workflow for it.`);

const cwd = (j && j.cwd) || process.cwd();
let root;
try { root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 5000 }).toString().trim(); }
catch { process.exit(0); } // not a repo: git itself will fail; nothing to gate
const jr = { ...j, cwd: root };
function git(args) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { timeout: 5000 }).toString();
}
function names(out) {
  return [...new Set(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
}
function bare(seg, word) {
  // Tokens after the subcommand with quoted spans removed — pathspec/refspec detector.
  const tail = seg.slice(seg.indexOf(word) + word.length).replace(/"[^"]*"|'[^']*'/g, '');
  return tail.split(/\s+/).filter(t => t && !t.startsWith('-'));
}

let files = [];
try {
  for (const [kind, seg] of cls.segs) {
    if (kind === 'commit') {
      let f = names(git(['diff', '--cached', '--name-only']));
      const risky = /\s(-\w*a\w*|--all|--only|--include|--patch|-p|--interactive)\b|\s--\s/.test(seg) ||
                    bare(seg, 'commit').filter(t => t !== '-m').length > 0;
      if (risky) f = [...new Set([...f, ...names(git(['diff', '--name-only']))])];
      if (/--amend\b/.test(seg)) f = [...new Set([...f, ...names(git(['diff', 'HEAD^', 'HEAD', '--name-only']))])];
      files.push(...f);
    } else {
      if (/\s(--all|--mirror|--tags|--delete|--force(-with-lease)?|-f)\b/.test(seg)) {
        die(`push variant outside the narrow grammar (${seg.trim()}) — the operator runs it.`);
      }
      const extras = bare(seg, 'push');
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      if (extras.some(t => t.includes(':')) || extras.length > 2 ||
          (extras.length === 2 && extras[1] !== branch)) {
        die('push refspec/target outside the narrow grammar — the operator runs it.');
      }
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
      if (!base) die('push base unresolvable (no upstream, no origin default) — the first push is the operator\'s.');
      files.push(...names(git(['diff', `${base}..HEAD`, '--name-only'])));
    }
  }
} catch (e) {
  die(`cannot resolve touched files (${String(e.message).split('\n')[0]}) — refusing to gate blind.`);
}
files = [...new Set(files)];
if (!files.length) {
  die('nothing resolvable to gate — empty/fileless mutations (--allow-empty, tag moves) are the operator\'s.');
}

function globToRe(glob) {
  const parts = glob.split('/').map(part =>
    part === '**' ? '\u0000' :
    part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'));
  return new RegExp('^' + parts.join('/').replace(/\u0000\//g, '(?:.*/)?').replace(/\u0000/g, '.*') + '$');
}

const auditRel = path.relative(root, resolveAuditPath(jr, cfg)).replace(/\\/g, '/');
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
if (governing === null) { die('all resolved files were exempt — nothing gateable; the operator decides.'); }

if (cls.action > overall) {
  appendAudit(jr, cfg, { action: actionName, files, domain: governing, verdict: 'BLOCK', by: 'hook' });
  const who = governing === 'unmatched'
    ? 'no domain matches — omission never grants; write a proposed ADR amendment instead'
    : `domain "${governing}" grants "${Object.keys(RANK).find(k => RANK[k] === overall)}" — the operator ships this`;
  console.error(`BLOCKED (orch ship-gate): git ${actionName} exceeds contract. ${who}. Files: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ` +${offenders.length - 5} more` : ''}`);
  process.exit(2);
}
appendAudit(jr, cfg, { action: actionName, files, domain: governing, verdict: 'ALLOW', by: 'hook' });
process.exit(0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-ship-gate.js`
Expected: `38/38 pass`. This file is the release's risk concentration — debug every mismatch here, do not weaken a test to pass it.

- [ ] **Step 5: Wire into `hooks/hooks.json`** — append to the PreToolUse `"Bash|PowerShell"` group's `hooks` array:

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/contract-ship-gate.js\"",
  "timeout": 10
}
```

- [ ] **Step 6: Wiring + regression check**

Run: `node -e "const h=require('./hooks/hooks.json');const g=h.hooks.PreToolUse.find(x=>x.matcher==='Bash|PowerShell');if(!g.hooks.some(k=>k.command.includes('contract-ship-gate')))throw 'not wired';console.log('wired')"`
Then: `node tests/test-audit.js && node tests/test-lock.js && node tests/test-destructive.js`
Expected: wired; all green.

- [ ] **Step 7: Commit**

```bash
git add hooks/contract-ship-gate.js hooks/hooks.json tests/test-ship-gate.js
git commit -m "feat: contract ship-gate — per-segment gating, narrow grammars, fail-closed everywhere"
```

---

### Task 4: `/orch:go` — driver skill (route/ship inline) + `work.md` + `loop.md`

**Files:**
- Delete: `skills/orch/` (the monolith moves)
- Create: `skills/go/SKILL.md`, `skills/go/work.md`, `skills/go/loop.md`

**Interfaces:**
- Consumes: contract; BRIEF/`ROUTE:`/ledger grammar (Global Constraints); ADR `Status:` enum.
- Produces: the phase precedence + artifact chain every other surface references.

- [ ] **Step 1: Create `skills/go/SKILL.md`** (frontmatter REQUIRED — copy exactly, then body):

```markdown
---
name: go
description: >
  The orch session driver. Use for any work session after a front exists:
  reads the board, dossiers, contract, and unratified ADRs, decides the
  current phase (route/work/ship/loop) by ordered precedence, acts, and
  reports. The human decides only what the contract reserves for them.
---

# /orch:go — the session driver

Premise: the operator decided ONCE (`.claude/orch.json` → `contract`)
which domains are theirs. Everything else you decide, review, and ship —
every decision leaves a record. You are the orchestrator: frontier-tier
judgment, verdict-only; suited cheap models execute.

## On every invocation

1. Read: BOARD.md · the active front's dossier · `docs/adr/` for
   `Status: proposed` · the contract.
2. Report ≤5 lines: front, phase, blockers, unratified ADRs, parked items.
3. Decide the phase — ORDERED, first match wins:

| # | Condition | Phase |
|---|---|---|
| 1 | operator's message asks for an autonomous run | loop → load `loop.md` |
| 2 | board row `merged` | closed → report, stop (never re-enter ship) |
| 3 | no front / no BRIEF | → point to `/orch:goal`, stop |
| 4 | BRIEF, no `ROUTE:` line | route (below) |
| 5 | `ROUTE:` exists, done-condition not evidenced | work → load `work.md` |
| 6 | ledger satisfies the BRIEF's `done:` | ship (below) |

Never advance past a missing artifact — refuse and point back. Skipped
steps are visible, never silent.

## The contract

- Classify by `paths`; the `expertise` text breaks ties — semantics over
  globs ("web-ui path but a setpoint calculation → numerics"). This
  judgment is yours; the hook enforces only the path axis.
- `decide: human` → STOP and ask before acting. `decide: ai` → act, and
  EVERY consequential autonomous decision writes a `Ruling:` line.
- Multi-match → strictest wins (human beats ai; lower ship rank beats
  higher). No match, a conflict, or a ship-gate BLOCK naming `unmatched` →
  park + write a proposed ADR with a ready-to-paste amendment. You NEVER
  edit the contract yourself.
- INCONCLUSIVE verdicts always go to the operator.
- A ship-gate block is the contract working — never route around it; the
  operator overrides by running the command themselves.

## Phase: route

1. Classify the front's intended change per the contract rules above.
2. Execution shape: number+cause-unknown → measurement-first iteration ·
   mechanical/spec-complete → cheapest tier, single review ·
   judgment-heavy/high-consequence → mid-tier implement + dual review.
3. `decide: human` → present plan ≤5 lines, STOP; write the ROUTE line
   only on approval, with `approved:operator`. `decide: ai` → write it
   with `approved:auto`.
4. Append to the dossier, exactly:
   `ROUTE: <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>`
   Then enter phase work.

## Phase: ship

1. Merge gate — all three legs, or park for the operator:
   ① No regression — the full relevant suite, from the real runner's
   verdict line, never a filtered/wrapped view. ② Measured improvement on
   the front's metric, exceeding its documented noise band — inside the
   band is INCONCLUSIVE → parks; "flat but correct" and hygiene-only park.
   ③ Root cause, no band-aid — symptom-masking stops for the operator
   regardless of green gates.
2. Contract ship check: the domain's `ship` grant decides who lands it.
   `none` → hand the operator the exact command + evidence summary.
   `commit`/`push` → run exactly the granted action; the ship-gate hook
   verifies independently — if it blocks, re-read the contract, never
   retry variants.
3. Board: evidence-before-done — the row flips to `merged` ONLY with a
   ledger line or artifact path behind it (else `needs_attention`); commit
   the board edit with the work. Evidence + baseline SHA in the commit/PR.

## Records & session end

Audit mirror: consequential Rulings also append
`{ts, decision, scope, domain, verdict, by:"ruling"}` to
`.claude/orch-audit.jsonl`. ADRs (`docs/adr/NNNN-<slug>.md`,
`Status: proposed|accepted|rejected|superseded`): pair mode → accepted on
write; autopilot → ALWAYS proposed, surfaced in step 2 until resolved via
`/orch:setup`. Before compaction/clock-out: refresh the handoff — ① done
② next action ③ entry phase for the next session ④ blockers + owners.
```

- [ ] **Step 2: Create `skills/go/work.md`**

```markdown
# Phase: work (ROUTE: exists, done-condition not evidenced)

Delegate execution to the tier named in the ROUTE: line. Reviewers are
verdict-only — a reviewer never implements the fix it proposes. Never
delegated: protected-directory edits, authored values without a cited
source, judgment the contract reserves for the operator.

## Review ladder (per hand-back — order is mandatory)

1. MECHANICAL first, cheap tier: empty-result check before anything — if
   the claimed diff is empty or a claimed artifact absent/zero-length,
   auto-FAIL; "ran, produced nothing" never costs a review round. Then
   `git diff --stat` + build + scoped tests. Fail → back to implementer.
   Test-touching hand-backs also get the test-quality audit: ①
   circular-oracle check (a test deriving expected values from the code
   under test proves nothing) ② assertion-strength ladder (existence →
   type → status → value → behavioral; consequential verdicts need
   value-or-behavioral) ③ disabled-test scan (skips found in review are
   findings).
2. JUDGMENT second: diff review, strongest model, verdict-only.
   High-consequence hand-backs get a second reviewer from a DIFFERENT
   model family in a FRESH context, same rubric. Verdicts tri-state:
   PASS / FAIL / INCONCLUSIVE — INCONCLUSIVE holds for the operator, no
   auto-retry, no round consumed. Both must PASS; one FAIL fails; one
   INCONCLUSIVE holds. Artifact reality check: claimed additions pass
   EXISTS → SUBSTANTIVE → WIRED.
3. LOOP: on FAIL the implementer (never a reviewer) fixes ONLY flagged
   items; step 2 re-runs fresh. Initial review = round 1; cap 3. Stall
   (identity-based, never count-based): a previous-round finding survives,
   or a new equal-or-higher-severity finding appears → escalate. Never
   merge dirty.

## Record discipline

Every iteration entry starts:
`iter <n> · <short-sha> · <before> → <after> · keep|revert|flat|refuted · <what>`
then prose: hypothesis (written BEFORE the change), what changed, every
number, verdict. Consequential autonomous calls:
`Ruling: <decision> — <why> — <cost if wrong>` + audit mirror.
Simplicity criterion: improvement bought with disproportionate complexity
→ flag `⚠complexity`; a flat result that DELETED code is a win — keep it.

Ledger satisfies the BRIEF's `done:` → return to the driver, phase ship.
```

- [ ] **Step 3: Create `skills/go/loop.md`**

```markdown
# Phase: loop (operator asked for an autonomous run)

Always a PROPOSAL — present the plan, get explicit approval, then launch.
Preflight is unskippable.

Topology check first (advisory): loop-shaped = multiple uncertain
iterations against a metric. Single-pass or 2-3 known steps → say so, do
it directly.

Refuse to launch until all five hold (any ✗ → fix the prompt file first):
1. Machine-decidable completion promise — probe/test/exit-code decides,
   never the loop's prose.
2. Boundaries stated — what the loop must NOT touch (protected dirs,
   authored values, the gates, the contract).
3. Iteration cap AND spend budget — the loop dies on whichever trips
   first, not only when context runs low.
4. Judge independence — external check output, never self-grading.
5. Numeric ambiguity checklist (binary): inputs + units · oracle ·
   tolerance vs noise band · measurement protocol · abort conditions.

In-loop: structure/contract-shaped calls → proposed ADR; if the work
depends on the answer, park the front and continue elsewhere. The
ship-gate caps what the loop lands regardless of what it believes.

Launch journal, in the dossier:
`LAUNCH <date> · <prompt file> · max-iter <n> · budget <tokens> · promise <string>`
```

- [ ] **Step 4: Remove the old monolith**

```bash
git rm -r skills/orch
```

- [ ] **Step 5: Verify frontmatter + files**

Run: `node -e "const fs=require('fs');['go'].forEach(d=>{const t=fs.readFileSync('skills/'+d+'/SKILL.md','utf8');if(!/^---/.test(t))throw d;});['work.md','loop.md'].forEach(f=>{if(!fs.readFileSync('skills/go/'+f,'utf8').length)throw f});console.log('ok')"`
Expected: ok.

- [ ] **Step 6: Commit**

```bash
git add -A skills/
git commit -m "feat: /orch:go driver (route/ship inline) + work/loop phase files; retire monolith"
```

---

### Task 5: `/orch:setup` and `/orch:goal`

**Files:**
- Create: `skills/setup/SKILL.md`, `skills/goal/SKILL.md`

- [ ] **Step 1: Create `skills/setup/SKILL.md`** (frontmatter: `name: setup`, description: "Onboard a repo onto the orch contract, edit contract domains, mirror the contract into the lock file, configure workflow tools, and ratify or reject proposed ADRs. The only place the contract changes."):

```markdown
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
   `contract` into `~/.claude/orch-lock.json` makes it tamper-proof (lock
   deep-overrides project). Strongly recommend for any `decide: human`
   domain. Also offer guard locks, e.g.
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
```

- [ ] **Step 2: Create `skills/goal/SKILL.md`** (frontmatter: `name: goal`, description: "Create or edit a front: shape the goal into a one-page BRIEF (goal, metric, done-condition, contract domains touched, kill criteria) using the routed shaping tool, and register the front on the board."):

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

Native fallback — exactly three questions, one at a time:
1. What number (or observable) tells us this worked?
2. What must NOT change while we chase it?
3. When would you kill this front rather than keep iterating?

## Register

Add the front's row to BOARD.md (status: ready) and commit the board
edit. Classify the `domains:` line against the contract now — if any part
is `decide: human`, tell the operator where they will be needed. Then
hand to `/orch:go` (phase: route).
```

- [ ] **Step 3: Verify**

Run: `node -e "const fs=require('fs');['setup','goal','go'].forEach(d=>{const t=fs.readFileSync('skills/'+d+'/SKILL.md','utf8');if(!/^---\n/.test(t))throw d+' frontmatter';console.log(d,'ok')})"`
Expected: three ok.

- [ ] **Step 4: Commit**

```bash
git add skills/setup/ skills/goal/
git commit -m "feat: /orch:setup (contract governance + lock mirroring) + /orch:goal (brief ritual)"
```

---

### Task 6: README reframe

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Rewrite `README.md`** — structure (plain-language register; keep `girazan/orch` install lines, MIT):

1. Opening: the symmetric-limits frame from spec §5, written out in the plain register — humans have intent + judgment (inside their specialty, for limited hours); frontier AI thinks and judges (within token budgets and prices); the contract maps BOTH: where your judgment is real it stays yours, where it isn't, cross-model fresh-context review is the stand-in judge. Model ladder: frontier thinks · high-end reviews · mid executes · low-end mechanical · frontier/high-end re-review before landing · you get the report after, per contract. Close with: "intent and judgment from the human, judgment and labor from the machines, and a written map of who's specialized in what — the map is the contract."
2. The seven premises as short bullets.
3. The contract: spec §1 JSON verbatim + three sentences (domains = whose expertise; omission never grants; the AI drafts amendments as ADRs, you ratify). One honest sentence on scope: "the hook gates this repo's git commit/push and blocks merge/rebase-style history rewrites; it is not a sandbox — the truly paranoid mirror the contract into the lock file, which no repo file can override."
4. Three commands: `/orch:setup` (once per repo) · `/orch:goal` (once per front) · `/orch:go` (everything else — knows the phase, stops only where your contract says).
5. Records: audit jsonl / Ruling lines / ADRs — one line each.
6. Seven hooks table: the six v0.2.0 rows + `contract-ship-gate` ("the AI can't ship outside its grant — if you truly want it shipped, you run the command yourself").
7. Configure: orch.json example incl. `contract` + `workflow.tools`; lock-file paragraph extended with contract mirroring.
8. Glossary: existing rows + contract → "decision rights matrix / RACI", ADR → "architecture decision record", ship grant → "deploy permission".

- [ ] **Step 2: Self-check**

Run: `node -e "const t=require('fs').readFileSync('README.md','utf8');['contract','orch:setup','orch:goal','orch:go','ship-gate','ADR','lock'].forEach(k=>{if(!new RegExp(k,'i').test(t))throw 'missing: '+k});console.log('ok')"`
Expected: ok.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README reframed — the decision contract as the front door"
```

---

### Task 7: Version bump, full regression, ship

**Files:**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Bump** — `"version": "0.3.0"`; description: "The decision contract for AI-driven work: the human decides once which domains are theirs; frontier AI orchestrates, plans, reviews, and gates; cheap AI executes; shipping is enforced per contract by deterministic hooks; every decision leaves a record (audit trail, Rulings, ADRs)."

- [ ] **Step 2: Full regression**

Run: `node tests/test-audit.js && node tests/test-lock.js && node tests/test-destructive.js && node tests/test-ship-gate.js`
Expected: 8/8, 7/7, 6/6, 38/38. Then re-run `node tests/test-ship-gate.js` a second time (rerun-safety: the Windows chmod teardown must hold).

- [ ] **Step 3: Skill-chain smoke (manual)**

Walk `skills/go/SKILL.md`'s precedence table for: (a) no BRIEF (b) BRIEF only (c) BRIEF+ROUTE (d) done-condition evidenced (e) board row merged (f) "run this overnight" message. Confirm exactly one phase matches each and refusals point backward. Fix wording inline.

- [ ] **Step 4: Commit and push**

```bash
git add .claude-plugin/plugin.json
git commit -m "orch v0.3.0 — the decision contract"
git push
```

---

## Self-Review (planning time, post-dual-review)

- Every Critical/High finding from both reviewers maps to a change: per-segment (T3 classify) · empty-list die (T3) · push grammar + base-chain diff-not-log (T3) · blocked history writers incl. `merge --continue`, `gh pr merge` (T3) · retarget die (T3) · corrupt-config die (T1+T3) · own-property enums (T3) · die-paths audited (T3 `die()`) · audit self-exemption (T3) + local-first audit (spec §3) · governing tracked independently (T3) · lock mirroring for the contract (T5 setup) · learn-loop from hook blocks (T4 SKILL.md contract section) · approval artifact = `approved:` field (T4) · phase precedence + terminal `closed` (T4) · ROUTE grammar unified `tier:`/no `tool:` (Global Constraints, T4) · ADR enum incl. rejected/superseded (T4, T5) · `/orch:go` naming (T4; no bare `/orch` anywhere) · regression suites in-repo (T2) · wiring asserted (T3 Step 6) · gpgsign/EPERM/gitignore (T1, T3 harness) · quotePath (T3 `git()`) · repo-root walk (T3 `rev-parse --show-toplevel`) · dead-branch offenders condition removed (T3 uses single `grant < cls.action`).
- Adopted cuts applied: no `merge` rank · no `ai_with_ruling` · no contract-hash machinery · route/ship inline in the driver.
- Formats: BRIEF/ROUTE/ledger/ADR strings identical across Global Constraints, T4, T5; enums identical between T3 code and T5 setup text.
