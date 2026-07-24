// SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
// SPDX-FileCopyrightText: 2013 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// Adapted from GJS (refs/gjs/modules/script/package.js). Copyright (c) 2013
// Giovanni Campagna. MIT OR LGPL-2.0-or-later.
// Modifications: the legacy `imports.package` — the GJS application bootstrap
// (`pkg.init` / `initGettext` / `initFormat`) — ported to @gjsify/node-gi. A GNOME
// app's entry point does `imports.package.init({ name, version, prefix, libdir })`
// then `pkg.initGettext()` / `pkg.initFormat()`. The GJS original's heavy
// source-tree detection + GResource registration + module-search machinery is NOT
// load-bearing for a node-gi consumer (the app carries its own dir constants and
// registers its own resources — see easy6502 app-gnome resources.ts), so this is
// the minimal, honest init: set `globalThis.pkg`, wire `_`/`C_`/`N_` and
// `String.prototype.format`, and keep `imports.searchPath` / `GLib.set_prgname`
// calls safe. Mirrors overrides/mainloop.js's `createX(deps)` shape.

/**
 * Build the `imports.package` object bound to the L1 backend.
 * @param {{ requireGi: Function, gettext: any, imports: Record<string, any> }} deps
 */
export function createPackage({ requireGi, gettext, imports }) {
  const pkg = {
    // Public fields GJS source may read. Populated by init().
    name: undefined,
    version: undefined,
    prefix: undefined,
    libdir: undefined,
    datadir: undefined,
    pkgdatadir: undefined,
    pkglibdir: undefined,
    moduledir: undefined,
    localedir: undefined,

    /**
     * @param {{ name?: string, version?: string, prefix?: string, libdir?: string, datadir?: string }} params
     */
    init(params = {}) {
      // The accessor GJS apps use right after: `pkg.initGettext()`.
      globalThis.pkg = pkg;

      pkg.name = params.name;
      pkg.version = params.version;
      pkg.prefix = params.prefix;
      pkg.libdir = params.libdir;
      pkg.datadir = params.datadir ?? (params.prefix ? `${params.prefix}/share` : undefined);

      // Installed-layout dirs — NOT load-bearing on node-gi (apps carry their own
      // constants + register their own resources), computed for source-compat only.
      if (pkg.name) {
        if (pkg.datadir) {
          pkg.pkgdatadir = `${pkg.datadir}/${pkg.name}`;
          pkg.moduledir = pkg.pkgdatadir;
          pkg.localedir = `${pkg.datadir}/locale`;
        }
        if (pkg.libdir) pkg.pkglibdir = `${pkg.libdir}/${pkg.name}`;
      }

      // Cheap + safe: keeps ARGV[0]/app-id semantics (window-manager grouping etc.).
      try {
        const GLib = requireGi('GLib', '2.0');
        if (pkg.name && typeof GLib.set_prgname === 'function') GLib.set_prgname(pkg.name);
      } catch {
        /* GLib not loadable in this context — skip */
      }

      // GJS unshifts moduledir onto imports.searchPath (script-import machinery).
      // node-gi apps use ESM + gi://, so the search path is inert here — but keep
      // the array present + the unshift safe so source that reads it doesn't throw.
      if (!Array.isArray(imports.searchPath)) imports.searchPath = [];
      if (pkg.moduledir) imports.searchPath.unshift(pkg.moduledir);
    },

    initGettext() {
      if (pkg.name) {
        try {
          gettext.bindtextdomain?.(pkg.name, pkg.localedir ?? null);
          gettext.textdomain?.(pkg.name);
        } catch {
          /* passthrough gettext — no catalog, ignore */
        }
      }
      // The globals GJS apps + compiled Blueprint use pervasively.
      globalThis._ = (msgid) => gettext.gettext(msgid);
      globalThis.C_ = (context, msgid) => gettext.pgettext(context, msgid);
      globalThis.N_ = (msgid) => msgid;
    },

    initFormat() {
      // GJS sets `String.prototype.format = imports.format.format` (backed by the
      // native `_format` vprintf). node-gi has no `imports.format`, so supply an
      // equivalent JS vprintf here (see makeVprintf).
      const vprintf = makeVprintf();
      Object.defineProperty(String.prototype, 'format', {
        configurable: true,
        writable: true,
        enumerable: false,
        value: function format(...args) {
          return vprintf(this, args);
        },
      });
    },

    // Script-import machinery is not ported — node-gi apps use ESM + gi://. These
    // keep the surface present for source that references them (Learn6502 does not).
    require() {
      /* no-op: apps import via ESM / gi:// on node-gi */
    },
    requireSymbol() {
      return true;
    },
    checkSymbol() {
      return true;
    },
    start(params = {}) {
      pkg.init(params);
      if (typeof params.main === 'function') params.main(globalThis.ARGV ? ['', ...globalThis.ARGV] : []);
    },
    run() {
      /* the app drives its own main() on node-gi */
    },
    initSubmodule() {
      /* n/a on node-gi */
    },
  };

  return pkg;
}

// A small vprintf covering the GJS `String.prototype.format` spec
// (refs/gjs/modules/script/format.js): `%s %d %x %f`, `%.Nf` precision, `%Ns`/`%Nd`
// width, `0`-padding for numerics, and `%%` → literal `%`. Positional `%N$s` is
// supported (GJS honours it). Learn6502 only uses `%s`; the rest is fidelity.
function makeVprintf() {
  return function vprintf(fmt, args) {
    let auto = 0;
    return String(fmt).replace(
      /%(?:(\d+)\$)?(0)?(\d+)?(?:\.(\d+))?([%sdxf])/g,
      (match, pos, zero, width, prec, spec) => {
        if (spec === '%') return '%';
        const arg = pos !== undefined ? args[Number(pos) - 1] : args[auto++];
        let str;
        switch (spec) {
          case 's':
            str = String(arg);
            break;
          case 'd':
            str = String(Math.trunc(Number(arg)));
            break;
          case 'x':
            str = Math.trunc(Number(arg)).toString(16);
            break;
          case 'f':
            str = prec !== undefined ? Number(arg).toFixed(Number(prec)) : String(Number(arg));
            break;
          default:
            return match;
        }
        if (width !== undefined) {
          const w = Number(width);
          const pad = zero && spec !== 's' ? '0' : ' ';
          while (str.length < w) str = pad + str;
        }
        return str;
      },
    );
  };
}
