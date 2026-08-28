// read-before-write gate: deny first edit, allow the retry, honor the
// deprecated factForce key. Fake HOME so the real lock never interferes.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'read-before-write.js');
const SCRATCH = path.join(__dirname, 'scratch-rbw');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });

// Markers are keyed by session id, so every case uses a fresh one rather
// than depending on tmpdir state left by a previous run.
let seq = 0;
const newSession = () => `s${process.pid}-${Date.now()}-${seq++}`;

function cfg(obj) {
  fs.writeFileSync(path.join(PROJ, '.claude', 'orch.json'), JSON.stringify(obj));
}
function run(file, session) {
  const payload = JSON.stringify({ session_id: session, cwd: PROJ, tool_input: { file_path: file } });
  try {
    execFileSync('node', [HOOK], { input: payload,
      env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, err: '' };
  } catch (e) { return { code: e.status, err: String(e.stderr) }; }
}
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

const HOT = 'D:/proj/src/Solver/Engine.cs';
const COLD = 'D:/proj/src/Web/Page.tsx';

cfg({});
check('no config = no-op', run(HOT, newSession()).code === 0);

cfg({ readBeforeWrite: { pathRegex: '(Solver|Kernel)' } });
const s1 = newSession();
const first = run(HOT, s1);
check('first critical edit denied', first.code === 2);
check('denial names the gate', /READ-BEFORE-WRITE/.test(first.err));
check('denial lists the facts', /caller/i.test(first.err));
check('retry in same session allowed', run(HOT, s1).code === 0);
check('non-critical path untouched', run(COLD, newSession()).code === 0);
check('new session denies again', run(HOT, newSession()).code === 2);

cfg({ readBeforeWrite: { pathRegex: '(Solver)', scopeRegex: '(^|[\\\\/])src[\\\\/]' } });
check('scopeRegex miss = no-op', run('D:/proj/docs/Solver.md', newSession()).code === 0);

cfg({ readBeforeWrite: { pathRegex: '(Solver)', facts: ['Only this one fact.'] } });
const custom = run(HOT, newSession());
check('custom facts used', /Only this one fact/.test(custom.err));

cfg({ readBeforeWrite: { pathRegex: '([unclosed' } });
check('bad regex fails open', run(HOT, newSession()).code === 0);

// Deprecated alias: pre-v0.4.0 configs keep working, with a notice.
cfg({ factForce: { pathRegex: '(Solver)' } });
const legacy = run(HOT, newSession());
check('factForce alias still gates', legacy.code === 2);
check('alias warns about the rename', /factForce/.test(legacy.err) && /readBeforeWrite/.test(legacy.err));

cfg({ readBeforeWrite: { pathRegex: '(Solver)' }, factForce: { pathRegex: '(Nothing)' } });
const both = run(HOT, newSession());
check('new key wins when both present', both.code === 2 && !/pre-v0\.4\.0/.test(both.err));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
