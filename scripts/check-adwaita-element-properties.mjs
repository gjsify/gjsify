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
// The GIR side is SHARED with `check-nativescript-widget-coverage.mjs`, which asks the
// same question of the same file for the NativeScript surface. Two copies of "what is a
// scalar property" is two backlogs that can disagree while both stay green.
import {
    GIR_FIXTURE_PROPS,
    GIR_FIXTURE_SCALARS,
    girReaderSelfTest,
    propsBodies,
    scalarProps,
    tagGTypes,
} from './gir-scalar-properties.mjs';

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
    'adw-action-row': ['icon-name', 'subtitle-selectable'],
    'adw-avatar': ['icon-name'],
    'adw-bottom-sheet': ['align', 'full-width'],
    'adw-carousel': ['reveal-duration'],
    'adw-clamp': ['unit'],
    'adw-combo-row': ['enable-search', 'search-match-mode', 'use-subtitle'],
    'adw-dialog': ['follows-content-size'],
    'adw-entry-row': ['enable-emoji-completion', 'input-hints', 'input-purpose'],
    'adw-expander-row': ['icon-name'],
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
        //
        // `tooltip` LEFT this list with #1823. It was the accessible NAME for an
        // icon-only toggle, which is the one case that had no other text at all.
        'description',
        'enabled',
        'name',
        'use-underline',
    ],
    'adw-toggle-group': ['can-shrink', 'homogeneous'],
    'adw-toolbar-view': ['reveal-bottom-bars', 'reveal-top-bars'],
    'adw-view-stack': ['enable-transitions', 'hhomogeneous', 'transition-duration', 'vhomogeneous'],
    'adw-window': ['adaptive-preview'],
    // The same debug mode `<adw-window>` records above, for the same reason: it
    // resizes the window to a set of device sizes from GTK Inspector or Ctrl+Shift+M,
    // and a browser has neither. This element is `<adw-window>` plus `show-menubar`.
    'adw-application-window': ['adaptive-preview'],
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
    // Baselines have no counterpart in a flex row that aligns BOXES, the same absence the
    // NativeScript box declares.
    'gtk-box': ['baseline-child', 'baseline-position'],
    'gtk-button': ['can-shrink', 'has-frame', 'use-underline'],
    // `active` and `inconsistent` are the two GIR names this element DELIBERATELY does
    // not use: it wraps a real `<input>`, so the state is `checked` and `indeterminate`
    // — the two spellings libadwaita's own cascade selects on (`_checks.scss`). GTK
    // raises the same state flags for them (gtkcheckbutton.c:647-691), so the divergence
    // is in the ATTRIBUTE NAME only. `use-underline` is a mnemonic hook on a `GtkLabel`
    // child (gtkcheckbutton.c:693-702); the label here is a plain `<span>` with no
    // keyval, so there is nothing for it to underline.
    // The three GStrv credit lists (`char **`). `<adw-about-dialog>` sets its own
    // `developers` / `designers` / `artists` / `documenters` as PROPERTIES and its entry
    // above is the ledger for them, so this element's `authors` / `documenters` / `artists`
    // are properties too — an attribute is one string, and a credit line is a `char *` with
    // its own `<email>` / URL syntax inside it. `parseCreditPerson` reads them.
    'gtk-about-dialog': ['artists', 'authors', 'documenters'],
    'gtk-check-button': ['active', 'inconsistent', 'use-underline'],
    'gtk-drop-down': ['search-match-mode', 'show-arrow'],
    // `use-es` is DEPRECATED in GTK 4.12 and `allowed-apis` replaced it
    // (gtkglarea.c:969-971, :1235-1254). The element carries the replacement, so the
    // retired spelling is all that is left — and it cannot go on being observed without
    // the element teaching a name GTK itself withdrew.
    'gtk-gl-area': ['use-es'],
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
    // `baseline-row` aligns every row's baseline to ONE row's, so a child whose `valign` is
    // baseline lines up across row boundaries (gtkgrid.c:474-479). A CSS grid aligns
    // baselines WITHIN one row track and has no per-grid baseline line, so there is no value
    // this attribute could hold that would do it.
    'gtk-grid': ['baseline-row'],
    // `natural-wrap-mode` is a natural-SIZE-REQUEST hint over a size-negotiation protocol
    // this renderer does not run (a browser lays out once, it does not ask a widget for a
    // preferred width first); `single-line-mode` pins the height to one line's
    // ascent+descent regardless of content, which no CSS box does without measuring the
    // font — and a non-wrapping `<gtk-label>`'s own height already IS one line's. The rest
    // of Pango's layout knobs (`ellipsize`, `wrap-mode`, `lines`, `width-chars`,
    // `max-width-chars`, `yalign`) reach a real CSS mechanism now — see `gtk-label.ts`'s
    // header.
    'gtk-label': ['natural-wrap-mode', 'single-line-mode'],
    'gtk-menu-button': ['active', 'always-show-arrow', 'can-shrink', 'has-frame', 'label', 'primary', 'use-underline'],
    'gtk-password-entry': [
        // "Whether to activate the default widget when Enter is pressed." A default widget
        // is a GTK toplevel concept: it is the widget a toplevel activates, resolved through
        // the window. A document has no such thing, so there is nothing to activate — the
        // `activate` SIGNAL the property gates is dispatched here instead.
        'activates-default',
    ],
    // `autohide` left this list when `<gtk-popover>` began honouring it: GTK's grab is what
    // dismisses the popover on an outside click and what takes the focus when it opens
    // (gtkpopover.c:1188, :1245-1247), so the attribute gates the document listeners the
    // element already binds.
    'gtk-popover': ['cascade-popdown', 'has-arrow', 'mnemonics-visible'],
    // `flags` is `GTK_POPOVER_MENU_SLIDING` (the default) against `GTK_POPOVER_MENU_NESTED`.
    // Only the sliding half is modelled: a nested submenu opens as a SECOND popover beside
    // the row (gtkpopovermenu.c:817-825), which needs the arrow this package does not draw
    // and an anchor the CSS placement cannot point at.
    'gtk-popover-menu': ['flags'],
    // `pulse-step` is the distance one `gtk_progress_bar_pulse()` call advances the
    // bouncing block (gtkprogressbar.c:830-847, :655-692): a property of a per-call
    // animation this element does not run — the indeterminate block is a CSS keyframe on
    // a fixed period, so there is no step to configure. `ellipsize` is Pango's
    // truncation mode on the text node, the same family `gtk-label` already carries.
    'gtk-progress-bar': ['ellipsize', 'pulse-step'],
    'gtk-search-entry': [
        // "Whether to activate the default widget when Enter is pressed." A default widget is
        // a GTK toplevel concept, resolved through the window; a document has no such thing, so
        // there is nothing to activate. The `activate` SIGNAL the property gates is dispatched
        // either way.
        'activates-default',
        // The two INPUT-METHOD hints, which GTK hands to GDK's input method and which a text
        // field has no way to pass on. `<gtk-entry>` carries both for the same reasons.
        'input-hints',
        'input-purpose',
    ],
    'gtk-spin-button': [
        // Same default-widget concept `gtk-search-entry` records above. `climb-rate` and
        // `update-policy` ARE observed: the held-arrow ramp (`TIMEOUT_INITIAL` 500ms,
        // `TIMEOUT_REPEAT` 50ms, `MAX_TIMER_CALLS` 5) and both update policies are ported.
        'activates-default',
    ],
    // The two text EDITORS carry more of their pspec surface here than anything else in the
    // table does, and every gap below is a MECHANISM a browser does not have rather than a
    // derivation nobody wrote — the reasons are one line each in the element headers.
    'gtk-text': [
        'activates-default',
        'enable-emoji-completion',
        'im-module',
        'invisible-char',
        'invisible-char-set',
        'input-hints',
        'input-purpose',
        'overwrite-mode',
        'truncate-multiline',
    ],
    'gtk-text-view': [
        'im-module',
        // The Pango PARAGRAPH model: a CSS line box cannot space paragraphs apart from the
        // lines inside them, and a `<textarea>` has no paragraphs to tell apart.
        'indent',
        'input-hints',
        'input-purpose',
        'overwrite',
        'pixels-above-lines',
        'pixels-below-lines',
        'pixels-inside-wrap',
    ],
    // ── The gtk/windows page (2026-10-02). Four new elements, and the gaps are the two
    // branches of one macOS-only property plus the window facts a page has no way to ask a
    // compositor for.
    'gtk-header-bar': [
        // `Gtk.HeaderBar:use-native-controls` (since 4.18) has ONE effect: it makes the bar
        // build a `GtkWindowButtonsQuartz` instead of the three symbolic buttons
        // (gtkheaderbar.c:639-651 creates the controls; gtkwindowcontrols.c:281-303 is the
        // macOS branch). The GIR says so on the property itself — "On Linux, this option has
        // no effect" — and this port is not macOS, so the attribute is observed for the
        // property's sake and changes nothing.
        'use-native-controls',
    ],
    'gtk-window-controls': [],
    // Every one of these is a fact about a SURFACE a compositor owns, or about GTK's own
    // input bookkeeping, and a browser document has neither. They are listed together
    // because the reasons are one family; see `gtk-window.ts` for each one's own line.
    'gtk-window': [
        // Which point stays fixed while the window is resized PROGRAMMATICALLY (gtkwindow.c:1163).
        // A browser box is laid out, never resized that way — there is no `resize()` to aim.
        'gravity',
        // GTK maintains it from user input and the GIR says an application must not set it (:969).
        'focus-visible',
        // Same, for the mnemonic underline (:956).
        'mnemonics-visible',
        // A DOM node has no destroy, and a page has no parent window to destroy it with.
        'destroy-with-parent',
        // F10 activating the menubar — `<gtk-application-window>`'s half, and it needs the
        // `Gio.MenuModel` the bar is built from (:1150).
        'handle-menubar-accel',
        // Write-only, and written by the launcher that started the application (:883).
        'startup-id',
    ],
    // One property of a widget whose every OTHER scalar is implemented here.
    //
    // `kinetic-scrolling` is the deceleration after a touch release: GTK runs its own
    // `GtkKineticScrolling` tick against the frame clock (`gtk_scrolled_window_decelerate`,
    // gtkscrolledwindow.c:3460-3490) and a page cannot hand a browser a curve to run. The
    // same answer covers the wheel step `get_wheel_detent_scroll_step` computes as
    // `pow (page_size, 2.0 / 3.0)` (gtkscrolledwindow.c:1210-1230): the platform's own
    // scrolling is what a reader gets, and the platform owns that arithmetic too.
    //
    // The two `propagate-natural-*` ARE ported: they ask the child for its natural size and
    // add it to the window's own NATURAL request (`gtk_scrolled_window_measure`,
    // gtkscrolledwindow.c:1881-1888, :1905-1906), which a browser layout states as `min-width:
    // max-content` on the scrollport. A NEVER policy adds the child's MINIMUM request instead
    // (:1890-1892), which is the same line with `min-content`.
    'gtk-scrolled-window': ['kinetic-scrolling'],
};

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

