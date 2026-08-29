# Numbered Lanes & Route Board (orch v0.6.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lane IDs (`C<n> · name`) everywhere a campaign appears, plus `/orch:board` — a read-only fourth command rendering a forward-looking route map (buckets × tracks, YOU lane, gates footer, today's queue) in ASCII, with an HTML page on demand.

**Architecture:** Route data lives in a new `## ROUTE` section of `docs/BOARD.md` (`|`-grammar); `/orch:goal` seeds it, `/orch:go` updates it, `/orch:board` only renders. Division of labor for rendering: the SKILL (model) does judgment + git forensics (stale detection, gate digest, queue ordering) and renders ASCII; `scripts/board-html.js` does deterministic HTML from the board file + fs-derived data (worklog metrics, ADR ages), taking the model's judgment as CLI args.

**Tech Stack:** Dependency-free Node script; plugin skill markdown; `node` test scripts matching the six existing suites' harness style.

**Spec:** `docs/superpowers/specs/2026-08-29-lanes-and-board-design.md`

## Global Constraints

- Lane ID grammar: `C<n> · <name>`; worklog `tmp/worklogs/C<n>-<name>.md`; ROUTE line grammar exactly `ROUTE: lane:C<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>`.
- ROUTE section grammar (BOARD.md): a `buckets:` line (`·`-separated labels), then item lines `LANE | BUCKET | TEXT |` with optional 4th field `-> <outcome>` or `milestone: <label>`; done items have a leading `✓` on TEXT; lanes are `C<n>` or `YOU`.
- `/orch:board` never acts, never writes — single exception: numbering legacy rows, announced.
- Buckets are operator-named labels, never fabricated dates.
- `scripts/board-html.js` is dependency-free, self-contained-output, silent-skip (with a rendered notice) on malformed ROUTE lines, exit 0 on success / 1 on unreadable board.
- Test expectations are "script exits 0", never a hardcoded N/N. Scratch dirs unique per run (`scratch-board-${pid}`) with exit-hook cleanup (Windows lock immunity, per test-fleet-context.js). Fake HOME not needed (no config/lock reads).
- Hooks untouched; all six existing suites stay green.
- Commit per task; push only in the final task.

---

### Task 1: `scripts/board-html.js` + test

**Files:**
- Create: `scripts/board-html.js`
- Test: `tests/test-board-html.js`

**Interfaces:**
- Produces CLI: `node scripts/board-html.js <boardPath> <outPath> [--worklogs <dir>] [--adr <dir>] [--stale "C2:5d,C4:3d"] [--digest "C5:4 ships · 1 block"] [--queue "<text>"] [--title "<text>"]`
  - Board parsing: `## ROUTE` section per Global Constraints; board-table rows matched loosely (`| C3 · name | ... | status | ...` — first cell starting `C<n> ·` or a `# | Front |`-era row, tolerated but not required).
  - `--worklogs`: per lane, file matching `C<n>-*.md`; metric = last line matching `^iter .+ · (.+?) → (.+?) ·` giving `before → after`; target = the worklog's `metric:` BRIEF line if present.
  - `--adr`: files whose content matches `^Status: proposed`; age in days from fs mtime.
  - `--stale`/`--digest`: model-computed judgment, rendered verbatim as ⚠/digest annotations on the named lanes.
  - Output: one self-contained HTML file (inline CSS, dark default + light via `prefers-color-scheme`), tracks as rows, buckets as columns, items in cells, ✓ struck-through, `milestone:` bold with ✅, YOU track visually distinct, GATES + ADR + QUEUE footer.

- [ ] **Step 1: Write the failing test**

Create `tests/test-board-html.js`:

