// Test-only: a `describe` that cannot forget its diagnostics gate.
//
// `@gjsify/unit` keeps ONE `beforeEach`/`afterEach` slot per module and nulls
// both when a `describe` returns — that is its documented per-describe teardown,
// and its own spec registers the hooks INSIDE the describe. `host.spec.ts`
// registered them once before the first of seventeen siblings, so sixteen ran
// with no gate at all. Measured: a GTK critical injected into describe #15
// printed to stderr, the case still reported `✔`, and the blame surfaced twelve
// tests later on an innocent neighbour; run alone, that suite exited 0.
//
// CORRECTED 2026-09-04 (#1554): the runner scopes hooks now — one frame per
// `describe`, popped when it returns — so registering outside a block covers every
// sibling and a second registration composes rather than replaces. The incident
// stays because it is why this wrapper exists; what it buys today is one
// declaration of what a gated block means, not a repair of the framework.
//
// A gate that is easy to omit is not a gate. This wrapper registers the hooks
// where the framework actually keeps them, so omission stops being possible.
//
// `.mts` on purpose: the library build globs `src/**/*.{ts,js}`, so nothing
// test-only reaches the published bundle.
//
// The DECLARATION had to be pruned separately, and that was a real leak rather
// than tidiness. `build:types` compiles all of `src`, so `lib/types/testing/gate.d.mts`
// was emitted and `files: ["lib"]` shipped it: a published type declaration for a
// runtime module that is not there, and it was one of SEVENTEEN — every `*.spec.d.ts`,
// every `generator/*.d.mts`, `generated/surface-data.d.mts`. Nothing could import
// them (the exports map gates every subpath), so the cost was a tarball describing
// modules it does not contain and a reader who believes `@gjsify/gtk-host/testing`
// exists. `package.json#files` now negates exactly the two shapes the build glob
// already excludes — `!lib/types/**/*.d.mts` and `!lib/types/**/*.spec.d.ts` —
// which is the whole class rather than this one instance: 68 packed files to 51.

import { afterEach, beforeEach, describe, type Runtime } from '@gjsify/unit';

import type { DiagnosticsGate } from '../conformance/diagnostics.js';

export const gated = (gate: DiagnosticsGate, name: string, body: () => Promise<void>): Promise<void> =>
    describe(name, async () => {
        beforeEach(() => gate.reset());
        afterEach(() => gate.assertQuiet());
        await body();
    }) as Promise<void>;

/**
 * The runtimes that can host GTK — and an IDENTITY list on purpose.
 *
 * These suites need a reachable GTK, not a particular interpreter, so the
 * expressive form would be a capability (`@gjsify/unit` splits `'Display'` from
 * `'Gl'` for exactly that reason). It is not used here, and the reason is the
 * failure mode rather than taste.
 *
 * A capability can only be PROBED — nothing about `(os, env)` answers "is the Gtk
 * typelib reachable from this process", and `@gjsify/unit` is Tier 1 and must not
 * import `gi://` to find out. A probe that answers "no" makes the whole suite STAND
 * DOWN, and `requireAxes` cannot catch that: it only holds axes the host MATCHES.
 * So a container that lost its GTK would run zero tests and report success — the
 * green-that-checked-nothing shape, arriving through the very gate meant to widen
 * coverage. Measured once already: gated on `'Gjs'` alone, this suite built for the
 * node target exited 0 having run 0 tests from 0 gates, 9 stood down.
 *
 * Named identities instead mean the suite RUNS wherever it was built, and a missing
 * GTK dies loudly at `Gtk.init()` in the first line of each suite. Louder beats
 * more expressive when the quiet failure is a pass.
 */
export const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];
