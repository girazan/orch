// PreToolUse (Edit|Write) — investigation gate (three stages: DENY → the
// denial names the facts to gather → retry ALLOWED). The first edit to a
// critical-surface file each session is denied with a fact checklist; the
// act of gathering the facts creates context that self-evaluation never
// does (the gateguard insight). No-ops without config.
//
// .claude/orch.json:
//   { "factForce": {
//       "pathRegex": "(Solver|Kernel|Pricing)",     // required to activate
//       "scopeRegex": "(^|[\\\\/])src[\\\\/]",     // optional extra scope
//       "facts": ["...", "..."]                     // optional, has defaults
//   } }
// Marker TTL 24h: a marker from a dead session must not waive the gate forever.
// Fail-open by design: this is a gate, not a block — if the marker can't
// persist or input is abnormal, allow (a permanent deny loop is worse).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { readStdin, loadConfig } = require('./lib/config');

const { j } = readStdin();
if (!j) process.exit(0);
const f = (j.tool_input && (j.tool_input.file_path || j.tool_input.filePath)) || '';
if (!f) process.exit(0);

const cfg = loadConfig(j).factForce || {};
if (!cfg.pathRegex) process.exit(0);
let hot, scope = null;
try {
  hot = new RegExp(cfg.pathRegex, 'i');
  if (cfg.scopeRegex) scope = new RegExp(cfg.scopeRegex, 'i');
} catch { process.exit(0); }
if (!hot.test(f) || (scope && !scope.test(f))) process.exit(0);

const session = j.session_id || 'nosession';
const key = crypto.createHash('md5').update(session + '|' + f.toLowerCase()).digest('hex');
const marker = path.join(os.tmpdir(), 'orch-factforce-' + key);

const TTL_MS = 24 * 60 * 60 * 1000;
if (fs.existsSync(marker)) {
  let stale = false;
  try { stale = (Date.now() - fs.statSync(marker).mtimeMs) > TTL_MS; } catch { stale = false; }
  if (stale) { try { fs.unlinkSync(marker); } catch {} }
  else process.exit(0); // stage 3: ALLOW the retry
}
try { fs.writeFileSync(marker, '1'); } catch { process.exit(0); }

const facts = cfg.facts || [
  'Every caller of the member you are changing (search the tree, not memory).',
  'The test that goes red if this change is wrong — write it FIRST if none exists.',
  'The measured number motivating the change and where it was reproduced.',
  'Units/invariants on every quantity touched.',
];
console.error(
  'FACT-FORCE (first critical-file edit this session — retry passes automatically).\n' +
  'Before editing ' + path.basename(f) + ', state in the conversation:\n' +
  facts.map((s, i) => `${i + 1}. ${s}`).join('\n')
);
process.exit(2);