```js
// board-html: parse ROUTE grammar, render tracks/buckets/annotations,
// skip malformed lines with a notice, rerun-safe.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'board-html.js');
const SCRATCH = path.join(__dirname, `scratch-board-${process.pid}`);
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(SCRATCH, 'worklogs'), { recursive: true });
fs.mkdirSync(path.join(SCRATCH, 'adr'), { recursive: true });

const BOARD = path.join(SCRATCH, 'BOARD.md');
fs.writeFileSync(BOARD, [
  '# Board',
  '',
  '| Lane | Status |',
  '|---|---|',
  '| C1 · hds | running |',
  '| C2 · battery | blocked |',
  '',
  '## ROUTE',
  'buckets: NOW · SEP W1 · SEP W2-3',
  'C1 | NOW | #1943-C merge |',
  'C1 | SEP W1 | PT0053 two-cycle fix | -> CONVERGE-SETTLED',
  'C1 | SEP W2-3 | certify exit 0 | milestone: HDS DONE',
  'C2 | NOW | ✓ battery re-run |',
  'YOU | NOW | merge clicks + push mains |',
  'YOU | SEP W1 | #1909 bottoms walk |',
  'this line has no pipes and is malformed',
  '',
  '## GATES',
  'acceptance/ read-only · certify byte-flat',
].join('\n'));

fs.writeFileSync(path.join(SCRATCH, 'worklogs', 'C1-hds.md'), [
  'BRIEF', 'metric:  drift, target <2%', 'done: certify exit 0', '',
  'iter 3 · abc1234 · 4.1% → 2.3% · keep · quench retune',
].join('\n'));
fs.writeFileSync(path.join(SCRATCH, 'adr', '0007-gain-scale.md'), 'Status: proposed\n\nGain scale.');
fs.writeFileSync(path.join(SCRATCH, 'adr', '0002-old.md'), 'Status: accepted\n\nOld.');

const OUT = path.join(SCRATCH, 'board.html');
function run(extra) {
  return spawnSync('node', [SCRIPT, BOARD, OUT,
    '--worklogs', path.join(SCRATCH, 'worklogs'),
    '--adr', path.join(SCRATCH, 'adr'),
    ...(extra || [])], { encoding: 'utf8' });
}
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

const r = run(['--stale', 'C2:5d', '--digest', 'C1:4 ships · 1 block', '--queue', 'suite -> PR -> click']);
check('exit 0', r.status === 0);
const html = fs.readFileSync(OUT, 'utf8');
check('self-contained (no external refs)', !/src=|href=|@import|url\(/i.test(html) || !/https?:\/\//.test(html));
check('bucket headers rendered', html.includes('SEP W2-3'));
check('lane track rendered', /C1[^<]*hds/.test(html));
check('item rendered', html.includes('PT0053 two-cycle fix'));
check('outcome arrow rendered', html.includes('CONVERGE-SETTLED'));
check('milestone rendered', html.includes('HDS DONE'));
check('done item marked', /✓[^<]*battery re-run|<s[^>]*>[^<]*battery re-run/.test(html));
check('YOU lane rendered', html.includes('merge clicks + push mains'));
check('metric from worklog', html.includes('4.1% → 2.3%'));
check('metric target from BRIEF', html.includes('target <2%'));
check('stale flag rendered', /⚠[^<]*5d|5d[^<]*⚠/.test(html));
check('digest rendered', html.includes('4 ships · 1 block'));
check('ADR age footer (proposed only)', html.includes('0007') && !html.includes('0002-old'));
check('gates footer', html.includes('acceptance/ read-only'));
check('queue rendered', html.includes('suite -> PR -> click'));
check('malformed line -> notice, not crash', /1 malformed ROUTE line|malformed/.test(html));

const r2 = run([]);
check('rerun-safe, args optional', r2.status === 0);
check('unreadable board exits 1', spawnSync('node', [SCRIPT, path.join(SCRATCH, 'nope.md'), OUT], { encoding: 'utf8' }).status === 1);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-board-html.js`
Expected: crash — script does not exist.

- [ ] **Step 3: Implement `scripts/board-html.js`**

