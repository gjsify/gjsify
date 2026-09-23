// WHAT THIS CORPUS IS, AND WHAT IT IS NOT
//
// ADR 0053 decided that Blueprint is parsed in this repo and that
// `blueprint-compiler` stops being a build dependency and becomes the ORACLE the
// parser is measured against. This directory is that oracle's subject: one small
// `.blp` per language rule, each with the GtkBuilder XML the reference compiler
// produces from it, checked in.
//
// It carries NO parser. ADR 0053 § Implementation puts the corpus first on purpose —
// "a harness with nothing to compare reports green while proving nothing" — so what
// this ships is the thing to compare AGAINST, and `scripts/check-blueprint-corpus.mjs`
// is the harness that will hold a parser to it the day one exists.
//
// WHY THE GOLDEN IS COMMITTED AND NOT COMPILED ON DEMAND
//
// ADR 0053 clause 6 wants a corpus that is "complete on every runner". The reference
// compiler is not on every runner — that is the entire reason the ADR exists. So the
// oracle's ANSWER travels with the repo, and the binary is only needed to re-derive
// it. `scripts/check-blueprint-corpus.mjs` runs in two stages for exactly that
// reason, and names which of the two ran.
//
// A committed answer nothing ever recomputes is folklore. Stage B recomputes all of
// it wherever the compiler is present — which includes `tree-checks`, the one CI job
// whose image bakes `blueprint-compiler` and which carries no classifier gate, so a
// docs-only PR runs it too.
//
// WHAT THE GOLDENS PROVED, MOST OF IT BEFORE ANY PARSER EXISTED
//
// The facts the plan did not have, each reproducible from a `.ui` file in here and each
// written up once, in this package's README: emission needs introspection and not only a
// parse; `@girs` supplies it, in two releases rather than one; a member is spelled with
// underscores where the nick has hyphens; a flag set is not numbered and a lone flag is;
// values are normalised rather than copied through; neither `layout { }` nor
// `accessibility { }` resolves through the widget; an `accessibility { }` block is three
// kinds of element and not one; and a GType name is not namespace plus name. They are in the
// README and not here because they are findings about the corpus rather than facts about
// this table, and a second copy of them beside the data is what would drift.
//
// WHAT THE FOURTEEN REAL FILES DO NOT REACH
//
// They are a probe against reality, not a measure of breadth, and citing "fourteen real
// files" as coverage would be wrong twice over. What they still reach is `binding`,
// `breakpoint`, `comment` and `signal`. The first three were six kinds until ADR 0066 gave
// `template` and `object-id` a field each, ADR 0067 the `_()` marking and ADR 0068 the style
// classes — which is also why most of the fourteen now project with NO loss at all, where
// before those changes not one of them did, and why what is left on the three that do (the
// binding/breakpoint pair) is a GRAMMAR rather than a construct. `signal` is a different
// story: no real file reached it until the storybook's own chrome (`packages/framework/
// storybook/src/window.ts`) moved into a `.blp`, so it is the first real file this corpus has
// ever held to a whole missing CONSTRUCT rather than a grammar detail. Every other kind
// (`menu`, `styles`-as-an-ident, `layout`, `accessibility`, `value-list`, `sibling-object`,
// `responses`, `extern`, the six bracketed lists, `internal-child`, `action-widget`,
// `inline-template`, `translation-domain`) is declared by no real expectation and is held
// only by the rules above — the half of the corpus written by whoever writes the parser.
// (`comment` is the one to read carefully: five of them DO carry comments, and the
// convention in `expectations.mjs` is that comments are never listed per entry.) And
// fourteen files are about nine distinct SHAPES: the three `templates/adw-*/src/main-window.blp`
// differ in one title string, and fireworks and pixel differ only in the template class
// name, the window title, a group title, four row titles and five object ids.
//
// WHAT THE REFUSED FILES ARE FOR
//
// ADR 0053 clause 3 is a property — "outside the documented subset is a hard error naming its
// line, never wrong output" — and the rule files cannot measure it: a golden exists only for a
// file the parser accepts. `refused/` holds one small file per construct the subset does NOT
// hold, and stage E of the harness holds the in-repo pipeline to refusing each by name and by
// line. Which of them the oracle compiles is recorded too, so the table says what is a limit of
// the subset and what is an error the two compilers share. `Gio.ListStore` is why: the parser
// accepted the `using`, the emitter wrote `GioListStore`, and nothing anywhere said no. The
// projection is asked too, and what it does is recorded per file: it is the second exit from the
// same AST, and it spelled `GioListStore` exactly as the emitter did.
//
// WHY THE REAL FILES ARE REFERENCED AND NOT COPIED
//
// The fourteen `.blp` files this repo already builds are the reality probe ADR 0053
// clause 6 asks for. They are listed here BY PATH and read from where they live: a
// copy would be a second transcript that drifts from the file the build actually
// compiles, and the drift would be invisible precisely because the copy would keep
// passing.

/** The reference implementation whose answers the `.ui` files hold. */
export const ORACLE = {
    tool: 'blueprint-compiler',
    // Fedora 44 ships this, and the `ci-fedora:44` image installs it unpinned from
    // the same repository, so CI and this workstation agree today. They can stop
    // agreeing at any image rebuild — and per ADR 0053 clause 5 that is not a
    // nuisance, it IS the upgrade notice: stage B fails naming the two versions.
    version: '0.20.4',
    recordedOn: '2026-09-11',
};

/**
 * @typedef {Object} CorpusRule
 * @property {string} file    file name under `rules/`
 * @property {string} isolates  the ONE language rule this file exists to pin down
 * @property {string} [surprise]  what the golden shows that reading the `.blp` does not
 */

/**
 * One small file per language rule. They are deliberately minimal: a rule that shares
 * a file with three others cannot fail alone, and a diff that fails for four reasons
 * names none of them.
 *
 * @type {readonly CorpusRule[]}
 */
