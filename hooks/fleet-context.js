// Stop — fleet fuel gauge: watches the CONTEXT of the delegates you are
// driving, not your own (context-monitor owns yours). Fires at a turn
// boundary, the natural pause point, and re-alerts per band as an agent
// burns down: 40% → 50% → 60% …
//
// Runtime-agnostic by construction: it shells out to commands YOU name, so
// a herdr/tmux/zellij/API fleet all work and a status-line restyle is a
// config edit, not a plugin release.
//
// .claude/orch.json (no config = no-op):
//   { "fleetContext": {
//       "listCmd": "herdr agent list --json",   // required to activate
//       "readCmd": "herdr agent read {name} --source visible",
//       "pattern": "ctx:([0-9]+)%",             // capture group 1 = percent used
//       "threshold": 40, "band": 10, "pollSeconds": 120, "maxAgents": 12
//   } }
// If listCmd's output already carries the percentages, omit readCmd and the
// hook parses names+percent from that single call — cheaper and immune to
// status-line churn.
//
// Advisory ONLY, and silent on every failure (missing CLI, bad JSON, no
// match, timeout): a watchdog that breaks a turn is worse than one that
// misses a reading.
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const { readStdin, loadConfig, tmpMark } = require('./lib/config');

const { j } = readStdin();
if (!j) process.exit(0);

const cfg = loadConfig(j).fleetContext || {};
if (cfg.enabled === false || !cfg.listCmd) process.exit(0);

// `|| default` would treat a configured 0 as unset — and pollSeconds: 0
// (poll every turn) is a legitimate, useful setting.
const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
const THRESHOLD = num(cfg.threshold, 40);
const BAND = Math.max(1, num(cfg.band, 10));
const POLL_MS = num(cfg.pollSeconds, 120) * 1000;
const MAX_AGENTS = Math.max(1, num(cfg.maxAgents, 12));
const PATTERN = cfg.pattern || 'ctx:([0-9]+)%';

const session = j.session_id || 'nosession';
const pollMark = tmpMark('orch-fleet-poll', session);
const stateFile = tmpMark('orch-fleet-state', session);

// Debounce: Stop fires every turn; polling a fleet every turn would tax
// every reply for a number that moves on the scale of minutes.
try {
  if (Date.now() - fs.statSync(pollMark).mtimeMs < POLL_MS) process.exit(0);
} catch { /* first run: poll */ }
try { fs.writeFileSync(pollMark, '1'); } catch { process.exit(0); }

function sh(cmd) {
  return execSync(cmd, { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString();
}
let listOut;
try { listOut = sh(cfg.listCmd); } catch { process.exit(0); }

let re;
try { re = new RegExp(PATTERN); } catch { process.exit(0); }

// Agent names: JSON array/objects with a name-ish field, else non-empty
// lines. Both shapes are common across fleet CLIs.
function agentNames(out) {
  try {
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : (parsed.agents || parsed.items || []);
    const names = arr.map(a => (typeof a === 'string' ? a : (a && (a.name || a.id || a.agent)))).filter(Boolean);
    if (names.length) return names.map(String);
  } catch { /* not JSON — fall through to lines */ }
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map(s => s.split(/\s+/)[0]).filter(s => /^[\w.:@-]+$/.test(s));
}

const readings = [];
if (!cfg.readCmd) {
  // Single-call mode: percentages already in the listing, paired to the
  // name on their own line.
  for (const line of listOut.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const name = (line.trim().split(/\s+/)[0] || '?').replace(/[",]/g, '');
    readings.push([name, parseInt(m[1], 10)]);
  }
} else {
  for (const name of agentNames(listOut).slice(0, MAX_AGENTS)) {
    try {
      const m = sh(cfg.readCmd.replace(/\{name\}/g, name)).match(re);
      if (m) readings.push([name, parseInt(m[1], 10)]);
    } catch { /* one unreadable agent never aborts the sweep */ }
  }
}
if (!readings.length) process.exit(0);

let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}

// Band-based re-alerting: one alert per band crossed, so a burning agent
// keeps reporting while a parked one stays quiet.
const alerts = [];
for (const [name, pct] of readings) {
  if (!Number.isFinite(pct) || pct < THRESHOLD) continue;
  const band = Math.floor((pct - THRESHOLD) / BAND);
  if (state[name] !== undefined && band <= state[name]) continue;
  state[name] = band;
  alerts.push(`${name} at ${pct}% context used`);
}
try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
if (!alerts.length) process.exit(0);

console.error(
  'FLEET CONTEXT: ' + alerts.join(' · ') + '.\n' +
  'Bank state BEFORE autocompaction picks the moment: for yourself, refresh ' +
  'the worklog + HANDOFF now; for a delegate, tell it to write its state to ' +
  'the worklog, then decide resume-vs-fresh (delegate.md: an agent\'s context ' +
  'dies with it — no bank, no kill).'
);
process.exit(0);
