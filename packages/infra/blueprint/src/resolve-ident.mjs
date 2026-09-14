// What a bare identifier in a `.blp` means, answered from the `@girs` vocabulary.
//
// `emit-xml.mjs` has three seams through which introspection reaches it — `EmitOptions.resolveIdent`,
// `EmitOptions.accessibilityElement` and `EmitOptions.gtypeName` — because `orientation: vertical`
// leaves `blueprint-compiler` as `<property name="orientation">1</property>`, `checked: true` leaves
// it as `<state name="checked">1</state>` and `Gio.ListStore` as `<object class="GListStore">`, and
// nothing in the syntax carries any of the three answers. This module is the implementation of all
// three seams, and it is a separate file so the emitter stays a function of its AST and the tables
// it is handed.
//
// WHY `@girs` AND NOT THE INSTALLED TYPELIB
//
// ADR 0053 clause 4 reserved the installed typelib for VALIDATION — "a parser reading into a
// tree does not perform" a ParamSpec lookup. Emission turns out to need a lookup of its own, and
// answering it from the typelib would have cost the property the corpus exists to have: the
// shadow run has no skip path and runs on EVERY runner, including the no-GNOME ones, so a
// resolver that needs a GNOME runtime would have reintroduced the hole `--require-oracle` was
// added to close one stage over. `@girs/<ns>/vocabulary` is a pinned npm dependency, generated
// from the GIR, present wherever `gjsify install` has run. The typelib keeps validation; this
// takes emission. ADR 0053 § Amendment 1 records the split.
//
// TWO LOOKUPS, AND THE SECOND ONE IS WHY THIS IS NEW
//
// Resolving `vertical` to `1` needs to know WHICH enum `GtkBox.orientation` is, and then what
// that enum numbers `vertical` as. Until `@girs` 4.8.0 the vocabulary carried only `ENUM_NICKS`
// — the names, in declaration order — so the second lookup was answered by reading the
// installed typelib into a committed table and the first could not be answered at all:
// `corpus/divergences.mjs` used to say so, and searching the nick lists for an enum with a
// member called `never` finds several. 4.8.0 added `ENUM_VALUES` (ts-for-gir #465) and 4.9.0
// added `PROP_ENUMS` (#467), which is the join. Both lookups are now data.
//
// A MAJOR IS NOT AUTOMATICALLY A MOVE IN THIS DATA. `@girs` 5.0.0 is a TYPE-surface break
// — `connect`/`emit` lost their permissive string overloads (ts-for-gir #464) — and it
// touched none of these tables: `gtk-4.0-vocabulary.js` and `adw-1-vocabulary.js` are
// BYTE-IDENTICAL between the two published tarballs, same sha256, so every name and number
// this module reads is the one 4.9.0 shipped. Worth stating rather than assuming, because
// the version is the only thing an upgrade shows you.
//
// THE MEMBER SPELLING IS BLUEPRINT'S, THE KEY SPELLING IS THE GIR'S
//
// Measured against blueprint-compiler 0.20.4: `halign: baseline-fill` is an ERROR ("not a
// member of Gtk.Align", hint `baseline_fill`) and `halign: baseline_fill` compiles to `4`.
// Blueprint spells a member with UNDERSCORES and the vocabulary keys it with the GIR's kebab
// nick, so exactly one transform stands between them and it is applied here rather than assumed
// anywhere else. `rules/03-property-enum.blp` pins it.
//
// A FLAG SET IS NOT A NUMBER — BUT A LONE FLAG IS
//
// Also measured on 0.20.4: `input-hints: word_completion | lowercase` compiles to
// `<property name="input-hints">word-completion|lowercase</property>` — the nicks survive,
// hyphenated, joined with no spaces — while `input-hints: lowercase` on its own compiles to `8`.
// The oracle reads a `|`-joined set as `Flags` and emits nicks, and a single identifier as a
// `Literal`, which it numbers whatever the type is. So the `|` selects the answer and not the
// kind of type, the two answers differ in kind, and this seam returns TEXT and not a number.
// `rules/27-property-flags.blp` pins both — and it pinned only the set, with this module
// returning the nick for a lone member too, until the file held a second entry.
//
// AN UNKNOWN MEMBER OF A KNOWN ENUM IS AN ERROR
//
// Where the join finds no enum the identifier is not one — `menu-model: mainMenu` is an object
// id and takes this path unresolved and correct — so `null` means "not ours" and the emitter
// writes the source spelling. But where the join DOES name an enum and the member is not in it,
// emitting the spelling would be silently wrong output, which is the failure ADR 0053 clause 3
// exists to prevent. That throws, naming the line, the property, the enum and the member, the
// way the oracle does.
//
// A GTYPE NAME IS NOT NAMESPACE PLUS NAME
//
// `Adw.Bin` is `AdwBin` and `Gtk.Box` is `GtkBox`, and every corpus file imports one of those two
// namespaces — the only reason concatenating ever produced a golden. Measured on 0.20.4,
// `Gio.ListStore` is `<object class="GListStore">`: the GIR's `c:identifier-prefixes` for Gio is
// `G`, and an emitter concatenating writes `GioListStore`, a class GtkBuilder cannot find, with no
// error anywhere. The prefix is a fact about the namespace, this module holds it for exactly the
// namespaces it imports vocabulary for, and a `using` outside that set is refused at the first type
// that spells it — a hard error naming its line, per ADR 0053 clause 3, rather than plausible XML.
// `corpus/refused/namespace-without-vocabulary.blp` holds the case.
//
// AN `accessibility { }` ENTRY NAMES ITS OWN ELEMENT, AND THE NAMES ARE ALSO DATA
//
// That block is not a list of `<property>` elements, which is what the emitter assumed for as
// long as the rule file's only entry happened to be one. Measured on 0.20.4,
// `accessibility { label: "n"; row-index: 3; checked: true; }` emits a `<property>`, a
// `<relation>` and a `<state>`, and a name belonging to none of the three is refused ("is not an
// accessibility property, relation, or state"). Which name is which is the nick list of
// `GtkAccessibleProperty`, `GtkAccessibleRelation` and `GtkAccessibleState`, so it is a lookup
// and never a hand-kept list.
//
// The VALUE each slot takes is not derivable: `checked: true` is `1` and `orientation: vertical`
// is `1` because GTK types the slots in C (`gtk_accessible_property_init_value`), and the GIR
// carries that function and not its table. So this seam answers the element, the values stay the
// source spelling, and `rules/20-accessibility.blp` is ledgered until ts-for-gir emits the table.

