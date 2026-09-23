// Vectors for the two case rules `@gjsify/adwaita-core/tags` exports — the spec every
// markup-based tree BUILDER is held to.
//
// WHY THIS TABLE EXISTS NOW. `hostTagOf`/`attributeOf` moved from a driver's own module to
// a published subpath (`@gjsify/adwaita-core/tags`, see that file's header) so a tree
// builder can depend on the rule without depending on `scripts/`. A published function with
// no vectors is a derivation asserted against itself the moment its only test lives beside
// it — the exact shape this whole `conformance/` directory exists to close. The regression
// that ALREADY happened here is `tags.ts`'s own docstring: the first version of
// `hostTagOf` was a naive `([a-z0-9])([A-Z])` split, and `GtkGLArea` caught it (`gtk-glarea`
// instead of `gtk-gl-area`) — a bug a table of real GIR class names would have caught before
// it shipped, not after.
//
// WHAT THE EXPECTATIONS ARE DERIVED FROM. Not from running `hostTagOf` and copying its
// output — that would pin whatever the function does today, bug included, under the name
// "conformance". Each row is derived from the RULE stated in `hostTagOf`'s own docstring
// ("the last capital of an acronym run opens the next word") applied by hand to a real GIR
// class name, then cross-checked against `packages/framework/gtk-host/src/tags.ts`'s
// `tagOf` — an INDEPENDENTLY authored implementation of the identical rule, for a different
// tier, that arm 11 of `check-generated-website-data.mjs` already holds against every tag
// `gtk-host` generates from the real `Gtk-4.0.gir`/`Adw-1.gir`. Two hand-derivations that
// agree are what "derived from the meaning, not the code" means in practice here.
//
// THE ACRONYM ROWS ARE REAL GIR CLASSES, not invented ones — `GtkGLArea`, `GtkATContext`
// and `GtkIMMulticontext` are the only three-or-more-capital-letter runs in `Gtk-4.0.gir`
// that are also followed by a lowercase word (`grep -oE '<class name="[A-Za-z0-9]+"'` over
// both GIRs; `libadwaita` has none). The digit row is the one exception: no `Adw`/`Gtk`
// class carries a digit today, so `GtkPad2Btn` is synthetic, chosen only to isolate what a
// digit does to the boundary rule — the same reason `gtk-host`'s own suite uses `MiniFooBar`
// for a case no real widget exercises yet.
//
// WHAT ATTRIBUTE_OF_VECTORS DOES NOT CLAIM. `attributeOf` has no acronym rule at all — it
// kebabs every capital on its own (`prop.replace(/[A-Z]/g, …)`), which is fine for every
// authored property name in the corpus today because none of them carries an embedded
// acronym. That is a fact about the CORPUS, not a guarantee `attributeOf` would keep for one
// that did, so this table does not assert an acronym row for it — asserting one would pin a
// behaviour (`iconURL` -> `icon-u-r-l`) nobody has decided is correct.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+ — the GIR class names below name
// GNOME's own types; the case rule applied to them is this repository's.

/** One `hostTagOf` expectation — a class that resolves, or a name it must refuse. */
export interface HostTagVector {
    /** A GIR class name, or a string that is deliberately not one. */
    gtype: string;
    /** The kebab tag `hostTagOf` must return. Absent for a row that must throw instead. */
    expected?: string;
    /** The exact `Error#message` `hostTagOf` must throw. Absent for a row that must resolve. */
    error?: string;
    rule: string;
}

/**
 * `hostTagOf` — GIR class name to kebab tag, and the refusal boundary.
 *
 * `AdwPreferencesGroup`/`AdwSwitchRow`/`GtkBox` pin the floor: one dash per word boundary,
 * no acronym involved. `GtkGLArea`/`GtkATContext`/`GtkIMMulticontext` pin THE rule the floor
 * cannot show — a run of two or more capitals closes at its LAST one, so `GL` stays one word
 * and `Area` opens a new one, rather than `g-l-area`. `GtkPad2Btn` pins what a digit does:
 * it is not an uppercase letter, so it ends a lower run exactly like a lowercase letter
 * would, and the capital after it still opens a new word.
 */
