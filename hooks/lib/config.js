// Shared config loader. Per-project config lives at <project>/.claude/orch.json
// (the hook payload's cwd is the project dir). Missing file = {} — every hook
// defines safe defaults and most config-dependent hooks no-op without config.
'use strict';
const fs = require('fs');
const path = require('path');

function readStdin() {
  // Returns { j, raw, oversized }. Callers decide fail-open vs fail-closed.
  let raw;
  try { raw = fs.readFileSync(0); } catch { return { j: null, oversized: false }; }
  if (raw.length >= 1_048_576) return { j: null, oversized: true };
  try { return { j: JSON.parse(raw.toString('utf8')), oversized: false }; }
  catch { return { j: null, oversized: false }; }
}

function loadConfig(j) {
  const roots = [];
  if (j && j.cwd) roots.push(j.cwd);
  roots.push(process.cwd());
  for (const r of roots) {
    const p = path.join(r, '.claude', 'orch.json');
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      // Bad config never breaks a hook — but silently losing the guards the
      // user configured is worse than noise. Warn (stderr on exit 0 is
      // non-blocking) and fall back to defaults.
      console.error(`orch: WARNING — ${p} is not valid JSON; configured guards are INACTIVE until fixed.`);
    }
  }
  return {};
}

module.exports = { readStdin, loadConfig };
