// v0.7.0 legacy lock migration: moves top-level contract/models into
// repos[<git-common-dir>], serialized via O_EXCL, never touched by a hook.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'migrate-lock.js');
const SCRATCH = path.join(__dirname, 'scratch-migrate-lock');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
const LOCK = path.join(FAKEHOME, '.claude', 'orch-lock.json');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: PROJ });
execFileSync('git', ['-C', PROJ, 'config', 'user.email', 't@t.com']);
execFileSync('git', ['-C', PROJ, 'config', 'user.name', 't']);

const { resolveRepoKey } = require('../hooks/lib/config');
const repoKey = resolveRepoKey(PROJ);

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

function runMigrate(cwd) {
  try {
    execFileSync('node', [SCRIPT, '--home', FAKEHOME], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}

check('no lock file: exits 0 (nothing to migrate)', runMigrate(PROJ) === 0);

fs.writeFileSync(LOCK, JSON.stringify({
  contract: { schemaVersion: 2, domains: { web: { paths: ['src/**'], decide: 'ai', ship: 'commit' } } },
  models: { low: 'haiku', mid: 'sonnet', high: 'opus', frontier: 'opus' },
  destructiveGit: { enabled: true },
}));
check('migration exits 0', runMigrate(PROJ) === 0);
const afterMigrate = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
check('contract moved into repos[key]', afterMigrate.repos[repoKey].contract.domains.web.decide === 'ai');
check('models moved into repos[key]', afterMigrate.repos[repoKey].models.mid === 'sonnet');
check('top-level contract removed after migration', afterMigrate.contract === undefined);
check('top-level models removed after migration', afterMigrate.models === undefined);
check('guard toggle destructiveGit untouched, still top-level', afterMigrate.destructiveGit.enabled === true);

check('re-running migration is a no-op (exits 0)', runMigrate(PROJ) === 0);
const afterSecondRun = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
check('repos[key] unchanged after second run', afterSecondRun.repos[repoKey].contract.domains.web.decide === 'ai');

fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
