// SPDX-License-Identifier: MIT
// @gjsify/node-gi/globals — seed GJS's ambient globals on Node.
//
// GJS source relies on a handful of globals that exist implicitly under gjs:
// `print` / `printerr` / `log` / `logError`, the `ARGV` array, and the legacy
// `imports` object (`imports.gi.Gtk`, `imports.gi.versions`, `imports.system`,
// `imports.gettext`, …). On Node these don't exist, so importing this module
// (a side effect) installs Node-backed equivalents that route through the same
// node-gi backend `gi://` uses. The gjsify `--app node` build injects this for
// any bundle that references those globals; it is also importable directly.
//
// Reference: GJS's global definitions (gjs/modules/{print,system,gettext}). The
// legacy `imports.*` namespace mirrors gjs/modules/esm/gi.js's require shape.
import { requireGi } from './gi.js';
// `imports.system` / `imports.gettext` / `imports.cairo` reuse the standalone
// module implementations — ONE source of truth, also reachable directly as
// `@gjsify/node-gi/{system,gettext,cairo}` (and the bare `system` / `gettext` /
// `cairo` specifiers on the `--app node` build).
import system from './system.js';
import gettext from './gettext.js';
import cairo from './cairo.js';
// Legacy `imports.signals` (the pure-JS Signals mixin) + `imports.mainloop` (the
// GLib.MainLoop convenience layer) — the GJS script modules many older sources use.
import * as signalsModule from './overrides/_signals.js';
import { createByteArray } from './overrides/byte-array.js';
import { createMainloop } from './overrides/mainloop.js';
import { createPackage } from './overrides/package.js';

// GJS stringifies each argument with String() and joins with a space (no
// util.inspect object formatting) — match that for fidelity.
function gjsFormat(args) {
    return args.map((a) => String(a)).join(' ');
}

/**
 * Install the GJS ambient globals on `globalThis` (idempotent — each global is
 * only defined if absent, so it never clobbers a host that already provides it).
 */
export function installGjsGlobals() {
    const g = globalThis;

    if (typeof g.print === 'undefined') {
        g.print = (...args) => console.log(gjsFormat(args));
    }
    if (typeof g.printerr === 'undefined') {
        g.printerr = (...args) => console.error(gjsFormat(args));
    }
    if (typeof g.log === 'undefined') {
        // GJS `log` writes to the GLib structured log (stderr/journal).
        g.log = (...args) => console.error(gjsFormat(args));
    }
    if (typeof g.logError === 'undefined') {
        g.logError = (error, prefix) => {
            const head = prefix ? `${prefix}: ` : '';
            const body = error && error.stack ? error.stack : String(error);
            console.error(head + body);
        };
    }
    if (typeof g.ARGV === 'undefined') {
        // GJS ARGV excludes the interpreter + the script path (Node's argv[0]+[1]).
        g.ARGV = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv.slice(2) : [];
    }

    if (typeof g.imports === 'undefined') {
        g.imports = makeImports();
    }

    return g.imports;
}

// Build the legacy `imports` object. `imports.gi.<Ns>` resolves a namespace via
// the node-gi backend, honouring a version pinned in `imports.gi.versions.<Ns>`
// (which GJS code sets before the first access).
function makeImports() {
    const giVersions = Object.create(null);
    const giCache = new Map();
    const gi = new Proxy(
        { versions: giVersions },
        {
            get(target, name) {
                if (name === 'versions') return giVersions;
                if (typeof name !== 'string') return target[name];
                if (giCache.has(name)) return giCache.get(name);
                const ns = requireGi(name, giVersions[name]);
                giCache.set(name, ns);
                return ns;
            },
            has(_target, name) {
                return name === 'versions' || typeof name === 'string';
            },
        },
    );

    // `imports.system` + `imports.gettext` + `imports.cairo` are the standalone
    // module objects (`./system.js` / `./gettext.js` / `./cairo.js`) — the single
    // source of truth for those surfaces, shared with the bare `system` / `gettext` /
    // `cairo` specifiers on Node.
    //
    // `imports.signals` is the pure-JS Signals mixin (`addSignalMethods` + the
    // `_connect`/`_disconnect`/`_emit`/… primitives), the SAME module the DBus proxy
    // surface uses. `imports.mainloop` (a lazy getter — it needs GLib, and a source
    // that never touches the main loop should not pull GLib in) is the thin
    // GLib.MainLoop convenience layer.
    const { addSignalMethods, _connect, _connectAfter, _disconnect, _emit, _signalHandlerIsConnected, _disconnectAll } =
        signalsModule;
    const imports = {
        gi,
        system,
        gettext,
        cairo,
        // `imports.byteArray` — the legacy GJS byte-array module
        // (fromGBytes/toGBytes/fromString/toString/fromArray/ByteArray), the seam
        // `@gjsify/utils`' gbytesToUint8Array/cli() read subprocess output through.
        // GLib is only pulled in lazily (toGBytes), so seeding it here is free.
        byteArray: createByteArray(requireGi),
        signals: {
            addSignalMethods,
            _connect,
            _connectAfter,
            _disconnect,
            _emit,
            _signalHandlerIsConnected,
            _disconnectAll,
        },
        // GJS's `imports.searchPath` — `imports.package.init` unshifts the app's
        // moduledir onto it. Inert on node-gi (ESM + gi://), but present + safe so
        // source that reads/mutates it doesn't throw.
        searchPath: [],
        versions: Object.create(null),
    };
    let mainloop;
    Object.defineProperty(imports, 'mainloop', {
        get() {
            if (mainloop === undefined) mainloop = createMainloop(requireGi('GLib', '2.0'));
            return mainloop;
        },
        enumerable: true,
        configurable: true,
    });
    // `imports.package` — the GJS application bootstrap (pkg.init/initGettext/
    // initFormat). Lazy like `mainloop`: a bundle that never calls it pulls no GLib.
    let pkg;
    Object.defineProperty(imports, 'package', {
        get() {
            if (pkg === undefined) pkg = createPackage({ requireGi, gettext, imports });
            return pkg;
        },
        enumerable: true,
        configurable: true,
    });
    return imports;
}

// Side effect on import: seed the globals.
installGjsGlobals();

export default installGjsGlobals;
