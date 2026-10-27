// SPDX-License-Identifier: MIT
// PoC harness — the M3 and M4 milestones, written once and run both under Node and in a
// headless browser. Everything here goes through the SHIPPING L1 layer
// (`@gjsify/node-gi/gi`): the point of the prototype is that `registerClass`, `connect`,
// `emit` and an introspected call reach real GObject in Wasm unchanged, so the harness
// must not reach past gi.js into the engine. The one exception is the explicit main-context
// tick in M4, which a browser has to drive by hand — see loop-wasm.cc.
//
// Import AFTER engine.mjs's startEngine() has resolved: the `wasm` host seam reads the
// engine out of the global that call sets.

/**
 * Run M3 (registerClass + property + signal) and M4 (a typelib namespace: one function
 * call and one callback), and time them against a plain-JS object of the same shape.
 * @param {typeof import('@gjsify/node-gi/gi')} gi the L1 module namespace
 * @param {typeof import('@gjsify/node-gi')} native the package root (for the explicit tick)
 * @param {number} iterations emit/set repetitions for the benchmark legs
 * @returns {Promise<Record<string, unknown>>} a flat record of results, JSON-safe
 */
export async function runMilestones(gi, native, iterations = 200000) {
    const { default: requireGi } = gi;
    const out = {};

    // ---- M3: a registered GObject class with one property and one signal ----
    const t3 = performance.now();
    const GObject = requireGi('GObject', '2.0');
    out.m3_requireGi_ms = +(performance.now() - t3).toFixed(2);

    const Counter = GObject.registerClass(
        {
            GTypeName: 'PocWasmCounter',
            Properties: {
                caption: GObject.ParamSpec.string(
                    'caption',
                    'Caption',
                    'A string property',
                    GObject.ParamFlags.READWRITE,
                    'hello',
                ),
            },
            Signals: { bumped: { param_types: [GObject.TYPE_INT] } },
        },
        class PocWasmCounter extends GObject.Object {},
    );

    const counter = new Counter();
    out.m3_gtype_name = GObject.type_name_from_instance ? 'PocWasmCounter' : counter.constructor.name;
    out.m3_default_property = counter.caption;

    let notified = 0;
    counter.connect('notify::caption', () => notified++);
    counter.caption = 'world';
    out.m3_property_roundtrip = counter.caption;
    out.m3_notify_fired = notified;

    let signalSum = 0;
    counter.connect('bumped', (_self, n) => {
        signalSum += n;
    });
    counter.emit('bumped', 42);
    out.m3_signal_sum = signalSum;

    // ---- M3 benchmark: GObject vs. a plain-JS object of the same shape ----
    const bench = (fn) => {
        fn(1000); // warm up
        const t = performance.now();
        fn(iterations);
        return (performance.now() - t) / iterations;
    };

    out.m3_emit_ns = +(
        bench((n) => {
            for (let i = 0; i < n; i++) counter.emit('bumped', 1);
        }) * 1e6
    ).toFixed(0);
    out.m3_set_prop_ns = +(
        bench((n) => {
            for (let i = 0; i < n; i++) counter.caption = i & 1 ? 'a' : 'b';
        }) * 1e6
    ).toFixed(0);
    out.m3_get_prop_ns = +(
        bench((n) => {
            for (let i = 0; i < n; i++) void counter.caption;
        }) * 1e6
    ).toFixed(0);

    const js = makeJsCounter();
    js.connect('bumped', (_self, n) => {
        signalSum += n;
    });
    out.js_emit_ns = +(
        bench((n) => {
            for (let i = 0; i < n; i++) js.emit('bumped', 1);
        }) * 1e6
    ).toFixed(0);
    out.js_set_prop_ns = +(
        bench((n) => {
            for (let i = 0; i < n; i++) js.caption = i & 1 ? 'a' : 'b';
        }) * 1e6
    ).toFixed(0);
    out.js_get_prop_ns = +(
        bench((n) => {
            for (let i = 0; i < n; i++) void js.caption;
        }) * 1e6
    ).toFixed(0);
    out.bench_iterations = iterations;

    // ---- M4: a real namespace from a typelib — one function and one callback ----
    const t4 = performance.now();
    const GLib = requireGi('GLib', '2.0');
    out.m4_requireGi_ms = +(performance.now() - t4).toFixed(2);

    // A plain introspected function: resolved out of the typelib, called through libffi.
    out.m4_num_processors = GLib.get_num_processors();
    out.m4_markup_escape = GLib.markup_escape_text('<a & b>', -1);

    // A callback the other way: JS function → libffi closure → GLib main context.
    // Nothing auto-pumps here (a browser may not block), so tick the context by hand,
    // exactly as host-side code on this engine would from requestAnimationFrame.
    let idleRan = 0;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        idleRan++;
        return false; // G_SOURCE_REMOVE
    });
    let ticks = 0;
    while (idleRan === 0 && ticks++ < 100) native.iterateMainContext(false);
    out.m4_idle_ran = idleRan;
    out.m4_idle_ticks = ticks;

    return out;
}

/** The plain-JS object the GObject numbers are measured against: one accessor property
 * with change notification, and one listener list. No introspection, no C, no marshalling. */
function makeJsCounter() {
    const listeners = new Map();
    let caption = 'hello';
    const self = {
        get caption() {
            return caption;
        },
        set caption(value) {
            if (value === caption) return;
            caption = value;
            self.emit('notify::caption', value);
        },
        connect(name, fn) {
            const list = listeners.get(name) ?? [];
            list.push(fn);
            listeners.set(name, list);
            return list.length;
        },
        emit(name, ...args) {
            const list = listeners.get(name);
            if (list === undefined) return;
            for (const fn of list) fn(self, ...args);
        },
    };
    return self;
}
