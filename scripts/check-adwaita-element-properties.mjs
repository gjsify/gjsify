#!/usr/bin/env node
// Every web element against the GIR properties of the widget it names — and the
// check proves itself on broken input before it looks at the repository.
//
// WHY THIS EXISTS. `<adw-alert-dialog>` shipped observing FOUR attributes while
// `Adw.AlertDialog` carries eight own properties. The website's widget table reads
// `observedAttributes` and truthfully rendered "takes 4 attributes", so the DOC was
// right and the ELEMENT was short — and nothing anywhere compared the two. That is the
// gap this closes: `check-vocabulary-alignment.mjs` already settles which element names
// which widget; this one asks whether the element carries that widget's PROPERTIES.
//
// WHAT IS DELIBERATELY NOT A GAP, because a check with a high false-positive rate gets
// disabled and then protects nothing (`check-workflow-inline-scripts.mjs`'s header
// records the same lesson from its own first draft — "23 findings, 21 false"):
//
//   · SIGNAL props (`on-clicked`, `on-notify-*`). 271 of them across the 43 mapped
//     elements. They are a JSX convention; a custom element dispatches events instead,
//     and an `on-*` ATTRIBUTE would be the inline-handler shape nobody wants.
//   · WIDGET-VALUED props (`child`, `content`, `sidebar`, `extra-child`, `title-widget`
//     — anything typed `Gtk.*`/`Adw.*`/`Gio.*`/`Gdk.*`/`Pango.*`/`GObject.*` and NOT an
//     enum). 47 of them. On this renderer those are SLOTS, not attributes: an attribute
//     cannot carry a widget. `<adw-alert-dialog>`'s `extra-child` is exactly this shape.
//
// ENUMS ARE NOT EXCLUDED, though the naive namespace test catches them: the generator
// spells one `AdwToolbarStyleNick | Adw.ToolbarStyle`, and a nick is a STRING. 24 of them
// are in scope here, 17 already observed as attributes today — which is the proof they
// belong. Dropping them would have hidden real gaps behind a justification ("an attribute
// cannot carry a widget") that does not apply to them.
//
// That leaves the scalar surface — strings, booleans, numbers, enums — which an
// attribute genuinely can carry, and which is therefore the only half whose absence
// carries information.
//
// KNOWN_GAPS IS A MEASURED BACKLOG, NOT A BLESSING. A number of scalar properties
// across the web elements are unobserved today; THIS SCRIPT PRINTS THE LIVE FIGURE
// on every run, and the stamped one that used to stand here said 83 against a real 75
// — a second copy of a number the run already computes. They are listed rather than
// individually justified, because inventing a rationale per entry would be worse than
// naming none: a rule without its real reason gets "simplified" back into the bug. What this check buys now is the
// RATCHET — a new gap fails, and closing one fails too until it leaves the list, so the
// number can only go down and cannot go quietly back up.
//
// The property list is the GIR-derived `generated/props.ts` (ADR 0028), so this check
// inherits its provenance rather than hand-copying a second one.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { observedAttributes } from './adwaita-elements.mjs';

const ROOT = process.cwd();

/**
 * Scalar GIR properties no web element observes yet, measured 2026-08-26 and extended
 * on 2026-09-01 by the nine elements the GIR rename made measurable at all.
 * A gap NOT listed here fails; a listed gap the element now observes fails too.
 */
