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
// A `|`-SET ON AN ENUM IS AN ERROR
//
// The `|` selects the form, and the form carries a type check of its own: the oracle's `Flags`
// node refuses a type that is not a bitfield ("Gtk.Orientation is not a bitfield type").
// Answering by member count alone wrote `orientation: vertical | horizontal` out as
// `vertical|horizontal` — XML GtkBuilder cannot read as a GtkOrientation, for a file the
// oracle refuses, the plausible wrong output clause 3 exists to prevent.
// `corpus/refused/flags-on-enum.blp` holds it.
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
// `Adw.Bin` is `AdwBin` and `Gtk.Box` is `GtkBox`, and every corpus file imported one of those two
// namespaces — the only reason concatenating ever produced a golden. Measured on 0.20.4,
// `Gio.ListStore` is `<object class="GListStore">` and `GObject.Object` is `<object class="GObject">`:
// the GIR's `c:identifier-prefixes` for both namespaces is `G`, and an emitter concatenating writes
// `GioListStore` and `GObjectObject`, classes GtkBuilder cannot find, with no error anywhere.
//
// SO THE PREFIX IS DERIVED FROM THE VOCABULARY, NOT KEPT IN A MAP HERE
//
// It used to be a two-entry `Map` in this file, which is the hand-written table ADR 0053 clause 6
// forbids — it just happened to be short enough not to look like one, and it is why a fifth
// namespace could not be added without editing code. `DECLS` names every instantiable GType the
// namespace declares, so the prefix is the longest common prefix of those names, backed off to a
// CamelCase boundary: `{GtkSourceView, GtkSourceBuffer, …}` gives `GtkSource`, and a hypothetical
// `{GObject, GBinding, GParamSpec, …}` gives `G`, which is the answer `GObject.Object` needs and
// the one no concatenation reaches. The back-off is what keeps a namespace with ONE declared type
// honest: `{FooBar}` has itself as its common prefix, the remainder is empty rather than a fresh
// CamelCase word, and the derivation walks back to `Foo`.
//
// IT IS A DERIVATION OVER THE FIVE NAMESPACES LOADED HERE, NOT A LAW ABOUT GIR
//
// Say what was measured. On the five vocabularies this module loads it reproduces
// `c:identifier-prefixes` verbatim. Swept over the 135 GIRs installed on one workstation, of the
// 104 that declare a concrete class it gets 28 WRONG (27%): `GdkX11` and `GdkWayland` answer
// themselves where the GIR says `Gdk`, eight `Gst*` namespaces answer `GstAudio`/`GstGL`/`GstVa`
// where it says `Gst`, `GstCheck`'s one class `GstTestClock` answers `GstTest`, `Colorhug`'s one
// class answers `ChDevice` where it says `Ch`, `GnomeBG` stops mid-word at `GnomeB`, `Nice`
// backs off to nothing at all, and four namespaces declare a MULTI-VALUED prefix (`Camel,camel`,
// `ECal,E`, `GUnix,G`) that a single string cannot express. None of the 28 is reachable today —
// not one publishes a `./vocabulary`, because none declares a `GtkWidget` descendant — and the
// day one does, this derivation is what has to be replaced by the prefix itself, emitted upstream.
// The one-type back-off is the same kind of claim: it answers `Foo` for `{FooBar}` and `GstTest`
// for `{GstTestClock}`, so it bounds the damage rather than removing it.
//
// AND IN OBJECT POSITION THE NAME IS CHECKED AGAINST THE SAME TABLE
//
// `<prefix><Name>` is checked against `DECLS` where the type is INSTANTIATED. A prefix derived
// wrong would otherwise write a class name GtkBuilder resolves to nothing — the plausible wrong
// output clause 3 exists to prevent, one level below the namespace check. The oracle refuses the
// same shape by name (`Namespace Gtk does not contain a type called FooApplicationWindow`), and it
// refuses an abstract class there too (`Gtk.Widget can't be instantiated because it's abstract`),
// which is exactly what `DECLS` leaves out. So this is agreement, not extra strictness.
//
// The check turns a wrong prefix into a refusal rather than a wrong class, and that is EMPIRICAL
// and not a theorem: swept over every concrete class in all 135 installed GIRs — 2182 of them —
// there is no case where a wrongly derived prefix still lands on a name the namespace declares.
// It is constructible, though, and the counterexample belongs beside the claim:
// `{FooBarOne, FooBarBarOne}` derives `FooBar`, so `Foo.BarOne` emits `FooBarBarOne`, a real and
// different class, silently. No installed GIR has that shape; nothing guarantees the next one does not.
//
// NOT IN REFERENCE POSITION, AND GETTING THAT WRONG COST A REAL FILE
//
// A template PARENT names a class without instantiating it, and `template $Foo: Gtk.Widget { }` is
// a file the oracle compiles — `<template class="Foo" parent="GtkWidget">`. `DECLS` holds
// instantiable GTypes, so `GtkWidget` is not in it, and checking membership in that position
// refused the 19 abstract classes Gtk and Adw declare, every one of them legal as a parent. The
// reference implementation draws the SAME line: its `tests/sample_errors/abstract_class.blp` writes
// both `template $MyWidget: Gtk.Widget { }` and `Gtk.Widget { }`, and pins the error on the
// instantiation alone. Neither sweep could see it — no wild file subclasses an abstract class and
// the oracle's `sample_errors/` are in no corpus here — so `rules/41-template-parent-abstract.blp`
// is what holds it.
//
// Nothing in the shipped vocabulary answers "does this class EXIST", abstract ones included:
// `OWN_PROPS` and `OWN_SIGNALS` carry `GtkWidget` but would miss a class declaring neither. So a
// reference position gets the prefix and no membership check — which is what every position did
// before, so the check is a strengthening of one and never a weakening of the other.
//
// THE TWO EXITS DEFAULT THE OTHER WAY FROM EACH OTHER, ON PURPOSE
//
// This seam reads silence as a REFERENCE, the weaker answer. It is the public contract — the
// harness hands it to both exits — and a caller that cannot say where it is must not be given a
// check that can refuse a legal file. `project.mjs`'s private `tagReader` reads silence as an
// OBJECT, the stronger one, because it has two call sites and that is the common one, so its
// single reference site is the one that has to say so out loud.
//
// The useful consequence is that each exit makes the OTHER position the explicit one, so between
// them a dropped argument is loud somewhere. All three were broken on purpose and measured:
// drop `'object'` in `emitObject` and `refused/abstract-instantiation.blp` is accepted (red);
// drop `'reference'` in the projection's template call and
// `rules/41-template-parent-abstract.blp` throws where a tree is expected (red); move the
// projection's own default off `'object'` and that refusal file's recorded projection verdict
// flips (red).
//
// COUNTED HONESTLY THAT IS THREE OF FIVE CALL SITES, NOT ALL FIVE, and the other two are worth
// writing down rather than rounding up. `emitTemplate` passes `'reference'`, which is already
// what omission means, so dropping it is a no-op. `indexObject` passes `'object'` and CAN lose
// it with no stage moving — because it is REDUNDANT, not unchecked: `emitObject` reaches the
// same node on the same pass and throws first, with the same line and the same message. The day
// that index is walked without the emitter walking the same tree, it stops being either.
//
// An EXTERN type (`$MyWidget`) is in no GIR and takes none of these rules.
//
// A `using` FOR A NAMESPACE WITH NO VOCABULARY IS STILL REFUSED
//
// ts-for-gir emits `./vocabulary` only for namespaces that declare a concrete `GtkWidget`
// descendant, so `@girs/gtksource-5`, `@girs/shumate-1.0` and `@girs/webkit-6.0` have one and
// `@girs/gdk-4.0`, `@girs/gio-2.0` and `@girs/gobject-2.0` do not — although `Gdk.Cursor`,
// `Gio.ListStore` and `GObject.Object` are all legal in a `.blp`. Those stay a hard error naming
// the line and the namespace, per clause 3, rather than plausible XML; the fix is upstream, in that
// gate, and this module needs no change when it lands — a namespace arrives by being added to
// `VOCABULARIES` below, and everything else is read out of it.
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
// AND THE VALUE IS A THIRD LOOKUP, WHICH `@girs` 5.1.0 ADDED
//
// `checked: true` is `1` and `orientation: vertical` is `1` on a `GtkButton` that is not
// orientable at all, because GTK types those slots in C (`gtk_accessible_property_init_value`)
// and the GIR carries that function, not its table. ts-for-gir reads each member's own GIR
// DOCUMENTATION instead and publishes `ARIA_VALUE_TYPES` — keyed like `ENUM_VALUES`, because the
// ARIA names ARE enum members — beside `ARIA_VALUE_ENUMS`, which names the enum GType for the
// rows that need one. `ARIA_VALUE_TYPES[key] === 'enum'` is the whole test and a row of any other
// kind keeps the source spelling, which is exactly what the goldens hold: measured on 0.20.4,
// `hidden: true` stays `true` where `checked: true` is `1`, and the only thing that tells those
// two lines apart is the table. Resolving them through the widget's ParamSpecs instead would be
// right by accident inside `Gtk.Box` and wrong inside `Gtk.Label`.

