# C2 · done-verifier

BRIEF
goal:    before the ship phase's merge gate, a FRESH independent agent verifies the BRIEF's done: condition from raw evidence — never the implementer's claim.
metric:  0 → 1 verifier steps shipped; grammar test checks the VERIFY line grammar and its position before the merge gate.
done:    test-grammar.js passes with new assertions: go's ship phase requires `VERIFY: C<n> · done:<met|unmet|inconclusive> · <evidence path> · <model-tier> · <date>` written by a verdict-only fresh reviewer BEFORE merge-gate leg ①; proportionality clause present (lanes whose done: is a plain test-suite verdict may cite the runner line instead).
domains: orch plugin skills + tests (no contract on this repo yet — /orch:setup has not run; operator decides).
kill:    if the verifier adds a review round to trivial lanes despite the proportionality clause, or the design can't land as ship-phase edits + grammar test — park for redesign.

research: adapted from pi-maestro-flow's independent verification on goal
completion (goal complete → external verifier, resume on failure) — see
2026-08-30 competitive analysis in session.
