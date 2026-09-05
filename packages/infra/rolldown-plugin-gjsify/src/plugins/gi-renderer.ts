// For `--app browser` / `--app nativescript`: resolve `gi://Ns?version=X` to the
// TARGET'S WIDGET RENDERER instead of an empty module — ADR 0034 stage 9, the
// `gi://` arms.
//
// WHAT IT BUYS. `import Adw from 'gi://Adw?version=1'` is the spelling every GJS
// source already uses, and `@girs/adw-1/adw-1.js` is literally that line plus
// `export default Adw`. Without an arm the specifier lands in
// `gjsImportsEmptyPlugin` and becomes `{}`, so `Adw.ActionRow` is `undefined` and
// `class Row extends Adw.ActionRow {}` throws `Class extends value undefined is not
// a constructor or null` — measured on both targets before this plugin existed, and
// the exact failure the sibling header records for `@girs/*`. With the arm the same
// import evaluates to `@gjsify/adwaita-web`'s (or `@gjsify/adwaita-nativescript`'s)
// `Adw` namespace, which ADR 0034 clause 2 makes a namespace OBJECT precisely so it
// can stand in for the GI one.
//
// IT IS OPT-IN (`--gi-renderer`), and NOT because turning it on breaks anything here.
// That was the hypothesis and it is measured wrong: forcing the arm on across the 53
// `--app browser` test entries and the 5 `packages/nativescript-bridge/*` packages in
// this repository changes ZERO outcomes, because no `gi://` reaches those builds at
// all — instrumented, the only specifier that arrives at the empty-import plugin is
// `@girs/gjs` (7 entries), whose body is `globalThis.imports || {}`. That measurement
// bounds the blast radius HERE and says nothing about a consumer tree, where a
// transitively-imported `gi://GLib` would go from a silent stub to a build failure.
//
// What opt-in buys is that the arm makes a tier-2 widget toolkit a BUILD-TIME
// DEPENDENCY of any bundle naming `gi://Adw` (measured on the probe fixture:
// 133 bytes to 500 202 on browser and 214 041 on NativeScript, the latter with a
// `@nativescript/core` import clause the flag-less bundle did not have), and nothing
// in a tree can infer that its `gi://Adw` was meant to be `@gjsify/adwaita-web`
// rather than nothing. `--dialect` is opt-in for the same shape of reason; see
// `PluginOptions.dialect`.
//
// THREE REFUSALS, EACH AT THE EARLIEST POINT ITS FACT IS KNOWN.
//
//   1. A namespace with no renderer — `gi://Gio` — is refused at BUILD time, from
//      `resolveId`. The specifier carries the namespace, so nothing has to run for
//      the answer to be knowable, and the alternative is the empty module this arm
//      exists to replace.
//   2. A `?version=` the renderer's vocabulary was not generated against is refused
//      at BUILD time too. GJS itself throws here (`Requiring Adw, version 9: Typelib
//      file for namespace 'Adw', version '9' not found`, measured on gjs 1.88.1), so
//      accepting it would make these two targets the only place a wrong version
//      passes.
//   3. An ABSENT MEMBER — `Adw.Window` on a renderer that ships no window — is
//      refused at RUNTIME, by a Proxy, because a property access is not knowable
//      from a specifier. These namespaces are SPARSE by construction (a renderer
//      implements a fraction of the GIR's widgets), so this is ADR 0034 § 1 clause 3
//      at member granularity: reading an absent member would hand back `undefined`
//      and re-create the very `Class extends value undefined` this arm removes,
//      thrown far from the import that caused it.
//
// WHY A PROXY AND NOT A COPIED OBJECT. The member set has to be the renderer's own,
// read at runtime from the module it re-exports — a second list here would be the
// copy that drifts, and `Object.keys` of the real namespace is also what makes the
// refusal able to PRINT what is available.
//
// THE EMITTED MODULE IS NOT ALIASED, by construction: `aliasPlugin` skips importers
// whose id carries `GJSIFY_VIRTUAL_PREFIX`, so the renderer import below names the
// package the arm decided on and no slot-routing or user `--alias` re-points it. On
// `--app nativescript` that layer would today be a no-op anyway — the renderer
// declares `nativescript: "native"` and ships no `globals.mjs`, so the derived map
// leaves it alone with a warn-once (visible in every NS build's output) — but the
// exemption is what keeps that true after the slot vocabulary is settled.
//
// Portability note (as in `gjs-imports-empty.ts`): the `filter` is a Rolldown
// fast-path; the guard inside the handler is the load-bearing check, so the plugin
// stays correct under an engine that does not pre-filter.

import type { Plugin } from 'rolldown';

import { GJSIFY_VIRTUAL_PREFIX } from '../utils/virtual-module-id.js';
import { parseGiSpecifier } from './gjs-gi-node.js';

const GI_RENDERER_VIRTUAL_PREFIX = `${GJSIFY_VIRTUAL_PREFIX}gi-renderer:`;

export interface GiRendererOptions {
    /** The `--app` target, named in every refusal so the message says WHERE it applies. */
    app: string;
    /** The package whose `Adw` / `Gtk` namespace exports answer `gi://` on this target. */
    renderer: string;
    /** GI namespace → the version this arm answers for, from `@gjsify/resolve-npm`. */
    namespaces: Readonly<Record<string, string>>;
}

