#!/usr/bin/env node
// One-time, operator-run migration: moves a lock's legacy top-level
// contract/models into repos[<git-common-dir>]. Never invoked by a hook
// (hooks must never write the lock file implicitly — spec §1 "Legacy
// migration"). Serialized with O_EXCL so two concurrent runs cannot
// corrupt the file.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveRepoKey } = require('../hooks/lib/config');

function parseArgs(argv) {
  let home = os.homedir();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home' && argv[i + 1]) { home = argv[i + 1]; i++; }
  }
  return { home };
}

function main() {
  const { home } = parseArgs(process.argv.slice(2));
  const lockPath = path.join(home, '.claude', 'orch-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.log('orch: no lock file — nothing to migrate.');
    process.exit(0);
  }
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (e) {
    console.error(`orch: lock file is not valid JSON — fix it before migrating (${e.message}).`);
    process.exit(1);
  }
  if (lock.contract === undefined && lock.models === undefined) {
    console.log('orch: no legacy top-level contract/models — nothing to migrate.');
    process.exit(0);
  }
  const repoKey = resolveRepoKey(process.cwd());
  if (!repoKey) {
    console.error('orch: current directory is not inside a git repository — run this from the repo you want to migrate.');
    process.exit(1);
  }

  const lockDir = path.dirname(lockPath);
  const lockfilePath = path.join(lockDir, '.migrate-lock.lock');
  let fd;
  try {
    fd = fs.openSync(lockfilePath, 'wx'); // O_EXCL: fails if another migration is mid-flight
  } catch {
    console.error('orch: another migration appears to be running (lockfile exists) — retry shortly.');
    process.exit(1);
  }
  try {
    // Re-read under the lock in case of a race since our first read above.
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (lock.contract === undefined && lock.models === undefined) {
      console.log('orch: no legacy top-level contract/models — nothing to migrate.');
      return;
    }
    const migrated = { ...lock };
    migrated.repos = { ...(lock.repos || {}) };
    migrated.repos[repoKey] = { ...(migrated.repos[repoKey] || {}) };
    if (lock.contract !== undefined) migrated.repos[repoKey].contract = lock.contract;
    if (lock.models !== undefined) migrated.repos[repoKey].models = lock.models;
    delete migrated.contract;
    delete migrated.models;

    const tmpPath = lockPath + '.tmp-' + process.pid;
    const fh = fs.openSync(tmpPath, 'w');
    fs.writeSync(fh, JSON.stringify(migrated, null, 2));
    fs.fsyncSync(fh);
    fs.closeSync(fh);
    fs.renameSync(tmpPath, lockPath);
    console.log(`orch: migrated legacy contract/models into repos["${repoKey}"].`);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lockfilePath);
  }
}

main();
