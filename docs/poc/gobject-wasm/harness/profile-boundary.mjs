// SPDX-License-Identifier: MIT
// PoC: split the cost of one property set / get / emit into its layers by calling the
// native binding directly (below the gi.js Proxy) and comparing with the wrapped call.
//   node --conditions=wasm profile-boundary.mjs        (wasm)
//   node profile-boundary.mjs                          (native node-gi)
export async function profile(gi, native, N = 200000) {
    const { default: requireGi } = gi;
    const GObject = requireGi('GObject', '2.0');
    const C = GObject.registerClass(
        {
            GTypeName: 'PocBoundary',
            Properties: {
                caption: GObject.ParamSpec.string('caption', 'C', 'C', GObject.ParamFlags.READWRITE, 'hello'),
                count: GObject.ParamSpec.int('count', 'N', 'N', GObject.ParamFlags.READWRITE, 0, 1 << 30, 0),
            },
            Signals: { bumped: { param_types: [GObject.TYPE_INT] } },
        },
        class PocBoundary extends GObject.Object {},
    );
    const o = new C();
    o.connect('bumped', () => {});
    const nat = native.ensureNative ? native.ensureNative() : native.default;
    const handle = gi.unwrap(o);
    const t = (fn) => {
        fn(2000);
        const s = performance.now();
        fn(N);
        return Math.round(((performance.now() - s) / N) * 1e6);
    };
    const r = {};
    r.wrapped_set = t((n) => { for (let i = 0; i < n; i++) o.caption = i & 1 ? 'a' : 'b'; });
    r.wrapped_get = t((n) => { for (let i = 0; i < n; i++) void o.caption; });
    r.wrapped_emit = t((n) => { for (let i = 0; i < n; i++) o.emit('bumped', 1); });
    r.wrapped_set_int = t((n) => { for (let i = 0; i < n; i++) o.count = i & 1023; });
    if (handle) {
        r.native_set = t((n) => { for (let i = 0; i < n; i++) nat.setProperty(handle, 'caption', i & 1 ? 'a' : 'b'); });
        r.native_set_int = t((n) => { for (let i = 0; i < n; i++) nat.setProperty(handle, 'count', i & 1023); });
        r.native_get = t((n) => { for (let i = 0; i < n; i++) nat.getProperty(handle, 'caption'); });
        r.native_has = t((n) => { for (let i = 0; i < n; i++) nat.hasProperty(handle, 'caption'); });
        r.native_emit = t((n) => { for (let i = 0; i < n; i++) nat.emitSignal(handle, 'bumped', [1]); });
        r.native_typename = t((n) => { for (let i = 0; i < n; i++) nat.getTypeName(handle); });
    }
    // Built-in property: no engine store, no JS setter callback -> isolates that crossing.
    const Gio = requireGi('Gio', '2.0');
    const act = new Gio.SimpleAction({ name: 'x' });
    const ah = gi.unwrap(act);
    r.builtin_native_set = t((n) => { for (let i = 0; i < n; i++) nat.setProperty(ah, 'enabled', !!(i & 1)); });
    r.builtin_native_get = t((n) => { for (let i = 0; i < n; i++) nat.getProperty(ah, 'enabled'); });
    const o2 = new C();
    const h2 = gi.unwrap(o2);
    r.native_emit_nohandler = t((n) => { for (let i = 0; i < n; i++) nat.emitSignal(h2, 'bumped', [1]); });
    r.handle_found = !!handle;
    return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { homedir } = await import('node:os');
    const { pathToFileURL } = await import('node:url');
    if (process.env.NODE_GI_WASM_DIR !== undefined || process.execArgv.some((a) => a.includes('wasm'))) {
        const { startEngine } = await import('./engine.mjs');
        const dir = process.env.NODE_GI_WASM_DIR ?? `${homedir()}/.cache/gjsify-wasm/out`;
        await startEngine(pathToFileURL(`${dir}/node_gi.mjs`).href);
    }
    const gi = await import('../../../../packages/node-gi/node-gi/gi.js');
    const native = await import('../../../../packages/node-gi/node-gi/index.js');
    console.log(JSON.stringify(await profile(gi, native, Number(process.env.POC_ITERATIONS ?? 100000))));
    process.exit(0);
}
