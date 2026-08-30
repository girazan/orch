---
name: board
description: >
  Render the orch route board: a read-only, forward-looking map of every
  campaign lane (buckets × tracks, the YOU owner lane, gates, today's
  queue). Use when the operator wants to see progress, the path to done,
  stale lanes, or pending ADRs — without starting any work. Do NOT use
  to start, route, or ship anything — /orch:go acts; this only looks.
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
