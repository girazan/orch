// PostToolUse (Bash|PowerShell) — fires a configured command, detached, after
// commit-shaped git operations (commit / merge / pull / cherry-pick /
// rebase --continue). Built for keeping derived artifacts fresh (a knowledge
// graph, a codemap, generated docs) without the agent remembering to.
// Never blocks; lock file (10-min staleness) prevents pile-ups. No-ops
// without config.
//
// .claude/orch.json:
//   { "runOnCommit": { "command": "graphify", "args": ["update", "."] } }
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readStdin, loadConfig, tmpMark } = require('./lib/config');

try {
  const { j } = readStdin();
  if (!j) process.exit(0);
  const cmd = (j.tool_input && (j.tool_input.command || '')) || '';
  if (!cmd) process.exit(0);

  const cfg = loadConfig(j).runOnCommit || {};
  if (!cfg.command) process.exit(0);

  const SEG = '[^\\n|;&]*';
  const G = '(?:\\brtk\\s+)?\\bgit(?:\\.exe)?\\b' + SEG;
  const shaped = new RegExp(G + '\\b(commit|merge|pull|cherry-pick)\\b')
    .test(cmd) || new RegExp(G + '\\brebase\\b' + SEG + '--continue').test(cmd);
  if (!shaped) process.exit(0);

  // Per-repo lock — two repos committing in parallel must not debounce
  // each other.
  const lock = tmpMark('orch-runoncommit', path.resolve(j.cwd || process.cwd()).toLowerCase());
  try {
    if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 10 * 60 * 1000) process.exit(0);
  } catch {}
  try { fs.writeFileSync(lock, String(process.pid)); } catch {}

  const child = spawn(cfg.command, cfg.args || [], {
    cwd: j.cwd || process.cwd(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
} catch { /* never block */ }
process.exit(0);
