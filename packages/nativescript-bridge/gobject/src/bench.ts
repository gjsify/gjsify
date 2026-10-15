// WHAT A REAL GObject COSTS PER INSTANCE — the measurement ADR 0105 stage 2 owes, and the first
// of the two gates ADR 0110 puts in front of making the real engine the Android default.
//
// Stage 3's report closes with "No performance number of any kind": the twin engine passes every
// vector on the host and on a device, and nobody knows what an instance of it costs. This file is
// that number. It is engine-AGNOSTIC on purpose — `createGObject(door, engine)` takes the engine
// as an argument, so one process can time `PURE_JS_ENGINE` and `createRealGioEngine(requireGi)`
// against the SAME benchmark body, on the same JIT, in the same run. A second copy of the body per
// engine is how a comparison quietly starts comparing two different things.
//
// WHY IT SHIPS rather than living in a spec file. Two legs drive it, exactly as with
// `vector-subject.ts`: `src/bench.node-gi.mts` on the host under Node, and the device suite's
// `app/specs/bench.ts` inside the NativeScript probe APK. Spec files are not published and the
// device app is a separate package that installs this one.
//
// IT IS NOT A CI GATE. Nothing fails here, and no threshold is encoded: a number measured on a
// shared CI runner, or on an emulator, is a number about that machine. The gate ADR 0110 describes
// is a human reading a report. So this is a tool that prints, run by hand on a known machine.
//
// WHAT IS MEASURED, and why these four:
//   • `construct` — `new Klass()` on a class with properties and signals, nothing passed. Under the
//     real engine this does NOT reach the engine at all: the subset's properties are plain
//     READWRITE (as every vector declares them), so `constructRegistered` writes none of them, and
//     `twinOf` builds the GObject on FIRST USE. The row therefore measures the subset's own
//     construction on both engines and is expected to be near-identical — which is itself the
//     finding, and the reason the next row exists.
//   • `construct+first-read` — the same construction followed by one property read. That read is
//     what materialises the twin, so this row is the honest per-instance cost of an instance an app
//     actually uses. The difference between the two rows IS the twin.
//   • `set+notify` — a property write with a `notify::<property>` handler connected, alternating
//     between two values so no write is the equal-write the engine short-circuits. One row covers
//     the write, GObject's own notification and the handler call, because on the real engine they
//     are one operation: `g_object_set_property` notifies from inside the store.
//   • `emit` — `emit('changed', …)` with one connected handler: a signal emission across the
//     napi boundary and back into a JS handler.
//
// HOW IT IS MEASURED. Each row runs `iterations` operations, `repeats` times, after `warmups`
// discarded repeats, and reports the MEDIAN of the per-repeat nanoseconds-per-operation plus the
// min and max as the spread. Median rather than mean because one GC pause in one repeat moves a
// mean and not a median; min/max rather than a standard deviation because the interesting question
// about a napi call is how bad the bad repeat was. The warm-up is discarded and not merely ignored:
// V8 needs the first repeats to tier up the benchmark body itself, and on the real engine the first
// `register()` also pays for the GType.
//
// WHY THE INSTANCES ARE KEPT. `construct` pushes every instance into an array that outlives the
// timed loop. Dropping them would let the engine's `WeakMap`s and the twin's refcount collect
// mid-measurement, and the row would partly time the collector. The array is the reason
// `iterations` is a few tens of thousands and not millions.

import { createGObject, PURE_JS_ENGINE } from '@gjsify/adwaita-core';
import type {
    BlueprintTemplate,
    BuiltTemplate,
    GObjectConstructor,
    GObjectDoor,
    GObjectEngine,
    GObjectInstance,
} from '@gjsify/adwaita-core';

export interface BenchOptions {
    /** Operations per repeat. Default 20 000 — large enough to swamp the clock, small enough to hold. */
    iterations?: number;
    /** Timed repeats, the population the median and the spread come from. Default 7. */
    repeats?: number;
    /** Repeats run and DISCARDED first, so the numbers are of a warm JIT. Default 2. */
    warmups?: number;
}