```js
#!/usr/bin/env node
// board-html — deterministic renderer for /orch:board's HTML view.
// The SKILL (model) owns judgment (stale detection, digest, queue order)
// and passes it as args; this script owns parsing + rendering only, so
// its output is testable and its failures are boring.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const [boardPath, outPath] = args;
function opt(name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; }

let board;
try { board = fs.readFileSync(boardPath, 'utf8'); }
catch (e) { console.error('board-html: cannot read ' + boardPath); process.exit(1); }

// --- parse ---------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lines = board.split(/\r?\n/);
const routeAt = lines.findIndex(l => /^##\s*ROUTE\b/i.test(l));
let buckets = [], items = [], malformed = 0;
if (routeAt >= 0) {
  for (let i = routeAt + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^##\s/.test(l)) break;
    if (!l) continue;
    const bm = l.match(/^buckets:\s*(.+)$/i);
    if (bm) { buckets = bm[1].split('·').map(s => s.trim()).filter(Boolean); continue; }
    const parts = l.split('|').map(s => s.trim());
    if (parts.length < 3 || !/^(C\d+|YOU)$/i.test(parts[0])) { malformed++; continue; }
    const extra = parts[3] || '';
    items.push({
      lane: parts[0].toUpperCase(), bucket: parts[1],
      done: parts[2].startsWith('✓'), text: parts[2].replace(/^✓\s*/, ''),
      outcome: (extra.match(/^->\s*(.+)$/) || [])[1] || null,
      milestone: (extra.match(/^milestone:\s*(.+)$/i) || [])[1] || null,
    });
  }
}
// Board-table rows: "| C3 · name | ... status ..." — loose, optional.
const laneNames = {}, laneStatus = {};
for (const l of lines) {
  const m = l.match(/^\|\s*(C\d+)\s*·\s*([^|]+?)\s*\|(.*)\|?$/);
  if (m) { laneNames[m[1]] = m[2].trim(); laneStatus[m[1]] = (m[3].split('|')[0] || '').trim(); }
}
// GATES section: lines after "## GATES" until next heading.
const gatesAt = lines.findIndex(l => /^##\s*GATES\b/i.test(l));
const gates = gatesAt >= 0
  ? lines.slice(gatesAt + 1).filter(l => l.trim() && !/^#/.test(l)).slice(0, 3).join(' ')
  : (lines.find(l => /^Rules of the board/i.test(l)) || '');

const annot = raw => Object.fromEntries((raw || '').split(',').map(s => {
  const i = s.indexOf(':'); return i < 0 ? null : [s.slice(0, i).trim().toUpperCase(), s.slice(i + 1).trim()];
}).filter(Boolean));
const stale = annot(opt('stale')), digest = annot(opt('digest'));

// Worklog metrics: last ledger line's "before → after", BRIEF metric: line.
const metrics = {};
const wl = opt('worklogs');
if (wl) {
  let files = [];
  try { files = fs.readdirSync(wl); } catch {}
  for (const f of files) {
    const m = f.match(/^(C\d+)-.*\.md$/i);
    if (!m) continue;
    let t = '';
    try { t = fs.readFileSync(path.join(wl, f), 'utf8'); } catch { continue; }
    const iters = [...t.matchAll(/^iter .+? · .+? · (.+?) → (.+?) ·/gm)];
    const target = (t.match(/^metric:\s*(.+)$/m) || [])[1] || '';
    const last = iters[iters.length - 1];
    if (last || target) {
      metrics[m[1].toUpperCase()] =
        (last ? `${last[1]} → ${last[2]}` : '') + (target ? ` (${target.trim()})` : '');
    }
  }
}
// Proposed ADRs with age in days.
const adrs = [];
const adrDir = opt('adr');
if (adrDir) {
  let files = [];
  try { files = fs.readdirSync(adrDir); } catch {}
  for (const f of files) {
    try {
      const p = path.join(adrDir, f);
      if (!/^Status:\s*proposed/mi.test(fs.readFileSync(p, 'utf8'))) continue;
      adrs.push(`${f.replace(/\.md$/i, '')} proposed ${Math.round((Date.now() - fs.statSync(p).mtimeMs) / 86400000)}d`);
    } catch {}
  }
}

// --- render --------------------------------------------------------------
const lanes = [...new Set(items.map(i => i.lane))]
  .sort((a, b) => (a === 'YOU') - (b === 'YOU') || a.localeCompare(b, undefined, { numeric: true }));
if (!buckets.length) buckets = [...new Set(items.map(i => i.bucket))];

const cell = its => its.map(i => {
  let t = esc(i.text);
  if (i.done) t = `<s>✓ ${t}</s>`;
  if (i.outcome) t += ` <span class="arrow">──▶ ${esc(i.outcome)}</span>`;
  if (i.milestone) t += ` <b class="ms">= ${esc(i.milestone)} ✅</b>`;
  return `<div class="item">├─▶ ${t}</div>`;
}).join('');

const rows = lanes.map(l => {
  const name = l === 'YOU' ? 'YOU · owner lane' : `${l} · ${esc(laneNames[l] || '')}`;
  const meta = [
    laneStatus[l] ? esc(laneStatus[l]) : '',
    stale[l] ? `<span class="warn">⚠ stale ${esc(stale[l])}</span>` : '',
    metrics[l] ? `<span class="metric">${esc(metrics[l])}</span>` : '',
    digest[l] ? `<span class="digest">${esc(digest[l])}</span>` : '',
  ].filter(Boolean).join(' · ');
  const cells = buckets.map(b =>
    `<td>${cell(items.filter(i => i.lane === l && i.bucket === b))}</td>`).join('');
  return `<tr class="${l === 'YOU' ? 'you' : ''}"><th><div>${name}</div><div class="meta">${meta}</div></th>${cells}</tr>`;
}).join('\n');

const foot = [
  gates ? `GATES: ${esc(gates)}` : '',
  adrs.length ? `ADRs: ${esc(adrs.join(' · '))}` : '',
  opt('queue') ? `TODAY'S QUEUE: ${esc(opt('queue'))}` : '',
  malformed ? `⚠ ${malformed} malformed ROUTE line${malformed > 1 ? 's' : ''} skipped` : '',
].filter(Boolean).map(s => `<div>${s}</div>`).join('');