/**
 * The runtime shim for one answered namespace.
 *
 * Exports `default` and nothing else, which is what GJS's own `gi://` module exports:
 * measured on gjs 1.88.1, `import * as Adw from 'gi://Adw?version=1'` yields a namespace
 * whose only key is `default`, and `import { ActionRow } from 'gi://Adw?version=1'` is a
 * SyntaxError (`doesn't provide an export named: 'ActionRow'`). Adding named member
 * exports here would compile on these two targets and fail on `--app gjs` — a second
 * spelling, which is the thing ADR 0034 exists to remove.
 *
 * ITS REFUSAL NAMES THE NAMESPACE AND VERSION SEPARATELY RATHER THAN QUOTING THE
 * SPECIFIER, and that is not a style choice. `tests/e2e/ns-bridge-bundles` and
 * `tests/e2e/app-browser` both assert `!bundle.includes('gi://')` — a SUBSTRING, because
 * on those two targets an unresolved GI import is always a missing alias. A diagnostic
 * carrying the literal `gi://Adw?version=1` would leave that guard unable to tell a
 * message from the defect it watches for. Measured: with the specifier quoted, both green
 * probe bundles carried one `gi://` occurrence and neither of them was an import.
 */
export function giRendererShimSource(options: GiRendererOptions, namespace: string, version: string): string {
    return (
        `import { ${namespace} as namespace } from ${JSON.stringify(options.renderer)};\n` +
        `const RENDERER = ${JSON.stringify(options.renderer)};\n` +
        `const APP = ${JSON.stringify(options.app)};\n` +
        `const NS = ${JSON.stringify(namespace)};\n` +
        `const VERSION = ${JSON.stringify(version)};\n` +
        `export default new Proxy(namespace, {\n` +
        `  get(target, property, receiver) {\n` +
        // Symbols are protocol probes (`Symbol.toStringTag`, `Symbol.iterator`,
        // `Symbol.toPrimitive`) and `then` is the thenable probe every `await` and
        // dynamic `import()` performs; refusing those would break the module rather
        // than report a missing widget.
        `    if (typeof property === 'symbol' || property === 'then' || property in target) {\n` +
        `      return Reflect.get(target, property, receiver);\n` +
        `    }\n` +
        `    throw new Error(\n` +
        `      'the ' + NS + ' arm (version ' + VERSION + ') on --app ' + APP + ': ' + RENDERER +\n` +
        `      ' has no ' + String(property) + '. A renderer implements a fraction of the GIR ' +\n` +
        `      'vocabulary, and every absent member is a declared remainder (ADR 0034 clause 3) ' +\n` +
        `      'rather than an oversight — refused by name here because reading it would be ' +\n` +
        `      'undefined and \`class X extends undefined\` throws far from the import that asked ' +\n` +
        `      'for it. It has: ' + Object.keys(target).sort().join(', ') + '.'\n` +
        `    );\n` +
        `  },\n` +
        `});\n`
    );
}

export function giRendererPlugin(options: GiRendererOptions): Plugin {
    const known = Object.keys(options.namespaces).sort();
    const answered = known.map((name) => `${name} (version ${options.namespaces[name]})`).join(', ');
    return {
        name: 'gjsify-gi-renderer',
        resolveId: {
            order: 'pre' as const,
            filter: { id: /^gi:\/\// },
            handler(source) {
                const parsed = parseGiSpecifier(source);
                if (parsed === null) return null;
                const expected = options.namespaces[parsed.namespace];
                if (expected === undefined) {
                    throw new Error(
                        `gjsify build --app ${options.app}: \`${source}\` has no widget renderer. ` +
                            `--gi-renderer answers ${answered} out of ${options.renderer} and nothing else — ` +
                            'there is no GObject introspection on this target, so a namespace with no renderer ' +
                            'counterpart cannot be substituted for. Drop --gi-renderer to keep the previous ' +
                            'behaviour (every `gi://` import becomes an empty module), or gate the import to ' +
                            'a target that has GI (`--app gjs`, `--app node`).',
                    );
                }
                if (parsed.version !== undefined && parsed.version !== expected) {
                    throw new Error(
                        `gjsify build --app ${options.app}: \`${source}\` asks for ${parsed.namespace} version ` +
                            `${parsed.version}; this arm answers version ${expected} — the version ` +
                            `${options.renderer}'s vocabulary is held against. GJS throws on a version it has no ` +
                            'typelib for, so accepting it here would make this target the only place a wrong ' +
                            'version passes.',
                    );
                }
                return { id: `${GI_RENDERER_VIRTUAL_PREFIX}${parsed.namespace}` };
            },
        },
        load(id) {
            if (!id.startsWith(GI_RENDERER_VIRTUAL_PREFIX)) return null;
            const namespace = id.slice(GI_RENDERER_VIRTUAL_PREFIX.length);
            const version = options.namespaces[namespace];
            if (version === undefined) return null;
            return { code: giRendererShimSource(options, namespace, version), moduleSideEffects: false };
        },
    };
}
