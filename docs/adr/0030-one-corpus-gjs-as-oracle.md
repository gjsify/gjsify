# 30. One test corpus per claim, parameterised by runtime; GJS is the oracle

- Status: **Accepted**
- Date: 2026-08-25
- Deciders: Pascal Garber
- Related: [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0005 (node-gi scope)](0005-node-gi-scope.md), [ADR 0011 (N-API host in GJS)](0011-napi-host-in-gjs.md), [ADR 0018 (OS axis declaration)](0018-os-axis-declaration.md), [ADR 0008 (release versioning policy)](0008-release-versioning-policy.md)

## Context

Two suites in this repo answer the same kind of question in two vocabularies, and
neither can see the other's runtime.

`@gjsify/gtk-host` carries 4 348 lines of `*.spec.ts` against roughly 6 600 lines
of hand-written implementation, and runs them as `test:gjs` only; its manifest declares `{gjs: polyfill, node: none, browser: none,
nativescript: none}`. `@gjsify/node-gi` carries 89 `test/*.test.mjs` written
against `node:test` and run as `NODE_GI_NATIVE=build node --test`; it declares
`{gjs: none, node: polyfill}`. Both suites are large, careful and green.

**The problem is not missing coverage. It is missing ATTRIBUTABILITY.** A claim
about how GObject is bound — how a `GValue` marshals, what `registerClass`
installs, which parameter a vfunc chain-up sees — tested only under node cannot
distinguish *"node-gi is wrong"* from *"the test's assumption is wrong"*. Both
produce the same red, and both produce the same green. Symmetrically, a renderer
claim tested only under gjs says nothing about the runtime the same source is
meant to run on.

### The mechanism already exists, and it is measured

`packages/node-gi/node-gi/scripts/conformance.mjs` is a golden-diff harness. Small
self-contained `gi://` programs under `conformance/programs/` run **unchanged** on
gjs, node, bun and deno; only stdout is compared; and **gjs's output IS the
golden**. A fifth opt-in leg, `gjs-napi`, runs node-gi's own addon *under GJS*
through the N-API shim, which separates "the binding is wrong" from "the runtime
is different" — a differential oracle rather than a second production path.

Two numbers make this more than an aspiration. There are 27 programs, and
`conformance/ledger.json` is **empty**: on all 27, node, bun and deno produce
byte-identical stdout to gjs. One of them is `log-writer.conf.mjs`, so
`GLib.log_set_writer_func` — the primitive gtk-host's whole diagnostics gate rests
on — is already proven equivalent across the four.

### What actually pins gtk-host to GJS

Measured, and smaller than the declaration suggests. `src/host.ts`, `props.ts`,
`policies.ts`, `registry.ts` and `types.ts` use nothing but `gi://`, which the
build's alias layer routes to `@gjsify/node-gi`. The only GJS-only spellings are
`import system from 'system'`, `declare const print` (both `src/probe.ts`) and
`printerr` (four sites in `src/conformance/diagnostics.ts`, one in `probe.ts`) —
and `gjsify build --app node` on a host showcase already emits
`import "@gjsify/node-gi/globals"` and `import … from "@gjsify/node-gi/system"`,
so all three are seeded. The build succeeds today with no warnings.

So what pins the host is a manifest quadruplet and a test script, not its code.

### Why `@gjsify/unit` alone does not answer this

`@gjsify/unit` already runs on Node **and** GJS, so the obvious move is to write
everything in it and run `test:node` + `test:gjs`. That gives two green runs. It
does not give a COMPARISON.

`expect(x).toBe(y)` writes the expected value INTO the test. If gjs and node-gi
both return the same wrong thing, both legs pass and the suite reports agreement
as correctness. A golden whose content is gjs's own output cannot do that: it
detects the case where both runtimes agree on something NEW, and it detects drift
in gjs itself — the harness asserts gjs against the golden too, so a
gjs↔golden divergence means either GJS changed or the golden is stale, and either
way it must fail loudly.

That is the criterion this ADR turns on, and it cuts cleanly:

|the expected value is a DESIGN DECISION we own|`@gjsify/unit`, run on every runtime the package declares|
|the expected value is WHATEVER GJS DOES|golden-diff against gjs's output|

A placement policy, an error code, an anchor resolution: ours, so `expect()`. How
a `GValue` of a boxed type marshals, what `notify::` delivers, what a construct-only
property does on a subclass: GJS's, so a golden.

## Decision

**1. GJS is the oracle.** Wherever a claim is about GObject/GI semantics, gjs's
observed behaviour is the reference and every other runtime is measured against
it. No claim of that kind gets an expected value chosen by its author.

**2. One corpus per claim, parameterised by runtime — not one suite per runtime.**
A claim is expressed once; the harness decides where it runs. A second suite that
restates a claim in another runtime's vocabulary is a second truth, and the two
drift in exactly the way that leaves both green.

**3. Which harness a claim goes to is decided by the criterion above,** not by
which package it lives in. `@gjsify/unit` for what we design; golden-diff for what
GJS defines.

**4. Three exemptions, and only three.** A claim may stay runtime-specific when:

