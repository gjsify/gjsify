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
// WHAT THE GOLDENS ALREADY PROVED, BEFORE ANY PARSER EXISTS
//
// Three facts the plan did not have, each reproducible from a `.ui` file in here and
// each written up once, in this package's README: emission needs introspection and not
// only a parse, `@girs` can supply what it needs once the install is not stale, and values are
// normalised rather than copied through. They are in the README and not here because
// they are findings about the corpus rather than facts about this table, and a second
// copy of them beside the data is what would drift.
//
// WHAT THE ELEVEN REAL FILES DO NOT REACH
//
// They are a probe against reality, not a measure of breadth, and citing "eleven real
// files" as coverage would be wrong twice over. They exercise six of the thirteen loss
// kinds — `template`, `object-id`, `translatable`, `binding`, `breakpoint`, `styles`.
// The other seven (`signal`, `menu`, `layout`, `accessibility`, `comment`, `value-list`,
// `sibling-object`) are declared by no real expectation and are held only by the rules
// above — the half of the corpus written by whoever writes the parser. (`comment` is the
// one to read carefully: three real files DO carry comments, and the convention in
// `expectations.mjs` is that comments are never listed per entry.) And eleven files are
// about six distinct SHAPES: the three `templates/*/src/main-window.blp` differ in one
// title string, and fireworks and pixel differ only in the template class name, the
// window title, a group title, four row titles and five object ids.
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
    recordedOn: '2026-09-10',
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
    { file: '02-property-scalars.blp', isolates: 'string, int, double and bool property values' },
    {
        file: '03-property-enum.blp',
        isolates: 'an enum member as a property value',
        surprise: 'resolved to its NUMBER via the typelib — `vertical` becomes `1`',
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
    { file: '07-object-id.blp', isolates: 'an object given an id' },
    { file: '08-template.blp', isolates: 'a `template $Name: Parent` root' },
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
    { file: '11-signal.blp', isolates: 'a signal handler, `clicked => $handler()`' },
    {
        file: '12-menu.blp',
        isolates: 'a top-level `menu` and a reference to it',
        surprise: 'the menu is a SIBLING of the object, and the reference is a plain string',
    },
    {
        file: '13-binding.blp',
        isolates: 'a property bound to a property of another object',
        surprise:
            'the compiler adds `bind-flags="sync-create"` that the source never wrote — but NOT unconditionally: measured on 0.20.4, `no-sync-create` drops the attribute entirely and other flags emit `|`-joined in the compiler\'s own order (`bind-flags="invert-boolean|bidirectional"`). No file here shows either, so a parser that hardcodes `sync-create` passes this corpus and is wrong',
    },
    {
        file: '14-breakpoint.blp',
        isolates: '`Adw.Breakpoint` with `condition` and `setters`',
        surprise: 'the condition is element TEXT and each setter its own `<setter>`',
    },
    {
        file: '15-comments.blp',
        isolates: 'line and block comments in four of the positions where they are legal',
        surprise:
            'three further positions are legal and unexercised — after a `[slot]` bracket, between a property `:` and its value, and inside a list literal; the note on this file in `expectations.mjs` names them',
    },
    {
        file: '16-string-escapes.blp',
        isolates: 'escapes inside a string literal',
        surprise: '`&` and `<` are XML-escaped, `"` is not, and `\\n` becomes a REAL newline',
    },
    {
        file: '17-numeric-forms.blp',
        isolates: 'integer, negative and fractional numbers',
        surprise: '`1.0` is normalised to `1`; `0.25` and `0.5` are not',
    },
    {
        file: '18-multiple-imports.blp',
        isolates: 'two `using` imports, both used',
        surprise:
            'only ONE of the two reaches the XML: `<requires lib="gtk" version="4.0"/>` and nothing for `Adw`. All 36 goldens carry exactly that one line, the seventeen files with `using Adw 1;` included',
    },
    { file: '19-layout.blp', isolates: 'a `layout { }` block of layout-child properties' },
    { file: '20-accessibility.blp', isolates: 'an `accessibility { }` block' },
    {
        file: '21-value-array.blp',
        isolates: 'a list-valued property, `strings [ … ]`',
        surprise: 'becomes `<items><item>…</item></items>`, a nested element and not an attribute',
    },
    {
        file: '22-menu-nested.blp',
        isolates: 'a `submenu` and the two-argument `item (label, action)` shorthand',
        surprise:
            'translatability follows `_()` and NOT the form — the shorthand takes `_()` too, and an unmarked `label:` line stays untranslatable',
    },
    {
        file: '24-unqualified-type.blp',
        isolates: 'a type name written without its namespace',
        surprise:
            'an unqualified name resolves against Gtk ALONE — measured on 0.20.4, `using Adw 1;` does not make a bare `Bin` legal ("Namespace Gtk does not contain a type called Bin"), and every file must start with `using Gtk`',
    },
    {
        file: '25-bracket-breakpoint.blp',
        isolates: 'a `[breakpoint]` bracket, where a slot and a refused construct meet',
        surprise: 'the bracket is an ordinary `<child type="breakpoint">`; nothing about it is special',
    },
    {
        file: '23-widget-reference-list.blp',
        isolates: 'a second top-level object holding a list of widget REFERENCES',
        surprise: 'the references are `<widget name="…"/>`, so the ids they point at are load-bearing',
    },
];

/**
 * @typedef {Object} CorpusRealFile
 * @property {string} slug    the name of the golden under `real/`
 * @property {string} source  repo-relative path of the `.blp` the build compiles
 */

/**
 * The eleven `.blp` files that are already part of a shipped build. They are the
 * probe against reality: a corpus of rules written by the same person who writes the
 * parser proves that person self-consistent and nothing else.
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
];
