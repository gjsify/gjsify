// Property application, keyed on the GParamSpec of the INSTALLED GTK.
//
// The generated widget table says which properties exist; the ParamSpec read at
// runtime says what a value must look like. That split is deliberate: the table
// travels with the package, the coercion travels with the user's GTK.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import Pango from 'gi://Pango?version=1.0';

import { buildAdjustment, isPortableAdjustment } from './adjustment.js';
import { err } from './errors.js';
import { buildStringList, isPortableListModel } from './list-model.js';
import { buildGioMenu, isPortableMenu } from './menu.js';
import type { WidgetDescriptor } from './types.js';

/**
 * Where a GType NAME is looked up, when the name is all a caller has.
 *
 * NOT on the coercion path any more, and that is the repair: `coerce` holds the
 * ParamSpec's own `value_type` and has GTK read the nick off THAT, so it needs no
 * namespace list at all. What still needs somewhere to look is the name-keyed
 * question {@link lookupEnumNick} and {@link enumMembers} ask, because
 * `GObject.type_from_name` answers null for a type nothing in the process has
 * touched yet — measured on a fresh process, `GPasswordSave` is exactly that case.
 *
 * THE PREFIX NO LONGER DECIDES. It says where to look; the candidate is confirmed
 * against the GType it carries itself, so an entry that matched by accident cannot
 * answer. That is what lets `G` — the prefix Gio, GLib and GObject share — appear
 * more than once: `GPasswordSave` is `Gio.PasswordSave`, and while `G` mapped to
 * GObject alone this host offered `GPasswordSaveNick` in its type surface and then
 * refused all three of those nicks at the call.
 *
 * Enumerating the namespaces instead would need no table at all, and is rejected on a
 * measurement: `Object.keys(Gio)` emits a deprecation warning
 * (`DESKTOP_APP_INFO_LOOKUP_EXTENSION_POINT_NAME`) and `Object.keys(GLib)` three
 * "cannot be safely stored in a JS Number" warnings, so the derivation would itself
 * trip the diagnostics gate every spec here runs under. A namespace missing from this
 * list is held RED instead, by `generated.spec.ts`.
 */
const GI_NAMESPACES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['Gtk', Gtk as unknown as Record<string, unknown>],
    ['Adw', Adw as unknown as Record<string, unknown>],
    ['Gdk', Gdk as unknown as Record<string, unknown>],
    // Pango owns the enums of the most-used GtkLabel properties — `ellipsize` is
    // `PangoEllipsizeMode`, `wrap-mode` is `PangoWrapMode` — and GtkLabel is in
    // the shipped table, so leaving it out made a built-in widget unsettable.
    ['Pango', Pango as unknown as Record<string, unknown>],
    ['G', Gio as unknown as Record<string, unknown>],
    ['G', GObject as unknown as Record<string, unknown>],
];

