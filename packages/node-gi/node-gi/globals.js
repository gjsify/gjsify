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
    g.ARGV = (typeof process !== 'undefined' && Array.isArray(process.argv))
      ? process.argv.slice(2)
      : [];
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
  return { gi, system, gettext, cairo, versions: Object.create(null) };
}

// Side effect on import: seed the globals.
installGjsGlobals();

export default installGjsGlobals;