fs.writeFileSync(outPath, `<!doctype html><meta charset="utf-8">
<title>${esc(opt('title') || 'orch board')}</title>
<style>
:root{color-scheme:dark light;--bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--line:#30363d;--acc:#58a6ff;--warn:#f0883e;--ok:#3fb950}
@media(prefers-color-scheme:light){:root{--bg:#fff;--fg:#1f2328;--dim:#656d76;--line:#d1d9e0;--acc:#0969da;--warn:#bc4c00;--ok:#1a7f37}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,monospace;margin:24px}
h1{font-size:18px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:8px;vertical-align:top;text-align:left}
thead th{color:var(--acc)}
tr.you th{color:var(--warn)}
.meta{color:var(--dim);font-size:12px;font-weight:normal}
.item{margin:2px 0}.arrow{color:var(--acc)}.ms{color:var(--ok)}
.warn{color:var(--warn)}.metric{color:var(--ok)}.digest{color:var(--dim)}
s{color:var(--dim)}
footer{margin-top:16px;color:var(--dim);border-top:1px solid var(--line);padding-top:8px}
</style>
<h1>${esc(opt('title') || 'orch board')}</h1>
<table><thead><tr><th></th>${buckets.map(b => `<th>${esc(b)}</th>`).join('')}</tr></thead>
<tbody>${rows}</tbody></table>
<footer>${foot}</footer>
`);
console.log('board-html: wrote ' + outPath);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-board-html.js` — twice.
Expected: exit 0 both times. Debug the script, never weaken a check.

- [ ] **Step 5: Commit**

```bash
git add scripts/board-html.js tests/test-board-html.js
git commit -m "feat: board-html renderer — ROUTE grammar to self-contained page"
```

---

### Task 2: `skills/board/SKILL.md` — the read-only fourth command

**Files:**
- Create: `skills/board/SKILL.md`

**Interfaces:**
- Consumes: ROUTE grammar (Global Constraints), `scripts/board-html.js` CLI (Task 1), lane worklogs `tmp/worklogs/C<n>-*.md`, audit `.claude/orch-audit.jsonl`, `docs/adr/`.

- [ ] **Step 1: Write the skill** (frontmatter included, exact content):

```markdown
---
name: board
description: >
  Render the orch route board: a read-only, forward-looking map of every
  campaign lane (buckets × tracks, the YOU owner lane, gates, today's
  queue). Use when the operator wants to see progress, the path to done,
  stale lanes, or pending ADRs — without starting any work.
---

# /orch:board — three commands act, this one looks

READ-ONLY. Never route, never delegate, never edit a file — with ONE
exception, announced when it happens: assigning `C<n>` numbers to legacy
unnumbered board rows (max existing + 1, in row order; worklogs are
renamed only when next written to).

## Gather (all best-effort — render what exists, label what doesn't)

1. `docs/BOARD.md`: the lane table and the `## ROUTE` section
   (`buckets:` line; items `LANE | BUCKET | TEXT |` with optional
   `-> outcome` or `milestone: label`; leading `✓` = done).
2. Stale: `git log --format=%ci -- docs/BOARD.md` vs each lane's last
   status change (the commit whose diff touched its row). Same status
   past `board.staleDays` (`.claude/orch.json`, default 3) → ⚠ with age.
3. Metric per lane: last ledger line of `tmp/worklogs/C<n>-*.md`
   (`before → after`) plus the BRIEF `metric:` target.
