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
// A gate that is easy to omit is not a gate. This wrapper registers the hooks
// where the framework actually keeps them, so omission stops being possible.
//
// `.mts` on purpose: the library build globs `src/**/*.{ts,js}`, so nothing
// test-only reaches the published bundle.

import { afterEach, beforeEach, describe } from '@gjsify/unit';

import type { DiagnosticsGate } from '../conformance/diagnostics.js';

export const gated = (gate: DiagnosticsGate, name: string, body: () => Promise<void>): Promise<void> =>
    describe(name, async () => {
        beforeEach(() => gate.reset());
        afterEach(() => gate.assertQuiet());
        await body();
    }) as Promise<void>;