import * as ADW from '@girs/adw-1/vocabulary';
import * as GTK from '@girs/gtk-4.0/vocabulary';
import * as GTK_SOURCE from '@girs/gtksource-5/vocabulary';
import * as SHUMATE from '@girs/shumate-1.0/vocabulary';
import * as WEBKIT from '@girs/webkit-6.0/vocabulary';

/**
 * Every `@girs` vocabulary this resolver reads, in one list.
 *
 * The list is the DEPENDENCY set and nothing else: a namespace is here because
 * `packages/infra/blueprint/package.json` depends on the package, and an npm dependency has to be
 * written down somewhere. Everything the resolver then knows about it — which namespace it IS, what
 * its C identifier prefix is, which GTypes it declares, which of its properties are enums — is read
 * out of the module, so adding the sixth namespace is one import and one dependency line and no
 * table anywhere.
 *
 * Why these five: Gtk and Adw are what the corpus wrote; GtkSource, Shumate and WebKit are the
 * three namespaces the wild sweep reaches (#1699 § 2) that publish a `./vocabulary` today — 273
 * `.blp`, 235 of them foreign. That sweep also reaches `Gdk`, and the reference implementation's
 * own samples reach `Gio` and `GObject`; those three publish none, so they are refused by name
 * rather than guessed at — see the header.
 *
 * FOUR OF THE FIVE HAVE A GOLDEN AND SHUMATE DOES NOT, which is worth saying here rather than
 * only in the ledger. A golden needs the oracle, the oracle needs the typelib, and the
 * `ci-fedora` image carries `gtk4-devel`, `libadwaita-devel`, `gtksourceview5-devel` and
 * `webkitgtk6.0-devel` and no libshumate. A rule file naming Shumate would red stage B until
 * that image is rebuilt, and an image is only pushed from `main`, so a PR cannot carry both
 * halves. Measured locally, a Shumate golden IS byte-equal; what holds it out is the image and
 * nothing about the code. `status/open-todos.md` carries the follow-up. Until then Shumate is
 * covered here only by load — `merged()` and `NAMESPACES` read every entry of this array on
 * import, so a broken or conflicting Shumate vocabulary fails every corpus run — and by the wild
 * sweep, which is not a gate.
 */