4. Gate digest per lane: `.claude/orch-audit.jsonl` entries whose files
   match the lane's contract domains, since the operator's last board
   commit — count ALLOWs, BLOCKs, Rulings.
5. Proposed ADRs in `docs/adr/` with ages.
6. Missing sources render as `—` with a one-word reason (`pre-install`,
   `no worklog`) — never fabricate, never omit the row.

## Render (ASCII, in chat)

Layout, exactly this shape — buckets as columns, lanes as tracks, YOU
last and visually distinct, gates + ADRs + queue as the footer:

    ORCH BOARD · <repo> · <goal line from the board header>
    ═══════════════════════════════════════════════════════
     NOW →            <bucket 2>         <bucket 3>
    ───────────────────────────────────────────────────────
    C1 · <name>   <status> <⚠ stale Nd>   <metric> · <digest>
     ├─▶ <item>       ├─▶ <item> ──▶ <outcome>
     │                │   = <MILESTONE> ✅
    YOU · owner lane — nothing here is delegable
     ├─▶ <item>       ├─▶ <item>
    ───────────────────────────────────────────────────────
     GATES: <from ## GATES or the board's rules line>
     ADRs: <NNNN proposed Nd ⚠ …> | GATE DIGEST where lane-level
     TODAY'S QUEUE: <current session order, from NOW items + parks>

Done items keep their place with ✓ — the map read left-to-right IS the
history. Buckets are the operator's labels; never invent dates.

## `/orch:board html`

Compute stale + digest as above, then run:

    node "<plugin>/scripts/board-html.js" docs/BOARD.md tmp/board.html \
      --worklogs tmp/worklogs --adr docs/adr \
      --stale "C2:5d" --digest "C1:4 ships · 1 block" \
      --queue "<queue>" --title "orch board · <repo>"

Report the output path; do not open it unasked.

## No route section?

Render the lane table alone, then say what's missing: "no `## ROUTE`
section — `/orch:goal` seeds one per lane, or add `buckets:` + item
lines by hand." Never scaffold it yourself — this command only looks.
```

- [ ] **Step 2: Verify frontmatter**

Run: `node -e "const t=require('fs').readFileSync('skills/board/SKILL.md','utf8');if(!/^---\n/.test(t))throw 'frontmatter';['READ-ONLY','## ROUTE','board-html.js'].forEach(k=>{if(!t.includes(k))throw 'missing '+k});console.log('ok')"`
Expected: ok.

- [ ] **Step 3: Commit**

```bash
git add skills/board/
git commit -m "feat: /orch:board — read-only route-map command"
```

---

### Task 3: Lane identity through goal / go / delegate

**Files:**
- Modify: `skills/goal/SKILL.md`
- Modify: `skills/go/SKILL.md`
- Modify: `skills/go/delegate.md`

**Interfaces:**
- Produces: the `lane:C<n>` ROUTE grammar and worklog naming every other surface reads.

- [ ] **Step 1: Edit `skills/goal/SKILL.md`** — three changes:

(a) In the BRIEF block intro, change the worklog path sentence to:
"...lands in this exact format at the top of the campaign's worklog
(`tmp/worklogs/C<n>-<name>.md` — see Register for the number)."

(b) Replace the `## Register` section body with:

```markdown
1. Assign the lane number: max `C<n>` on `docs/BOARD.md` + 1 (numbers are
   never reused and survive archival). The campaign is `C<n> · <name>`
   everywhere from here on; its worklog is `tmp/worklogs/C<n>-<name>.md`.
2. Add the row to `docs/BOARD.md` (status: ready) and commit the edit.
3. Seed the route: if the board has no `## ROUTE` section, ask the
   operator for bucket labels once (e.g. `NOW · SEP W1 · SEP W2-3`), then
   add one item line per known step from the BRIEF:
   `C<n> | <bucket> | <item> |` — with `-> <outcome>` where a step feeds
   the next, and `milestone: <label>` on the done-condition item. Owner
   actions the BRIEF implies (merge clicks, sign-offs) go to the YOU lane:
   `YOU | <bucket> | <item> |`.
4. Classify the `domains:` line against the contract now — if any part is
   `decide: human`, tell the operator where they will be needed. Then hand
   to `/orch:go` (phase: route).
