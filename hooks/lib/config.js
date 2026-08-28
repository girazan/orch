// Shared config loader. Per-project config lives at <project>/.claude/orch.json
// (the hook payload's cwd is the project dir). Missing file = {} — every hook
// defines safe defaults and most config-dependent hooks no-op without config.
// A user-level lock file (~/.claude/orch-lock.json) deep-overrides project
// config: a per-repo orch.json can never switch off a guard the user locked.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function deepMerge(base, win) {
  // win overrides base; plain objects merge, everything else replaces.
  const out = { ...base };
  for (const k of Object.keys(win)) {
    const b = out[k], w = win[k];
    out[k] = (b && w && typeof b === 'object' && typeof w === 'object' &&
              !Array.isArray(b) && !Array.isArray(w)) ? deepMerge(b, w) : w;
  }
  return out;
}

function loadLock() {
  const p = path.join(os.homedir(), '.claude', 'orch-lock.json');
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    console.error(`orch: WARNING — ${p} is not valid JSON; locked guard overrides are INACTIVE until fixed.`);
  }
  return null;
}

function readStdin() {
  // Returns { j, oversized }. Callers decide fail-open vs fail-closed.
  let raw;
  try { raw = fs.readFileSync(0); } catch { return { j: null, oversized: false }; }
  if (raw.length >= 1_048_576) return { j: null, oversized: true };
  try { return { j: JSON.parse(raw.toString('utf8')), oversized: false }; }
  catch { return { j: null, oversized: false }; }
}

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
      // user configured is worse than noise. Warn; blocking hooks see the
      // corruption and fail closed instead of running ungated.
      console.error(`orch: WARNING — ${p} is not valid JSON; configured guards are INACTIVE until fixed.`);
      corrupt = true;
      break;
    }
  }
  const lock = loadLock();
  let out = lock ? deepMerge(cfg, lock) : cfg;
  // A locked contract REPLACES the project's — an additive merge would let
  // the agent-writable project file add permissive domains beside it.
  if (lock && Object.prototype.hasOwnProperty.call(lock, 'contract')) out.contract = lock.contract;
  if (corrupt) Object.defineProperty(out, '__corrupt', { value: true });
  return out;
}

const AUDIT_REL = path.join('.claude', 'orch-audit.jsonl');

function appendAudit(root, entry) {
  // Audit is best-effort evidence, never a point of failure for the hook.
  const p = path.resolve(root || process.cwd(), AUDIT_REL);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.error(`orch: WARNING — audit write failed (${p}): ${e.message}`);
  }
}

module.exports = { readStdin, loadConfig, appendAudit, AUDIT_REL };
