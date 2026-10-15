// The HOST leg of the construction-cost benchmark (ADR 0105 stage 2, ADR 0110 gate 1): both
// engines, one process, on a desktop GI stack behind `@gjsify/node-gi`.
//
// The device leg is `tests/integration/nativescript-gi/app/specs/bench.ts`. The two drive the same
// `runGObjectBench` for the same reason the vectors share one subject: a benchmark assembled twice
// is two benchmarks, and the host/device comparison is most of what the numbers are for.
//
// Why `@gjsify/node-gi` is named only here and not in `bench.ts`: `src/test.node-gi.mts` says it
// at length — the bridge is no workspace member, a static import in a type-checked file fails
// `build:types` on every other job, and a dynamic load would mis-declare the package's runtime
// triplet to `scripts/audit-runtimes.mjs`. `--app node` keeps the specifier external.
//
// BOTH ENGINES IN ONE PROCESS is deliberate and it is possible because `createGObject(door, engine)`
// takes the engine as an argument: only the core's engine SLOT freezes, and nothing here touches
// it. Same V8, same JIT state, same machine — the ratio is then a property of the engines rather
// than of two runs.
import requireGi from '@gjsify/node-gi/gi';

import { createRealGioEngine } from './engine.js';
import { benchRatios, formatBenchLines, runGObjectBench, runPureJsBench } from './bench.js';

const iterations = Number(process.env.GJSIFY_BENCH_ITERATIONS ?? 20000);
const repeats = Number(process.env.GJSIFY_BENCH_REPEATS ?? 7);
const options = { iterations, repeats };

// Pure JS first: it registers no GType and loads nothing, so the real engine's first registration
// is not charged with warming up the benchmark body itself.
const pureJs = runPureJsBench(options);
const realGio = runGObjectBench(createRealGioEngine(requireGi), options);

for (const line of formatBenchLines(pureJs)) console.log(line);
for (const line of formatBenchLines(realGio)) console.log(line);
for (const { name, ratio } of benchRatios(pureJs, realGio)) {
    console.log(`ratio real-gio/pure-js ${name}: ${ratio.toFixed(2)}x`);
}
