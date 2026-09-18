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
// WHAT THE ELEVEN REAL FILES DO NOT REACH
//
// They are a probe against reality, not a measure of breadth, and citing "eleven real
// files" as coverage would be wrong twice over. They exercise six of the fifteen loss
// kinds — `template`, `object-id`, `translatable`, `binding`, `breakpoint`, `styles`.
// The other nine (`signal`, `menu`, `layout`, `accessibility`, `comment`, `value-list`,
// `sibling-object`, `responses`, `extern`) are declared by no real expectation and are held only by the rules
// above — the half of the corpus written by whoever writes the parser. (`comment` is the
// one to read carefully: three real files DO carry comments, and the convention in
// `expectations.mjs` is that comments are never listed per entry.) And eleven files are
// about six distinct SHAPES: the three `templates/*/src/main-window.blp` differ in one
// title string, and fireworks and pixel differ only in the template class name, the
// window title, a group title, four row titles and five object ids.
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
// The eleven `.blp` files this repo already builds are the reality probe ADR 0053
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
            'the oracle numbers it like any other (`mode: horizontal` is `1`) and the in-repo resolver cannot: `PROP_ENUMS` in the `@girs` vocabulary is keyed by WIDGET types, so a `GtkSizeGroup` property has no join to its enum — the second ledger entry in `corpus/divergences.mjs`',
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
            'an extern type whose GType name is a REAL class, from a namespace this resolver has no vocabulary for — the same `GListStore` that `refused/namespace-without-vocabulary.blp` refuses one spelling above',
        surprise:
            'the extern spelling reaches it and GtkBuilder resolves the result, so the vocabulary gate is a gate on the DOTTED form only — and it is still not a hole in that gate, because concatenation cannot produce `GListStore` from `$Gio.ListStore` (that is `GioListStore`): the C name has to be written out, which is exactly the assertion the sigil exists to make',
    },
    {
        file: '36-setter-null.blp',
        isolates:
            'the keyword `null` as a `setters { }` value — the one position in the whole grammar where the oracle admits it',
        surprise:
            'it emits `<setter …></setter>` with an EMPTY body, and does so whatever the property is typed as: `label` (a string) and `width-request` (an int) both come out empty, so `null` is not a value of the property type but the absence of one. That is why it needs a member of its own in `ast.d.mts`: read as an `IdentValue` it is indistinguishable from an object id spelled `null`, and the emitter then writes the four characters `null` into the body — which is exactly what it did to a wild file, in a live property, with every stage of this corpus green. `refused/null-value.blp` holds the other half: everywhere else the oracle says "null is not permitted here".',
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
        file: 'namespace-without-vocabulary.blp',
        construct: 'a type from a namespace the resolver has no vocabulary for (`Gio.ListStore`)',
        oracle: 'compiles',
        projection: 'refuses',
        line: 6,
        names: 'no vocabulary for',
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
        file: 'binding-lookup-chain.blp',
        construct: 'a binding with more than one lookup, `bind a.b.c`',
        oracle: 'compiles',
        projection: 'refuses',
        line: 8,
        names: 'multi-step lookup',
    },
    {
        file: 'inline-menu.blp',
        construct: 'a `menu { }` written as a property value',
        oracle: 'compiles',
        projection: 'refuses',
        line: 4,
        names: 'inline `menu`',
    },
    {
        file: 'response-flags.blp',
        construct: 'a response flag, `destructive` / `suggested` / `disabled`',
        oracle: 'compiles',
        projection: 'refuses',
        line: 6,
        names: 'response flag',
    },
    {
        file: 'translation-domain.blp',
        construct: 'the file-level `translation-domain "…";`',
        oracle: 'compiles',
        projection: 'refuses',
        line: 3,
        names: 'translation-domain',
    },
    {
        file: 'internal-child.blp',
        construct: 'an `[internal-child …]` bracket',
        oracle: 'compiles',
        projection: 'refuses',
        line: 4,
        names: 'internal-child',
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
        construct: 'the keyword `null` as a plain property value, `label: null;`',
        oracle: 'refuses',
        projection: 'refuses',
        line: 4,
        names: '`null`',
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
];
