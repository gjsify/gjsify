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
// SO THE PREFIX IS READ OFF THE VOCABULARY, NOT KEPT IN A MAP HERE
//
// It used to be a two-entry `Map` in this file, which is the hand-written table ADR 0053 clause 6
// forbids — it just happened to be short enough not to look like one, and it is why a fifth
// namespace could not be added without editing code. It then became a DERIVATION off `DECLS`: the
// longest common prefix of every declared GType, backed off to a CamelCase boundary, which is
// right on every namespace loaded here and wrong on 28 of the 104 that declare a concrete class in
// the 135 GIRs installed on one workstation. That derivation named the condition for its own
// deletion — the day one of the 28 published a vocabulary — and `@girs` 5.3.0 met it twice over:
// #476 emits a vocabulary for every namespace a UI file can name, and it ships the GIR's
// `c:identifier-prefixes` as `PROVENANCE.identifierPrefixes`. The prefix is read from that field
// now. `identifierPrefix()` below is what is left of the question: which entry, where a namespace
// declares more than one, and the eight measured counterexamples are in its header.
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
// A `using` FOR A NAMESPACE NOT LOADED HERE IS STILL REFUSED, AND THE REASON CHANGED UNDER IT
//
// Until `@girs` 5.3.0 ts-for-gir emitted `./vocabulary` only for a namespace declaring a concrete
// `GtkWidget` descendant, so `Gdk.Cursor`, `Gio.ListStore` and `GObject.Object` — all three legal
// in a `.blp`, all three written by files the reference implementation compiles — were refused for
// a reason nothing here could close. ts-for-gir #476 closed it: every namespace a UI file can name
// publishes one now, and those three are loaded below. What is left is not an upstream gap but the
// finite thing it always was underneath — the dependency set of this package. A namespace outside
// it is still a hard error naming the line and the namespace, per clause 3, rather than plausible
// XML, and `corpus/refused/namespace-without-vocabulary.blp` holds the case with `GdkPixbuf`,
// whose C prefix is `Gdk`: concatenating writes `GdkPixbufPixbuf` where the oracle writes
// `GdkPixbuf`, so guessing there is wrong in a way that reads perfectly.
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

/** @import { SourceLocation } from './ast.d.mts' */
import { BlueprintEmitError, SUBSET_NOTE } from './errors.mjs';

import * as ADW from '@girs/adw-1/vocabulary';
import * as GDK from '@girs/gdk-4.0/vocabulary';
import * as GIO from '@girs/gio-2.0/vocabulary';
import * as GOBJECT from '@girs/gobject-2.0/vocabulary';
import * as GTK from '@girs/gtk-4.0/vocabulary';
import * as GTK_SOURCE from '@girs/gtksource-5/vocabulary';
import * as PANGO from '@girs/pango-1.0/vocabulary';
import * as SHUMATE from '@girs/shumate-1.0/vocabulary';
import * as WEBKIT from '@girs/webkit-6.0/vocabulary';

/**
 * Every `@girs` vocabulary this resolver reads, keyed by the specifier it is imported from.
 *
 * Two kinds of entry, and only the first kind is a choice. A SEED is a namespace a `.blp` in
 * reach may NAME, which is a fact about the corpus and the wild sweep, not about `@girs`: Gtk and
 * Adw are what the corpus wrote; GtkSource, Shumate, WebKit, Gdk and Gio are what the sweep and
 * the reference implementation's own `tests/samples` reach (273 `.blp`, 235 of them foreign —
 * `scripts/blueprint-wild-sweep.mjs`, tabled in
 * `docs/reports/2026-09-16-blueprint-subset-gap.md` § 2). The rest are CLOSURE: a vocabulary
 * names the siblings it needs in `PROVENANCE.requiredVocabularies`, and `assertClosed()` below
 * holds this map to it. GObject and Pango are here for no other reason.
 *
 * THE LIST IS NOT DERIVABLE AND ITS COMPLETENESS NOW IS, WHICH IS THE WHOLE OF WHAT 5.3.0 BOUGHT.
 * A static `import` cannot take a computed specifier, and a dynamic one cannot be bundled — the
 * GJS build resolves these at build time, so a specifier the bundler cannot see is a module that
 * is not there at run time. So the SPELLING stays hand-written; what stopped being hand-judged is
 * whether it is enough. Before `requiredVocabularies` (ts-for-gir #476, `@girs` 5.3.0) a missing
 * sibling was silent: the join simply found nothing and `resolveIdent` returned `null`, which the
 * emitter reads as "not ours" and writes the source spelling — the plausible wrong output ADR 0053
 * clause 3 exists to prevent. It is now an import-time throw naming both packages.
 *
 * Everything else about a namespace — which one it IS, its C identifier prefix, which GTypes it
 * declares, which of its properties are enums — is read out of the module, so a sixth seed is one
 * import, one row here and one dependency line.
 *
 * FOUR OF THE NINE HAVE A GOLDEN, which is worth saying here rather than only in the ledger. A
 * golden needs the oracle, the oracle needs the typelib, and the `ci-fedora` image carries
 * `gtk4-devel`, `libadwaita-devel`, `gtksourceview5-devel` and `webkitgtk6.0-devel` and no
 * libshumate. A rule file naming Shumate would red stage B until that image is rebuilt, and an
 * image is only pushed from `main`, so a PR cannot carry both halves. Measured locally, a Shumate
 * golden IS byte-equal; what holds it out is the image and nothing about the code.
 * `status/open-todos.md` carries the follow-up. Until then Shumate — and the same goes for the
 * four namespaces reached only through the closure — is covered here by LOAD: `merged()`,
 * `assertClosed()` and `NAMESPACES` read every entry of this map on import, so a broken or
 * conflicting one fails every corpus run.
 *
 * @type {ReadonlyMap<string, typeof GTK>}
 */
