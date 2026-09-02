/**
 * The declaration graph the type surfaces are emitted from — the shape only.
 *
 * ONE INTERFACE PER DECLARATION, carrying its OWN members and extending its bases —
 * not one flat interface per widget. The measurement decides it: the concrete widgets
 * have thousands of writable property slots between them and a few hundred distinct
 * property names. Flattening would emit the same `visible?: boolean` once per widget;
 * mirroring the inheritance the vocabulary reports emits it once, on `GtkWidgetProps`,
 * and the diff of a GTK update then shows what actually changed.
 *
 * WHO FILLS IT. `girs-vocabulary.mts`, from `@girs/<ns>/vocabulary`. This module used
 * to hold a `buildSurface()` that filled the same shape from GIR XML this package
 * parsed itself; ADR 0029 moved the vocabulary into `@girs/*` so there is one reader
 * of that format instead of two. Only the shape survived, which is why the file is
 * `model.mts` and no longer `surface.mts`: `surface` now names the `@girs` subpath.
 */

import type { WidgetRow } from './emit.mjs';

export interface PropMember {
    readonly kebab: string;
    readonly camel: string;
    readonly ts: string;
    /**
     * The hover blurb, from the JSDoc above the property in the vocabulary's `.d.ts`.
     *
     * The typelib strips documentation by design — which is why gi-docgen reads the
     * GIR — and hover text is what a published type surface is FOR (ADR 0028 § 6). So
     * the doc travels with the rendered type, out of the half of the vocabulary that
     * can carry it; the runtime half is values, and a value cannot hold a comment.
     */
    readonly doc?: string;
    readonly deprecated: boolean;
    readonly since?: string;
}

export interface SignalMember {
    readonly signal: string;
    readonly prop: string;
    /** Already rendered — `Gtk.ListBox.SignalSignatures['row-activated']`. */
    readonly ts: string;
    readonly doc?: string;
    readonly deprecated: boolean;
    readonly since?: string;
}

export interface Declaration {
    /** Namespace-qualified — `Gtk.Box`. The graph is keyed on this, the way GIR references. */
    readonly key: string;
    readonly gtype: string;
    readonly kind: 'class' | 'interface';
    /** `GtkBoxProps`. */
    readonly iface: string;
    readonly bases: readonly string[];
    readonly props: readonly PropMember[];
    readonly signals: readonly SignalMember[];
    readonly doc?: string;
    /**
     * The library release this TYPE arrived in, where GIR states one.
     *
     * Distinct from a member's `since`: it answers "does the installed library have
     * this class at all", which is the question a bare `ctor()` returning `undefined`
     * used to ask by crashing. Only about 11% of GIR classes carry a `version`, so an
     * absent value means "not stated", never "has always existed".
     */
    readonly since?: string;
}

export interface SurfaceModel {
    /**
     * The widget rows, sorted by GType name.
     *
     * The same three fields the table emitter takes, so the type comes from there
     * rather than being restated — a second spelling of a row is a second thing to
     * keep in step with `girs-vocabulary.mts`, which fills both.
     */
    readonly widgets: readonly WidgetRow[];
    readonly declarations: ReadonlyMap<string, Declaration>;
    /** Widget GType -> the GTypes of every declaration its members come from, self first. */
    readonly closure: ReadonlyMap<string, readonly string[]>;
    /** Enum GType -> nicks, for the emitted aliases and for the runtime nick check. */
    readonly enumNicks: ReadonlyMap<string, readonly string[]>;
    readonly namespacesUsed: ReadonlySet<string>;
    /** Namespace -> the `@girs` package that types it, so the emitter needs no second source. */
    readonly packages: Readonly<Record<string, string>>;
    /**
     * Base -> members it must not contribute, because a nearer declaration disagrees.
     *
     * EMPTY TODAY, AND NOT DEFENSIVE MACHINERY. TypeScript requires a multiply
     * inherited member to be IDENTICAL in every base — `string` and `string | null`
     * are not — and GTK's interfaces do redeclare class properties, so a base that
     * loses a member has to be emitted as `Omit<Base, 'name'>`: a local redeclaration
     * does NOT repair incompatible bases, it turns one error into another. The GIR
     * route computed those conflicts here; the published vocabulary resolves them
     * upstream, so the map now arrives empty. It stays because `emit-types.mts`
     * renders `Omit<>` from it, and a vocabulary that reintroduces a conflict needs a
     * way to say so — the alternative is a surface that does not compile.
     */
    readonly omissions: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}
