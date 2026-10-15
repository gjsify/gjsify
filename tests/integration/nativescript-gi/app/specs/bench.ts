// THE DEVICE LEG of the construction-cost benchmark — ADR 0105 stage 2's missing number, measured
// where it actually matters (ADR 0110 gate 1).
//
// The body is `@gjsify/adwaita-gobject-native`'s `runGObjectBench`, the same function
// `packages/nativescript-bridge/gobject/src/bench.node-gi.mts` drives on the host. That package
// ships it rather than keeping it in a spec file precisely so these two legs cannot drift; what
// differs between them is the machine and `requireGi`, and nothing else.
//
// BOTH ENGINES IN ONE RUN, when the app opted in: the pure-JS engine is always constructible, and
// the real one is read out of the core's SLOT rather than built fresh — so the row measures the
// engine this APK's app is actually backed by, and a second `createRealGioEngine` is not left
// registering a second set of GTypes beside it. `createGObject(door, engine)` takes the engine as
// an argument, which is what makes one process able to time two engines at all.
//
// IT IS OFF BY DEFAULT, behind `__GJSIFY_GI_BENCH__` (see ../../vite.config.ts). Two reasons, both
// about not breaking the measurements that already exist:
//   • `app/app.ts` starts the suite before `Application.run()`, so a few seconds of benchmark would
//     be charged to the app's COLD START — the number stage 4 reports and ADR 0110 gate 2 compares.
//   • the runner gives the whole run 180 s to reach its END marker.
// So the bench run is its own run, and the vector runs stay the vector runs.
//
// NUMBERS ARE INFO, NOT ASSERTIONS. An `it()` here asserts only that the benchmark RAN — four rows
// per engine, all finite. A threshold would be a claim about this emulator, and the gate ADR 0110
// describes is a human reading a report.
import { PURE_JS_ENGINE, registeredEngine } from '@gjsify/adwaita-core';
import { benchRatios, createRealGioEngine, formatBenchLines, runGObjectBench } from '@gjsify/adwaita-gobject-native';
import type { BenchResult } from '@gjsify/adwaita-gobject-native';

import { describe, expect, info, it } from '../reporter.js';
import { optedIn, requireGi } from '../opt-in.js';

// Fewer operations than the host's 20 000: the rows RETAIN their instances (see `bench.ts` on why),
// an emulator's heap is not a workstation's, and the runner's 180 s budget covers the whole app.
// Per-operation numbers are what gets quoted, so a smaller N stays comparable — only the spread
// widens, and the spread is reported.
//
// TWO WARM-UPS, not one. Measured on 2026-10-15 with `warmups: 1`: the pure-JS rows run first, in
// an app whose bundle V8 has only just finished evaluating, and the first timed repeat of
// `construct` came in at 2046 ns/op against a 346 ns/op minimum — enough to pull the pure-JS
// median above the real engine's and print a `0.30x` ratio that reads as the real engine being
// three times FASTER to construct. It is not; the row is engine-independent (the twin is lazy) and
// the ratio was warm-up noise. The second discarded repeat is what makes the row say so.
const DEVICE_OPTIONS = { iterations: 4000, repeats: 7, warmups: 2 };

export default async function benchSpec(): Promise<void> {
    await describe('GObject cost per instance (ADR 0105 stage 2)', async () => {
        const results: BenchResult[] = [];

        // Pure JS first, for the host leg's reason: the real engine's first GType registration must
        // not also pay for warming up the benchmark body.
        results.push(runGObjectBench(PURE_JS_ENGINE, DEVICE_OPTIONS));
        if (optedIn) {
            // The app's own engine. `?? createRealGioEngine` is the honest fallback rather than a
            // silent skip: if the slot were empty here the engine spec has already failed, and a
            // measured real engine is still worth having.
            results.push(runGObjectBench(registeredEngine() ?? createRealGioEngine(requireGi), DEVICE_OPTIONS));
        }

        for (const result of results) {
            for (const line of formatBenchLines(result)) info(line);
        }
        if (results.length === 2) {
            for (const { name, ratio } of benchRatios(results[0]!, results[1]!)) {
                info(`ratio ${results[1]!.engine}/${results[0]!.engine} ${name}: ${ratio.toFixed(2)}x`);
            }
        }

        for (const result of results) {
            await it(`the benchmark ran on '${result.engine}'`, () => {
                expect(result.cases.length).toBe(4);
                const broken = result.cases.filter((each) => !(each.medianNs > 0) || !isFinite(each.medianNs));
                expect(broken.map((each) => each.name).join(',')).toBe('');
            });
        }

        await it(optedIn ? 'both engines were measured in one process' : 'the pure-JS engine was measured', () => {
            expect(results.map((each) => each.engine).join('+')).toBe(optedIn ? 'pure-js+real-gio' : 'pure-js');
        });
    });
}