```

- [ ] **Step 2: Edit `skills/go/SKILL.md`** — four changes:

(a) Route phase step 5, ROUTE grammar becomes exactly:
`ROUTE: lane:C<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>`

(b) "On every invocation" step 2 report line becomes:
"Report ≤5 lines: lane (`C<n>`), phase, blockers (⚠ + age if a lane sat
in one status past `board.staleDays`, default 3), unratified ADRs with
ages, parked items."

(c) In "The contract" section, extend the park bullet: after "park +
write a proposed ADR with a ready-to-paste amendment" add: "and append
the parked action to the board's YOU lane
(`YOU | NOW | <item> |`) so owner work is visible as a track, not
scattered in prose."

(d) In "Phase: ship" step 3, after the board-row sentence add: "Mark the
lane's completed ROUTE items `✓` and update the `TODAY'S QUEUE`
expectations in the same board commit; a `milestone:` item flipping ✓ is
what closes the lane."

(e) In the "On every invocation" step 1 read list, add: "legacy boards:
if rows lack `C<n>` numbers, assign them now (max + 1, row order) and say
so — the one write `/orch:board` also shares."

- [ ] **Step 3: Edit `skills/go/delegate.md`** — in the resident-pane row
of the Delegation surface table, change "a ROLE with a name and a
lifetime tied to the campaign" to "a ROLE with a name and a lifetime tied
to the lane (`impl-C3`, `codex-C3`)"; in "Killing and restarting" rule 4,
change "A resident worker exists for one campaign." to "A resident worker
exists for one lane (`C<n>`)."

- [ ] **Step 4: Verify consistency**

Run: `node -e "const fs=require('fs');const go=fs.readFileSync('skills/go/SKILL.md','utf8');const goal=fs.readFileSync('skills/goal/SKILL.md','utf8');if(!go.includes('lane:C<n>'))throw 'go grammar';if(!goal.includes('tmp/worklogs/C<n>-<name>.md'))throw 'goal path';if(!go.includes('YOU | NOW |'))throw 'go YOU lane';console.log('ok')"`
Expected: ok.

- [ ] **Step 5: Commit**

```bash
git add skills/goal/ skills/go/
git commit -m "feat: lane identity C<n> through goal/go/delegate"
```

---

### Task 4: README, version, regression, ship

**Files:**
- Modify: `README.md`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: README edits** — (a) "## ⌨️ Three commands" heading → "## ⌨️ Four commands — three act, one looks"; add table row: `| 📊 \`/orch:board\` | whenever you want to look | read-only route map: buckets × lanes, the YOU owner lane, stale flags, metric positions, ADR ages, today's queue — plus \`html\` for a shareable page |`; (b) update the "There is no bare /orch" sentence to "always one of these four"; (c) in Configure JSON example add `"board": { "staleDays": 3 },`.

- [ ] **Step 2: Bump** `.claude-plugin/plugin.json` → `"version": "0.6.0"`.

- [ ] **Step 3: Full regression**

Run: `for t in audit lock destructive read-before-write fleet-context board-html; do node tests/test-$t.js >/dev/null 2>&1 && echo "$t OK" || echo "$t FAIL"; done && node tests/test-ship-gate.js | tail -1 && node tests/test-ship-gate.js | tail -1`
Expected: six OK + `85/85 pass` twice.

- [ ] **Step 4: Manual smoke** — copy the i-start-ots board excerpt (any lane table + a hand-written `## ROUTE` with 2 lanes + YOU) into a temp dir, run the script per the skill's html invocation, open the HTML once, confirm tracks/footer render.

- [ ] **Step 5: Commit and push**

```bash
git add README.md .claude-plugin/plugin.json
git commit -m "orch v0.6.0 — numbered lanes + route board"
git push
```

---

## Self-Review (planning time)

- Spec coverage: §1 → Task 3 (grammar a/b, worklog path, legacy numbering in go e + board skill) · §2 → Task 2 (render ritual, annotations, html flag, no-route fallback, read-only + one exception) · §3 → Task 3 step 1b (seeding) + 2d (✓ marking, queue) + 2c (YOU parks) · §4 table → Tasks 1-4 map 1:1; hooks untouched · §5 → Task 1 test (fixture, malformed-notice, rerun via second run) + Task 4 regression.
- Placeholders: none — script, test, and skill text are written out; Task 3 edits quote exact replacement text.
- Type consistency: ROUTE grammar identical in Global Constraints, Task 2 skill, Task 3 (a); `C<n>-<name>.md` identical in goal/board/script regex `^(C\d+)-.*\.md$`; script CLI flags match the skill's invocation verbatim.
