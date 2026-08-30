// Prompt-contract test — the record grammars are stated in prose in more
// than one file; this pins every restatement to one canonical string so
// they cannot drift apart silently.
'use strict';
const fs = require('fs');
const path = require('path');

const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const go = R('skills/go/SKILL.md');
const goal = R('skills/goal/SKILL.md');
const board = R('skills/board/SKILL.md');
const work = R('skills/go/work.md');
const loop = R('skills/go/loop.md');
const renderer = R('scripts/board-html.js');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

// 1. ROUTE worklog line — canonical in go/SKILL.md, all six fields in order.
const ROUTE = 'ROUTE: lane:C<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>';
check('go states the full ROUTE line grammar', go.includes(ROUTE));
check('no other skill restates the ROUTE line', ![goal, board, work, loop].some(t => t.includes('ROUTE: lane:')));

// 2. Board item grammar — goal writes it, board reads it, renderer parses it.
check('goal writes items as C<n> | <bucket> | <item> |', goal.includes('C<n> | <bucket> | <item> |'));
check('board reads items as LANE | BUCKET | TEXT |', board.includes('LANE | BUCKET | TEXT |'));
for (const [name, marker] of [['outcome arrow', '-> '], ['milestone label', 'milestone:']]) {
  check(`goal and board both carry the ${name}`, goal.includes(marker) && board.includes(marker));
}
// goal only seeds items (never done); ✓ is written by go's ship phase and
// read by board.
check('go ships the done tick and board reads it', go.includes('✓') && board.includes('✓'));
// Renderer must accept exactly that shape (incl. outcome + milestone).
check('renderer splits items on |', /split\(\s*['"]\|['"]\s*\)|\|/.test(renderer));
for (const marker of ['->', 'milestone:', '✓']) {
  check(`renderer handles "${marker}"`, renderer.includes(marker));
}

// 3. Ledger iter line — canonical in work.md; board reads before → after.
check('work states the iter ledger grammar',
  work.includes('iter <n> · <short-sha> · <before> → <after> · keep|revert|flat|refuted · <what>'));
check('board reads the ledger before → after', board.includes('before → after'));

// 4. LAUNCH journal line — canonical in loop.md.
check('loop states the LAUNCH line grammar',
  loop.includes('LAUNCH <date> · <prompt file> · max-iter <n> · budget <tokens> · promise <string>'));

console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