const VOCABULARIES = [GTK, ADW, GTK_SOURCE, SHUMATE, WEBKIT];

/**
 * One table folded across every vocabulary, refusing to merge two rows that disagree.
 *
 * A GType NAME is globally unique, so the tables cannot collide by construction and the shipped
 * ones do not — measured on `@girs` 5.2.0 across these five, 21 keys appear in more than one
 * vocabulary (Gtk's enums re-declared by a namespace that inherits them) and every one of them
 * carries the same value. That is a property of the data, not of the code, and it stops holding
 * silently: a later `@girs` where two namespaces number the same GType differently would otherwise
 * be decided by the order of this array. So it is checked rather than asserted in a comment.
 *
 * @param {string} table  the export name, for the message
 * @returns {Record<string, any>}
 */
function merged(table) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const vocabulary of VOCABULARIES) {
        for (const [key, value] of Object.entries(vocabulary[table] ?? {})) {
            const seen = out[key];
            if (seen !== undefined && JSON.stringify(seen) !== JSON.stringify(value)) {
                throw new Error(
                    `blueprint: @girs vocabularies disagree about ${table}[${key}]: ` +
                        `${JSON.stringify(seen)} vs ${JSON.stringify(value)} — a GType name is globally ` +
                        'unique, so this is an upstream defect and not something to merge past',
                );
            }
            out[key] = value;
        }
    }
    return out;
}