export const CORPUS_RULES = [
    {
        file: '01-object-minimal.blp',
        isolates: 'an object with no properties and no children',
        surprise: 'the empty object is `<object …></object>`, never self-closed',
    },
    {
        file: '02-property-scalars.blp',
        isolates: 'string, int, double and bool property values — the string in either quote, and empty',
        surprise:
            'a single-quoted string and a double-quoted one are the same string, and an empty one is `<property name="name"></property>` with nothing between the tags',
    },
    {
        file: '03-property-enum.blp',
        isolates: 'an enum member as a property value',
        surprise:
            'resolved to its NUMBER against the GIR — `vertical` becomes `1`; and the member is spelled with UNDERSCORES where the GIR nick has hyphens, so `baseline_fill` is `4` and `baseline-fill` is an error',
    },
    { file: '04-children-implicit.blp', isolates: 'objects written as children, with no slot' },
    {
        file: '05-child-slot-named.blp',
        isolates: 'a named child slot, `[start]` / `[end]`',
        surprise: 'becomes `<child type="start">`, an attribute on the CHILD wrapper',
    },
    {
        file: '06-property-object-valued.blp',
        isolates: 'a property whose value is an object',
        surprise: 'becomes `<property name="content">` wrapping the object — NOT a `<child>`',
    },
    {
        file: '07-object-id.blp',
        isolates: 'an object given an id — the root, a child, and one spelled with a hyphen',
        surprise:
            'an id is an ordinary `id=` attribute in every position, hyphen included; nothing about the root is special',
    },
    {
        file: '08-template.blp',
        isolates: 'a `template $Name: Parent` root, with a property of its own',
        surprise:
            'the template class has no ParamSpecs of its own yet, so a member written on it resolves against the PARENT: `halign: center` is `3` through `Adw.Bin`',
    },
    {
        file: '09-translatable.blp',
        isolates: '`_()` and `C_()` translatable markers',
        surprise: '`C_()` emits BOTH `translatable="yes"` and `context="…"`',
    },
    {
        file: '10-styles.blp',
        isolates: 'a `styles [...]` list',
        surprise: 'becomes a `<style>` element of `<class name="…"/>`, not a property',
    },
    {
        file: '11-signal.blp',
        isolates:
            'a signal handler in six spellings — bare, `swapped`, `after`, with an object, with an object and `not-swapped`, and detailed',
        surprise:
            'the flags are PYTHON booleans: `swapped` is `swapped="True"`, `not-swapped` is `swapped="False"` rather than no attribute, and `after` is `after="True"` or absent; the detail folds back into `name="notify::sensitive"`; and the attribute order is name, handler, swapped, after, object whatever the source wrote',
    },
    {
        file: '12-menu.blp',
        isolates: 'a top-level `menu` and a reference to it',
        surprise: 'the menu is a SIBLING of the object, and the reference is a plain string',
    },
    {
        file: '13-binding.blp',
        isolates: 'a property bound to a property of another object',
        surprise:
            'the compiler adds `bind-flags="sync-create"` that the source never wrote — but NOT unconditionally: `no-sync-create` drops the attribute entirely, and the other flags emit `|`-joined in the compiler\'s own order, `invert-boolean|bidirectional` for a source that wrote `bidirectional inverted`. Until this file held all five forms, a parser that hardcoded `sync-create` passed this corpus and was wrong',
    },
    {
        file: '14-breakpoint.blp',
        isolates: '`Adw.Breakpoint` with `condition` and `setters` of four kinds of value',
        surprise:
            'the condition is element TEXT and each setter its own `<setter>`; an enum setter resolves against the object it TARGETS (`boxOne.orientation: vertical` is `1` although the setter sits in a breakpoint), and `_()` on a setter marks the `<setter>` element itself',
    },
    {
        file: '15-comments.blp',
        isolates: 'line and block comments in every position the grammar admits',
        surprise:
            'none reaches the XML — including the three positions an earlier version of this file left unexercised (after a `[slot]` bracket, between a property `:` and its value, and inside a list literal) and one before the `using` directive',
    },
    {
        file: '16-string-escapes.blp',
        isolates: 'escapes inside a string literal, in both quotes',
        surprise:
            '`&`, `<` and `>` are XML-escaped, `"` is not, `\\n` and `\\t` become a REAL newline and tab, a backslash before a line break is a newline too, and a single-quoted string decodes the same way',
    },
    {
        file: '17-numeric-forms.blp',
        isolates:
            'integer, negative, fractional, hex, signed hex, underscored, signed, very large and very small numbers',
        surprise:
            "`1.0` is normalised to `1` and `100.0` to `100` while `0.25` and `0.5` are not; `0x10` is `16` and `-0x10` is `-16`, `1_000` is `1000`, `+5` is `5`, `.75` is `0.75` and `-0.0` is `0`; `0.00005` is `5e-05` in Python's notation and not JavaScript's; and `12345678901234567` keeps every digit, because the oracle reads an integer through Python's `int`",
    },
    {
        file: '18-multiple-imports.blp',
        isolates: 'two `using` imports, both used',
        surprise:
            'only ONE of the two reaches the XML: `<requires lib="gtk" version="4.0"/>` and nothing for `Adw`. Every golden carries exactly that one line, the seventeen files with `using Adw 1;` included',
    },
    {
        file: '19-layout.blp',
        isolates: 'a `layout { }` block of layout-child properties',
        surprise:
            'an entry is NOT resolved through the widget — `halign: center` stays `center` where the same line on the widget itself is `3`, because a layout entry belongs to the layout CHILD (`GtkGridLayoutChild`), which has no `halign` and which the compiler does not check it against either',
    },
    {
        file: '20-accessibility.blp',
        isolates:
            'an `accessibility { }` block holding every kind of ARIA element, every kind of ARIA VALUE the table can type, a translatable entry and a list-valued relation',
        surprise:
            "the block is not a list of `<property>` elements and not a list of source spellings either: a relation emits `<relation>` and a state `<state>`, and both the element and the VALUE come from GTK's ARIA table and not from the widget — `orientation: vertical` is `1` on a `GtkButton`, which is not orientable at all. The three `<state>` lines are the ones to read: `checked: true` is `1` because that slot is a `GtkAccessibleTristate`, `hidden: true` — spelled identically, one line below — stays `true` because that one is a boolean, and `pressed: mixed` is `2` — the tristate's third member, and the one identifier on a state where the other two carry booleans. And `labelled-by: [labelA, labelB]` is TWO `<relation>` elements of the same name, never one holding a list",
    },
    {
        file: '21-value-array.blp',
        isolates: 'a bracketed list in both spellings — the `strings [ … ]` extension and a `css-classes: [ … ]` value',
        surprise:
            'the extension becomes `<items><item>…</item></items>` and `_()` marks an `<item>` the way it marks a property; the VALUE becomes one `<property>` whose text is the items joined by a NEWLINE, which is what GtkBuilder splits a string array on — the `:` is the whole difference in the source',
    },
    {
        file: '22-menu-nested.blp',
        isolates: 'a `submenu` and the `item (…)` shorthand in its one-, two- and three-argument forms',
        surprise:
            'translatability follows `_()` and NOT the form — the shorthand takes `_()` and `C_()` too, and an unmarked `label:` line stays untranslatable; the third argument is `icon`, and the second is as optional as it',
    },
    {
        file: '24-unqualified-type.blp',
        isolates: 'a type name written without its namespace — as the root, as a property value and as a child',
        surprise:
            'an unqualified name resolves against Gtk ALONE — measured on 0.20.4, `using Adw 1;` does not make a bare `Bin` legal ("Namespace Gtk does not contain a type called Bin"), and every file must start with `using Gtk`; and the bare name behaves as `Gtk.<Name>` in every position, with an id and with an enum that resolves through it',
    },
    {
        file: '25-bracket-breakpoint.blp',
        isolates: 'a `[breakpoint]` bracket, where a slot and a refused construct meet',
        surprise: 'the bracket is an ordinary `<child type="breakpoint">`; nothing about it is special',
    },
    {
        file: '26-one-line-members.blp',
        isolates: 'two body members sharing one source line — in an object body three times, and once inside a menu',
        surprise:
            'the oracle keeps SOURCE order everywhere: the child, the signal and the style block each precede the property beside them, and inside the menu the item precedes the attribute — an order `line` alone cannot recover, and the menu half is the one the emitter got wrong until this file held it',
    },
    {
        file: '23-widget-reference-list.blp',
        isolates: 'a second top-level object holding a list of widget REFERENCES',
        surprise: 'the references are `<widget name="…"/>`, so the ids they point at are load-bearing',
    },
    {
        file: '27-property-flags.blp',
        isolates: 'a flag set as a property value beside an enum on one object, and a lone flag member on another',
        surprise:
            'a flag SET is NOT numbered — the nicks survive, hyphenated and joined by `|` with no spaces — while the enum beside it is, and so is a LONE flag member: `lowercase` on its own is `8`, because the oracle reads a single identifier as a literal and only a `|`-joined set as flags. The resolver returned the nick for both until this file held the second entry',
    },
    {
        file: '28-property-enum-foreign.blp',
        isolates:
            "an enum declared by a namespace other than the property's owner — Adw's own, and Pango's through `Gtk.Label`",
        surprise:
            'the Gtk vocabulary carries the enums Gtk properties are typed with even where Pango declares them, so `ellipsize: end` is `3` with no `using Pango` anywhere; and an Adw enum resolves through the Adw table the same way',
    },
    {
        file: '29-enum-non-widget.blp',
        isolates: 'an enum on an object that is not a widget',
        surprise:
            'the oracle numbers it like any other (`mode: horizontal` is `1`) and the in-repo resolver cannot: `PROP_ENUMS` in the `@girs` vocabulary is keyed by WIDGET types, so a `GtkSizeGroup` property had no join to its enum until `@girs` 5.2.0 — the last entry `corpus/divergences.mjs` ever held',
    },
    {
        file: '30-template-self-reference.blp',
        isolates:
            'the template addressed as `template` — as a property value, a binding source, a signal object and a setter target',
        surprise:
            "all four are rewritten to the template's CLASS NAME (`CorpusSelf`), the plain property value `mnemonic-widget: template` included; nothing is special about the position",
    },
    {
        file: '31-responses.blp',
        isolates: 'a `responses [ … ]` block on an `Adw.AlertDialog`',
        surprise:
            'each response is `<response id="…">` with the translatable attributes after the id; the flags `suggested` / `destructive` / `disabled` would add `appearance` and `enabled="false"`, and the parser refuses them by name, so the subset holds the form without them',
    },
    {
        file: '32-extern-nested.blp',
        isolates:
            'an extern type `$Name` as a nested object — as a `[top]` child, as a property value, with an id, holding a real child, and once with a dotted namespace',
        surprise:
            'the sigil is the whole syntax and the GType name is what is left of it — `$Ns.Inner` is `NsInner`, a CONCATENATION and not a C prefix, because there is no namespace behind an extern type to have one',
    },
    {
        file: '33-extern-unresolved.blp',
        isolates:
            'that nothing inside an extern object is resolved against the vocabulary, on both call sites — an object body and a `setters { }` target',
        surprise:
            '`$GtkBox { orientation: vertical; }` emits `vertical` and `Gtk.Box { orientation: vertical; }` emits `1`, in the same file and under the same `class="GtkBox"`: the emitted NAME is identical and the bytes are not, so extern-ness has to travel with the type and cannot be read back off the GType name',
    },
    {
        file: '34-extern-template-parent.blp',
        isolates: 'an extern type as a template PARENT, `template $Child: $Base`',
        surprise:
            'neither name is touched — `class="CorpusExternChild" parent="CorpusExternBase"` — and the body resolves against nothing, so the parent is the second place in one file that can lose the vocabulary',
    },
    {
        file: '35-extern-real-class.blp',
        isolates:
            'an extern type whose GType name is a REAL class — `GListStore`, whose namespace this resolver had no vocabulary for when this file was written, and has loaded since the `@girs` 5.3.0 bump',
        surprise:
            'the extern spelling reaches it and GtkBuilder resolves the result, so the vocabulary gate is a gate on the DOTTED form only — and it is still not a hole in that gate, because concatenation cannot produce `GListStore` from `$Gio.ListStore` (that is `GioListStore`): the C name has to be written out, which is exactly the assertion the sigil exists to make',
    },
    {
        file: '36-setter-null.blp',
        isolates:
            'the null LITERAL as a `setters { }` value — an identifier spelled `null` in the one position where nothing answers to the name, so nothing can resolve it',
        surprise:
            "it emits `<setter …></setter>` with an EMPTY body, which GtkBuilder reads as \"unset\" — and it is NOT the absence of a value for any property you like. Measured on 0.20.4: a string (`label`), an int (`width-request`), a double and an object-typed property come out empty, an enum one is `null is not a member of Gtk.Align` (`refused/setter-null-enum.blp`) and a flags one the same. A BOOLEAN one is refused too — `Expected 'true' or 'false' for boolean value` — and that half this emitter cannot detect: telling it apart needs the ParamSpec TYPE of every property, where `resolve-ident.mjs` carries enum and flags types only. So `labelOne.visible: null;` is accepted here and refused by the oracle, a divergence recorded in `status/open-todos.md` rather than guessed at. Before this rule existed the emitter wrote the four characters `null` into the body of a live `<setter>` in a wild file, with every stage of this corpus green.",
    },
    {
        file: '37-layout-untyped-ident.blp',
        isolates:
            'an identifier as a `layout { }` value, where the emitter has neither an owner type nor a ParamSpec to ask about it',
        surprise:
            'the spelling passes straight through — `<property name="column">null</property>`, with no object anywhere called `null` — and that is the oracle\'s own answer, not a shortfall of this subset: a layout property belongs to the layout CHILD and is resolved by the layout manager at build time, so nothing type-checks it here. This file exists because the reference check on `identText` is the kind of rule that grows over a position it was never measured against: an earlier cut of that check refused this file, and nothing in the corpus noticed. `row: start` is beside `column: null` so the pass-through is pinned as a rule about the POSITION and not about one spelling.',
    },
    {
        file: '38-null-object-id.blp',
        isolates:
            'the identifier `null` where the file DOES declare an object by that name, in the two positions that resolve one: an object-typed property and a `widgets [ ]` item',
        surprise:
            'there is nothing special about it. `null` is not a keyword in this grammar — `menu null { }` declares an id (the oracle warns `null may be a confusing object ID` and compiles), `menu-model: null` then points at it, and `bind null.label` binds to it. The literal in `36-setter-null.blp` is only what is LEFT when no object claims the name, which is why `isNullLiteral` in `emit-xml.mjs` asks the file and not the spelling. Stated the other way: the identifier wins over the literal, and it wins inside a `setters { }` block too — `labelOne.label: null;` with this `null` declared is `Cannot assign Gtk.Label to string`, a TYPE error, so the id resolved.',
    },
    {
        file: '39-namespace-vocabulary.blp',
        isolates:
            'a type from a namespace beyond the two the corpus was written against — `GtkSource.View` holding a `GtkSource.Buffer`, and a `WebKit.WebView` beside it',
        surprise:
            'the `using GtkSource 5;` and `using WebKit 6.0;` lines leave NO trace in the output — `<requires>` names gtk alone whatever else a file imports (`18-multiple-imports.ui` said so for Adw, and a third and fourth namespace do not change it), so the class name is the only evidence a namespace was resolved at all. Which is why refusing an unknown namespace matters more than it looks: what it replaces is an `<object class="…">` that is one word wrong and reads perfectly. The GType name is the namespace\'s C identifier prefix plus the type name, and for these three the prefix equals the namespace name — the cases that tell the two rules apart are `Gio.ListStore` (`GListStore`, prefix `G`), loaded since the `@girs` 5.3.0 bump, and `GdkPixbuf.Pixbuf` (`GdkPixbuf`, prefix `Gdk`), which is not and sits in `refused/namespace-without-vocabulary.blp`',
    },
    {
        file: '40-namespace-vocabulary-enum.blp',
        isolates: 'an enum property DECLARED by one of those namespaces rather than by Gtk',
        surprise:
            "`smart-home-end: after` is `2` and `background-pattern: grid` is `1`, and neither number is in Gtk's tables: the property-to-enum join is keyed by the type that DECLARES the property, so this one is answered entirely inside GtkSource's own `PROP_ENUMS` and `ENUM_VALUES`. `28-property-enum-foreign.blp` pins the opposite direction — an enum PANGO declares, reached through a Gtk property, with no `using Pango` anywhere — and the two together say the join follows the declaring type in both directions and the `using` list in neither",
    },
    {
        file: '41-template-parent-abstract.blp',
        isolates: 'an ABSTRACT class as a template parent, `template $Name: Gtk.Widget`',
        surprise:
            "the oracle compiles it — `parent=\"GtkWidget\"` — and refuses the same class one line over as an object (`Gtk.Widget can't be instantiated because it's abstract`, `refused/abstract-instantiation.blp`). So a type reference is TWO questions and not one, and the `@girs` table that answers the first answers the second wrong by construction: `DECLS` holds instantiable GTypes, which leaves out all 17 of Gtk's abstract classes and both of Adw's. This file exists because a check written for the object position was applied to both and refused 19 legal parents, and neither the wild corpus (no file there subclasses an abstract class) nor the reference implementation's `tests/samples` (its abstract-class case lives in `sample_errors/`, which is measured nowhere here) could see it",
    },
    {
        file: '42-expression-binding-shape.blp',
        isolates: 'the SAME lookup written seven ways, so the shape a `bind` emits is pinned rather than assumed',
        surprise:
            "a `bind` collapses into `bind-source`/`bind-property` attributes for a lookup on a BARE identifier, and for one under EXACTLY ONE cast — `bind labelOne.label as <string> bidirectional` is a self-closing `<property>`, and `bind labelOne.label as <string> as <string>` is a `<binding>` element with a `<lookup>` inside it. A parenthesis anywhere turns it into the element form too, so `bind (labelOne.label)` and `bind labelOne.label` are two different outputs from the same lookup, and the oracle refuses flags on everything but the collapsed form (`Only bindings with a single lookup can have flags`). Both halves are the same predicate, which is how they are known to be a single condition rather than a pair. The last two rows are the sharpest: a cast BETWEEN the identifier and the dot (`labelOne as <Gtk.Widget>.name`) puts the id in a nested `<constant>` where the bare form puts it in the lookup's text",
    },
    {
        file: '43-expression-lookup.blp',
        isolates: 'a lookup CHAIN, on a declared id, on `template`, and on an extern-typed object',
        surprise:
            "`<lookup name=… type=…>` names the type the property is read ON and never the type it has, so a chain reads inside-out: `labelOne.parent as <Gtk.Overlay>.child as <Gtk.Label>.label` is three nested `<lookup>` elements whose types are `GtkLabel`, `GtkOverlay`, `GtkLabel` — the declared class first, then each cast. `template` answers with the TEMPLATE's class, not its parent's, in the `type` and in the text alike. An extern-typed object answers with its own sigil-free name (`CorpusLookupTarget`), which is why `EmitContext` keeps a second id index: `idTypes` is `null` for an extern object, and this position needs the NAME",
    },
    {
        file: '44-expression-closure.blp',
        isolates: 'a closure call and every kind of argument one can take',
        surprise:
            'an argument is the expression grammar again, not a literal grammar: a nested closure, a lookup, a translated string and a `typeof<>` are all legal there. Three of them emit shapes nothing else in the corpus has — an object id becomes `<constant>labelOne</constant>` with NO type attribute, `null` becomes a self-closing `<constant initial="True"/>` whose `type` appears only where a cast supplied one, and a cast on an object-id argument is DROPPED (`labelOne as <Gtk.Widget>` is still `<constant>labelOne</constant>`). The closure\'s own `type` is the cast and nothing else, which is why `refused/expression-closure-untyped.blp` exists',
    },
    {
        file: '45-expression-property.blp',
        isolates: 'the `expr` keyword, and the `item` it exists for',
        surprise:
            '`expr` and `bind` are one grammar with two exits — `expr` writes the expression INTO a `<property>` and `bind` into a `<binding>`, and `expression: bind filterOne.expression` still collapses to `bind-source` like any other single lookup. `item` emits NOTHING: it is the implicit subject, so `expr item as <Gtk.Entry>.visible` is `<lookup name="visible" type="GtkEntry"></lookup>` with an empty body, and the parenthesised spelling of the same thing is byte-identical. That emptiness is why `item` needs a check of its own rather than a branch in the emitter — see `refused/expression-item-in-bind.blp`',
    },
    {
        file: '46-expression-cast-builtins.blp',
        isolates:
            "every one of Blueprint's twelve built-in type keywords, plus a GIR type, an unqualified one and an extern one",
        surprise:
            '`double` is `gfloat`. Not a typo and not an approximation — 0.20.4 writes `<closure … type="gfloat">` for `as <double>`, exactly as it does for `as <float>` — which is the single measurement that decides `src/builtin-types.mjs` may be hand-written under ADR 0053 clause 6: a table DERIVED from GObject\'s fundamentals would have said `gdouble` and been wrong here. The last three rows pin the other half: a cast on a LITERAL never changes the emitted type, so `5 as <uint>` is still `<constant type="gint">5</constant>` and `1.0 as <double>` is `<constant type="gfloat">1</constant>` — the cast is a validity question there and nothing else',
    },
    {
        file: '47-expression-typeof.blp',
        isolates: 'a `typeof<Type>` in the two positions the language gives it',
        surprise:
            'the same syntax emits two different things. As a property VALUE it is bare text — `<property name="enum-type">GtkOrientation</property>` — and inside an expression it is `<constant type="GType">GtkLabel</constant>`. So `typeof` is a `Value` AND an `Expression` in `ast.d.mts`, two nodes rather than one used twice. `Gtk.Orientation` also shows that a type REFERENCE is not a class reference: an enum resolves here, in the same position an abstract class resolves in `41-template-parent-abstract.blp`',
    },
    {
        file: '48-expression-try.blp',
        isolates: 'a `try { … }` and its trailing comma',
        surprise:
            "the arms are ordinary expressions and the element is a plain `<try>` with no attributes, but the arms do NOT inherit a type from anywhere: each closure among them needs its own cast. That is why the reference implementation's own `expr_try.blp` is still refused here — its first closure has none, and the type the oracle infers for it comes from the property's GType",
    },
    {
        file: '49-namespace-core-vocabulary.blp',
        isolates:
            'the three namespaces that were refused BY NAME until the `@girs` 5.3.0 bump — `Gdk.Cursor`, `Gio.ListStore` and `GObject.Object`, each legal in a `.blp` and each written by a file the reference implementation compiles',
        surprise:
            'two of the three GType names are not the namespace plus the type, and the one file that used to hold this shape had to hold it as a REFUSAL. `Gio.ListStore` is `GListStore` and `GObject.Object` is `GObject`, because the C identifier prefix of both namespaces is `G` — concatenating writes `GioListStore` and `GObjectObject`, classes GtkBuilder resolves to nothing, with no error anywhere. `Gdk.Cursor` is the third one and the only one where concatenation happens to be right, which is exactly why it is here beside the other two rather than standing for them. What made the file writable is not this package: ts-for-gir #476 stopped gating the `./vocabulary` subpath on "declares a concrete GtkWidget descendant", so these three publish one and `src/resolve-ident.mjs` loads them. The prefix is read from `PROVENANCE.identifierPrefixes` and derived from nothing',
    },
    {
        file: '50-template-orphan.blp',
        isolates:
            "a `template $Name { }` with NO parent — the branch of the oracle grammar where `( ':' TypeName )?` is absent",
        surprise:
            '`visible: true` stays the string `true` here, where `08-template.blp` turns `halign: center` into `3`. Both are the same emitter taking the same path; what differs is that a parentless template has no parent to own the property, so there is no vocabulary to resolve a value through and the source spelling is all there is. The oracle agrees by construction rather than by choice — a parentless template is an `ExternType`, which it marks `incomplete`, so it validates no property or signal name written inside either. The `parent` attribute is OMITTED and not defaulted: `class="CorpusOrphan"` stands alone, because the oracle passes `parent=None` and its writer drops null-valued attributes',
    },
    {
        file: '51-inline-template.blp',
        isolates:
            'the `template Type { … }` block of a `Gtk.BuilderListItemFactory` — a SECOND, complete GtkBuilder document embedded in the first',
        surprise:
            'the sub-document is not nested XML, it is TEXT: its own `<?xml?>` declaration, its own `<interface>`, indentation restarting at column 0, CDATA-escaped into `<property name="bytes">` — and no `<requires>`, which every other document in this corpus carries. It also has its OWN ID SCOPE, which is why `corpusLabel` is declared twice in one file and neither is a duplicate: the two documents may not reference each other at all, so `indexBody` never descends into the block and the outer index cannot see inside. The block is NESTED here on purpose — a sub-document inside a sub-document writes `]]>` into the outer CDATA, and the only escape a CDATA section has is to split across two, so `]]]]><![CDATA[>` is in the golden and that branch of the writer is held by a file rather than by an argument',
    },
    {
        file: '52-response-flags.blp',
        isolates: 'the three flags a `responses [ ]` entry may carry — `destructive`, `suggested` and `disabled`',
        surprise:
            'the emitted order is FIXED and is not the source order: `save: … suggested disabled` writes `enabled="false"` BEFORE `appearance="suggested"`, and so would `disabled suggested` — one XML for two spellings. An absent flag omits its attribute rather than writing a default, so there is no `enabled="true"` anywhere and `plain` carries neither. `destructive` and `suggested` are mutually exclusive and the parser says so on the SECOND one, because two appearances are a contradiction in the file and the reader needs the line of the one that broke it',
    },
    {
        file: '53-extension-lists.blp',
        isolates:
            'all six bracketed extension lists in one file — `marks`, `mime-types`, `patterns`, `suffixes`, `items`, `offsets`',
        surprise:
            'six names, ONE construct, and four payloads: a bare string (`mime-types`, `patterns`, `suffixes`), a string with an optional `id:` prefix (`items`), a `mark (value[, position[, label]])` triple and an `offset ("name", value)` pair. The oracle\'s own file-filter trio is already one implementation parameterised by wrapper tag and child tag, and that same parameterisation carries all six. What is NOT shared: `offset` is the one self-closing child, `mark` is never self-closing even with no label (`<mark value="2"></mark>`), and only `marks` and `items` may be translated — a MIME type and a CSS class name are `UseQuoted` in the grammar, so `_("text/plain")` is refused rather than emitted with an attribute GtkBuilder ignores',
    },
    {
        file: '54-internal-child-menu-domain.blp',
        isolates:
            'three constructs that share only their position in the file — `translation-domain`, an `[internal-child …]` bracket, and a `menu { }` written as a property value',
        surprise:
            'each one goes somewhere the construct beside it does not. The domain becomes an ATTRIBUTE on `<interface>` and reaches nothing else. `[internal-child content_area]` becomes `<child internal-child="…">`, a different attribute from the `<child type="…">` every other bracket writes — the oracle\'s grammar is one `AnyOf`, so the two can never both appear on one child. And an inline menu emits `<menu id="…">` inside the `<property>`, NOT an `<object class="GMenu">`, which is why it is a value kind of its own and not an object-valued property',
    },
    {
        file: '55-template-type-name.blp',
        isolates: 'a `template` named by a TYPE rather than by a `$`-sigil name',
        surprise:
            '`template ListItem` is not the pre-0.8.0 legacy spelling and raises no upgrade warning anywhere: `ListItem` is a real Gtk type, so the oracle resolves it like any type reference and the class attribute is its GTYPE — `class="GtkListItem"`, not the spelling. That is the whole difference from the sigil form, where the name is the class being DEFINED and reaches the XML verbatim. It follows into the projection: the root tag is `GtkListItem` and there is NO `extern` loss, because the type is a real one — where `template $TestTemplate { }` has both. The binding through `template` is in the file because the class name is read TWICE, once for the tag and once for every identifier inside it, and reading the spelling in the second place while the GType is written in the first is what made this exact shape silently different',
    },
    {
        file: '56-action-widgets-menu-ids.blp',
        isolates:
            'the `[action response=…]` annotation and the id a `section` or `submenu` may carry — the two constructs that reach somewhere other than the element they are written on',
        surprise:
            'an action widget is the only annotation whose content is emitted somewhere ELSE: the child gets `type="action"` and the response goes into an `<action-widgets>` block the PARENT writes after all its children, in source order and whatever order the children came in. The widget is named by the element\'s TEXT, not an attribute, so a child without an id cannot be written at all — the oracle refuses it and so does this. `default` is `default="True"`, capital T, because the oracle writes a Python bool straight out. The menu ids are here for a different reason: they are REFERENCE TARGETS, so accepting them without indexing them would have turned `menu-model: namedSub` into a refusal on a file the oracle compiles — the obligation `indexObjectIds` wrote down for whoever lifted the limit',
    },
];

