# C1 · knowledge-gate

BRIEF
goal:    orch accumulates cross-campaign knowledge (docs/KNOWLEDGE.md) and the route phase consults it before writing a ROUTE line.
metric:  0 → 1 knowledge conventions shipped; grammar test checks: route phase names the gate, goal + go reference the file, entry format pinned.
done:    test-grammar.js passes with new assertions: go's route phase contains a knowledge-gate step reading docs/KNOWLEDGE.md; ship phase appends lessons to it; entry grammar (`K<n> · <date> · <domain> · <fact> · <source>`) stated in exactly one canonical file.
domains: orch plugin skills + tests (no contract on this repo yet — /orch:setup has not run; operator decides).
kill:    the design needs more than 1 new file + edits to 2 skills, or reaches for semantic search/embedding tooling — descope to the flat file or drop.

research: adapted from pi-maestro-flow's knowledge system (spec/knowhow types,
mandatory pre-work knowledge gate) — see 2026-08-30 competitive analysis in
session; flat-file version deliberately chosen over their semantic-search
design (simplicity criterion).
