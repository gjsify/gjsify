// THE SECOND ORACLE (ADR 0105 stage 0): the GOBJECT_VECTORS against real GObject under NODE,
// through `@gjsify/node-gi`, besides `gobject.gjs.spec.ts`'s GJS leg and `gobject.spec.ts`'s
// pure-JS subset.
//
// WHY A SECOND ORACLE AT ALL. ADR 0105 proposes replacing the hand-written subset on Android with
// real GObject reached through node-gi's NativeScript engine. That only makes the subset's vectors
// moot if node-gi's GObject answers them the way GJS does — and until this file existed, nothing
// measured that. `gobject.gjs.spec.ts` proves the vectors are right; this proves the OTHER real
// GObject binding holds them. A divergence here is a node-gi bug (GJS is the oracle, never the
// other way round), and five of them were found and fixed by writing it.
//
// WHY IT LIVES IN `adwaita-core`. The vectors, the `GObjectSubject` seam and the driver are all
// here, and a subject is ~40 lines of wiring. `packages/web/gamepad` is the precedent for a
// `web`-pillar package growing a node-gi leg as a dedicated spec plus a `test.node-gi.mts` entry
// and a `test:gjs-on-node` script — a third package to hold forty lines would put the subject
// further from the vectors it drives for no gain.
//
// WHY `requireGi` IS INJECTED INSTEAD OF IMPORTED HERE. `@gjsify/node-gi` is not a workspace
// member: it is reachable only where a job links it (the `test:gjs-on-node` legs do), so a static
// import of `@gjsify/node-gi/gi` in a file this package TYPE-CHECKS fails `build:types` with
// TS2307 on every other job — which is how the Fedora build and the docs build first went red. The
// bridge import therefore lives in `src/test.node-gi.mts`, the entry `tsconfig.json` excludes
// alongside the other two test entries, and the suite takes `requireGi` as a parameter. A dynamic
// `gi://` load, the GJS leg's shape, is not an option either: `scripts/audit-runtimes.mjs` skips
// only the `.gjs.spec.*` suffix, so this file IS walked for runtime signals, and a `gi://` load
// sets `dynamic_gi` — which flips `suggestRuntimes`' design-identity branch from the all-`polyfill`
// triplet this package declares to a browser-only one and reports adwaita-core as mis-declared.
// (The walk is textual: the same spelling in a COMMENT trips it, which is its own small finding.)
//
// WHAT IS NOT RUN HERE. The seven `holds: 'subset'` refusal vectors: real GObject ACCEPTS what the
// subset refuses, so `isOracle: true` skips them, exactly as on the GJS leg. 17 of the 24 vectors
// run.

import { describe, expect, it } from '@gjsify/unit';

import { driveGObjectVectors, type GObjectSubject } from './conformance/gobject.js';
import type { GObjectConstructor, GObjectInstance, GObjectNamespace } from './gobject.js';

/**
 * `@gjsify/node-gi/gi`'s default export, as much of it as this suite uses: the namespace loader.
 * Declared here rather than imported for the reason in the header — the bridge's own types are not
 * resolvable in a job that has not linked it.
 */
export type RequireGi = (namespace: string, version?: string) => unknown;

interface GtkModule {
    init_check(): boolean;
    Box: GObjectConstructor;
}

type BindFlags = Record<'DEFAULT' | 'BIDIRECTIONAL' | 'SYNC_CREATE' | 'INVERT_BOOLEAN', number>;
type GObjectModule = GObjectNamespace & { BindingFlags: BindFlags };

const FLAGS = {
    bidirectional: 'BIDIRECTIONAL',
    'sync-create': 'SYNC_CREATE',
    'invert-boolean': 'INVERT_BOOLEAN',
} as const;

/**
 * Vectors known to diverge on node-gi, each with the issue that tracks the cause. Driven as
 * `it.failing`, so the row still RUNS and the suite goes red the day node-gi starts passing it —
 * filtering the vector out or `it.skip`ping it would lose exactly that.
 *
 * Keyed by the `${row}: ${rule}` prefix the driver builds, which is the row name plus a colon.
 */
const KNOWN_DIVERGENT: Readonly<Record<string, string>> = {
    'field-form:':
        '$gtype.name is undefined on node-gi (gjs answers the GType name): the GType is a napi ' +
        'External, which is not extensible, so the name slot needs a representation change — ' +
        'gjsify/gjsify#2151. Registration itself is correct; only the `.name` read differs.',
};

function reasonFor(name: string): string | undefined {
    for (const [prefix, reason] of Object.entries(KNOWN_DIVERGENT)) {
        if (name.startsWith(prefix)) return reason;
    }
    return undefined;
}

export const gobjectNodeGiSuite = (requireGi: RequireGi) => async () => {
    const GObject = requireGi('GObject', '2.0') as unknown as GObjectModule;
    const Gtk = requireGi('Gtk', '4.0') as unknown as GtkModule;
    // Without a display Gtk cannot build a widget, so the template rows are not run; the
    // plain-GObject rows are. Same gate as the GJS leg, and the reason the CI step runs under
    // xvfb — headless, those rows would silently not be measured.
    const hasDisplay = Gtk.init_check();

    const subject: GObjectSubject = {
        name: 'node-gi (real GObject on Node)',
        isOracle: true,
        GObject,
        Widget: hasDisplay ? Gtk.Box : undefined,
        template: (source) => source.xml,
        bind: (source, sourceProperty, target, targetProperty, flags) => {
            const bits = flags.reduce(
                (all, flag) => all | GObject.BindingFlags[FLAGS[flag]],
                GObject.BindingFlags.DEFAULT,
            );
            (
                source as unknown as {
                    bind_property(from: string, to: GObjectInstance, toProperty: string, bits: number): unknown;
                }
            ).bind_property(sourceProperty, target, targetProperty, bits);
        },
    };

    await driveGObjectVectors(subject, {
        describe,
        expect,
        it: (name, fn) => {
            const reason = reasonFor(name);
            return reason === undefined ? it(name, fn) : it.failing(name, fn, reason);
        },
    });
};