// The ARIA tables are merged for one reason beyond symmetry: `ARIA_SLOTS` reads the merged
// `ENUM_NICKS`, so taking the value types from Gtk alone would let the name half and the value half
// disagree the day another namespace declares an ARIA slot of its own. None does today — measured
// on 5.2.0, only Gtk's two tables have entries.
const ARIA_VALUE_TYPES = merged('ARIA_VALUE_TYPES');
const ARIA_VALUE_ENUMS = merged('ARIA_VALUE_ENUMS');
const DECLS = merged('DECLS');
const PROP_ENUMS = merged('PROP_ENUMS');
const ENUM_NICKS = merged('ENUM_NICKS');
const ENUM_VALUES = merged('ENUM_VALUES');
const FLAG_VALUES = merged('FLAG_VALUES');
const UNREADABLE = { ...merged('ENUM_VALUES_UNREADABLE'), ...merged('FLAG_VALUES_UNREADABLE') };

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
 * One member of a known enum or flags type — its nick, its number and which of the two kinds
 * of type it belongs to — or a thrown error naming it.
 *
 * @param {string} enumType @param {string} member @param {string} where
 * @returns {{ nick: string, value: number, flags: boolean }}
 */
function lookupMember(enumType, member, where) {
    const nick = member.replaceAll('_', '-');
    const key = `${enumType}.${nick}`;

    const asEnum = ENUM_VALUES[key];
    if (asEnum !== undefined) return { nick, value: asEnum, flags: false };
    const asFlag = FLAG_VALUES[key];
    if (asFlag !== undefined) return { nick, value: asFlag, flags: true };

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
 * The enum or flags type a property carries, or `null` for a property that carries neither
 * (or one this vocabulary has never heard of — the two are not told apart, and a caller that
 * needs them told apart needs a different question).
 *
 * The signature the emitter's `EmitOptions.enumOrFlagsTypeOf` declares. `resolveIdent` below
 * answers what one identifier MEANS; this answers what the property would accept, which is
 * the question the null literal raises: the oracle writes an empty `<setter>` for a string,
 * numeric or object-typed property and refuses an enum or flags one, so the emitter has to
 * ask about the property rather than about the value.
 *
 * @param {string | null} typeName  GType name, or `null` for an extern target with no vocabulary
 * @param {string} propertyName
 * @returns {string | null}
 */
export function enumOrFlagsTypeOf(typeName, propertyName) {
    return typeName === null ? null : typeOfProperty(typeName, propertyName);
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
    // …and the set form is refused where the oracle refuses it, on a type that is not flags.
    if (!members.every((entry) => entry.flags)) {
        throw new Error(
            `blueprint: ${where}: \`${member}\` joins members with \`|\`, and ${enumType} is not a flags type`,
        );
    }
    return members.map((entry) => entry.nick).join('|');
}

/**
 * The GIR `c:identifier-prefixes` of one namespace, read off the GTypes it declares.
 *
 * The longest common prefix of every declared GType, backed off until what follows it in EVERY
 * name is a fresh CamelCase word. The back-off is the whole guard: without it a namespace whose
 * declared types happen to share more than their prefix — one type, or two siblings like
 * `FooBarOne` and `FooBarTwo` — would answer `FooBar` and write `FooBarBarOne`. With it, the
 * remainder test fails at `FooBar`, and the walk stops at the last position that leaves every
 * remainder starting a word.
 *
 * Measured on `@girs` 5.2.0: Gtk → `Gtk`, Adw → `Adw`, GtkSource → `GtkSource`, Shumate →
 * `Shumate`, WebKit → `WebKit`, each of which is that GIR's `c:identifier-prefixes` verbatim.
 *
 * @param {string[]} gtypes  every GType name the namespace declares
 * @returns {string}  the prefix, possibly empty for a namespace that shares none
 */
function identifierPrefix(gtypes) {
    let prefix = gtypes.reduce((a, b) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
        return a.slice(0, i);
    });
    while (prefix.length > 0 && !gtypes.every((name) => /^[^a-z]/.test(name.slice(prefix.length)))) {
        prefix = prefix.slice(0, -1);
    }
    return prefix;
}

