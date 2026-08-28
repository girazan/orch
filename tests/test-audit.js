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
