// board-html: parse ROUTE grammar, render tracks/buckets/annotations,
// skip malformed lines with a notice, rerun-safe.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'board-html.js');
const SCRATCH = path.join(__dirname, `scratch-board-${process.pid}`);
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(SCRATCH, 'worklogs'), { recursive: true });
fs.mkdirSync(path.join(SCRATCH, 'adr'), { recursive: true });

const BOARD = path.join(SCRATCH, 'BOARD.md');
fs.writeFileSync(BOARD, [
  '# Board',
  '',
  '| Lane | Status |',
  '|---|---|',
  '| C1 · hds | running |',
  '| C2 · battery | blocked |',
  '',
  '## ROUTE',
  'buckets: NOW · SEP W1 · SEP W2-3',
  'C1 | NOW | #1943-C merge |',
  'C1 | SEP W1 | PT0053 two-cycle fix | -> CONVERGE-SETTLED',
  'C1 | SEP W2-3 | certify exit 0 | milestone: HDS DONE',
  'C2 | NOW | ✓ battery re-run |',
  'YOU | NOW | merge clicks + push mains |',
  'YOU | SEP W1 | #1909 bottoms walk |',
  'this line has no pipes and is malformed',
  '',
  '## GATES',
  'acceptance/ read-only · certify byte-flat',
].join('\n'));

fs.writeFileSync(path.join(SCRATCH, 'worklogs', 'C1-hds.md'), [
  'BRIEF', 'metric:  drift, target <2%', 'done: certify exit 0', '',
  'iter 3 · abc1234 · 4.1% → 2.3% · keep · quench retune',
].join('\n'));
fs.writeFileSync(path.join(SCRATCH, 'adr', '0007-gain-scale.md'), 'Status: proposed\n\nGain scale.');
fs.writeFileSync(path.join(SCRATCH, 'adr', '0002-old.md'), 'Status: accepted\n\nOld.');

const OUT = path.join(SCRATCH, 'board.html');
function run(extra) {
  return spawnSync('node', [SCRIPT, BOARD, OUT,
    '--worklogs', path.join(SCRATCH, 'worklogs'),
    '--adr', path.join(SCRATCH, 'adr'),
    ...(extra || [])], { encoding: 'utf8' });
}
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

const r = run(['--stale', 'C2:5d', '--digest', 'C1:4 ships · 1 block', '--queue', 'suite -> PR -> click']);
check('exit 0', r.status === 0);
const html = fs.readFileSync(OUT, 'utf8');
check('self-contained (no external refs)', !/src=|href=|@import|url\(/i.test(html) || !/https?:\/\//.test(html));
check('bucket headers rendered', html.includes('SEP W2-3'));
check('lane track rendered', /C1[^<]*hds/.test(html));
check('item rendered', html.includes('PT0053 two-cycle fix'));
check('outcome arrow rendered', html.includes('CONVERGE-SETTLED'));
check('milestone rendered', html.includes('HDS DONE'));
check('done item marked', /✓[^<]*battery re-run|<s[^>]*>[^<]*battery re-run/.test(html));
check('YOU lane rendered', html.includes('merge clicks + push mains'));
check('metric from worklog', html.includes('4.1% → 2.3%'));
check('metric target from BRIEF', html.includes('target &lt;2%'));
check('stale flag rendered', /⚠[^<]*5d|5d[^<]*⚠/.test(html));
check('digest rendered', html.includes('4 ships · 1 block'));
check('ADR age footer (proposed only)', html.includes('0007') && !html.includes('0002-old'));
check('gates footer', html.includes('acceptance/ read-only'));
check('queue rendered', html.includes('suite -&gt; PR -&gt; click'));
check('malformed line -> notice, not crash', /1 malformed ROUTE line|malformed/.test(html));

const r2 = run([]);
check('rerun-safe, args optional', r2.status === 0);
check('unreadable board exits 1', spawnSync('node', [SCRIPT, path.join(SCRATCH, 'nope.md'), OUT], { encoding: 'utf8' }).status === 1);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