/**
 * @typedef {Object} CorpusRefusal
 * @property {string} file       file name under `refused/`
 * @property {string} construct  the ONE construct outside the subset this file reaches
 * @property {'compiles'|'refuses'} oracle  what `blueprint-compiler` does with the same file:
 *                               `compiles` marks a limit of the subset, `refuses` an error both share
 * @property {'refuses'|'projects'} projection  what the SECOND exit, `src/project.mjs`, does with
 *                               the same file: `refuses` is a thrown error naming the same line — the
 *                               parser refused it, or the tag seam did; `projects` is a tree, because
 *                               the construct sits inside a loss the projection declares or is a VALUE
 *                               it keeps as spelled. ADR 0053 clause 4 leaves value validation to the
 *                               compiler; a tag is the one thing this exit must spell right
 * @property {number} line       the line the in-repo error must name
 * @property {string} names      text the in-repo error must contain, so the refusal is by NAME
 */

/**
 * One small file per construct the subset refuses. Each is a hard error today; the ones the
 * oracle compiles are the next units of work under ADR 0053 clause 5.
 *
 * @type {readonly CorpusRefusal[]}
 */
export const CORPUS_REFUSALS = [
    {
        // `Gio.ListStore` was this file until the `@girs` 5.3.0 bump, and what replaced it is not
        // a weaker case but a sharper one. ts-for-gir #476 stopped gating the `./vocabulary`
        // subpath on "declares a concrete GtkWidget descendant", so the namespaces that used to
        // have none — Gdk, Gio, GObject — publish one and this resolver loads them. What is left
        // is the finite thing it always really was: the set of packages `package.json` depends on.
        // `GdkPixbuf` is the sharpest member of it, because its C prefix is `Gdk` and its class is
        // `Pixbuf`, so the oracle writes `<object class="GdkPixbuf">` where concatenating the
        // namespace onto the name writes `GdkPixbufPixbuf` — a class GtkBuilder resolves to
        // nothing, with no error anywhere. That is exactly the output clause 3 refuses to guess.
        file: 'namespace-without-vocabulary.blp',
        construct: 'a type from a namespace the resolver has no vocabulary for (`GdkPixbuf.Pixbuf`)',
        oracle: 'compiles',
        projection: 'refuses',
        line: 4,
        names: 'no vocabulary for',
    },
    {
        // The other half of the namespace question, and the half the oracle answers the same way.
        // `39-namespace-vocabulary.blp` says a namespace with a vocabulary resolves; this says a
        // NAME that vocabulary does not declare is an error and not a class name to guess at. Both
        // compilers refuse it, for once for the same reason: the oracle answers `Namespace Gtk does
        // not contain a type called NotAWidget` with a `Did you mean Widget?` hint.
        file: 'unknown-type-name.blp',
        construct: 'a type name the namespace does not declare (`Gtk.NotAWidget`)',
        oracle: 'refuses',
        projection: 'refuses',
        line: 3,
        names: 'declares no instantiable type called',
    },
    {
        // The same check, on a name that DOES exist. It is here rather than beside the rule files
        // because the oracle refuses it too, and it is the other half of
        // `rules/41-template-parent-abstract.blp`: one file per position, so applying the object
        // position's check to a template parent — which refused 19 legal files — fails a stage.
        file: 'abstract-instantiation.blp',
        construct: 'an abstract class instantiated as an object (`Gtk.Widget { }`)',
        oracle: 'refuses',
        projection: 'refuses',
        line: 3,
        names: 'declares no instantiable type called',
    },
    {
        file: 'closure-value.blp',
        construct: 'a closure as a plain property value, `label: $format("a")`',
        oracle: 'refuses',
        projection: 'refuses',
        line: 4,
        names: 'closure',
    },
    {
        // The one expression shape `rules/42`–`47` do NOT close, and its reason has an owner
        // outside this repository. `<lookup name="name" type="GtkWidget">` for `a.parent.name`
        // is the oracle reading `GtkLabel.parent`'s TYPE out of the typelib; `@girs`'s
        // vocabulary has no property-to-GType table, so the middle type cannot be derived and
        // ADR 0053 clause 6 forbids writing one by hand. Cast it —
        // `a.parent as <Widget>.name` — and `rules/43-expression-lookup.blp` line 13 is that
        // same shape, compiled.
        file: 'binding-lookup-chain.blp',
        construct: 'a lookup chain with no cast to name the middle type, `bind a.b.c`',
        oracle: 'compiles',
        projection: 'projects',
        line: 8,
        names: 'multi-step lookup',
    },
    {
        file: 'unknown-enum-member.blp',
        construct: 'a member the enum does not have, `orientation: diagonal`',
        oracle: 'refuses',
        projection: 'projects',
        line: 4,
        names: 'not a member of GtkOrientation',
    },
    {
        file: 'flags-on-enum.blp',
        construct: 'a `|`-joined set on an enum property, `orientation: vertical | horizontal`',
        oracle: 'refuses',
        projection: 'projects',
        line: 4,
        names: 'is not a flags type',
    },
    {
        file: 'unknown-accessibility-name.blp',
        construct: 'an `accessibility { }` name that is none of the three ARIA kinds',
        oracle: 'refuses',
        projection: 'projects',
        line: 5,
        names: 'not an accessibility property',
    },
    {
        file: 'unknown-accessibility-member.blp',
        construct: "a member the ARIA slot's enum does not have, `orientation: sideways`",
        oracle: 'refuses',
        projection: 'projects',
        line: 5,
        names: 'not a member of GtkOrientation',
    },
    {
        file: 'styles-with-semicolon.blp',
        construct: 'a `;` after `styles [ … ]`',
        oracle: 'refuses',
        projection: 'refuses',
        line: 4,
        names: 'takes no `;`',
    },
    {
        file: 'bad-escape.blp',
        construct: 'an escape outside the closed set, `\\q`',
        oracle: 'refuses',
        projection: 'refuses',
        line: 4,
        names: 'invalid escape sequence',
    },
    {
        file: 'bad-hex-digit.blp',
        construct: 'a hex literal with a digit outside its base, `0xZZ`',
        oracle: 'refuses',
        projection: 'refuses',
        line: 4,
        names: 'not a valid number literal',
    },
    {
        file: 'adw-before-gtk.blp',
        construct: 'a file whose first directive is not `using Gtk`',
        oracle: 'refuses',
        projection: 'refuses',
        line: 1,
        names: 'expected `using Gtk`',
    },
    {
        file: 'null-value.blp',
        construct:
            'the identifier `null` as a plain property value, `label: null;`, where the file declares no object by that name',
        oracle: 'refuses',
        // The projection reads the value as the identifier it is and keeps the SPELLING, the
        // same way it keeps an enum member — so it projects a `GtkLabel` whose `label` is the
        // four characters `null`. That is this stage earning its keep rather than a hole: the
        // two exits disagree, only the XML one can tell a reference from a literal (it is the
        // one that holds `idTypes`), and clause 3 is a rule about the exit that emits.
        projection: 'projects',
        line: 4,
        names: '`null`',
    },
    {
        file: 'unresolved-reference.blp',
        construct: 'an object reference to an id the file never declares, `extra-menu: doesNotExist;`',
        oracle: 'refuses',
        projection: 'projects',
        line: 4,
        names: 'no object in this file is declared with that id',
    },
    {
        file: 'signal-object-unresolved.blp',
        construct: 'an unresolved reference as the object of a signal handler, `clicked => $onClicked(doesNotExist);`',
        oracle: 'refuses',
        projection: 'projects',
        line: 4,
        names: 'no object in this file is declared with that id',
    },
    {
        file: 'setter-null-enum.blp',
        construct: 'the null literal as a `setters { }` value on an ENUM-typed property, `labelOne.halign: null;`',
        oracle: 'refuses',
        projection: 'projects',
        line: 13,
        names: 'is not a member of GtkAlign',
    },
    {
        // The expression shape that is out of subset for the same reason `binding-lookup-chain`
        // is, one construct over: the oracle infers a closure's return type from the GType of
        // the property it is assigned to, and `@girs` ships no property-to-GType table. Eight
        // files in the reference implementation's `tests/samples` stop here and no wild file
        // does — every closure in the wild corpus writes its cast.
        file: 'expression-closure-untyped.blp',
        construct: 'a closure with no `as <Type>`, whose return type the oracle infers from the property',
        oracle: 'compiles',
        projection: 'projects',
        line: 4,
        names: 'has no `as <Type>`',
    },
    {
        // NOT a subset gap — a file both compilers refuse, and the one in this directory that
        // pins an `accepted-past-oracle`. `item` contributes no element, so an emitter that
        // simply skipped it wrote a well-formed `<binding><lookup …></lookup></binding>` for a
        // file 0.20.4 rejects outright. Nothing else in the corpus could have caught that:
        // a golden exists only for a file both compile.
        file: 'expression-item-in-bind.blp',
        construct: 'the keyword `item` inside a `bind` rather than an `expr`',
        oracle: 'refuses',
        projection: 'projects',
        line: 4,
        names: 'item',
    },
    {
        file: 'expression-try-empty.blp',
        construct: 'a `try { }` with no branches',
        oracle: 'refuses',
        projection: 'projects',
        line: 4,
        names: 'try',
    },
    {
        // `46-expression-cast-builtins.blp` pins that a cast on a literal never changes the
        // emitted type; this pins that it is still checked. The oracle answers `Cannot convert
        // string to number`, and accepting it here would emit a `<constant type="gchararray">`
        // for a file the language does not have.
        file: 'expression-cast-literal.blp',
        construct: 'a cast on a literal to a type of another kind, `bind "text" as <int>`',
        oracle: 'refuses',
        projection: 'projects',
        line: 4,
        names: 'cast',
    },
];

