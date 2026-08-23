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
import type { WidgetDescriptor } from './types.js';

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

/** The scalar value types a probe can be read through the JS accessor. */
const SCALAR_VALUE_TYPES: readonly GObject.GType[] = [
    GObject.TYPE_BOOLEAN,
    GObject.TYPE_STRING,
    GObject.TYPE_INT,
    GObject.TYPE_UINT,
    GObject.TYPE_INT64,
    GObject.TYPE_UINT64,
    GObject.TYPE_DOUBLE,
    GObject.TYPE_FLOAT,
];

const isScalarSpec = (spec: GObject.ParamSpec) =>
    GObject.type_is_a(spec.value_type, GObject.TYPE_ENUM) ||
    SCALAR_VALUE_TYPES.some((t) => GObject.type_is_a(spec.value_type, t));

/** `background-color` -> `backgroundColor`, the spelling GJS installs the accessor under. */
const toAccessorName = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const constructedCache = new Map<string, Map<string, unknown>>();

/**
 * What a FRESHLY CONSTRUCTED widget of this GType carries, by kebab name.
 *
 * One probe instance per GType, read once and dropped. There is no API for this
 * question — a widget's `_init` runs arbitrary code, so constructing one is the
 * only way to learn what construction leaves behind — and the value cannot be
 * read off a `GValue` either: `probe.get_property(name)` is the raw
 * two-argument GObject call under GJS ("At least 2 arguments required, but only
 * 1 passed"), so the JS accessor is the channel.
 *
 * A `Gtk.Window` probe is destroyed explicitly. GTK holds a reference to every
 * toplevel, so dropping the JS reference alone would leak one per window GType
 * for the life of the process.
 */
function constructedDefaults(descriptor: WidgetDescriptor): Map<string, unknown> {
    const cached = constructedCache.get(descriptor.gtype);
    if (cached) return cached;

    const values = new Map<string, unknown>();
    // Recorded BEFORE the probe runs, so a GType whose construction throws pays
    // for the attempt once rather than on every removal.
    constructedCache.set(descriptor.gtype, values);

    const klass = descriptor.ctor();
    let probe: GObject.Object;
    try {
        probe = new (klass as unknown as new () => GObject.Object)();
    } catch {
        // A consumer subclass registered through `registerWidget()` can have an
        // `_init` that refuses a bare construction. Falling back to the
        // ParamSpec is exactly the behaviour this function replaces, so the
        // fallback is signalled by an EMPTY map — never by a guessed value —
        // and a removal keeps working instead of throwing out of `setProp`.
        // All 26 shipped descriptors construct; this path is for the registry.
        return values;
    }

    for (const [name, spec] of paramSpecs(klass, descriptor.gtype)) {
        // Construct-only never reaches the removal path — `rebuild` replays
        // `el.props` and gets the constructed value free. Worth saying because
        // `css-name` is construct-only on all 26 descriptors and is 26 of the
        // 104 disagreements below.
        if (!isWritable(spec) || isConstructOnly(spec)) continue;
        if (!isFlag(spec.flags, GObject.ParamFlags.READABLE)) continue;
        // A DEPRECATED property warns on every READ under GJS: the probe read
        // `Adw.ActionRow.icon-name` and the suite's diagnostics gate failed the
        // test — correctly, since a host that exists because GTK fails at exit 0
        // must not add noise to a consumer's render. Skipping costs nothing:
        // `icon-name` is the only deprecated one of the 11 that disagree here,
        // and `''` and `null` both mean no icon.
        if (isFlag(spec.flags, GObject.ParamFlags.DEPRECATED)) continue;
        if (!isScalarSpec(spec)) continue;
        const accessor = toAccessorName(name);
        if (!(accessor in probe)) continue;
        values.set(name, (probe as unknown as Record<string, unknown>)[accessor]);
    }

    if (probe instanceof Gtk.Window) probe.destroy();
    return values;
}

/**
 * The value a property falls back to when a renderer removes it.
 *
 * React hands `undefined` for a prop that disappeared, and GObject cannot store
 * that: `set_property(name, undefined)` throws "Could not guess unspecified
 * GValue type" (measured). What "removed" means is the value the widget would
 * have carried had the prop never been authored — and that is what CONSTRUCTION
 * leaves behind, not what the ParamSpec declares.
 *
 * The two disagree far too often to treat the ParamSpec as an approximation.
 * Measured on gjs 1.88.1 / GTK 4.22.4 / Adw 1.10 across the 26 shipped
 * descriptors: 953 scalar properties are both readable and writable, and
 * **104 of them disagree** — 78 once construct-only `css-name` is set aside.
 * Twelve property names carry it, four of them behavioural:
 *
 *     GtkWindow.visible                 spec=true   constructed=false
 *     AdwActionRow.activatable          spec=true   constructed=false
 *     GtkToggleButton.receives-default  spec=false  constructed=true
 *     GtkListBox.focusable              spec=false  constructed=true  (7 types)
 *
 * So `<AdwActionRow activatable={cond}>` with `cond` going `undefined` made a
 * non-activatable row activatable, and removing `visible` SHOWED a window —
 * silently, at exit 0, in the package that exists to refuse exactly that.
 *
 * `name` is kept as the probe reports it rather than as the ParamSpec's `null`:
 * `gtk_widget_get_name` falls back to the type name when none was set, so the
 * probe's answer is the one CSS `#id` matching already sees.
 */
export function removedValue(descriptor: WidgetDescriptor, spec: GObject.ParamSpec): unknown {
    const constructed = constructedDefaults(descriptor);
    const name = spec.get_name();
    if (constructed.has(name)) return constructed.get(name);
    return (spec as unknown as { get_default_value(): unknown }).get_default_value();
}

/** Look a property up, refusing the two silent failures: unknown and read-only. */
export function requireSpec(specs: Map<string, GObject.ParamSpec>, tag: string, name: string): GObject.ParamSpec {
    const spec = specs.get(name);
    if (!spec) throw err.unknownProp(tag, name);
    if (!isWritable(spec)) throw err.readOnlyProp(tag, name);
    return spec;
}
