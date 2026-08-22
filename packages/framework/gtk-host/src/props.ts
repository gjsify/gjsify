// Property application, keyed on the GParamSpec of the INSTALLED GTK.
//
// The generated widget table says which properties exist; the ParamSpec read at
// runtime says what a value must look like. That split is deliberate: the table
// travels with the package, the coercion travels with the user's GTK.

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Pango from 'gi://Pango';

import { err } from './errors.js';

/** GType name prefix -> the GI namespace object that carries its enums. */
const ENUM_NAMESPACES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['Gtk', Gtk as unknown as Record<string, unknown>],
    ['Adw', Adw as unknown as Record<string, unknown>],
    ['Gdk', Gdk as unknown as Record<string, unknown>],
    // Pango owns the enums of the most-used GtkLabel properties — `ellipsize` is
    // `PangoEllipsizeMode`, `wrap-mode` is `PangoWrapMode` — and GtkLabel is in
    // the shipped table, so leaving it out made a built-in widget unsettable.
    ['Pango', Pango as unknown as Record<string, unknown>],
    ['G', GObject as unknown as Record<string, unknown>],
];

/** `backgroundColor` and `background-color` both name the GObject property `background-color`. */
export function toPropertyName(name: string): string {
    return name.includes('-') ? name : name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const specCache = new Map<string, Map<string, GObject.ParamSpec>>();

/** All ParamSpecs of a class, by kebab name. Cached per GType — `list_properties()` is not cheap. */
export function paramSpecs(klass: GObject.ObjectClass, gtypeName: string): Map<string, GObject.ParamSpec> {
    let specs = specCache.get(gtypeName);
    if (specs) return specs;
    specs = new Map();
    for (const spec of (klass as unknown as { list_properties(): GObject.ParamSpec[] }).list_properties()) {
        specs.set(spec.get_name(), spec);
    }
    specCache.set(gtypeName, specs);
    return specs;
}

const isFlag = (flags: number, flag: number) => (flags & flag) !== 0;

export const isWritable = (spec: GObject.ParamSpec) => isFlag(spec.flags, GObject.ParamFlags.WRITABLE);
export const isConstructOnly = (spec: GObject.ParamSpec) => isFlag(spec.flags, GObject.ParamFlags.CONSTRUCT_ONLY);

/** Construct-only property names of a class, in declaration order. */
export function constructOnlyNames(klass: GObject.ObjectClass, gtypeName: string): string[] {
    const names: string[] = [];
    for (const [name, spec] of paramSpecs(klass, gtypeName)) {
        if (isConstructOnly(spec) && isWritable(spec)) names.push(name);
    }
    return names;
}

interface EnumLookup {
    /** The enum object was found, so a miss is a bad NICK, not an unknown namespace. */
    resolved: boolean;
    value?: number;
}

function resolveEnumValue(gtypeName: string, nick: string): EnumLookup {
    for (const [prefix, ns] of ENUM_NAMESPACES) {
        if (!gtypeName.startsWith(prefix)) continue;
        const enumObject = ns[gtypeName.slice(prefix.length)] as Record<string, number> | undefined;
        if (!enumObject) continue; // prefix matched by accident — keep looking
        const value = enumObject[nick.toUpperCase().replace(/-/g, '_')];
        return typeof value === 'number' ? { resolved: true, value } : { resolved: true };
    }
    // The `G` prefix matches every GLib/Gio type, so deciding on the PREFIX alone
    // reported "bad nick" for types whose enum object was never found at all.
    return { resolved: false };
}

/**
 * Turn an authored value into one GObject will actually store.
 *
 * The enum branch is the whole reason this function exists: GObject accepts a
 * string for an enum property and silently keeps the old value. Measured on
 * gjs 1.88.1 — `set_property('orientation', 'vertical')` emits
 * `GLib-GObject-CRITICAL` and leaves HORIZONTAL, and the JS setter
 * `box.orientation = 'vertical'` does the same without any diagnostic at all.
 */
export function coerce(spec: GObject.ParamSpec, value: unknown, tag: string): unknown {
    if (value === null || value === undefined) return value;
    const valueType = spec.value_type;

    if (GObject.type_is_a(valueType, GObject.TYPE_ENUM) && typeof value === 'string') {
        const gtypeName = GObject.type_name(valueType);
        const lookup = resolveEnumValue(gtypeName, value);
        if (lookup.value !== undefined) return lookup.value;
        throw lookup.resolved ? err.badEnum(tag, spec.get_name(), value, gtypeName) : err.unresolvableEnum(gtypeName);
    }

    // Flags take the same silent-drop path as enums, and resolving a nick set
    // ("horizontal|vertical") is not something GObject exposes to us. Refuse it by
    // name rather than let it vanish.
    if (GObject.type_is_a(valueType, GObject.TYPE_FLAGS) && typeof value === 'string') {
        throw err.badFlags(tag, spec.get_name(), value, GObject.type_name(valueType));
    }

    if (GObject.type_is_a(valueType, GObject.TYPE_BOOLEAN)) {
        // `Boolean('false')` is TRUE. In the one function whose job is to refuse
        // what GObject would silently mis-store, a JS truthiness cast is the same
        // defect wearing a different hat.
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'string') throw err.badBoolean(tag, spec.get_name(), value);
        return Boolean(value);
    }

    if (GObject.type_is_a(valueType, GObject.TYPE_STRING)) {
        // `label={count}` is the ordinary JSX/template spelling and unambiguous.
        // An object is not: passing it through reached `g_object_new`, which threw
        // from inside a rebuild rather than at the call that authored it.
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        throw err.badString(tag, spec.get_name(), typeof value);
    }

    if (
        GObject.type_is_a(valueType, GObject.TYPE_INT) ||
        GObject.type_is_a(valueType, GObject.TYPE_UINT) ||
        GObject.type_is_a(valueType, GObject.TYPE_INT64) ||
        GObject.type_is_a(valueType, GObject.TYPE_UINT64)
    ) {
        return typeof value === 'number' ? Math.trunc(value) : value;
    }

    return value;
}

/**
 * The value a property falls back to when a renderer removes it.
 *
 * React hands `undefined` for a prop that disappeared, and GObject cannot store
 * that: `set_property(name, undefined)` throws "Could not guess unspecified
 * GValue type" (measured). The ParamSpec knows the right answer.
 */
export function defaultValue(spec: GObject.ParamSpec): unknown {
    return (spec as unknown as { get_default_value(): unknown }).get_default_value();
}

/** Look a property up, refusing the two silent failures: unknown and read-only. */
export function requireSpec(specs: Map<string, GObject.ParamSpec>, tag: string, name: string): GObject.ParamSpec {
    const spec = specs.get(name);
    if (!spec) throw err.unknownProp(tag, name);
    if (!isWritable(spec)) throw err.readOnlyProp(tag, name);
    return spec;
}
