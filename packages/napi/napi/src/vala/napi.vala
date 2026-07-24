/*
 * SPDX-License-Identifier: MIT
 *
 * GjsifyNapi — bootstrap-only GI surface for the @gjsify/napi N-API host.
 *
 * The introspectable surface is deliberately ONE call: `init()` installs the
 * `globalThis.__gjsifyNapiLoadAddon` JSNative via the C++ bridge compiled
 * into this same shared library (src/cc/module.cc). Everything after that —
 * loading addons, exports, errors — happens as plain JS→JSNative calls with
 * no GI marshalling involved (ADR 0011 / plan §3a).
 *
 * Mirrors the `@gjsify/tls-native` packaging template: Vala class + C code in
 * one `.so` + `.gir` + `.typelib`, loaded from GJS via `imports.gi`.
 */

using GLib;

namespace GjsifyNapi {

    /*
     * The extern C++ bridge (extern "C" in src/cc/module.cc, same .so).
     * Returns false when there is no current GjsContext/JSContext — i.e.
     * when called outside a GJS runtime.
     */
    [CCode (cname = "gjsify_napi_install")]
    private extern bool install_bridge ();

    /**
     * Install the N-API host into the running GJS context.
     *
     * Defines the non-enumerable `globalThis.__gjsifyNapiLoadAddon` native.
     * Idempotent — a second call is a no-op returning true. The TS L1
     * (`@gjsify/napi`) captures the native and deletes the global property.
     *
     * @return true when the loader native was (or already is) installed.
     */
    public bool init () {
        return install_bridge ();
    }

    /**
     * Whether the native shim is loaded. The interesting availability
     * question ("did init() manage to reach a JSContext?") is answered by
     * init()'s return value; this exists so the L1 can probe the typelib.
     */
    public bool is_available () {
        return true;
    }
}