import {
    DECLS as ADW_DECLS,
    ENUM_NICKS as ADW_ENUM_NICKS,
    ENUM_VALUES as ADW_ENUM_VALUES,
    ENUM_VALUES_UNREADABLE as ADW_ENUM_UNREADABLE,
    FLAG_VALUES as ADW_FLAG_VALUES,
    FLAG_VALUES_UNREADABLE as ADW_FLAG_UNREADABLE,
    PROP_ENUMS as ADW_PROP_ENUMS,
} from '@girs/adw-1/vocabulary';
import {
    DECLS as GTK_DECLS,
    ENUM_NICKS as GTK_ENUM_NICKS,
    ENUM_VALUES as GTK_ENUM_VALUES,
    ENUM_VALUES_UNREADABLE as GTK_ENUM_UNREADABLE,
    FLAG_VALUES as GTK_FLAG_VALUES,
    FLAG_VALUES_UNREADABLE as GTK_FLAG_UNREADABLE,
    PROP_ENUMS as GTK_PROP_ENUMS,
} from '@girs/gtk-4.0/vocabulary';

// Two namespaces and not more, because those are the two `using` lines the corpus has and the
// two the vocabulary is generated for. A GType NAME is globally unique, so merging cannot
// collide by construction — and Gtk's tables already carry the enums it inherits from its
// dependency closure (`PangoEllipsizeMode` is in there), so a third import would add names
// neither namespace declares.
const DECLS = { ...GTK_DECLS, ...ADW_DECLS };
const PROP_ENUMS = { ...GTK_PROP_ENUMS, ...ADW_PROP_ENUMS };
const ENUM_NICKS = { ...GTK_ENUM_NICKS, ...ADW_ENUM_NICKS };
const ENUM_VALUES = { ...GTK_ENUM_VALUES, ...ADW_ENUM_VALUES };
const FLAG_VALUES = { ...GTK_FLAG_VALUES, ...ADW_FLAG_VALUES };
const UNREADABLE = {
    ...GTK_ENUM_UNREADABLE,
    ...ADW_ENUM_UNREADABLE,
    ...GTK_FLAG_UNREADABLE,
    ...ADW_FLAG_UNREADABLE,
};