const KNOWN_GAPS = {
    'adw-about-dialog': [
        'appdata-resource-path',
        'artists',
        'debug-info',
        'debug-info-filename',
        'designers',
        'developers',
        'documenters',
        'license-type',
        // The heading of a section this element does not render. `<adw-about-dialog>`
        // has no other-apps list — libadwaita builds one from `add_other_app()`, which
        // has no attribute and no counterpart here — so the title has nothing to title.
        // Same family as the credits sections above it, and it arrived with @girs
        // 4.5.0 rather than being overlooked.
        'other-apps-title',
        'release-notes',
        'release-notes-version',
        'translator-credits',
    ],
    'adw-action-row': ['icon-name', 'subtitle-lines', 'subtitle-selectable', 'title-lines'],
    'adw-avatar': ['icon-name'],
    'adw-bottom-sheet': ['align', 'can-open', 'full-width', 'reveal-bottom-bar'],
    'adw-carousel': ['reveal-duration'],
    'adw-clamp': ['unit'],
    'adw-combo-row': ['enable-search', 'search-match-mode', 'use-subtitle'],
    'adw-dialog': ['follows-content-size'],
    'adw-entry-row': ['enable-emoji-completion', 'input-hints', 'input-purpose'],
    'adw-expander-row': ['icon-name', 'subtitle-lines', 'title-lines'],
    'adw-header-bar': [
        'centering-policy',
        'decoration-layout',
        'show-back-button',
        'show-end-title-buttons',
        'show-start-title-buttons',
        'show-title',
    ],
    'adw-inline-view-switcher': ['can-shrink', 'homogeneous'],
    'adw-navigation-split-view': ['sidebar-width-fraction', 'sidebar-width-unit'],
    'adw-navigation-view': ['hhomogeneous', 'vhomogeneous'],
    'adw-overlay-split-view': ['sidebar-width-unit'],
    'adw-preferences-dialog': ['search-enabled', 'visible-page-name'],
    'adw-preferences-group': ['separate-rows'],
    'adw-preferences-page': ['description', 'description-centered'],
    'adw-sidebar': ['drop-preload'],
    'adw-spin-row': ['climb-rate', 'digits', 'numeric', 'snap-to-ticks', 'update-policy', 'wrap'],
    'adw-split-button': ['can-shrink'],
    'adw-status-page': ['icon-name'],
    'adw-tab-view': ['shortcuts'],
    'adw-toggle': [
        // Invisible until `AdwToggle` gained a GTK tag: it is a placement carrier
        // (ADR 0028 § Amendment), so the widget it is held against only started
        // existing in the table when the carrier rule landed. The gap is older than
        // the check that found it.
        //
        // `enabled` is the one with a written decision and an obligation attached —
        // `status/open-todos.md` § `<adw-toggle>` has no `enabled`. Adding it means
        // adding the roving-focus filter in the same change, and
        // `keyboard-operable.spec.ts` pins `observedAttributes` so that commit fails
        // until someone reads the entry.
        'description',
        'enabled',
        'name',
        'tooltip',
        'use-underline',
    ],
    'adw-toggle-group': ['active-name', 'can-shrink', 'homogeneous'],
    'adw-toolbar-view': ['reveal-bottom-bars', 'reveal-top-bars'],
    'adw-view-stack': ['enable-transitions', 'hhomogeneous', 'transition-duration', 'vhomogeneous'],
    'adw-window': ['adaptive-preview'],
    // ── Visible for the first time on 2026-09-01, when nine elements took the GIR
    // name of the widget they always were (ADR 0034 clause 1, § Amendment 5). The
    // GAPS are not new: `<adw-entry>` observed five attributes against `GtkEntry`'s
    // scalar surface for its whole life, and this check could not see it, because a
    // tag with no GIR counterpart has nothing to be measured against. Renaming the
    // tag is what put them in front of the ratchet.
    //
    // Two shapes are mixed in here on purpose, because separating them would be a
    // verdict nobody has reached: an attribute the element simply does not carry
    // (`gtk-image/pixel-size`), and one it carries under its own spelling
    // (`gtk-entry` observes `placeholder` and `maxlength`, GTK spells them
    // `placeholder-text` and `max-length`). The second is the ATTRIBUTE-level form of
    // the property distance ADR 0034 § Amendment 2 measures for NativeScript, and it
    // is a rename of a published attribute — out of scope for the tag rename that
    // exposed it, and listed rather than quietly done.
    'gtk-button': ['can-shrink', 'has-frame', 'icon-name', 'use-underline'],
    'gtk-check-button': ['active', 'inconsistent', 'use-underline'],
    'gtk-drop-down': ['search-match-mode', 'show-arrow'],
    'gtk-entry': [
        'activates-default',
        'enable-emoji-completion',
        'has-frame',
        'im-module',
        'input-hints',
        'input-purpose',
        'invisible-char',
        'invisible-char-set',
        'max-length',
        'menu-entry-icon-primary-text',
        'menu-entry-icon-secondary-text',
        'overwrite-mode',
        'placeholder-text',
        'primary-icon-activatable',
        'primary-icon-name',
        'primary-icon-sensitive',
        'primary-icon-tooltip-markup',
        'primary-icon-tooltip-text',
        'progress-fraction',
        'progress-pulse-step',
        'secondary-icon-activatable',
        'secondary-icon-name',
        'secondary-icon-sensitive',
        'secondary-icon-tooltip-markup',
        'secondary-icon-tooltip-text',
        'show-emoji-icon',
        'truncate-multiline',
        'visibility',
    ],
    'gtk-image': ['file', 'icon-size', 'pixel-size', 'resource', 'use-fallback'],
    'gtk-menu-button': ['active', 'always-show-arrow', 'can-shrink', 'has-frame', 'label', 'primary', 'use-underline'],
    'gtk-popover': ['autohide', 'cascade-popdown', 'has-arrow', 'mnemonics-visible'],
    'gtk-progress-bar': ['ellipsize', 'pulse-step'],
    'gtk-switch': ['state'],
};