const LOADED = new Map([
    ['@girs/adw-1/vocabulary', ADW],
    ['@girs/gdk-4.0/vocabulary', GDK],
    ['@girs/gio-2.0/vocabulary', GIO],
    ['@girs/gobject-2.0/vocabulary', GOBJECT],
    ['@girs/gtk-4.0/vocabulary', GTK],
    ['@girs/gtksource-5/vocabulary', GTK_SOURCE],
    ['@girs/pango-1.0/vocabulary', PANGO],
    ['@girs/shumate-1.0/vocabulary', SHUMATE],
    ['@girs/webkit-6.0/vocabulary', WEBKIT],
]);

/**
 * Every vocabulary names the siblings it needs, and this refuses a map that is missing one.
 *
 * Read the failure it replaces rather than the rule: `GtkSizeGroup.mode` resolved at `@girs` 5.2.0
 * only because Gtk's own vocabulary happened to carry the enum, and 83 `PROP_ENUMS` rows in 33
 * packages were joins of exactly that kind — right while a sibling was loaded, silently unanswered
 * while it was not. 5.3.0 carries the numbers per package and says in `requiredVocabularies` which
 * siblings a join may reach into, which is what makes the question askable at all.
 */
function assertClosed() {
    for (const [specifier, vocabulary] of LOADED) {
        for (const required of vocabulary.PROVENANCE.requiredVocabularies) {
            if (LOADED.has(required)) continue;
            throw new Error(
                `blueprint: ${specifier} declares it needs ${required}, which this resolver does not ` +
                    'load — a property-to-enum join reaching into it would find nothing and be read as ' +
                    '"not an enum", so the emitter would write the source spelling out as if it were an ' +
                    'object id. Import it beside the others and add the dependency to ' +
                    'packages/infra/blueprint/package.json.',
            );
        }
    }
}
assertClosed();

const VOCABULARIES = [...LOADED.values()];