/**
 * Which enum or flags type a property is, or `null` when it is neither.
 *
 * `PROP_ENUMS` is keyed by the type that DECLARES the property, the way `OWN_PROPS` is, so
 * `GtkBox.orientation` is not in it — `orientation` comes from the `GtkOrientable` interface.
 * `DECLS` is the flattened ancestry and interface list the vocabulary already ships for exactly
 * this kind of question, so the walk is a lookup and not a graph traversal.
 *
 * A type the vocabulary does not describe falls back to itself: the answer is then right when
 * the property is declared on that type and `null` otherwise, which is the same "not ours" the
 * emitter handles.
 *
 * @param {string} typeName  GType name of the object the property sits on
 * @param {string} propertyName  the property, kebab-spelled as GObject knows it
 * @returns {string | null}  GType name of the enum or flags type
 */
function typeOfProperty(typeName, propertyName) {
    for (const declaration of DECLS[typeName] ?? [typeName]) {
        const found = PROP_ENUMS[`${declaration}.${propertyName}`];
        if (found !== undefined) return found;
    }
    return null;
}

/**
 * One member of a known enum or flags type — its nick and its number — or a thrown error naming it.
 *
 * @param {string} enumType @param {string} member @param {string} where
 * @returns {{ nick: string, value: number }}
 */