/**
 * @typedef {Object} CorpusRealFile
 * @property {string} slug    the name of the golden under `real/`
 * @property {string} source  repo-relative path of the `.blp` the build compiles
 */

/**
 * Every `.blp` file that is already part of a shipped build. They are the probe against
 * reality: a corpus of rules written by the same person who writes the parser proves that
 * person self-consistent and nothing else.
 *
 * The count is NOT written here. This comment said "eleven" and was stale the first time a
 * twelfth `.blp` was added, which is the same failure `check-blueprint-corpus.mjs`'s own
 * header records at "25 rules". The gate counts the list; a reader who needs the number
 * reads the list.
 *
 * @type {readonly CorpusRealFile[]}
 */
export const CORPUS_REAL_FILES = [
    {
        slug: 'showcases_dom_canvas2d-fireworks_src_gjs_fireworks-window',
        source: 'showcases/dom/canvas2d-fireworks/src/gjs/fireworks-window.blp',
    },
    {
        slug: 'showcases_dom_excalibur-jelly-jumper_src_gjs_jelly-jumper-window',
        source: 'showcases/dom/excalibur-jelly-jumper/src/gjs/jelly-jumper-window.blp',
    },
    {
        slug: 'showcases_dom_three-geometry-teapot_src_gjs_teapot-window',
        source: 'showcases/dom/three-geometry-teapot/src/gjs/teapot-window.blp',
    },
    {
        slug: 'showcases_dom_three-loader-ldraw_src_gjs_ldraw-window',
        source: 'showcases/dom/three-loader-ldraw/src/gjs/ldraw-window.blp',
    },
    {
        slug: 'showcases_dom_three-postprocessing-pixel_src_gjs_pixel-window',
        source: 'showcases/dom/three-postprocessing-pixel/src/gjs/pixel-window.blp',
    },
    {
        slug: 'showcases_gtk_adw-blueprint-layout_src_header-bar',
        source: 'showcases/gtk/adw-blueprint-layout/src/header-bar.blp',
    },
    {
        slug: 'showcases_gtk_adw-blueprint-layout_src_toolbar-view',
        source: 'showcases/gtk/adw-blueprint-layout/src/toolbar-view.blp',
    },
    {
        slug: 'showcases_gtk_effect-adw-services_src_window',
        source: 'showcases/gtk/effect-adw-services/src/window.blp',
    },
    { slug: 'templates_adw-canvas2d_src_main-window', source: 'templates/adw-canvas2d/src/main-window.blp' },
    { slug: 'templates_adw-game_src_main-window', source: 'templates/adw-game/src/main-window.blp' },
    { slug: 'templates_adw-webgl_src_main-window', source: 'templates/adw-webgl/src/main-window.blp' },
    { slug: 'templates_gtk-minimal_src_main-window', source: 'templates/gtk-minimal/src/main-window.blp' },
    {
        slug: 'packages_framework_storybook_src_window',
        source: 'packages/framework/storybook/src/window.blp',
    },
    { slug: 'website_src_blueprints_adwaita_clamp', source: 'website/src/blueprints/adwaita/clamp.blp' },
];