/**
 * Each namespace this module has vocabulary for -> its C prefix and the GTypes it declares.
 *
 * Keyed by the vocabulary's OWN `PROVENANCE.namespace`, so the `using Ns …` spelling a `.blp`
 * writes and the package it resolves to are joined by the generated data rather than by a map
 * kept here. `@girs/gtksource-5` says `GtkSource`; nothing in the package NAME does.
 *
 * @type {ReadonlyMap<string, { prefix: string, declares: (name: string) => boolean }>}
 */
const NAMESPACES = new Map(
    VOCABULARIES.map((vocabulary) => {
        const gtypes = Object.keys(vocabulary.DECLS);
        return [
            vocabulary.PROVENANCE.namespace,
            { prefix: identifierPrefix(gtypes), declares: (name) => name in vocabulary.DECLS },
        ];
    }),
);

/**
 * The GType name a type reference spells, or a thrown error naming what it cannot answer.
 *
 * The signature the emitter's `EmitOptions.gtypeName` declares. An unqualified name is a Gtk type
 * — `24-unqualified-type.blp` pins that `using Adw 1;` does not make a bare `Bin` legal.
 *
 * `position` is which question is being asked, and the two have different answers in the data:
 * `'object'` is a type being INSTANTIATED, where `DECLS` is exactly the right table and an
 * abstract class is an error in both compilers; anything else is a type merely NAMED — a template
 * parent — where no shipped table can say whether the class exists, so only the prefix applies.
 * An omitted position is read as a reference, because a caller that does not say where it is
 * cannot be given the stronger check. `refused/unknown-type-name.blp` and
 * `rules/41-template-parent-abstract.blp` hold the two sides, so dropping the argument at either
 * call site fails a stage rather than going quiet.
 *
 * Two failures, and they are different questions with different repairs: a namespace with no
 * vocabulary at all (`Gdk`, `Gio`, `GObject` today — upstream's gate, see the header) and a name
 * the namespace does not declare as instantiable (a typo, or an abstract class where one cannot
 * go; the oracle refuses both by name).
 *
 * An EXTERN type takes neither rule. `$MyWidget` is a class the application registers, so there
 * is no namespace to default, no C prefix to look up and no GIR to have declared it: its GType
 * name is what the source spells with the sigil removed, and a dotted `$Ns.Inner` CONCATENATES to
 * `NsInner` — measured on the oracle, and the one place in this module where concatenation is the
 * answer rather than the fallback that was wrong for `Gio`.
 *
 * @param {{ namespace?: string, name: string, extern?: true }} type
 * @param {string} where  `line N`, for an error message that can be acted on
 * @param {'object' | 'reference'} [position]  where the type is written; see above
 * @returns {string}
 */