/** A GIR type that holds an object — a slot on this renderer, never an attribute. */
const OBJECT_TYPE = /\b(?:Gtk|Adw|Gio|Gdk|Pango|GObject)\.\w+/;

/**
 * An ENUM, which {@link OBJECT_TYPE} also matches and must not exclude.
 *
 * The generator spells an enum property `AdwToolbarStyleNick | Adw.ToolbarStyle`, so the
 * namespaced half makes it look object-typed. It is not: a nick is a STRING, exactly what
 * an attribute carries. The proof that these belong to the checked surface is that 17 of
 * them are already observed as attributes today (`adw-banner/button-style`,
 * `adw-dialog/presentation-mode`, `adw-toolbar-view/top-bar-style`, …). Excluding them
 * would have hidden 14 real gaps behind a justification — "an attribute cannot carry a
 * widget" — that does not apply to them.
 */
const ENUM_TYPE = /\b\w+Nick\b/;

const kebab = (name) => name.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`);

/** `tag -> GType`, from the runtime widget table. */
export function tagGTypes(widgetsSource) {
    const map = new Map();
    for (const m of widgetsSource.matchAll(/gtype: '([^']+)', tag: '([^']+)'/g)) map.set(m[2], m[1]);
    return map;
}

/**
 * `<GType> -> interface body`, brace-MATCHED rather than regex-bounded.
 *
 * A lazy `[\s\S]*?\n\}` reads an EMPTY interface as the next one's body, which silently
 * credited `adw-spinner` with `AdwSplitButton`'s properties while this was being built.
 */
export function propsBodies(propsSource) {
    const bodies = new Map();
    // `extends\s`, NOT `extends ` — the generator wraps long heritage lists onto the
    // next line, and a literal space missed 65 of 190 interfaces. Each one then had no
    // body, and `propertyProblems` skipped its element as unmapped: eight `adw-*`
    // elements passed by being invisible. A vector pins it.
    //
    // `\s*` before the brace is the SAME defect one clause over, and it was live here
    // after the first one was fixed: `[^{]*` swallows the space only when `extends` is
    // present, so an interface declared WITHOUT one — `export interface AdwToggleProps
    // {` — never matched. 13 interfaces were invisible that way, and the @girs 4.5.0
    // vocabulary took it to 25 by dropping the empty `GObject` base: `<adw-toggle>`
    // left this check silently, and surfaced only as five KNOWN_GAPS entries reported
    // as stale. `girs-vocabulary.mts` carries the identical rule and its own vector.
    const head = /export interface (\w+)Props(?:\s+extends\s[^{]*)?\s*\{/g;
    let m;
    while ((m = head.exec(propsSource))) {
        let depth = 1;
        let i = head.lastIndex;
        while (i < propsSource.length && depth > 0) {
            const c = propsSource[i];
            if (c === '{') depth++;
            else if (c === '}') depth--;
            i++;
        }
        bodies.set(m[1], propsSource.slice(head.lastIndex, i - 1));
    }
    return bodies;
}

/**
 * The scalar property names of one interface body, kebab-spelled and deduplicated.
 *
 * The generator emits multiword properties TWICE — `canOpen?: boolean;` and
 * `'can-open'?: boolean;` — so without the dedupe every multiword gap counts double.
 */
export function scalarProps(body) {
    const names = new Set();
    for (const line of body.split('\n')) {
        const m = /^\s*(?:'([a-z0-9-]+)'|([a-zA-Z][a-zA-Z0-9]*))\?:\s*(.+?);\s*$/.exec(line);
        if (!m) continue;
        const name = m[1] ?? kebab(m[2]);
        if (name.startsWith('on-')) continue;
        if (OBJECT_TYPE.test(m[3]) && !ENUM_TYPE.test(m[3])) continue;
        names.add(name);
    }
    return names;
}

/** @returns {string[]} one line per problem; empty means aligned. */
export function propertyProblems({ byTag, tagToGtype, bodies, knownGaps }) {
    const problems = [];
    const seenDeclarations = new Set();
    for (const [tag, attributes] of byTag) {
        const gtype = tagToGtype.get(tag);
        if (!gtype) continue; // web-only or aliased — check-vocabulary-alignment owns that
        const body = bodies.get(gtype);
        if (body === undefined) continue;

        const observed = new Set(attributes);
        const declared = new Set(knownGaps[tag] ?? []);
        for (const property of scalarProps(body)) {
            if (observed.has(property)) {
                if (declared.has(property)) {
                    seenDeclarations.add(`${tag}/${property}`);
                    problems.push(
                        `${tag} now observes '${property}' — delete it from KNOWN_GAPS so the backlog can only shrink.`,
                    );
                }
                continue;
            }
            if (declared.has(property)) {
                seenDeclarations.add(`${tag}/${property}`);
                continue;
            }
            problems.push(
                `${tag} does not observe '${property}', a scalar property of ${gtype}. ` +
                    `Implement it, or add it to KNOWN_GAPS with the measurement that made it a decision.`,
            );
        }
    }
    for (const [tag, properties] of Object.entries(knownGaps)) {
        for (const property of properties) {
            if (!seenDeclarations.has(`${tag}/${property}`)) {
                problems.push(
                    `KNOWN_GAPS lists ${tag}/'${property}', which is not a scalar property of that widget any more.`,
                );
            }
        }
    }
    return problems;
}

// ---------------------------------------------------------------------------
// SELF-TEST FIRST — a check that cannot go red is worse than no check.
// ---------------------------------------------------------------------------

const FIXTURE_PROPS = `
export interface DemoWidgetProps extends GtkWidgetProps {
    /** A scalar. */
    label?: string;
    /** Multiword, emitted twice by the generator. */
    canShrink?: boolean;
    'can-shrink'?: boolean;
    /** An ENUM — namespaced, but a nick is a string an attribute carries. */
    barStyle?: AdwBarStyleNick | Adw.BarStyle;
    'bar-style'?: AdwBarStyleNick | Adw.BarStyle;
    /** A slot, not an attribute. */
    child?: Gtk.Widget | null;
    /** A signal, not a property. */
    'on-clicked'?: () => void;
}
export interface RootWidgetProps {
    /** Reachable ONLY if the head reader tolerates a space before the brace. */
    rooted?: string;
}
export interface EmptyWidgetProps extends GtkWidgetProps {}
export interface AfterEmptyProps extends GtkWidgetProps {
    trap?: string;
}
export interface WrappedWidgetProps
    extends GtkWidgetProps,
        GtkAccessibleProps,
        GtkBuildableProps {
    /** Reachable ONLY if the head reader tolerates a newline after \`extends\`. */
    wrapped?: string;
}
`;

const FIXTURE_WIDGETS = `
    { gtype: 'DemoWidget', tag: 'adw-demo', ctor: () => Adw.Demo },
    { gtype: 'EmptyWidget', tag: 'adw-empty', ctor: () => Adw.Empty },
    { gtype: 'WrappedWidget', tag: 'adw-wrapped', ctor: () => Adw.Wrapped },
    { gtype: 'RootWidget', tag: 'adw-root', ctor: () => Adw.Root },
`;

const world = (attributes, knownGaps = {}, tag = 'adw-demo') => ({
    byTag: new Map([[tag, attributes]]),
    tagToGtype: tagGTypes(FIXTURE_WIDGETS),
    bodies: propsBodies(FIXTURE_PROPS),
    knownGaps,
});

/** Every scalar `DemoWidget` offers — an enum among them, on purpose. */
const DEMO_SCALARS = ['label', 'can-shrink', 'bar-style'];

const VECTORS = [
    ['every scalar observed is not a problem', () => world(DEMO_SCALARS), 0],
    ['one unobserved scalar IS a problem', () => world(['label', 'can-shrink']), 1],
    ['all unobserved is one problem each', () => world([]), 3],
    ['a declared gap is accepted', () => world(['label', 'bar-style'], { 'adw-demo': ['can-shrink'] }), 0],
    ['a declaration the element now honours fails', () => world(DEMO_SCALARS, { 'adw-demo': ['can-shrink'] }), 1],
    ['a declaration for a property that does not exist fails', () => world(DEMO_SCALARS, { 'adw-demo': ['ghost'] }), 1],
    ['a missing SLOT property is not a problem', () => world(DEMO_SCALARS), 0],
    ['a missing SIGNAL property is not a problem', () => world(DEMO_SCALARS), 0],

    // BLOCKER-1 REGRESSION. `WrappedWidget` declares its heritage across three lines,
    // which is how the generator emits a long `extends` list. With the old `extends `
    // (literal space) head reader this interface had no body at all, so the element was
    // skipped as unmapped and reported ZERO problems — green by being invisible.
    ['a widget whose extends list wraps is still read', () => world([], {}, 'adw-wrapped'), 1],
    ['a wrapped widget with its scalar observed is clean', () => world(['wrapped'], {}, 'adw-wrapped'), 0],

    // The same class one clause over: an interface with NO `extends` at all, which is
    // what `AdwToggleProps` became. Without `\s*` before the brace it had no body, so
    // the element reported zero problems — green by being invisible, again.
    ['a widget declared without `extends` is still read', () => world([], {}, 'adw-root'), 1],
    ['a root widget with its scalar observed is clean', () => world(['rooted'], {}, 'adw-root'), 0],
];

/**
 * The ORIGINAL defect, as a vector rather than as a claim.
 *
 * `<adw-alert-dialog>` observed `heading`, `body`, `open` and `prefer-wide-layout` while
 * `Adw.AlertDialog` carries eight own scalar properties. Reproduced against a synthetic
 * twin so the pin survives the real element being fixed — a regression test that reads
 * the fixed source proves nothing once it is fixed.
 */
const ALERT_DIALOG_FIXTURE = `
export interface AlertTwinProps
    extends AdwDialogProps,
        GtkAccessibleProps {
    body?: string;
    bodyUseMarkup?: boolean;
    'body-use-markup'?: boolean;
    closeResponse?: string;
    'close-response'?: string;
    defaultResponse?: string;
    'default-response'?: string;
    extraChild?: Gtk.Widget | null;
    'extra-child'?: Gtk.Widget | null;
    heading?: string;
    headingUseMarkup?: boolean;
    'heading-use-markup'?: boolean;
    preferWideLayout?: boolean;
    'prefer-wide-layout'?: boolean;
}
`;

function alertDialogRegression() {
    const shipped = ['heading', 'body', 'open', 'prefer-wide-layout'];
    const fixed = [...shipped, 'heading-use-markup', 'body-use-markup', 'close-response', 'default-response'];
    const build = (attributes) => ({
        byTag: new Map([['adw-alert-twin', attributes]]),
        tagToGtype: new Map([['adw-alert-twin', 'AlertTwin']]),
        bodies: propsBodies(ALERT_DIALOG_FIXTURE),
        knownGaps: {},
    });
    const failures = [];
    const before = propertyProblems(build(shipped));
    const missing = ['body-use-markup', 'close-response', 'default-response', 'heading-use-markup'];
    if (before.length !== 4) {
        failures.push(`the shipped alert dialog must give 4 problems, got ${before.length}`);
    }
    for (const property of missing) {
        if (!before.some((problem) => problem.includes(`'${property}'`))) {
            failures.push(`the shipped alert dialog must name '${property}'`);
        }
    }
    // `extra-child` is a slot and must NOT be among them.
    if (before.some((problem) => problem.includes("'extra-child'"))) {
        failures.push('extra-child is a slot and must not be reported');
    }
    const after = propertyProblems(build(fixed));
    if (after.length !== 0) failures.push(`the fixed alert dialog must be clean, got ${after.length}`);
    return failures;
}

function selfTest() {
    const failures = [];

    // The brace matcher, pinned directly: the lazy-regex bug it replaces was silent.
    const bodies = propsBodies(FIXTURE_PROPS);
    if (scalarProps(bodies.get('EmptyWidget') ?? '').size !== 0) {
        failures.push('an empty interface must have no properties — the body reader ran past its closing brace');
    }
    if (!scalarProps(bodies.get('AfterEmpty') ?? '').has('trap')) {
        failures.push('the interface after an empty one must still be read');
    }
    if (!bodies.has('WrappedWidget')) {
        failures.push('an interface whose `extends` list wraps must be found — the head reader needs `\\s`');
    }
    if (!bodies.has('RootWidget')) {
        failures.push('an interface with no `extends` must be found — the head reader needs `\\s*` before `{`');
    }
    const demo = scalarProps(bodies.get('DemoWidget') ?? '');
    for (const property of DEMO_SCALARS) {
        if (!demo.has(property)) failures.push(`DemoWidget must expose '${property}' as a scalar`);
    }
    if (demo.has('child')) failures.push('a widget-valued property must not count as a scalar');
    if (demo.size !== DEMO_SCALARS.length) {
        failures.push(`DemoWidget must expose ${DEMO_SCALARS.length} scalars, got ${[...demo].join(', ')}`);
    }

    for (const [label, build, expected] of VECTORS) {
        const got = propertyProblems(build()).length;
        if (got !== expected) failures.push(`${label}: expected ${expected} problem(s), got ${got}`);
    }
    failures.push(...alertDialogRegression());
    return failures;
}

const selfTestFailures = selfTest();
if (selfTestFailures.length > 0) {
    console.error('check-adwaita-element-properties: SELF-TEST failed — the check itself is broken:');
    for (const failure of selfTestFailures) console.error(`  - ${failure}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

let real;
try {
    const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');
    const { byTag, unreadable } = observedAttributes(ROOT);
    if (unreadable.length > 0) {
        // An element whose `observedAttributes` cannot be read would otherwise be
        // credited with none and pass by looking maximally broken.
        console.error('check-adwaita-element-properties: cannot read observedAttributes for:');
        for (const name of unreadable) console.error(`  - ${name}`);
        process.exit(1);
    }
    real = {
        byTag,
        tagToGtype: tagGTypes(read('packages/framework/gtk-host/src/generated/widgets.ts')),
        bodies: propsBodies(read('packages/framework/gtk-host/src/generated/props.ts')),
        knownGaps: KNOWN_GAPS,
    };
} catch (error) {
    console.error(`check-adwaita-element-properties: cannot read an input — ${error.message}`);
    console.error('If a file moved, teach this check where it went. Do not delete it.');
    process.exit(1);
}

const problems = propertyProblems(real);
if (problems.length > 0) {
    console.error('check-adwaita-element-properties: an element and its widget disagree:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

const mapped = [...real.byTag.keys()].filter((tag) => {
    const gtype = real.tagToGtype.get(tag);
    return gtype !== undefined && real.bodies.has(gtype);
}).length;
const backlog = Object.values(KNOWN_GAPS).flat().length;
console.log(
    `check-adwaita-element-properties: self-test green — ${VECTORS.length} vector(s). ` +
        `${mapped} web elements hold their widget's scalar GIR properties; ` +
        `${backlog} property/ies across ${Object.keys(KNOWN_GAPS).length} elements remain a declared backlog.`,
);