- it is ABOUT a runtime's own machinery — addon loading, prebuild layout, rpaths,
  typelib backers, the Node event-loop pump, worker threads. GJS has no
  counterpart, so there is nothing to compare and a comparison would be theatre;
- its observable is not reducible to deterministic stdout (timing, GC ordering,
  anything the harness would have to normalise into meaninglessness);
- the environment is unavailable on a leg — no display, no session bus.

**5. An exemption is DATA, never a code path.** The ledger already has the right
shape and it is the shape to keep: a documented exclusion PASSES, and a stale one
FAILS. There is no `if (runtime === 'node')` inside a test, because a branch inside
a test is an exemption nobody reviews and nobody retires.

**6. A package's suite runs on every runtime its `gjsify.runtimes` claims.** The
declaration and the test matrix are one statement, so `node: "polyfill"` with a
gjs-only `test` script is a defect the drift check should reach. This is the same
principle ADR 0018 established for the OS axis: no declaration without a check.

**7. A showcase's `gjsify.example.runtimes` is a promise the smoke leg keeps.**
`scripts/showcase-smoke.mjs` already prints the columns it does not launch rather
than letting them read as passes — that honesty is the right default and the
columns are meant to close, not to stay printed.

## Consequences

- A divergence becomes a bug report with an address: gjs green + node red is a
  binding defect in node-gi; gjs red is a wrong assumption in the claim.
- The empty ledger becomes a baseline to defend rather than a coincidence. It may
  grow only by reviewed entries, and a stale entry already fails.
- **The cost is real: stdout is a weaker assertion language than `expect()`.**
  Some claims need an explicit stdout encoding before they can move, and that
  encoding is work with its own risk — an over-broad golden passes while the
  meaning changes. The mitigation is structural rather than diligence: the golden
  is gjs's own output, so a change in meaning changes the golden and shows up in a
  diff.
- Migrating 89 node-only files is a rewrite if attempted at once. It is
  incremental, ordered by binding risk — where a gjs↔node-gi divergence would be
  most damaging and least visible goes first.
- gtk-host's own suite gains runtimes it has never run on, which will surface
  defects that are node-gi's rather than the host's. That is the point, and those
  go home to node-gi per the root AGENTS.md rule on fixing at the core.

## Alternatives rejected

- **Keep two suites and add a cross-runtime third.** Three truths where there were
  two. The new one would be the only one anybody trusts, and the other two would
  keep passing.
- **Port gtk-host's specs to `node:test`.** Makes the host node-only, which is the
  wrong direction: GJS is the primary target and the oracle.
- **Write everything in `@gjsify/unit` and run both legs.** Treated seriously
  above; it is the right tool for half the claims and structurally unable to catch
  agreed-upon-but-wrong behaviour, which is the half that matters most for a
  binding.
- **Trust the golden without asserting gjs against it.** The harness already
  refuses this, and it is why: without the gjs↔golden leg, a stale golden is
  indistinguishable from a correct one.

## Risks

1. **The oracle can be wrong.** GJS has bugs, and making it the reference codifies
   them. This is accepted deliberately: a GJS bug that node-gi reproduces is
   COMPATIBILITY, and the place to record a disagreement with GJS is
   `status/upstream-patch-candidates.md`, not a divergent golden.
2. **Golden churn on a GJS upgrade.** A new gjs can move output that is not a
   defect. `--update-golden` exists and requires the gjs leg; the discipline is
   that a golden update is reviewed as a behaviour change, never as a chore.
3. **Per-OS reach is not the same as per-runtime reach.** node/bun/deno need a
   node-gi addon for the target, so the matrix is bounded by which platforms have
   one. The OS axis (ADR 0018) already owns that question and must not be answered
   here a second time.

## Implementation

Not scheduled as one change. The order that follows from the risk in § Decision 4:

1. gtk-host's declaration and test path. Its code is already portable, so this
   looks like a manifest edit and a new script — and it is not, because of one
   thing measured while scoping it.

   **Every gtk-host suite is gated on `on('Gjs', …)`, an interpreter IDENTITY, and
   therefore stands down under Node.** Built for the node target and run, the suite
   exits **0** having executed **0 tests from 0 gates, 9 stood down**. That is the
   green-that-checked-nothing shape, produced by the very step meant to add
   coverage — and it would have shipped as a passing CI leg.

   `@gjsify/unit` already has the concept and its own reason for it: `Runtime` is
   documented as "a runtime IDENTITY, or a host CAPABILITY", and `'Display'` and
   `'Gl'` were split apart because "a gate must state the thing it actually
   requires". These suites require a reachable GTK, not a particular interpreter.
   So step 1 is: a `'Gtk'` capability beside those two, the suites gated on it, and
   the node entry declaring `requireAxes: ['Gtk']` — the existing mechanism that
   turns a stood-down run into a failure instead of a pass. The manifest flip and
   the drift-check tolerance ride along, because a declaration without a suite is
   what § Decision 6 refuses.
2. The showcase columns, since the showcases already self-verify on every launch
   through `runHostProbeApp` and a `--app node` build already succeeds.
3. node-gi's oracle-able tests, migrated in themed groups, highest binding risk
   first, each group leaving the ledger empty.
4. The three exemption kinds written into the harness as data, so a file that
   cannot move says why in a reviewable line.