/**
 * One table folded across every vocabulary, refusing to merge two rows that disagree.
 *
 * A GType NAME is globally unique, so the tables cannot collide by construction and the shipped
 * ones do not — measured on `@girs` 5.3.0 across these nine, 185 rows across three tables appear in
 * more than one vocabulary (a namespace re-declaring an enum it inherits) and every one of them
 * carries the same value; `DECLS` and `PROP_ENUMS` overlap nowhere at all. That is a property of
 * the data, not of the code, and it stops holding silently: a later `@girs` where two namespaces
 * number the same GType differently would otherwise be decided by the order of this array. So it is
 * checked rather than asserted in a comment — and the count above is what 5.3.0 did to it, up from
 * 21 across the five loaded before, which is the shape a bump moves without touching a line here.
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
                // The throw in this module that is deliberately NOT a `BlueprintEmitError`,
                // and the reason is that class's own contract: it carries a file and a line,
                // and this has neither. It is raised while the vocabularies are being merged at
                // import time, about the DEPENDENCY rather than about anyone's `.blp` — no
                // source has been read yet, and an invented location would send a reader to a
                // line of their own file for a defect one package over.
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
// on 5.3.0 across all nine, only Gtk's two tables have entries, 53 and 6.
const ARIA_VALUE_TYPES = merged('ARIA_VALUE_TYPES');
const ARIA_VALUE_ENUMS = merged('ARIA_VALUE_ENUMS');
const DECLS = merged('DECLS');
const PROP_ENUMS = merged('PROP_ENUMS');
// ts-for-gir #478. `PROP_ENUMS` answers only where the property's type is an enum or bitfield;
// this answers for any type, which is what an uncast closure's return type needs. An `@girs`
// older than the release that added it simply has no such table and this is `{}` — the two
// refusals below then read exactly as they did before.
const PROP_TYPES = merged('PROP_TYPES');
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
 * The GType of a property's own type, whatever that type is, or `null` when the vocabulary
 * states none.
 *
 * The same DECLS walk {@link typeOfProperty} makes, over the wider table: a property is keyed by
 * the type that DECLARES it, so `GtkBox.orientation` is not there and `GtkOrientable.orientation`
 * is. `null` means the artefact carries no answer — an `@girs` predating the table, a property
 * whose GIR type the generator could not map, or a type nobody described. It never means
 * "scalar": `gchararray` is carried like any other, which is the whole reason the table is
 * separate from `PROP_ENUMS`.
 *
 * @param {string} typeName @param {string} propertyName
 * @returns {string | null}
 */
export function propertyGType(typeName, propertyName) {
    for (const declaration of DECLS[typeName] ?? [typeName]) {
        const found = PROP_TYPES[`${declaration}.${propertyName}`];
        if (found !== undefined) return found;
    }
    return null;
}

/**
 * One member of a known enum or flags type — its nick, its number and which of the two kinds
 * of type it belongs to — or a thrown error naming it.
 *
 * @param {string} enumType @param {string} member @param {SourceLocation} where
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
        throw new BlueprintEmitError(
            `\`${member}\` is a member of ${enumType} whose value ` +
                `@girs could not read (${UNREADABLE[key]}), so its number cannot be emitted`,
            where,
        );
    }
    // The nick is printed beside the member because the two differ by the one transform this
    // module applies, and a message that showed only the member read as a contradiction the
    // day that transform was the thing that broke: "`baseline_fill` is not a member of
    // GtkAlign — it has …, `baseline_fill`, …".
    const nicks = membersOf(enumType);
    throw new BlueprintEmitError(
        `\`${member}\` (nick \`${nick}\`) is not a member of ${enumType}` +
            (nicks.length === 0 ? '' : ` — it has ${nicks.map((n) => `\`${n.replaceAll('-', '_')}\``).join(', ')}`),
        where,
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
 * @param {SourceLocation} where  the file and line the construct sits on
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
        throw new BlueprintEmitError(
            `\`${member}\` joins members with \`|\`, and ${enumType} is not a flags type`,
            where,
        );
    }
    return members.map((entry) => entry.nick).join('|');
}

/**
 * The C identifier prefix one namespace declares, chosen where it declares more than one.
 *
 * `PROVENANCE.identifierPrefixes` is the GIR's `c:identifier-prefixes` verbatim, shipped since
 * `@girs` 5.3.0. Before it this module DERIVED the prefix — the longest common prefix of every
 * declared GType, backed off to a CamelCase boundary — and said so in the comment that stood here:
 * a derivation over the five namespaces then loaded, not a law about GIR, which over the 135 GIRs
 * installed on one workstation got 28 of the 104 that declare a concrete class wrong, and which
 * was to be replaced by the upstream prefix the day one of those 28 published a vocabulary.
 *
 * THAT DAY IS THIS BUMP, so the derivation is gone rather than kept beside the data it guessed at.
 * 5.3.0 emits a vocabulary for every namespace a UI file can name, not only the widget-bearing
 * ones, and all eight of the namespaces the old comment named by hand now publish one: measured on
 * their 5.3.0 tarballs, the derivation answers `GdkX11`/`GdkWayland` where the GIR says `Gdk`,
 * `GstAudio`/`GstGL` and `GstTest` where it says `Gst`, `GnomeB` where it says `Gnome`, and the
 * empty string for `Nice`. Reading the field gets all eight right, and the nine loaded here
 * unchanged — Gtk `Gtk`, Adw `Adw`, GtkSource `GtkSource`, Shumate `Shumate`, WebKit `WebKit`,
 * Gdk `Gdk`, Pango `Pango`, and `G` for both Gio and GObject, which is the answer
 * `Gio.ListStore` -> `GListStore` needs and no concatenation reaches.
 *
 * WHY A CHOICE IS STILL NEEDED. Four namespaces declare more than one prefix (`Camel,camel`,
 * `ECal,E`, `GUnix,G`), and a GType name takes exactly one. The one that can be right is one that
 * every declared GType already starts with, and where several do, the longest — `Camel` over
 * `camel` for `{CamelFolder, …}`, `E` over `ECal` for a namespace that declares an `EReminder…`
 * beside its `ECal…`. None of the nine loaded here is multi-valued, so this branch is exercised by
 * no golden and is written to refuse rather than to guess.
 *
 * @param {{ namespace: string, identifierPrefixes: string[] }} provenance
 * @param {string[]} gtypes  every GType name the namespace declares
 * @returns {string}
 */
