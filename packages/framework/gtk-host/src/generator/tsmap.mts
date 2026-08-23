/**
 * GIR type -> TypeScript type, and the two places variance decides the answer.
 *
 * Measured over the real Gtk-4.0 + Adw-1 GIR with the seven referenced namespaces
 * loaded: 6768 writable property slots and 1889 signal parameters, and NOT ONE
 * type name that fails to resolve. So there is no "unknown fallback" branch to
 * hide behind — every type either maps or the generator fails and says which.
 *
 * WHERE PROPERTIES AND PARAMETERS MUST DIFFER, twice, both times because a
 * property is an INPUT and a handler parameter is an OUTPUT:
 *
 *  1. An enum PROPERTY takes the nick (`orientation="vertical"`) — the host
 *     resolves it (`coerce()` in props.ts) precisely because GObject would
 *     silently keep the old value. An enum PARAMETER arrives as a NUMBER: GJS
 *     hands the marshalled value. Offering the nick union in a parameter would
 *     invite `if (mode === 'single')`, which is always false — a silent bug worse
 *     than no typing at all.
 *  2. Nullability widens a property harmlessly and BREAKS a parameter. GIR marks
 *     many parameters `nullable="1"`, but a parameter type is contravariant: with
 *     `(row: Gtk.ListBoxRow | null) => void` declared, the ordinary
 *     `onRowActivated={(row: Gtk.ListBoxRow) => …}` stops compiling. So object
 *     PROPERTIES get `| null` (clearing one is legitimate) and parameters do not,
 *     and this comment is the record that the second was a decision rather than an
 *     oversight.
 *
 * FLAGS ARE `number`, in both positions, and that mirrors the runtime exactly: the
 * host REFUSES a nick string for a flags property by name (`err.badFlags`),
 * because resolving a nick set ("horizontal|vertical") is not something GObject
 * exposes. A union of nicks here would type-check something the host rejects.
 */

import type { GirClass, GirEnum, GirNamespace, GirType } from './gir.mjs';

/** The C scalars GIR uses, and the whole set — an unmapped one is an error, not a guess. */
const SCALARS: Readonly<Record<string, string>> = {
    gboolean: 'boolean',
    utf8: 'string',
    filename: 'string',
    gchar: 'string',
    gunichar: 'string',
    gint: 'number',
    guint: 'number',
    gint8: 'number',
    guint8: 'number',
    gint16: 'number',
    guint16: 'number',
    gint32: 'number',
    guint32: 'number',
    gint64: 'number',
    guint64: 'number',
    gshort: 'number',
    gushort: 'number',
    glong: 'number',
    gulong: 'number',
    gsize: 'number',
    gssize: 'number',
    gfloat: 'number',
    gdouble: 'number',
    guchar: 'number',
    none: 'void',
};

/** GIR namespace -> the `@girs` package that types it. Only these seven are referenced. */
export const GIRS_PACKAGES: Readonly<Record<string, string>> = {
    Gtk: '@girs/gtk-4.0',
    Adw: '@girs/adw-1',
    Gdk: '@girs/gdk-4.0',
    Gio: '@girs/gio-2.0',
    GLib: '@girs/glib-2.0',
    GObject: '@girs/gobject-2.0',
    Pango: '@girs/pango-1.0',
};

export interface Universe {
    readonly enums: Map<string, GirEnum>;
    readonly classes: Map<string, GirClass>;
    readonly others: Set<string>;
    /**
     * GIR namespace -> the `@girs` package that types it.
     *
     * Carried here rather than read from the module constant, so a fixture can
     * supply its own five-class namespace. Without it the type mapper is only ever
     * exercised against the real GIR, where the branch that refuses an unknown
     * namespace can never be reached.
     */
    readonly packages: Readonly<Record<string, string>>;
}