export interface BenchCase {
    /** `construct`, `construct+first-read`, `set+notify` or `emit`. */
    readonly name: string;
    readonly iterations: number;
    readonly repeats: number;
    /** Median over the repeats, nanoseconds per operation — the number to quote. */
    readonly medianNs: number;
    /** Fastest and slowest repeat, same unit; the spread. */
    readonly minNs: number;
    readonly maxNs: number;
    /** The median repeat's wall time, for a sense of what the row actually ran. */
    readonly medianMs: number;
}

export interface BenchResult {
    /** The engine's own `name` — `pure-js` or `real-gio`. */
    readonly engine: string;
    /** Which clock answered, so a run with a 1 ms clock is not mistaken for a precise one. */
    readonly timer: string;
    readonly cases: readonly BenchCase[];
}

/** The best clock the host has. NativeScript's V8 has no guaranteed `performance`, so this asks. */
function selectTimer(): { readonly name: string; readonly nowNs: () => number } {
    const perf = (globalThis as { performance?: { now?: () => number } }).performance;
    if (typeof perf?.now === 'function') {
        const now = perf.now.bind(perf);
        return { name: 'performance.now', nowNs: () => now() * 1e6 };
    }
    return { name: 'Date.now', nowNs: () => Date.now() * 1e6 };
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * A door that refuses everything. The benchmark registers no template and reaches no widget, and a
 * door that answered would make the rows depend on a port that is not under measurement.
 */
const BENCH_DOOR: GObjectDoor = {
    name: 'bench door',
    dispatch(_target, event) {
        throw new Error(`bench door: nothing to dispatch '${event}' on`);
    },
    listen(_target, event) {
        throw new Error(`bench door: nothing to listen '${event}' on`);
    },
    createFromTree(_tree: BlueprintTemplate): BuiltTemplate {
        throw new Error('bench door: the benchmark registers no template');
    },
    attach() {},
    register() {},
};

/**
 * The class every row runs against: three properties of three kinds and two signals, which is the
 * shape the GObject vectors register and roughly what an Adwaita widget declares. It is built fresh
 * per engine — a registered class belongs to the namespace that registered it.
 */
function benchClassFor(engine: GObjectEngine): GObjectConstructor {
    const G = createGObject(BENCH_DOOR, engine);
    const { ParamSpec: P, ParamFlags: F } = G;
    return G.registerClass(
        {
            GTypeName: 'BenchSubject',
            Properties: {
                label: P.string('label', '', '', F.READWRITE, ''),
                active: P.boolean('active', '', '', F.READWRITE, false),
                count: P.int('count', '', '', F.READWRITE, 0, 1000000, 0),
            },
            Signals: {
                changed: { param_types: [G.TYPE_STRING] },
                ticked: { param_types: [] },
            },
        },
        class extends G.Object {},
    );
}

/** One row: `warmups` discarded repeats, then `repeats` timed ones, each of `iterations` ops. */
function measure(
    name: string,
    iterations: number,
    repeats: number,
    warmups: number,
    nowNs: () => number,
    /** Runs `iterations` operations. Receives the repeat index so a row can vary per repeat. */
    body: (iterations: number, repeat: number) => void,
): BenchCase {
    for (let repeat = 0; repeat < warmups; repeat++) body(iterations, -1 - repeat);
    const perOp: number[] = [];
    const elapsed: number[] = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
        const started = nowNs();
        body(iterations, repeat);
        const took = nowNs() - started;
        elapsed.push(took);
        perOp.push(took / iterations);
    }
    return {
        name,
        iterations,
        repeats,
        medianNs: median(perOp),
        minNs: Math.min(...perOp),
        maxNs: Math.max(...perOp),
        medianMs: median(elapsed) / 1e6,
    };
}

/**
 * Times the four rows against `engine` and returns the numbers. Takes the engine rather than
 * reading the core's slot, so one process can measure both — the slot freezes on first read and
 * would pin a process to one engine.
 */