function lookupMember(enumType, member, where) {
    const nick = member.replaceAll('_', '-');
    const key = `${enumType}.${nick}`;

    const value = ENUM_VALUES[key] ?? FLAG_VALUES[key];
    if (value !== undefined) return { nick, value };

    // Two different failures, and the repair differs. A nick the enum HAS but whose value the
    // GIR could not read is a declared gap upstream — today both namespaces declare none, and
    // the entry says which library produced it. A nick the enum does not have is a typo, and
    // the oracle refuses the same file with the same information.
    if (UNREADABLE[key] !== undefined) {
        throw new Error(
            `blueprint: ${where}: \`${member}\` is a member of ${enumType} whose value ` +
                `@girs could not read (${UNREADABLE[key]}), so its number cannot be emitted`,
        );
    }
    // The nick is printed beside the member because the two differ by the one transform this
    // module applies, and a message that showed only the member read as a contradiction the
    // day that transform was the thing that broke: "`baseline_fill` is not a member of
    // GtkAlign — it has …, `baseline_fill`, …".
    const nicks = membersOf(enumType);
    throw new Error(
        `blueprint: ${where}: \`${member}\` (nick \`${nick}\`) is not a member of ${enumType}` +
            (nicks.length === 0 ? '' : ` — it has ${nicks.map((n) => `\`${n.replaceAll('-', '_')}\``).join(', ')}`),
    );
}

/**
 * Every member of one enum or flags type, in the Blueprint spelling, for the message above.
 *
 * `ENUM_NICKS` is the vocabulary's list and it covers ENUMS ONLY — measured on 4.9.0, all 21
 * flags types the gtk vocabulary numbers are absent from its 104 entries. Deriving the flags
 * half from `FLAG_VALUES`' own keys keeps the two errors symmetric; reading `ENUM_NICKS` alone
 * would have printed a bare "is not a member of GtkInputHints" and left the asymmetry looking
 * like a defect in this file.
 *
 * @param {string} enumType @returns {string[]}
 */
function membersOf(enumType) {
    const listed = ENUM_NICKS[enumType];
    if (listed !== undefined) return [...listed];
    const prefix = `${enumType}.`;
    return Object.keys(FLAG_VALUES)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
}

/**
 * Resolve one identifier written as a property value.
 *
 * The signature the emitter's `EmitOptions.resolveIdent` declares. Returning `null` means the
 * identifier is not an enum or flags member of that property, and the emitter then writes it as
 * the source spelled it — which is what an object id needs.
 *
 * @param {string} typeName  GType name of the object the property sits on
 * @param {string} propertyName
 * @param {string} member  the identifier as the source spelled it; a flag set is `a|b`
 * @param {string} where  `line N`, for an error message that can be acted on
 * @returns {string | null}
 */
export function resolveIdent(typeName, propertyName, member, where) {
    const enumType = typeOfProperty(typeName, propertyName);
    if (enumType === null) return null;
    const members = member.split('|').map((part) => lookupMember(enumType, part.trim(), where));
    // A lone member is a literal to the oracle and emits its NUMBER whatever the type, `8` for
    // `input-hints: lowercase`; only a `|`-joined set keeps the nicks (27-property-flags.ui).
    if (members.length === 1) return String(members[0].value);
    return members.map((entry) => entry.nick).join('|');
}

/** The GIR `c:identifier-prefixes` of each namespace this module imports vocabulary for. */
const C_PREFIXES = new Map([
    ['Gtk', 'Gtk'],
    ['Adw', 'Adw'],
]);

/**
 * The GType name a type reference spells, or a thrown error naming the namespace it cannot answer.
 *
 * The signature the emitter's `EmitOptions.gtypeName` declares. An unqualified name is a Gtk type
 * — `24-unqualified-type.blp` pins that `using Adw 1;` does not make a bare `Bin` legal.
 *
 * @param {{ namespace?: string, name: string }} type
 * @param {string} where  `line N`, for an error message that can be acted on
 * @returns {string}
 */
export function gtypeName(type, where) {
    const namespace = type.namespace ?? 'Gtk';
    const prefix = C_PREFIXES.get(namespace);
    if (prefix === undefined) {
        throw new Error(
            `blueprint: ${where}: \`${namespace}.${type.name}\` names a namespace this resolver has no ` +
                `vocabulary for (it has ${[...C_PREFIXES.keys()].join(', ')}), so its GType name cannot be ` +
                'derived — the C prefix is not the namespace name (`Gio.ListStore` is `GListStore`)',
        );
    }
    return `${prefix}${type.name}`;
}

/**
 * Every name an `accessibility { }` entry may carry, against the element it becomes.
 *
 * GTK's ARIA vocabulary is three registered enums and the nick of a member IS the name written
 * in the block, so the table is built rather than typed. Deriving it also means a GTK that adds
 * an ARIA slot adds it here on the next `@girs` bump, which a hand-kept list would not.
 *
 * @type {ReadonlyMap<string, 'property' | 'relation' | 'state'>}
 */
const ARIA_ELEMENTS = new Map(
    [
        ['GtkAccessibleProperty', 'property'],
        ['GtkAccessibleRelation', 'relation'],
        ['GtkAccessibleState', 'state'],
    ].flatMap(([enumType, element]) => (ENUM_NICKS[enumType] ?? []).map((nick) => [nick, element])),
);

/**
 * Which element one `accessibility { }` entry becomes, or a thrown error naming it.
 *
 * The signature the emitter's `EmitOptions.accessibilityElement` declares. There is no `null`
 * answer and no default: every name in the block is one of the three or the oracle refuses the
 * whole file, so falling back to `<property>` for an unrecognised name would emit an element
 * GtkBuilder rejects at load — the plausible-looking wrong output ADR 0053 clause 3 is about.
 *
 * @param {string} name  the entry name, kebab-spelled as the ARIA nick is
 * @param {string} where  `line N`, for an error message that can be acted on
 * @returns {'property' | 'relation' | 'state'}
 */
export function accessibilityElement(name, where) {
    const element = ARIA_ELEMENTS.get(name);
    if (element !== undefined) return element;
    throw new Error(`blueprint: ${where}: \`${name}\` is not an accessibility property, relation or state`);
}