const FIXTURE_WIDGETS = `
    { gtype: 'DemoWidget', tag: 'adw-demo', ctor: () => Adw.Demo },
    { gtype: 'EmptyWidget', tag: 'adw-empty', ctor: () => Adw.Empty },
    { gtype: 'WrappedWidget', tag: 'adw-wrapped', ctor: () => Adw.Wrapped },
    { gtype: 'RootWidget', tag: 'adw-root', ctor: () => Adw.Root },
`;

const world = (attributes, knownGaps = {}, tag = 'adw-demo') => ({
    byTag: new Map([[tag, attributes]]),
    tagToGtype: tagGTypes(FIXTURE_WIDGETS),
    bodies: propsBodies(GIR_FIXTURE_PROPS),
    knownGaps,
});

const VECTORS = [
    ['every scalar observed is not a problem', () => world(GIR_FIXTURE_SCALARS), 0],
    ['one unobserved scalar IS a problem', () => world(['label', 'can-shrink']), 1],
    ['all unobserved is one problem each', () => world([]), 3],
    ['a declared gap is accepted', () => world(['label', 'bar-style'], { 'adw-demo': ['can-shrink'] }), 0],
    [
        'a declaration the element now honours fails',
        () => world(GIR_FIXTURE_SCALARS, { 'adw-demo': ['can-shrink'] }),
        1,
    ],
    [
        'a declaration for a property that does not exist fails',
        () => world(GIR_FIXTURE_SCALARS, { 'adw-demo': ['ghost'] }),
        1,
    ],
    ['a missing SLOT property is not a problem', () => world(GIR_FIXTURE_SCALARS), 0],
    ['a missing SIGNAL property is not a problem', () => world(GIR_FIXTURE_SCALARS), 0],

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
    // The brace matcher and the scalar rule are pinned in the module that OWNS them,
    // and run from here as well as from the NativeScript ratchet: a shared reader only
    // one of its two callers proves is a reader half the repository trusts on somebody
    // else's word. The lazy-regex bug it replaces was silent.
    const failures = girReaderSelfTest();

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