export function runGObjectBench(engine: GObjectEngine, options: BenchOptions = {}): BenchResult {
    const iterations = options.iterations ?? 20000;
    const repeats = options.repeats ?? 7;
    const warmups = options.warmups ?? 2;
    const { name: timer, nowNs } = selectTimer();

    const Klass = benchClassFor(engine) as unknown as new () => GObjectInstance;

    // Held across the whole run, for the reason in the header: a collection inside a timed loop
    // would be charged to the row that triggered it.
    let kept: GObjectInstance[] = [];

    const construct = measure('construct', iterations, repeats, warmups, nowNs, (count) => {
        const batch: GObjectInstance[] = Array.from({ length: count });
        for (let index = 0; index < count; index++) batch[index] = new Klass();
        kept = batch;
    });

    const constructAndRead = measure('construct+first-read', iterations, repeats, warmups, nowNs, (count) => {
        const batch: GObjectInstance[] = Array.from({ length: count });
        for (let index = 0; index < count; index++) {
            const instance = new Klass();
            // The read materialises the real engine's twin; `sink` only keeps it from being
            // optimised away.
            sink((instance as unknown as { label: unknown }).label);
            batch[index] = instance;
        }
        kept = batch;
    });

    // One instance with one handler, reused by the two emission rows: connecting inside the timed
    // loop would measure the connection, which is a per-handler cost and not a per-emission one.
    const subject = new Klass();
    let notified = 0;
    let emitted = 0;
    subject.connect('notify::label', () => {
        notified++;
    });
    subject.connect('changed', () => {
        emitted++;
    });

    const setNotify = measure('set+notify', iterations, repeats, warmups, nowNs, (count) => {
        const writable = subject as unknown as { label: string };
        for (let index = 0; index < count; index++) {
            // Alternating, because an equal write is not a change: both engines short-circuit it
            // and the row would time the short-circuit instead of a write and its notification.
            writable.label = index % 2 === 0 ? 'a' : 'b';
        }
    });

    const emit = measure('emit', iterations, repeats, warmups, nowNs, (count) => {
        for (let index = 0; index < count; index++) subject.emit('changed', 'x');
    });

    // Reading the counters is what keeps the handlers, the writes and the instances live to the end
    // of the function; `kept` is otherwise dead after the last row.
    sink(notified + emitted + kept.length);

    return { engine: engine.name, timer, cases: [construct, constructAndRead, setNotify, emit] };
}

/** Swallows a value so an engine-less optimiser cannot delete the operation that produced it. */
let swallowed: unknown;
function sink(value: unknown): void {
    swallowed = value;
    if (swallowed === Symbol.for('@gjsify/bench/never')) throw new Error('unreachable');
}

/** `runGObjectBench` against the default engine, for the caller that wants the comparison leg. */
export function runPureJsBench(options?: BenchOptions): BenchResult {
    return runGObjectBench(PURE_JS_ENGINE, options);
}

function round(value: number): string {
    return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

/**
 * The result as lines a report can paste: one per row, nanoseconds per operation with the spread.
 * Deliberately plain text — both legs print through a different channel (stdout on the host, the
 * suite's `INFO` markers on the device) and neither wants a table.
 */
export function formatBenchLines(result: BenchResult): string[] {
    return [
        `engine=${result.engine} timer=${result.timer}`,
        ...result.cases.map(
            (each) =>
                `${each.name}: median ${round(each.medianNs)} ns/op ` +
                `(min ${round(each.minNs)}, max ${round(each.maxNs)}; ` +
                `${each.iterations} ops x ${each.repeats} repeats, median repeat ${round(each.medianMs)} ms)`,
        ),
    ];
}

/**
 * The real engine's median divided by the pure-JS one's, per row — the ratio ADR 0110's gate is
 * actually about. Rows the two runs do not share are skipped.
 */
export function benchRatios(pureJs: BenchResult, realGio: BenchResult): { name: string; ratio: number }[] {
    const ratios: { name: string; ratio: number }[] = [];
    for (const real of realGio.cases) {
        const base = pureJs.cases.find((each) => each.name === real.name);
        if (base && base.medianNs > 0) ratios.push({ name: real.name, ratio: real.medianNs / base.medianNs });
    }
    return ratios;
}
