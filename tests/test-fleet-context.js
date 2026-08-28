// fleet-context: debounce, band re-alerting, both read modes, fail-silent.
// Fake HOME so the real lock never interferes; fake fleet CLIs are node
// scripts whose output the test controls.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'fleet-context.js');
// Unique per run: on Windows a scratch dir can stay locked by an unrelated
// process, and a suite that cannot re-run is a suite you stop trusting.
const SCRATCH = path.join(__dirname, `scratch-fleet-${process.pid}`);
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
const BIN = path.join(SCRATCH, 'bin');
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });
fs.mkdirSync(BIN, { recursive: true });

// Fake fleet: LIST prints agent JSON, READ prints a pane status line whose
// ctx% comes from a file the test rewrites between polls.
const PCT = path.join(SCRATCH, 'pct.json');
fs.writeFileSync(path.join(BIN, 'list.js'),
  'console.log(JSON.stringify(Object.keys(require(' + JSON.stringify(PCT) + ')).map(n=>({name:n}))))');
fs.writeFileSync(path.join(BIN, 'read.js'),
  'const p=require(' + JSON.stringify(PCT) + ');console.log("agent "+process.argv[2]+" | ctx:"+p[process.argv[2]]+"% | idle")');
fs.writeFileSync(path.join(BIN, 'listwide.js'),
  'const p=require(' + JSON.stringify(PCT) + ');for(const n of Object.keys(p))console.log(n+" ctx:"+p[n]+"%")');
const node = process.execPath;
const LIST = `"${node}" "${path.join(BIN, 'list.js')}"`;
const READ = `"${node}" "${path.join(BIN, 'read.js')}" {name}`;
const LISTWIDE = `"${node}" "${path.join(BIN, 'listwide.js')}"`;
const setPct = obj => fs.writeFileSync(PCT, JSON.stringify(obj));

function cfg(fleet) {
  fs.writeFileSync(path.join(PROJ, '.claude', 'orch.json'),
    JSON.stringify(fleet === null ? {} : { fleetContext: fleet }));
}
let seq = 0;
const newSession = () => `f${process.pid}-${Date.now()}-${seq++}`;
function run(session) {
  // The hook is advisory: it prints to stderr and still exits 0, so the
  // harness must read stderr on success too.
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: session, cwd: PROJ }),
    env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, encoding: 'utf8' });
  return { code: r.status, err: r.stderr || '', out: r.stdout || '' };
}
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

setPct({ 'impl-a': 12, 'impl-b': 20 });

cfg(null);
check('no config = no-op', run(newSession()).err === '');

cfg({ listCmd: LIST, readCmd: READ, pollSeconds: 0 });
check('below threshold = silent', run(newSession()).err === '');

// Threshold crossing, then band re-alerting on the SAME session.
setPct({ 'impl-a': 45, 'impl-b': 20 });
const s = newSession();
const first = run(s);
check('crossing 40% alerts', /impl-a at 45%/.test(first.err));
check('alert names the bank-first action', /Bank state BEFORE/.test(first.err));
check('quiet agent not named', !/impl-b/.test(first.err));
check('same band does not re-alert', run(s).err === '');
setPct({ 'impl-a': 52, 'impl-b': 20 });
check('next band re-alerts', /impl-a at 52%/.test(run(s).err));
setPct({ 'impl-a': 58, 'impl-b': 20 });
check('same band again stays quiet', run(s).err === '');
setPct({ 'impl-a': 61, 'impl-b': 44 });
const third = run(s);
check('third band alerts', /impl-a at 61%/.test(third.err));
check('newly-crossing agent joins the alert', /impl-b at 44%/.test(third.err));

// A fresh session has its own state.
check('fresh session alerts again', /impl-a at 61%/.test(run(newSession()).err));

// Debounce: with pollSeconds high, the second call must not poll at all.
cfg({ listCmd: LIST, readCmd: READ, pollSeconds: 600 });
const d = newSession();
setPct({ 'impl-a': 70 });
check('debounce: first call polls', /impl-a at 70%/.test(run(d).err));
setPct({ 'impl-a': 90 });
check('debounce: second call skipped', run(d).err === '');

// Single-call mode: percentages already in the listing, no readCmd.
cfg({ listCmd: LISTWIDE, pollSeconds: 0 });
setPct({ 'solo-x': 66 });
check('single-call mode parses listing', /solo-x at 66%/.test(run(newSession()).err));

// Failure modes must all be silent.
cfg({ listCmd: 'definitely-not-a-real-command-xyz', pollSeconds: 0 });
check('missing CLI = silent', run(newSession()).err === '');
cfg({ listCmd: LIST, readCmd: READ, pattern: '[unclosed', pollSeconds: 0 });
check('bad pattern = silent', run(newSession()).err === '');
cfg({ listCmd: LIST, readCmd: READ, pattern: 'nomatch:([0-9]+)%', pollSeconds: 0 });
check('no pattern match = silent', run(newSession()).err === '');
cfg({ listCmd: LIST, readCmd: READ, enabled: false, pollSeconds: 0 });
setPct({ 'impl-a': 99 });
check('enabled:false = silent', run(newSession()).err === '');

// Custom threshold/band.
cfg({ listCmd: LIST, readCmd: READ, threshold: 80, band: 5, pollSeconds: 0 });
setPct({ 'impl-a': 70 });
check('custom threshold not reached', run(newSession()).err === '');
setPct({ 'impl-a': 82 });
check('custom threshold reached', /impl-a at 82%/.test(run(newSession()).err));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
