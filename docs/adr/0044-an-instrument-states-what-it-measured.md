# ADR 0044 — An instrument states what it measured

- **Status:** Proposed (2026-09-04)
- **Scope:** `@gjsify/unit`'s hook and counter contract (Tier 1 — published summary line,
  `getTestCounters()`, `window.__gjsify_test_results`); `@gjsify/devtools-protocol`'s
  `NodeInfo` (Tier 2); the `continue-on-error` rule for `.github/workflows/**`
- **Supersedes nothing.** Names a class this repository keeps paying for, and fixes its four
  measured instances.

## Context

The most expensive defect in this repository's history is a step that reports success while
having measured nothing. `AGENTS.md` § Priorities names it, `check-e2e-suite-coverage`,
`pr-trigger-parity` and `report-gate-history` each close one shape of it, and the incidents
behind them are all the same sentence: *the output looked like a measurement.*

Four instances arrived in one week (#1552, #1553, #1554, #1557), in four different
instruments, and each was found the same way — by disbelieving a number rather than by a
gate. They share a structure worth naming, because the fixes otherwise look unrelated:

> **An instrument reported a value whose shape hid the one distinction its caller needed.**

- `@gjsify/unit` printed `N completed`. `N` was ASSERTIONS. Every consumer read it as tests,
  including two commit messages now on `main`.
- `@gjsify/unit` kept ONE `beforeEach`/`afterEach` slot per module, so a second registration
  replaced the first — silently. A diagnostics gate ran for 12 of 49 cases and a test named
  *"…with no diagnostic"* was green with two `GLib-GObject-CRITICAL`s inside it.
- `DumpTree` truncated at depth 8 and a truncated node was byte-identical to a leaf, so zero
  children could mean "nothing there" or "I stopped looking".
- A `continue-on-error` step's CONCLUSION is forced to `success`, so the PR page reads green
  whatever the step did. #1541 reported green on every gate with three probes red — two of
  them for a defect nobody had counted.

## Decision

**An instrument states what it measured, in a shape that cannot be read as something else.**
Concretely, four rules, each of which is what its fix implements:

1. **A count says what it counts.** `@gjsify/unit`'s summary is
   `N tests passed · M assertions · K ignored`, and `getTestCounters()` returns `tests`,
   `assertions`, `failed`, `failedOutsideTests`, `ignored`, `xfail` as separate fields. The
   number that survives a refactor and the number that does not are never one number.
2. **A ratio is only printed where it can be true.** Failures that belong to no test — a
   stray assertion, a suite or run that timed out, a declared axis that exercised nothing —
   are counted apart, because they raise a numerator whose denominator they do not touch.
   Before the split: `3 of 2 tests failed`, and with no real tests, `2 of 0`.
3. **A hook has a scope, and a bound leaves a trace.** `beforeEach`/`afterEach` register into
   the enclosing `describe` and unwind in a `finally`; `NodeInfo.truncated` marks a node whose
   children a depth bound left unwalked. Both are the same rule: an omission must be
   observable in the answer, or a negative result has two meanings.
4. **A step whose result the platform discards must be READ.** Every
   `continue-on-error` step carries an `id` and something reads `steps.<id>.outcome`, held by
   `scripts/check-probe-outcomes-read.mjs`. It reports and does not gate: each probe carries a
   written retirement condition, and failing on them would red the branch for defects the
   workflow already documents.

### What it costs and what it lets us delete

§ Governance's simplicity rule asks what a new guard lets you DELETE, and the honest answer
here is: nothing yet. The reporting rule replaces no existing check — it covers 18 steps that
were covered by nothing. What it retires is the PRACTICE the incident describes: reading a
job log for a leg that is passing, which is how the three red probes were found and is not a
practice anybody can be asked to keep. The two `@gjsify/unit` fixes DO delete something —
the hand-composed hook pairs in four spec files exist only because the runner forgot, and
their headers now say so.

### The published contracts this moves

Both are stated here rather than in a comment, because ADR 0003 gives them different weights:

- **`@gjsify/unit` (Tier 1, stability promise).** `getTestCounters().overall` is gone; the
  same number is `assertions`, and `tests` is new. The summary wording changed, and the one
  in-repo parser (`scripts/node-gi-consumer-harness.mjs`) reads BOTH spellings, since a
  consumer resolving a published `@gjsify/unit` still prints the old one.
  `window.__gjsify_test_results.total` is now TESTS, and `assertions` sits beside it — the
  browser floor reads `assertions`, which is the number it always meant.
- **`@gjsify/devtools-protocol` (Tier 2, best effort).** `NodeInfo.truncated?: true` is
  additive. `DumpTree`'s default depth moves 8 → 40, which changes the SIZE of an answer
  callers already receive.

## Consequences

A hook that is scoped is a hook that runs where a reader expects it, which means gates that
were silently off are now on: the whole workspace suite was run as the measurement —
176 packages, 23 632 tests, exit 0 — because "no suite changed behaviour" is a claim that
needs the whole suite, not an argument.

The `continue-on-error` rule adds a per-probe step to five workflows. That is duplication in
YAML, and it stays duplication: a composite action would be one definition and two files to
read, and the step's whole content is one env pair and one script call.

`packages/framework/AGENTS.md` — which owns the devtools D-Bus method table, and would
otherwise carry `truncated` — is 50 bytes below the 32 KiB `project_doc_max_bytes` cap, where
Codex silently truncates the tail. It takes no new sentence, so the `DumpTree` contract lives
here and on `NodeInfo` itself. That file needs a section moved into `docs/`, which is its own
change and not this one's to make.

What none of this reaches is the question one level up — an instrument nobody reads at all.
`report-probe-outcome.mjs` writes a job-summary row and an annotation; whether either is read
is not something a script can hold.