/** `backgroundColor` and `background-color` both name the GObject property `background-color`. */
export function toPropertyName(name: string): string {
    return name.includes('-') ? name : name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * A props object without the keys a framework reserves for itself.
 *
 * The SET is per-framework and stays with the adapter that owns it — Vue's is
 * `@vue/shared`'s `isReservedProp`, React's is `children` — but the LOOP was
 * written twice, byte-for-byte apart from the identifier names. That is the second
 * copy this repo lifts on: the two would drift, and the drifted one fails in a
 * consumer while the host stays green.
 *
 * `undefined` rather than `{}` for an empty result, and that is load-bearing:
 * `createElement(tag, undefined)` skips the property loop entirely, so a vnode
 * whose props are ALL reserved must not look like a vnode with one unknown
 * property.
 */
export function withoutKeys(
    props: Record<string, unknown> | null | undefined,
    skip: ReadonlySet<string>,
): Record<string, unknown> | undefined {
    if (!props) return undefined;
    let kept: Record<string, unknown> | undefined;
    for (const key of Object.keys(props)) {
        if (skip.has(key)) continue;
        (kept ??= {})[key] = props[key];
    }
    return kept;
}

const specCache = new Map<string, Map<string, GObject.ParamSpec>>();

/** All ParamSpecs of a class, by kebab name. Cached per GType — `list_properties()` is not cheap. */
export function paramSpecs(klass: GObject.ObjectClass, gtypeName: string): Map<string, GObject.ParamSpec> {
    let specs = specCache.get(gtypeName);
    if (specs) return specs;
    specs = new Map();
    for (const spec of klass.list_properties()) {
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

/** The GI object a GType NAME belongs to, CONFIRMED by the GType that object carries. */
function giTypeObject(gtypeName: string): Record<string, unknown> | undefined {
    for (const [prefix, ns] of GI_NAMESPACES) {
        if (!gtypeName.startsWith(prefix)) continue;
        const candidate = ns[gtypeName.slice(prefix.length)];
        if (!candidate || typeof candidate !== 'object') continue;
        const gtype = (candidate as { $gtype?: GObject.GType }).$gtype;
        if (!gtype || GObject.type_name(gtype) !== gtypeName) continue;
        return candidate as Record<string, unknown>;
    }
    return undefined;
}

/**
 * The GType a name registers on this host, forcing the registration if it has to.
 *
 * `type_from_name` is asked FIRST because it is the answer that needs no table. It
 * answers null until something has touched the type, which is why the table is still
 * reachable at all: reading `Gio.PasswordSave` is what registers `GPasswordSave`.
 */
function gtypeOfName(gtypeName: string): GObject.GType | undefined {
    const registered = GObject.type_from_name(gtypeName);
    if (registered) return registered;
    return (giTypeObject(gtypeName) as { $gtype?: GObject.GType } | undefined)?.$gtype;
}

/**
 * One lazily built `Gtk.Builder`, the parser almost every nick in this file goes through.
 *
 * Constructing one costs nothing and needs no `Gtk.init()` (measured), and 10 000
 * parses take 12 ms — so the ONE parser is affordable on the property path, which is
 * what keeps a second nick-resolution rule out of everything but the one input the
 * parser provably cannot answer (see {@link startsNumeric}).
 */
let nickParser: Gtk.Builder | undefined;

/** A flags value is a `|`-joined set, exactly as GObject and Blueprint spell one. */
const FLAG_SEPARATOR = '|';

/**
 * `g_ascii_strtoull(text, …, 0)` would consume the WHOLE string.
 *
 * The one input whose NUMERIC reading is what the author wrote: `inputHints="5"` and
 * `licenseType="18"`. Base 0, so `0x12` is 18 — the parser's own base, and a vector
 * pins it, because a narrower `/^\d+$/` here would turn a hex literal GTK accepts into
 * a refusal.
 */
const isWholeNumber = (text: string): boolean => /^[+-]?(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(text.trim());

/**
 * `g_ascii_strtoull` would consume a PREFIX of this member and GTK would drop the rest.
 *
 * THE SILENT-WRONG NUMBER, and the reason the parser is not asked at all below.
 * `_gtk_builder_enum_value_from_string` and its flags twin both try the number first and
 * accept it on `endptr != string` — one consumed character is enough, and what follows
 * is discarded without a diagnostic. Measured on GTK 4.22.5:
 *
 *   - `GtkLicense` `"0bsd"` -> `[true, 0]`, and the member is 18. `0` is `unknown`, so
 *     an `<AdwAboutDialog licenseType="0bsd">` shows the wrong licence at exit 0.
 *   - `GskTransformCategory` `"3d"` -> 3 (the member is 2), `"2d"` -> 2 (it is 3),
 *     `"2d-affine"` -> 2 (it is 4), `"2d-translate"` -> 2 (it is 5) — four wrong
 *     answers that are each ANOTHER VALID MEMBER, so nothing downstream can notice.
 *   - `GtkInputHints` `"0nope"` -> `[true, 0]` and `"0|spellcheck"` -> `[true, 0]`,
 *     i.e. every flag cleared with the rest of the set thrown away.
 *
 * This is the same class as {@link hasBlankMember}: GTK's parser answers, and the
 * answer is wrong. Reach across the installed libraries: 1 of 1366 enum members and 0
 * of 406 bitfield members over the six namespaces {@link GI_NAMESPACES} reaches, and in
 * the shipped surface exactly one nick — `GtkLicense.0bsd`. No nick anywhere is made of
 * digits ALONE, so `isWholeNumber` and this predicate never both want the same string;
 * if one ever arrives, the NICK wins, which is what `parseNickText` orders below.
 */
const startsNumeric = (member: string): boolean => /^[+-]?[0-9]/.test(member.trim());

/**
 * The number an enum or bitfield member nick names, read off the INSTALLED type itself.
 *
 * The second resolution route, and it stays confined to `startsNumeric` members on
 * purpose — the parser is authoritative for everything else and is MEASURED to be:
 * swept over the six namespaces, `value_from_string_type(nick)` agrees with the
 * member's own number on 1365 of 1366 enum members and 406 of 406 bitfield members, the
 * single exception being the `0bsd` the parser truncates. Replacing the parser wholesale
 * with this transform would trade a resolver that matches GTK's `.ui` dialect exactly
 * for one that only derives it, and a GObject type that registers an explicit nick
 * differing from its member name would then resolve here and nowhere else.
 *
 * NOT the generated nick table. `generated.spec.ts` validates that table by resolving
 * every nick in it through {@link lookupEnumNick}; consulting it here would make the
 * check validate itself. The installed type's members are a fact about the running
 * library, which is what that check needs on the other side of the comparison.
 *
 * A namespace missing from {@link GI_NAMESPACES} answers `undefined`, and that is the
 * safe direction: `Gsk` is absent and carries the four `GskTransformCategory` nicks
 * above, so a property of that type entering the surface is REFUSED by name rather than
 * silently given another member's value.
 */
function memberNickValue(valueType: GObject.GType, nick: string): number | undefined {
    const members = giTypeObject(GObject.type_name(valueType));
    const value = members?.[nick.trim().toUpperCase().replace(/-/g, '_')];
    return typeof value === 'number' ? value : undefined;
}

/**
 * The number GTK's own `.ui` parser reads out of `text` for an enum or flags GType.
 *
 * WHY GTK AND NOT GOBJECT. `GObject.enum_get_value_by_nick` and
 * `flags_get_value_by_nick` are both present on the GJS namespace and both unusable
 * from it: the only way to reach a class is `GObject.type_class_ref`, which hands back
 * a `GObject.TypeClass` that GJS refuses to convert to `GObject.EnumClass`
 * ("Object is of type GObject.TypeClass - cannot convert"). Re-measured on gjs 1.88.1,
 * still true. What IS reachable is `gtk_builder_value_from_string_type`, the parser a
 * `.ui` file's every enum and flags attribute goes through — so the spellings this host
 * accepts are now GTK's own, including the `|`-joined SET that GObject will not resolve.
 *
 * WHERE THE CUT IS. The parser's numeric reading is only ever what the AUTHOR wrote
 * when the whole string is a number, so that is the only shape allowed to reach it with
 * a digit in front: a member that merely STARTS numeric would come back truncated and
 * silent ({@link startsNumeric}). Such a member is a nick, and it is resolved off the
 * installed type's members instead. The gate is in front of the parser rather than
 * behind it because the parser's answer is indistinguishable from a real one — `0` is
 * `GTK_LICENSE_UNKNOWN`, a legal value — so there is nothing to check afterwards.
 *
 * A `startsNumeric` member inside a SET is refused rather than resolved. No bitfield in
 * any installed vocabulary has a digit-leading nick (0 of 874), so the shape only
 * arises from a mistake — `"0|spellcheck"`, which GTK reads as plain `0` — and
 * resolving half a set off one route and half off the other is a second dialect for a
 * case that does not exist. If a digit-leading FLAG nick ever ships, this refuses it
 * loudly and the vector that pins it turns red, which is the order we want.
 *
 * The `catch` is not defensive: the call is `throws="1"` and raises a GError for an
 * unparseable value ("Unknown flag: 'nope'", "Could not parse enum: 'sideways'").
 * Turning that into `undefined` is what lets the caller name the tag and the property,
 * which a GError out of GTK cannot.
 */
function parseNickText(valueType: GObject.GType, text: string): number | undefined {
    if (!isWholeNumber(text)) {
        const members = text.split(FLAG_SEPARATOR);
        if (members.some(startsNumeric)) {
            return members.length === 1 ? memberNickValue(valueType, text) : undefined;
        }
    }
    nickParser ??= new Gtk.Builder();
    try {
        const [ok, value] = nickParser.value_from_string_type(valueType, text);
        return ok && typeof value === 'number' ? value : undefined;
    } catch {
        return undefined;
    }
}

/**
 * A member of a nick SET that names nothing — `""`, `"a|"`, `"|"`, `"a||b"`.
 *
 * Refused here rather than handed on, because this is the one input GTK's parser
 * answers SILENTLY: measured, `""` and `" "` both parse to `[true, 0]`, and a leading
 * empty member is dropped without a word. Zero is a legal flags value, so the caller
 * gets a widget with every flag cleared and no diagnostic — the exact silent-wrong
 * value this file exists to refuse.
 */
const hasBlankMember = (text: string): boolean =>
    text.split(FLAG_SEPARATOR).some((member) => member.trim().length === 0);

/**
 * The value a nick names on an enum or bitfield GType, or undefined if it names none.
 *
 * Exported for the generated surface's own check: the type surface offers a union
 * of nicks per enum, and a nick this host cannot resolve would type-check and then
 * be refused at runtime. `generated.spec.ts` resolves every emitted nick through
 * this function, so the GIR-member-to-nick spelling is measured rather than
 * assumed. Also the primitive a renderer needs for a "did you mean" diagnostic.
 *
 * The NAME is kept in the signature although a GType would need no lookup, because
 * every caller has the name and not the type — the check reads it off a generated
 * table, a renderer off `GObject.type_name(spec.value_type)`.
 */
export const lookupEnumNick = (gtypeName: string, nick: string): number | undefined => {
    const gtype = gtypeOfName(gtypeName);
    return gtype === undefined ? undefined : parseNickText(gtype, nick);
};

/**
 * The member names an installed enum or bitfield registers, or `undefined` if this
 * host has none.
 *
 * The INVERSE of {@link lookupEnumNick}, and it exists for the one question that
 * function cannot answer: a nick the vocabulary never emitted is absent from every
 * list a check could iterate, so only the host's own members can reveal it. GJS
 * offers no route to a `GEnumClass`, so the members come off the namespace object —
 * which is the whole remaining reason {@link GI_NAMESPACES} exists.
 *
 * `$gtype` and anything non-numeric are not members; GJS puts both on the same object.
 */
export function enumMembers(gtypeName: string): string[] | undefined {
    const enumObject = giTypeObject(gtypeName);
    if (!enumObject) return undefined;
    return Object.keys(enumObject).filter((key) => key !== '$gtype' && typeof enumObject[key] === 'number');
}

/** What a refusal calls the value it got — the kind with its article, so the sentence reads. */
const kindOf = (value: unknown): string => (Array.isArray(value) ? 'an array' : `a ${typeof value}`);

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

    // A `GMenuModel` property authored as an ARRAY is the portable menu model
    // (ADR 0042), and this is where it becomes a real `Gio.Menu` — the same seam and the
    // same reason as the enum branch below: GObject cannot store what was written, and
    // the ParamSpec is what says so. It is the ONLY spelling a declarative dialect has,
    // since a `GMenuModel` is a GObject with no literal form, and it is why
    // `Adw.SplitButton`, `Gtk.MenuButton` and `Gtk.PopoverMenu` have framework snippets
    // at all. A real `Gio.MenuModel` still passes straight through, so the imperative
    // path every existing application uses is untouched.
    if (GObject.type_is_a(valueType, Gio.MenuModel.$gtype) && isPortableMenu(value)) {
        return buildGioMenu(value);
    }

    // A `Gio.ListModel` property authored as an ARRAY is the portable list model (ADR
    // 0046), and this is where it becomes a real `Gtk.StringList`. TWO ParamSpec facts
    // decide it, and neither is the property's NAME: `model` is also what `Gtk.ListView`
    // calls its `Gtk.SelectionModel`, which IS a `Gio.ListModel` — so the first test
    // alone would build a string list for it, and what GTK does with that is worse than
    // a diagnostic (measured, GTK 4.22.4 / gjs 1.88.1): `set_property` — the route a
    // GObject value takes — turns the mismatch into NULL and logs NOTHING, so the view is
    // empty at exit 0 and the diagnostics gate is quiet; constructed with it, GJS throws a
    // TypeError from inside `materialize`, after `el.props` has recorded the array a
    // rebuild would replay. The second test asks whether the property can HOLD what this
    // branch builds, and where it cannot the refusal names the type GTK wants, at the call
    // that authored it. A real `Gio.ListModel` passes straight through, as the menu does
    // above; a string or an object is refused by name, because the total normaliser
    // would have turned either into an EMPTY list without a word. What a built list does
    // to the one the widget already holds is `setProp`'s question, answered in
    // `list-model.ts`: spliced, never replaced.
    if (GObject.type_is_a(valueType, Gio.ListModel.$gtype) && !(value instanceof GObject.Object)) {
        if (!isPortableListModel(value)) throw err.badListModel(tag, spec.get_name(), kindOf(value));
        if (!GObject.type_is_a(Gtk.StringList.$gtype, valueType)) {
            throw err.listModelMismatch(tag, spec.get_name(), GObject.type_name(valueType));
        }
        return buildStringList(value);
    }

    // A `Gtk.Adjustment` property authored as an OBJECT is the portable adjustment (ADR
    // 0047), and this is where it becomes a real `Gtk.Adjustment` — for all seven
    // interfaces that carry one, keyed on the ParamSpec and not on `adjustment` /
    // `hadjustment` / `vadjustment`. A bare NUMBER is refused by name rather than read as
    // the value: `value` is a property of its own on every one of those widgets, and the
    // one thing GObject would do with the number is guess a GType for it and store
    // nothing, at exit 0.
    if (GObject.type_is_a(valueType, Gtk.Adjustment.$gtype) && !(value instanceof GObject.Object)) {
        if (!isPortableAdjustment(value)) throw err.badAdjustment(tag, spec.get_name(), kindOf(value));
        return buildAdjustment(value);
    }

    if (GObject.type_is_a(valueType, GObject.TYPE_ENUM) && typeof value === 'string') {
        const resolved = parseNickText(valueType, value);
        if (resolved !== undefined) return resolved;
        throw err.badEnum(tag, spec.get_name(), value, GObject.type_name(valueType));
    }

    // FLAGS TAKE THE SAME SILENT-DROP PATH AS ENUMS, and a nick SET
    // ("spellcheck|lowercase") is not something GObject resolves — which is why this
    // branch refused every string by name for as long as that was the whole truth.
    // GTK's own `.ui` parser does resolve one, so the refusal is replaced by the
    // answer and kept for the two inputs that still have none: an unknown member, and
    // a blank one, which GTK reads as zero without a word.
    if (GObject.type_is_a(valueType, GObject.TYPE_FLAGS) && typeof value === 'string') {
        const gtypeName = GObject.type_name(valueType);
        if (hasBlankMember(value)) throw err.blankFlags(tag, spec.get_name(), value, gtypeName);
        const resolved = parseNickText(valueType, value);
        if (resolved !== undefined) return resolved;
        throw err.badFlags(tag, spec.get_name(), value, gtypeName);
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
        // Seeded with the construct-only properties this GType ABORTS without.
        // A bare `new Adw.LayoutSlot()` does not throw — it reaches `g_error()`
        // and takes the process with it, so the `catch` below would never run and
        // a removal on an otherwise legal `<adw-layout-slot id="…">` would be
        // fatal. The values are placeholders: the probe is read for what every
        // OTHER property settled to, then dropped.
        const seed: Record<string, unknown> = {};
        for (const name of descriptor.requiresProps ?? []) seed[name] = '';
        probe = new (klass as unknown as new (props?: Record<string, unknown>) => GObject.Object)(seed);
    } catch {
        // A consumer subclass registered through `registerWidget()` can have an
        // `_init` that refuses a bare construction. Falling back to the
        // ParamSpec is exactly the behaviour this function replaces, so the
        // fallback is signalled by an EMPTY map — never by a guessed value —
        // and a removal keeps working instead of throwing out of `setProp`.
        // Every table row but one constructs (measured, one process per row); this path
        // is for the registry.
        return values;
    }

    for (const [name, spec] of paramSpecs(klass, descriptor.gtype)) {
        // Construct-only never reaches the removal path — `rebuild` replays
        // `el.props` and gets the constructed value free. Worth saying because
        // `css-name` is construct-only on every curated descriptor and disagrees on
        // every one of them — 27 of the 107 disagreements below, one per row.
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
 * Measured on gjs 1.88.1 / GTK 4.22.4 / libadwaita 1.9.3, one probe per row, over
 * the curated descriptors as this table ships them — 27 of them at the time of the
 * measurement, so the totals move when a row joins: 981 scalar properties are both
 * readable and writable, and **107 of them disagree** — 80 once construct-only
 * `css-name` is set aside. Twelve property names carry it, four of them
 * behavioural, and those four are pinned BY NAME in `props.spec.ts` because a name
 * is what survives a re-count:
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
