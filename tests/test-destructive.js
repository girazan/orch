// destructive-git guard smoke incl. the round-3 gh rules. Fake HOME.
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
check('gh pr merge blocked', run('gh pr merge 5') === 2);
check('gh api PUT blocked', run('gh api -X PUT repos/o/r/contents/x') === 2);
check('gh api --method post blocked', run('gh api --method POST repos/o/r/issues') === 2);
check('gh api GET allowed', run('gh api repos/o/r/pulls') === 0);
check('gh pr view allowed', run('gh pr view 5') === 0);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