export function gtypeName(type, where, position) {
    if (type.extern === true) return `${type.namespace ?? ''}${type.name}`;
    const namespace = type.namespace ?? 'Gtk';
    const known = NAMESPACES.get(namespace);
    if (known === undefined) {
        throw new Error(
            `blueprint: ${where}: \`${namespace}.${type.name}\` names a namespace this resolver has no ` +
                `vocabulary for (it has ${[...NAMESPACES.keys()].join(', ')}), so its GType name cannot be ` +
                'derived — the C prefix is not the namespace name (`Gio.ListStore` is `GListStore`). ' +
                `\`@girs/…/vocabulary\` is what carries it, and ts-for-gir emits that subpath only for ` +
                'namespaces declaring a concrete GtkWidget descendant',
        );
    }
    const gtype = `${known.prefix}${type.name}`;
    if (position === 'object' && !known.declares(gtype)) {
        throw new Error(
            `blueprint: ${where}: namespace ${namespace} declares no instantiable type called ` +
                `\`${type.name}\` (its GType name would be \`${gtype}\`), so there is nothing to ` +
                `instantiate — @girs ${namespace} vocabulary is what was asked, and it lists the ` +
                'abstract classes nowhere, which is why one is legal as a template parent and not here',
        );
    }
    return gtype;
}

/**
 * Every name an `accessibility { }` entry may carry -> the element it becomes, and the key its
 * VALUE is typed by.
 *
 * GTK's ARIA vocabulary is three registered enums and the nick of a member IS the name written
 * in the block, so the table is built rather than typed. Deriving it also means a GTK that adds
 * an ARIA slot adds it here on the next `@girs` bump, which a hand-kept list would not. One map
 * answers both questions because `ARIA_VALUE_TYPES` is keyed `<enum GType>.<nick>` and the nicks
 * of the three enums are disjoint — which is what lets the block spell all three alike at all.
 *
 * @type {ReadonlyMap<string, { element: 'property' | 'relation' | 'state', key: string }>}
 */
const ARIA_SLOTS = new Map(
    [
        ['GtkAccessibleProperty', 'property'],
        ['GtkAccessibleRelation', 'relation'],
        ['GtkAccessibleState', 'state'],
    ].flatMap(([enumType, element]) =>
        (ENUM_NICKS[enumType] ?? []).map((nick) => [nick, { element, key: `${enumType}.${nick}` }]),
    ),
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
    const slot = ARIA_SLOTS.get(name);
    if (slot !== undefined) return slot.element;
    throw new Error(`blueprint: ${where}: \`${name}\` is not an accessibility property, relation or state`);
}

/**
 * What one `accessibility { }` value emits where the ARIA table types that slot as an ENUM, and
 * `null` where it types it as anything else.
 *
 * The signature the emitter's `EmitOptions.accessibilityValue` declares. `null` does not mean
 * what it means in `resolveIdent`: there it is "not the library's identifier", here it is "this
 * slot takes a string, an integer, a double, a boolean or a reference" — all five of which the
 * emitter already writes the way the oracle does, so the enum rows are the only ones where the
 * source spelling is measurably wrong. A member the enum does not have throws, as the oracle
 * refuses `orientation: sideways` by name; `corpus/refused/unknown-accessibility-member.blp`
 * holds that case.
 *
 * @param {string} name  the entry name, kebab-spelled as the ARIA nick is
 * @param {string} member  the identifier or boolean as the source spelled it
 * @param {string} where  `line N`, for an error message that can be acted on
 * @returns {string | null}
 */
export function accessibilityValue(name, member, where) {
    const slot = ARIA_SLOTS.get(name);
    // `accessibilityElement` refuses a name that is no slot and the emitter asks it first, so a
    // miss here is a caller reaching this seam on its own rather than through the block.
    if (slot === undefined || ARIA_VALUE_TYPES[slot.key] !== 'enum') return null;
    return String(lookupMember(ARIA_VALUE_ENUMS[slot.key], member, where).value);
}