export const HOST_TAG_VECTORS: ReadonlyArray<HostTagVector> = [
    {
        gtype: 'AdwPreferencesGroup',
        expected: 'adw-preferences-group',
        rule: 'a plain PascalCase run — one dash per word boundary, no acronym involved',
    },
    {
        gtype: 'AdwSwitchRow',
        expected: 'adw-switch-row',
        rule: 'the `Adw` prefix follows the same floor rule as `Gtk`',
    },
    {
        gtype: 'GtkBox',
        expected: 'gtk-box',
        rule: 'the shortest case: prefix plus one word',
    },
    {
        gtype: 'GtkGLArea',
        expected: 'gtk-gl-area',
        rule:
            'THE ACRONYM VECTOR: the measured regression — a naive boundary split produced ' +
            '`gtk-glarea`; the last capital of an acronym run opens the next word, so `GL` ' +
            'closes before `Area` opens',
    },
    {
        gtype: 'GtkATContext',
        expected: 'gtk-at-context',
        rule: 'the same rule for a two-letter acronym immediately followed by a whole word',
    },
    {
        gtype: 'GtkIMMulticontext',
        expected: 'gtk-im-multicontext',
        rule: 'and for a three-capital run: `IM` closes before `Multicontext` opens, not `i-m-multicontext`',
    },
    {
        gtype: 'GtkPad2Btn',
        expected: 'gtk-pad2-btn',
        rule:
            'THE DIGIT VECTOR (synthetic — no real Gtk/Adw class carries a digit): a digit ' +
            'is not an uppercase letter, so it ends a lower run exactly like a lowercase ' +
            'letter would, and the capital after it still opens a new word',
    },
    {
        gtype: 'preferences-group',
        error: 'hostTagOf: preferences-group is not a GIR class name',
        rule: 'refuses an already-kebab name — `hostTagOf` only accepts the PascalCase GIR spelling',
    },
    {
        gtype: '',
        error: 'hostTagOf:  is not a GIR class name',
        rule: 'refuses the empty string',
    },
    {
        gtype: 'WkWebView',
        error: 'hostTagOf: WkWebView is not a GIR class name',
        rule: 'refuses a real GIR class from a namespace that is neither `Adw` nor `Gtk`',
    },
];

/** One `attributeOf` expectation. */
export interface AttributeOfVector {
    /** The authored property name, as an `AdwXyz`/`GtkXyz` prop is spelled in a `SharedTreeNode`. */
    prop: string;
    /** The attribute `attributeOf` must return. */
    expected: string;
    rule: string;
}

/**
 * `attributeOf` — camelCase property name to kebab DOM attribute.
 *
 * Every capital gets its own dash, with no acronym awareness — see the header for why that
 * boundary is out of scope for this table.
 */
export const ATTRIBUTE_OF_VECTORS: ReadonlyArray<AttributeOfVector> = [
    { prop: 'buttonLabel', expected: 'button-label', rule: 'the documented example — one boundary, one dash' },
    { prop: 'showInitials', expected: 'show-initials', rule: 'the same rule on a second authored property' },
    {
        prop: 'title',
        expected: 'title',
        rule: 'a single-word name has no capital to kebab, so it passes through unchanged',
    },
    { prop: '', expected: '', rule: 'the empty string passes through unchanged' },
    {
        prop: 'button-label',
        expected: 'button-label',
        rule: 'an ALREADY-KEBAB name has no capital either, so it is idempotent — safe to call twice',
    },
];

/** One `propertyOf` expectation. */
export interface PropertyOfVector {
    /** A property name as a projected `.blp` spells it, or as a hand-authored tree does. */
    name: string;
    /** The member `propertyOf` must return. */
    expected: string;
    rule: string;
}

/** `propertyOf` — a GIR property name to the camel-case member a NativeScript widget declares. */
export const PROPERTY_OF_VECTORS: ReadonlyArray<PropertyOfVector> = [
    { name: 'maximum-size', expected: 'maximumSize', rule: 'one hyphen, one capital' },
    {
        name: 'tightening-threshold',
        expected: 'tighteningThreshold',
        rule: 'the same rule on a second property of the same widget',
    },
    { name: 'icon_name', expected: 'iconName', rule: 'GObject reads `_` as `-`, so it closes a word too' },
    { name: 'label', expected: 'label', rule: 'a single-word name passes through unchanged' },
    {
        name: 'maximumSize',
        expected: 'maximumSize',
        rule: 'an ALREADY-camel name has no separator, so it is idempotent, as the hand-authored trees need',
    },
];
