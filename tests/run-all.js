// Runs every tests/test-*.js sequentially; exits non-zero on first failure.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => /^test-.*\.js$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  process.stdout.write(`== ${f} ==\n`);
  try {
    execFileSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  } catch (e) {
    failed++;
  }
}
console.log(failed ? `\n${failed} suite(s) FAILED` : `\nall ${files.length} suites passed`);
process.exit(failed ? 1 : 0);