export function buildUniverse(
    namespaces: readonly GirNamespace[],
    packages: Readonly<Record<string, string>> = GIRS_PACKAGES,
): Universe {
    const enums = new Map<string, GirEnum>();
    const classes = new Map<string, GirClass>();
    const others = new Set<string>();
    for (const ns of namespaces) {
        for (const e of ns.enums) enums.set(e.qualified, e);
        for (const c of ns.classes) classes.set(`${ns.name}.${c.name}`, c);
        for (const t of ns.otherTypes) others.add(t);
    }
    return { enums, classes, others, packages };
}

/**
 * The GObject nick of a GIR enum member.
 *
 * GIR writes `baseline_fill`; the nick GObject registered is `baseline-fill`, and
 * the nick is what `g_enum_get_value_by_nick` and this host's `coerce()` accept.
 * The transform is one substitution, and it is not taken on trust: the generator
 * emits every nick into test data and a spec resolves each one through the host's
 * own enum lookup, so a nick this function spells wrong fails a test rather than
 * shipping as a type that accepts a value GTK refuses.
 */
export const nickOf = (member: string): string => member.replace(/_/g, '-');

export interface TsType {
    readonly text: string;
    /** GIR namespaces whose `@girs` import the emitted text needs. */
    readonly namespaces: readonly string[];
    /** Enum GTypes whose nick alias the emitted text references. */
    readonly enums: readonly string[];
}

export class TypeMapError extends Error {}

const scalarOf = (name: string): string | undefined => SCALARS[name];

/** A nick union, or `never` for an enum GIR declares with no members. */
export const nickUnion = (e: GirEnum): string =>
    e.members.length === 0 ? 'never' : e.members.map((m) => `'${nickOf(m)}'`).join(' | ');

/** The alias name a nick union is emitted under — the GType name, so it is unique. */
export const nickAliasOf = (e: GirEnum): string => `${e.gtype}Nick`;

/**
 * Map one GIR type.
 *
 * `where` is not decoration: see the header — an enum in a `prop` accepts nicks
 * and in a `param` never does, and an object in a `prop` accepts null.
 */
export function tsTypeOf(type: GirType, u: Universe, where: 'prop' | 'param'): TsType {
    const inner = tsInner(type.name, u, where);
    if (!type.array) return inner;
    // Measured: every array-typed writable property in the table is an array of a
    // C scalar (177 of them, `css-classes` the most-written). A parenthesised
    // element type keeps a union element correct if that ever changes.
    const text = /[|&]/.test(inner.text) ? `(${inner.text})[]` : `${inner.text}[]`;
    return { ...inner, text };
}

function tsInner(name: string, u: Universe, where: 'prop' | 'param'): TsType {
    if (name === '') throw new TypeMapError('GIR gave no type name');
    const scalar = scalarOf(name);
    if (scalar) return { text: scalar, namespaces: [], enums: [] };

    const enumeration = u.enums.get(name);
    if (enumeration) {
        const ns = name.slice(0, name.indexOf('.'));
        if (enumeration.flags) return { text: 'number', namespaces: [], enums: [] };
        const qualified = `${ns}.${name.slice(ns.length + 1)}`;
        if (where === 'param') return { text: qualified, namespaces: [ns], enums: [] };
        return {
            text: `${nickAliasOf(enumeration)} | ${qualified}`,
            namespaces: [ns],
            enums: [enumeration.gtype],
        };
    }

    if (u.classes.has(name) || u.others.has(name)) {
        const ns = name.slice(0, name.indexOf('.'));
        if (!u.packages[ns]) throw new TypeMapError(`no @girs package known for namespace ${ns} (type ${name})`);
        return { text: where === 'prop' ? `${name} | null` : name, namespaces: [ns], enums: [] };
    }

    throw new TypeMapError(`unresolved GIR type ${name} — is its namespace loaded?`);
}

/** `row-activated` -> `onRowActivated`; `notify` handled by the caller. */
export const eventPropOf = (signal: string): string =>
    `on${signal.replace(/(^|[-_])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())}`;

/** `can-focus` -> `canFocus`. The inverse of the host's `toPropertyName`. */
export const camelOf = (kebab: string): string => kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