function identifierPrefix(provenance, gtypes) {
    const usable = provenance.identifierPrefixes
        .filter((prefix) => gtypes.every((name) => name.startsWith(prefix)))
        .sort((a, b) => b.length - a.length);
    if (usable.length > 0) return usable[0];
    throw new Error(
        `blueprint: @girs says ${provenance.namespace} has C identifier prefix(es) ` +
            `${provenance.identifierPrefixes.join(', ')}, and not one of them starts every GType it ` +
            'declares, so there is no prefix a type reference in that namespace could take',
    );
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
            {
                prefix: identifierPrefix(vocabulary.PROVENANCE, gtypes),
                declares: (name) => name in vocabulary.DECLS,
            },
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
 * @param {SourceLocation} where  the file and line the construct sits on
 * @param {'object' | 'reference'} [position]  where the type is written; see above
 * @returns {string}
 */
export function gtypeName(type, where, position) {
    if (type.extern === true) return `${type.namespace ?? ''}${type.name}`;
    const namespace = type.namespace ?? 'Gtk';
    const known = NAMESPACES.get(namespace);
    if (known === undefined) {
        // Closing this is a dependency line and an import in `LOADED`, not an upstream release —
        // since `@girs` 5.3.0 every namespace a UI file can name publishes a vocabulary. That is
        // for whoever maintains this file and not for the message: someone whose build just
        // stopped needs the extern form, not the provenance.
        throw new BlueprintEmitError(
            `\`${namespace}.${type.name}\` names a namespace this resolver has no ` +
                `vocabulary for (it has ${[...NAMESPACES.keys()].join(', ')}), so its GType name cannot ` +
                'be derived: the C prefix is not the namespace name, and guessing it would emit a class ' +
                'GtkBuilder resolves to nothing. Write the GType name out with the extern form instead — ' +
                `\`GdkPixbuf.Pixbuf\` is \`$GdkPixbuf\` — which needs no vocabulary. ${SUBSET_NOTE}`,
            where,
        );
    }
    const gtype = `${known.prefix}${type.name}`;
    if (position === 'object' && !known.declares(gtype)) {
        throw new BlueprintEmitError(
            `namespace ${namespace} declares no instantiable type called ` +
                `\`${type.name}\` (its GType name would be \`${gtype}\`), so there is nothing to ` +
                `instantiate — @girs ${namespace} vocabulary is what was asked, and it lists the ` +
                'abstract classes nowhere, which is why one is legal as a template parent and not here',
            where,
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
 * @param {SourceLocation} where  the file and line the construct sits on
 * @returns {'property' | 'relation' | 'state'}
 */
export function accessibilityElement(name, where) {
    const slot = ARIA_SLOTS.get(name);
    if (slot !== undefined) return slot.element;
    throw new BlueprintEmitError(`\`${name}\` is not an accessibility property, relation or state`, where);
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
 * @param {SourceLocation} where  the file and line the construct sits on
 * @returns {string | null}
 */
export function accessibilityValue(name, member, where) {
    const slot = ARIA_SLOTS.get(name);
    // `accessibilityElement` refuses a name that is no slot and the emitter asks it first, so a
    // miss here is a caller reaching this seam on its own rather than through the block.
    if (slot === undefined || ARIA_VALUE_TYPES[slot.key] !== 'enum') return null;
    return String(lookupMember(ARIA_VALUE_ENUMS[slot.key], member, where).value);
}
