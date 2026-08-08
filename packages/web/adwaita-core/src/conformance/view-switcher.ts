// View-switcher conformance vectors — the spec all three implementations are
// held to.
//
// The family splits into two kinds of expectation and the tables follow that
// split. The PURE derivations (mnemonic stripping, the icon fallback, the
// button-visibility predicate, the badge label + screen-reader description, the
// bar-reveal gate, the tooltip) are one input and one output per row. The rest
// is a STATE MACHINE, so a row is a script: a page list, a sequence of
// operations, and the exact change notifications those produce.
//
// Every row cites the C function it came from. Rows whose `rule` opens with
// REGRESSION PIN encode behaviour that BOTH ports shipped wrong, so "fixing" the
// vector to match a renderer would undo the reason the table exists:
//   - a page with neither title nor icon must render NO button;
//   - an EMPTY title is not NULL, so that page keeps its button;
//   - a missing icon name renders `image-missing`, not nothing;
//   - a one-page stack keeps the switcher bar collapsed;
//   - hidden pages produce no inline toggle, so the toggle and page index spaces
//     diverge and `-1` is a reachable "nothing active";
//   - an out-of-range or negative index is REFUSED, never clamped into range.
//
// Reference: refs/libadwaita/src/adw-view-switcher.c
// Reference: refs/libadwaita/src/adw-view-switcher-button.c
// Reference: refs/libadwaita/src/adw-view-switcher-bar.c
// Reference: refs/libadwaita/src/adw-inline-view-switcher.c
// Reference: refs/libadwaita/src/adw-indicator-bin.c
// Reference: refs/libadwaita/src/adw-widget-utils.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type {
    AdwInlineViewSwitcherDisplayMode,
    AdwViewSwitcherPolicy,
    ViewSwitcherScheduler,
    ViewSwitcherTimerHandle,
} from '../view-switcher.js';

/**
 * A page as a vector declares it — the input half of `AdwViewSwitcherPageInit`.
 *
 * `title`/`iconName` omitted OR `null` both mean "the page has none", which is
 * also what `getAttribute` returns for a missing attribute, so a DOM driver maps
 * both to "do not set the attribute".
 */
export interface ViewSwitcherVectorPage {
    /** The page name. */
    name: string;
    /** `AdwViewStackPage:title`; absent means NULL. */
    title?: string | null;
    /** `AdwViewStackPage:icon-name`; absent means NULL. */
    iconName?: string | null;
    /** `AdwViewStackPage:visible`; absent means `true`. */
    visible?: boolean;
    /** `AdwViewStackPage:use-underline`; absent means `false`. */
    useUnderline?: boolean;
    /** `AdwViewStackPage:badge-number`; absent means `0`. */
    badgeNumber?: number;
    /** `AdwViewStackPage:needs-attention`; absent means `false`. */
    needsAttention?: boolean;
}

/** One `stripMnemonic` expectation. */
export interface MnemonicVector {
    /** The raw title. */
    label: string;
    /** What `adw_strip_mnemonic` produces. */
    stripped: string;
    /** What this row pins down. */
    rule: string;
}

/**
 * `adw_strip_mnemonic` (adw-widget-utils.c:685-703) — `g_markup_escape_text`
 * then `pango_parse_markup` with `'_'` as the accel marker.
 *
 * The escape/parse round trip is entity-NEUTRAL, which is what the `R&D` row
 * pins: a port that only escaped, or only unescaped, would drift on every
 * ampersand.
 */
export const VIEW_SWITCHER_MNEMONIC_VECTORS: ReadonlyArray<MnemonicVector> = [
    { label: '_Files', stripped: 'Files', rule: 'a single accel marker is removed' },
    { label: 'Fi__les', stripped: 'Fi_les', rule: 'a DOUBLED marker collapses to one literal underscore' },
    { label: 'R&D', stripped: 'R&D', rule: 'escape → parse is entity-neutral, so an ampersand survives' },
    { label: 'Ü_bersicht', stripped: 'Übersicht', rule: 'non-ASCII is untouched; only the marker goes' },
    { label: '', stripped: '', rule: 'empty in, empty out' },
    { label: 'a_b_c', stripped: 'abc', rule: 'every lone marker is removed, not just the first' },
    { label: 'Files_', stripped: 'Files', rule: 'a trailing lone marker marks nothing and is dropped' },
    { label: '__', stripped: '_', rule: 'a doubled marker with nothing after it is still one underscore' },
    { label: 'No mnemonic', stripped: 'No mnemonic', rule: 'a title without markers is copied verbatim' },
];

/** One `viewSwitcherIconName` expectation. */
export interface ViewSwitcherIconVector {
    /** `AdwViewStackPage:icon-name` as the page carries it. */
    iconName: string | null | undefined;
    /** The icon the switcher actually renders. */
    resolved: string;
    /** What this row pins down. */
    rule: string;
}

/**
 * The `image-missing` substitution (adw-view-switcher-button.c:399-405,
 * adw-inline-view-switcher.c:137-142). Both ports rendered NO icon instead,
 * which is why an icons-mode toggle for a page without an icon was a blank box.
 *
 * Note there is no `-symbolic` stripping here: C passes the name to `GtkImage`
 * unchanged. Turning a name into a CSS class or an SVG document is the
 * renderer's job.
 */
export const VIEW_SWITCHER_ICON_VECTORS: ReadonlyArray<ViewSwitcherIconVector> = [
    {
        iconName: null,
        resolved: 'image-missing',
        rule: 'REGRESSION PIN — a NULL icon name falls back, it does not vanish',
    },
    { iconName: '', resolved: 'image-missing', rule: "REGRESSION PIN — `icon_name && *icon_name` fails on '' too" },
    { iconName: undefined, resolved: 'image-missing', rule: 'an absent property reads as NULL' },
    { iconName: 'go-home-symbolic', resolved: 'go-home-symbolic', rule: 'a real name passes through, suffix included' },
    { iconName: 'image-missing', resolved: 'image-missing', rule: 'the fallback name is itself a valid name' },
];

/** One `isViewSwitcherButtonVisible` expectation. */
export interface ViewSwitcherButtonVisibilityVector {
    /** `AdwViewStackPage:visible`. */
    visible: boolean;
    /** `AdwViewStackPage:title`. */
    title: string | null;
    /** `AdwViewStackPage:icon-name`. */
    iconName: string | null;
    /** Whether `AdwViewSwitcher` shows the button. */
    buttonVisible: boolean;
    /** What this row pins down. */
    rule: string;
}

/**
 * `update_button`'s `gtk_widget_set_visible (button, visible && (title != NULL ||
 * icon_name != NULL))` (adw-view-switcher.c:178).
 *
 * Implemented in NEITHER port: the browser one hid the label and icon spans but
 * always appended a visible `<button>`, the NativeScript one always added the
 * button `StackLayout` with an empty `Label`. Both therefore rendered an empty,
 * clickable, space-consuming tab for a page with no title and no icon.
 */
export const VIEW_SWITCHER_BUTTON_VISIBILITY_VECTORS: ReadonlyArray<ViewSwitcherButtonVisibilityVector> = [
    { visible: true, title: 'Home', iconName: null, buttonVisible: true, rule: 'a title alone is enough' },
    { visible: true, title: null, iconName: 'go-home-symbolic', buttonVisible: true, rule: 'an icon alone is enough' },
    {
        visible: true,
        title: null,
        iconName: null,
        buttonVisible: false,
        rule: 'REGRESSION PIN — both NULL hides the button entirely; both ports rendered an empty clickable box',
    },
    {
        visible: true,
        title: '',
        iconName: null,
        buttonVisible: true,
        rule: "REGRESSION PIN — the test is `title != NULL`, and '' is NOT NULL, so an empty-title page keeps its button",
    },
    {
        visible: true,
        title: null,
        iconName: '',
        buttonVisible: true,
        rule: 'an EMPTY icon name is not NULL either — the button stays, showing the image-missing fallback',
    },
    {
        visible: false,
        title: 'Home',
        iconName: 'go-home-symbolic',
        buttonVisible: false,
        rule: 'page visibility gates everything else',
    },
    { visible: false, title: null, iconName: null, buttonVisible: false, rule: 'hidden and empty is still hidden' },
];

/** One badge-label + indicator-description expectation. */
export interface ViewSwitcherBadgeVector {
    /** `AdwViewStackPage:badge-number`. */
    badgeNumber: number;
    /** `AdwViewStackPage:needs-attention`. */
    needsAttention: boolean;
    /** `get_badge_label`'s text. */
    badgeLabel: string;
    /** `update_description`'s text. */
    description: string;
    /** What this row pins down. */
    rule: string;
}

/**
 * `get_badge_label` (adw-indicator-bin.c:58-68) and `update_description`
 * (:70-113), which both ports omit entirely — neither renders a badge, a
 * needs-attention dot, or an accessible description.
 *
 * The composition ORDER is the subtle part: when both clauses apply the format
 * is `"%s %s", badge_description, needs_attention_description` (:96), so the
 * BADGE comes first.
 */
export const VIEW_SWITCHER_BADGE_VECTORS: ReadonlyArray<ViewSwitcherBadgeVector> = [
    { badgeNumber: 0, needsAttention: false, badgeLabel: '', description: '', rule: 'no badge, no attention, no text' },
    {
        badgeNumber: 0,
        needsAttention: true,
        badgeLabel: '',
        description: 'Attention requested.',
        rule: 'the dot has no label but does have a description',
    },
    {
        badgeNumber: 1,
        needsAttention: false,
        badgeLabel: '1',
        description: 'Has a badge: 1.',
        rule: 'the smallest badge',
    },
    { badgeNumber: 7, needsAttention: false, badgeLabel: '7', description: 'Has a badge: 7.', rule: 'a plain count' },
    {
        badgeNumber: 7,
        needsAttention: true,
        badgeLabel: '7',
        description: 'Has a badge: 7. Attention requested.',
        rule: 'both clauses — the BADGE one comes first',
    },
    {
        badgeNumber: 999,
        needsAttention: false,
        badgeLabel: '999',
        description: 'Has a badge: 999.',
        rule: '999 is not > 999, so it still prints',
    },
    {
        badgeNumber: 1000,
        needsAttention: false,
        badgeLabel: '999+',
        description: 'Has a badge: more than 999.',
        rule: 'above the limit the count collapses',
    },
    {
        badgeNumber: 1000,
        needsAttention: true,
        badgeLabel: '999+',
        description: 'Has a badge: more than 999. Attention requested.',
        rule: 'the overflow clause composes the same way',
    },
];

/** One `shouldRevealViewSwitcherBar` expectation. */
export interface ViewSwitcherBarRevealVector {
    /** `AdwViewSwitcherBar:reveal` — what the layout asked for. */
    reveal: boolean;
    /** The bound stack's pages, reduced to their `visible` flag. */
    pages: readonly { readonly visible: boolean }[];
    /** Whether the action bar is actually revealed. */
    revealed: boolean;
    /** What this row pins down. */
    rule: string;
}

/**
 * `update_bar_revealed` (adw-view-switcher-bar.c:104-126) — absent from BOTH
 * ports, which each reduced `revealed` to their own boolean flag and never
 * consulted the page count. A bar bound to a one-page stack therefore showed an
 * empty strip libadwaita keeps collapsed.
 */
export const VIEW_SWITCHER_BAR_REVEAL_VECTORS: ReadonlyArray<ViewSwitcherBarRevealVector> = [
    {
        reveal: true,
        pages: [{ visible: true }, { visible: true }],
        revealed: true,
        rule: 'two visible pages reveal it',
    },
    {
        reveal: true,
        pages: [{ visible: true }],
        revealed: false,
        rule: 'REGRESSION PIN — `count > 1`, so a single page never reveals the bar',
    },
    { reveal: true, pages: [], revealed: false, rule: 'an empty stack keeps the count at 0' },
    {
        reveal: false,
        pages: [{ visible: true }, { visible: true }, { visible: true }],
        revealed: false,
        rule: 'with `reveal` FALSE the count loop never runs',
    },
    {
        reveal: true,
        pages: [{ visible: true }, { visible: false }, { visible: false }],
        revealed: false,
        rule: 'only pages with visible==TRUE count, so 1 of 3 stays collapsed',
    },
    {
        reveal: true,
        pages: [{ visible: false }, { visible: false }, { visible: true }, { visible: true }],
        revealed: true,
        rule: '2 visible out of 4 is enough, wherever they sit',
    },
];

/** One step of a {@link ViewSwitcherBarVector} script. */
export type ViewSwitcherBarStep =
    | { readonly kind: 'reveal'; readonly value: boolean }
    | { readonly kind: 'pages'; readonly pages: readonly { readonly visible: boolean }[] };

/** The `{ reveal, revealed }` pair a bar exposes. */
export interface ViewSwitcherBarSnapshot {
    /** The request. */
    reveal: boolean;
    /** The derived truth. */
    revealed: boolean;
}

/** One end-to-end switcher-bar expectation. */
export interface ViewSwitcherBarVector {
    /** What this row pins down. */
    rule: string;
    /** The C function + lines it is derived from. */
    derivedFrom: string;
    /** The script, applied in order to a fresh bar. */
    steps: readonly ViewSwitcherBarStep[];
    /**
     * Return value of each step. A `reveal` step returns whether `reveal` ITSELF
     * changed (C returns early before its notify otherwise); a `pages` step
     * returns whether `revealed` flipped.
     */
    stepResults: readonly boolean[];
    /** The state after each step, in order. */
    states: readonly ViewSwitcherBarSnapshot[];
    /** The changes emitted, in order — only a flip of `revealed` notifies. */
    changes: readonly ViewSwitcherBarSnapshot[];
}

/**
 * `AdwViewSwitcherBar`'s reveal machine end to end. `update_bar_revealed` is
 * re-run from `set_reveal`, from `set_stack` and from the pages' `items-changed`
 * (adw-view-switcher-bar.c:340-343, :383, :277), which is why the page set alone
 * can flip the bar while `reveal` never moves.
 */
export const VIEW_SWITCHER_BAR_VECTORS: ReadonlyArray<ViewSwitcherBarVector> = [
    {
        rule: 'REGRESSION PIN — a fresh bar is NOT revealed (the NativeScript port started life visible)',
        derivedFrom: 'PROP_REVEAL defaults to FALSE, adw-view-switcher-bar.c:256-259 + the init call at :277',
        steps: [],
        stepResults: [],
        states: [],
        changes: [],
    },
    {
        rule: 'reveal + two visible pages shows the bar; dropping to one page hides it again while `reveal` stays true',
        derivedFrom: 'update_bar_revealed re-run from set_reveal (:383) and from items-changed (:340-343)',
        steps: [
            { kind: 'pages', pages: [{ visible: true }, { visible: true }] },
            { kind: 'reveal', value: true },
            { kind: 'pages', pages: [{ visible: true }] },
        ],
        stepResults: [false, true, true],
        states: [
            { reveal: false, revealed: false },
            { reveal: true, revealed: true },
            { reveal: true, revealed: false },
        ],
        changes: [
            { reveal: true, revealed: true },
            { reveal: true, revealed: false },
        ],
    },
    {
        rule: 'REGRESSION PIN — revealing a one-page stack does nothing until a second page appears',
        derivedFrom: 'update_bar_revealed, adw-view-switcher-bar.c:125 `gtk_action_bar_set_revealed (…, count > 1)`',
        steps: [
            { kind: 'pages', pages: [{ visible: true }] },
            { kind: 'reveal', value: true },
            { kind: 'pages', pages: [{ visible: true }, { visible: true }] },
        ],
        stepResults: [false, true, true],
        states: [
            { reveal: false, revealed: false },
            { reveal: true, revealed: false },
            { reveal: true, revealed: true },
        ],
        changes: [{ reveal: true, revealed: true }],
    },
    {
        rule: 'setting `reveal` to the value it already has is a silent no-op',
        derivedFrom: 'adw_view_switcher_bar_set_reveal, adw-view-switcher-bar.c:379-380',
        steps: [
            { kind: 'pages', pages: [{ visible: true }, { visible: true }] },
            { kind: 'reveal', value: false },
        ],
        stepResults: [false, false],
        states: [
            { reveal: false, revealed: false },
            { reveal: false, revealed: false },
        ],
        changes: [],
    },
    {
        rule: 'hiding pages under a revealed bar collapses it without touching `reveal`',
        derivedFrom: 'update_bar_revealed counts adw_view_stack_page_get_visible only, :116-120',
        steps: [
            { kind: 'reveal', value: true },
            { kind: 'pages', pages: [{ visible: true }, { visible: true }, { visible: true }] },
            { kind: 'pages', pages: [{ visible: true }, { visible: false }, { visible: false }] },
        ],
        stepResults: [true, true, true],
        states: [
            { reveal: true, revealed: false },
            { reveal: true, revealed: true },
            { reveal: true, revealed: false },
        ],
        changes: [
            { reveal: true, revealed: true },
            { reveal: true, revealed: false },
        ],
    },
];

/** One `inlineToggleTooltip` expectation. */
export interface InlineTooltipVector {
    /** `AdwViewStackPage:title`. */
    title: string | null;
    /** `AdwViewStackPage:use-underline`. */
    useUnderline: boolean;
    /** The current display mode. */
    displayMode: AdwInlineViewSwitcherDisplayMode;
    /** The tooltip text, as PLAIN text. */
    tooltip: string;
    /** What this row pins down. */
    rule: string;
}

/**
 * `update_tooltip` (adw-inline-view-switcher.c:163-192). The browser port gated
 * on the mode correctly but used the RAW attribute, so `title="_Files"` produced
 * the tooltip `_Files`; the NativeScript port has no tooltip at all.
 */
export const INLINE_TOOLTIP_VECTORS: ReadonlyArray<InlineTooltipVector> = [
    { title: '_Files', useUnderline: true, displayMode: 'labels', tooltip: '', rule: 'labels mode clears the tooltip' },
    { title: '_Files', useUnderline: true, displayMode: 'both', tooltip: '', rule: 'both mode clears it too' },
    {
        title: '_Files',
        useUnderline: true,
        displayMode: 'icons',
        tooltip: 'Files',
        rule: 'REGRESSION PIN — icons mode strips the mnemonic instead of showing the underscore',
    },
    {
        title: '_Files',
        useUnderline: false,
        displayMode: 'icons',
        tooltip: '_Files',
        rule: 'without use-underline the title is copied verbatim, underscore included',
    },
    {
        title: 'R&D',
        useUnderline: false,
        displayMode: 'icons',
        tooltip: 'R&D',
        rule: 'C stores the markup-escaped form because GTK tooltips are markup; the renderer-neutral value is plain text',
    },
    { title: null, useUnderline: false, displayMode: 'icons', tooltip: '', rule: 'a NULL title has no tooltip' },
    { title: '', useUnderline: false, displayMode: 'icons', tooltip: '', rule: 'an empty title has no tooltip either' },
];

/** The derived per-button model a vector expects. */
export interface ExpectedViewSwitcherButton {
    /** Position in the page list. */
    pageIndex: number;
    /** The page name. */
    name: string;
    /** The text painted on the button. */
    label: string;
    /** The icon name painted on the button, never empty. */
    iconName: string;
    /** Whether the button is shown at all. */
    visible: boolean;
    /** Whether it is the selected one. */
    selected: boolean;
    /** Icon/label arrangement, from the policy. */
    orientation: 'horizontal' | 'vertical';
    /** Badge text, `''` for none. */
    badgeLabel: string;
    /** Whether the needs-attention dot is painted. */
    needsAttention: boolean;
    /** Screen-reader description, `''` for none. */
    description: string;
}

/** One `buildViewSwitcherButtons` expectation. */
export interface ViewSwitcherButtonVector {
    /** What this row pins down. */
    rule: string;
    /** The C function + lines it is derived from. */
    derivedFrom: string;
    /** The pages, in order. */
    pages: readonly ViewSwitcherVectorPage[];
    /** The selected PAGE index, `-1` for none. */
    selected: number;
    /** `AdwViewSwitcher:policy`. */
    policy: AdwViewSwitcherPolicy;
    /** One model per page — the index space is preserved, hidden buttons included. */
    buttons: readonly ExpectedViewSwitcherButton[];
}

/**
 * `AdwViewSwitcher`'s per-button derivation: `populate_switcher` adds a button
 * for EVERY page (adw-view-switcher.c:230-238) and `update_button` decides what
 * it shows and whether it is visible (:149-182).
 */
export const VIEW_SWITCHER_BUTTON_VECTORS: ReadonlyArray<ViewSwitcherButtonVector> = [
    {
        rule: 'REGRESSION PIN — a page with neither title nor icon keeps its slot but its button is HIDDEN, and a page with only an icon still gets one',
        derivedFrom: 'update_button, adw-view-switcher.c:178 + the icon fallback at adw-view-switcher-button.c:399-405',
        pages: [{ name: 'a', title: 'Home' }, { name: 'b' }, { name: 'c', iconName: 'go-home-symbolic' }],
        selected: 0,
        policy: 'narrow',
        buttons: [
            {
                pageIndex: 0,
                name: 'a',
                label: 'Home',
                iconName: 'image-missing',
                visible: true,
                selected: true,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                pageIndex: 1,
                name: 'b',
                label: '',
                iconName: 'image-missing',
                visible: false,
                selected: false,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                pageIndex: 2,
                name: 'c',
                label: '',
                iconName: 'go-home-symbolic',
                visible: true,
                selected: false,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
    },
    {
        rule: 'REGRESSION PIN — an EMPTY title keeps its button, and the wide policy lays every button out horizontally',
        derivedFrom: 'adw-view-switcher.c:178 (`title != NULL`) + the orientation ternary at :219-220, :534-537',
        pages: [
            { name: 'a', title: '' },
            { name: 'b', title: 'B' },
        ],
        selected: 1,
        policy: 'wide',
        buttons: [
            {
                pageIndex: 0,
                name: 'a',
                label: '',
                iconName: 'image-missing',
                visible: true,
                selected: false,
                orientation: 'horizontal',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                pageIndex: 1,
                name: 'b',
                label: 'B',
                iconName: 'image-missing',
                visible: true,
                selected: true,
                orientation: 'horizontal',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
    },
    {
        rule: 'a hidden page hides its button no matter what it carries',
        derivedFrom: 'adw-view-switcher.c:178 — the `visible &&` clause short-circuits',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B', iconName: 'go-next-symbolic', visible: false },
        ],
        selected: 0,
        policy: 'narrow',
        buttons: [
            {
                pageIndex: 0,
                name: 'a',
                label: 'A',
                iconName: 'image-missing',
                visible: true,
                selected: true,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                pageIndex: 1,
                name: 'b',
                label: 'B',
                iconName: 'go-next-symbolic',
                visible: false,
                selected: false,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
    },
    {
        rule: 'badges and needs-attention reach the button, with the description AdwIndicatorBin derives',
        derivedFrom:
            'update_button binds both onto the button (adw-view-switcher.c:161-176) → adw-indicator-bin.c:58-113',
        pages: [
            { name: 'a', title: 'Inbox', badgeNumber: 7 },
            { name: 'b', title: 'Spam', badgeNumber: 1000, needsAttention: true },
            { name: 'c', title: 'Sent', needsAttention: true },
        ],
        selected: 0,
        policy: 'wide',
        buttons: [
            {
                pageIndex: 0,
                name: 'a',
                label: 'Inbox',
                iconName: 'image-missing',
                visible: true,
                selected: true,
                orientation: 'horizontal',
                badgeLabel: '7',
                needsAttention: false,
                description: 'Has a badge: 7.',
            },
            {
                pageIndex: 1,
                name: 'b',
                label: 'Spam',
                iconName: 'image-missing',
                visible: true,
                selected: false,
                orientation: 'horizontal',
                badgeLabel: '999+',
                needsAttention: true,
                description: 'Has a badge: more than 999. Attention requested.',
            },
            {
                pageIndex: 2,
                name: 'c',
                label: 'Sent',
                iconName: 'image-missing',
                visible: true,
                selected: false,
                orientation: 'horizontal',
                badgeLabel: '',
                needsAttention: true,
                description: 'Attention requested.',
            },
        ],
    },
    {
        rule: 'REGRESSION PIN — use-underline decides whether the accel marker is part of the painted label',
        derivedFrom:
            'update_button binds title + use-underline onto the button, whose template label carries use-underline (adw-view-switcher-button.ui)',
        pages: [
            { name: 'a', title: '_Files', useUnderline: true },
            { name: 'b', title: '_Files' },
        ],
        selected: 0,
        policy: 'narrow',
        buttons: [
            {
                pageIndex: 0,
                name: 'a',
                label: 'Files',
                iconName: 'image-missing',
                visible: true,
                selected: true,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                pageIndex: 1,
                name: 'b',
                label: '_Files',
                iconName: 'image-missing',
                visible: true,
                selected: false,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
    },
    {
        rule: 'with nothing selected no button is marked selected — -1 is a real state, not "page 0"',
        derivedFrom: 'add_child reads gtk_selection_model_is_selected per page (adw-view-switcher.c:209-217)',
        pages: [{ name: 'a', title: 'A' }],
        selected: -1,
        policy: 'narrow',
        buttons: [
            {
                pageIndex: 0,
                name: 'a',
                label: 'A',
                iconName: 'image-missing',
                visible: true,
                selected: false,
                orientation: 'vertical',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
    },
];

/** The derived per-toggle model a vector expects. */
export interface ExpectedInlineToggle {
    /** Position among the toggles — compacted. */
    toggleIndex: number;
    /** Position in the page list — libadwaita's `child-index`. */
    pageIndex: number;
    /** The page name. */
    name: string;
    /** The text painted on the toggle. */
    label: string;
    /** The icon name painted on the toggle, never empty. */
    iconName: string;
    /** Whether this display mode builds an icon. */
    showIcon: boolean;
    /** Whether this display mode builds a label. */
    showLabel: boolean;
    /** Tooltip text, `''` outside icons mode. */
    tooltip: string;
    /** Badge text, `''` for none. */
    badgeLabel: string;
    /** Whether the needs-attention dot is painted. */
    needsAttention: boolean;
    /** Screen-reader description, `''` for none. */
    description: string;
}

/** One `buildInlineToggles` + index-mapping expectation. */
export interface InlineToggleVector {
    /** What this row pins down. */
    rule: string;
    /** The C function + lines it is derived from. */
    derivedFrom: string;
    /** The pages, in order. */
    pages: readonly ViewSwitcherVectorPage[];
    /** `AdwInlineViewSwitcher:display-mode`. */
    displayMode: AdwInlineViewSwitcherDisplayMode;
    /** One model per VISIBLE page. */
    toggles: readonly ExpectedInlineToggle[];
    /** `toggleIndexForPage` for every page index, in order — `-1` for a hidden page. */
    toggleIndexByPage: readonly number[];
    /** `pageIndexForToggle` for every toggle index, in order. */
    pageIndexByToggle: readonly number[];
}

/**
 * The inline switcher's TWO index spaces, plus what each display mode builds.
 *
 * `populate_group` calls `add_toggle` only for visible pages and passes the PAGE
 * index `i`, which `add_toggle` stashes as `child-index`
 * (adw-inline-view-switcher.c:370-378, :346); `notify_active_cb` reads it back
 * (:114-129) and `selection_changed_cb` walks the other way (:434-453). Neither
 * port filtered hidden pages, so the mapping looked like the identity and the
 * `-1` sentinel had no spelling.
 */
export const INLINE_TOGGLE_VECTORS: ReadonlyArray<InlineToggleVector> = [
    {
        rule: 'REGRESSION PIN — a hidden page produces NO toggle, so toggleIndex and pageIndex diverge',
        derivedFrom: 'populate_group + add_toggle, adw-inline-view-switcher.c:370-378, :346',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B', visible: false },
            { name: 'c', title: 'C' },
            { name: 'd', title: 'D' },
        ],
        displayMode: 'labels',
        toggles: [
            {
                toggleIndex: 0,
                pageIndex: 0,
                name: 'a',
                label: 'A',
                iconName: 'image-missing',
                showIcon: false,
                showLabel: true,
                tooltip: '',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                toggleIndex: 1,
                pageIndex: 2,
                name: 'c',
                label: 'C',
                iconName: 'image-missing',
                showIcon: false,
                showLabel: true,
                tooltip: '',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                toggleIndex: 2,
                pageIndex: 3,
                name: 'd',
                label: 'D',
                iconName: 'image-missing',
                showIcon: false,
                showLabel: true,
                tooltip: '',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
        toggleIndexByPage: [0, -1, 1, 2],
        pageIndexByToggle: [0, 2, 3],
    },
    {
        rule: 'icons mode builds no label and DOES set a mnemonic-stripped tooltip',
        derivedFrom: 'update_toggle ICONS branch (adw-inline-view-switcher.c:270-288) + update_tooltip (:163-192)',
        pages: [
            { name: 'a', title: '_Files', useUnderline: true, iconName: 'folder-symbolic' },
            { name: 'b', title: 'R&D' },
        ],
        displayMode: 'icons',
        toggles: [
            {
                toggleIndex: 0,
                pageIndex: 0,
                name: 'a',
                label: 'Files',
                iconName: 'folder-symbolic',
                showIcon: true,
                showLabel: false,
                tooltip: 'Files',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                toggleIndex: 1,
                pageIndex: 1,
                name: 'b',
                label: 'R&D',
                iconName: 'image-missing',
                showIcon: true,
                showLabel: false,
                tooltip: 'R&D',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
        toggleIndexByPage: [0, 1],
        pageIndexByToggle: [0, 1],
    },
    {
        rule: 'both mode builds icon AND label, and clears the tooltip',
        derivedFrom:
            'update_toggle BOTH branch, adw-inline-view-switcher.c:289-319 (adw_toggle_set_tooltip "" at :310)',
        pages: [{ name: 'a', title: 'A', iconName: 'go-home-symbolic', badgeNumber: 3, needsAttention: true }],
        displayMode: 'both',
        toggles: [
            {
                toggleIndex: 0,
                pageIndex: 0,
                name: 'a',
                label: 'A',
                iconName: 'go-home-symbolic',
                showIcon: true,
                showLabel: true,
                tooltip: '',
                badgeLabel: '3',
                needsAttention: true,
                description: 'Has a badge: 3. Attention requested.',
            },
        ],
        toggleIndexByPage: [0],
        pageIndexByToggle: [0],
    },
    {
        rule: 'with every page hidden there are no toggles at all and nothing maps',
        derivedFrom: 'populate_group leaves the group empty and calls set_active(GTK_INVALID_LIST_POSITION), :370-390',
        pages: [
            { name: 'a', title: 'A', visible: false },
            { name: 'b', title: 'B', visible: false },
        ],
        displayMode: 'labels',
        toggles: [],
        toggleIndexByPage: [-1, -1],
        pageIndexByToggle: [],
    },
    {
        rule: 'the title-or-icon rule does NOT apply here — a page with neither still gets a toggle',
        derivedFrom:
            'populate_group gates on adw_view_stack_page_get_visible alone (:374); the title/icon predicate lives only in AdwViewSwitcher.update_button',
        pages: [{ name: 'a' }, { name: 'b', title: 'B' }],
        displayMode: 'labels',
        toggles: [
            {
                toggleIndex: 0,
                pageIndex: 0,
                name: 'a',
                label: '',
                iconName: 'image-missing',
                showIcon: false,
                showLabel: true,
                tooltip: '',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
            {
                toggleIndex: 1,
                pageIndex: 1,
                name: 'b',
                label: 'B',
                iconName: 'image-missing',
                showIcon: false,
                showLabel: true,
                tooltip: '',
                badgeLabel: '',
                needsAttention: false,
                description: '',
            },
        ],
        toggleIndexByPage: [0, 1],
        pageIndexByToggle: [0, 1],
    },
];

/** One change notification, in the order it is emitted. */
export interface ViewSwitcherVectorChange {
    /** Index of the newly-selected page, `-1` for none. */
    selected: number;
    /** Its name, `''` for none. */
    name: string;
    /** Its painted label, `''` for none. */
    title: string;
    /** `true` for a user activation or an explicit select; `false` for an auto-pick. */
    interactive: boolean;
}

/** One operation a selection vector applies after its pages exist. */
export type ViewSwitcherVectorOp =
    | { readonly kind: 'selectIndex'; readonly index: number }
    | { readonly kind: 'selectName'; readonly name: string | null | undefined }
    | { readonly kind: 'setPageVisible'; readonly name: string; readonly visible: boolean };

/** One end-to-end switcher-selection expectation. */
export interface ViewSwitcherSelectionVector {
    /** What this row pins down. */
    rule: string;
    /** The C function + lines it is derived from. */
    derivedFrom: string;
    /** The pages, set in this order. */
    pages: readonly ViewSwitcherVectorPage[];
    /** Changes emitted WHILE the pages are set (the auto-pick), in order. */
    setupChanges: readonly ViewSwitcherVectorChange[];
    /** Operations applied after the pages exist. */
    ops: readonly ViewSwitcherVectorOp[];
    /**
     * Return value of each op, in order. Asserted by the core and NativeScript
     * suites; the browser suite drives property setters, which return nothing,
     * and asserts `changes` plus the final state instead.
     */
    opResults: readonly boolean[];
    /** Changes emitted BY the ops, in order. */
    changes: readonly ViewSwitcherVectorChange[];
    /** Final selected page index, `-1` for none. */
    selected: number;
    /** Final selected page name, `''` for none. */
    selectedName: string;
    /** Final selected page label, `''` for none. */
    selectedTitle: string;
    /** Expected diagnostics (C's `g_warning` texts), when the row exercises them. */
    diagnostics?: readonly string[];
}

/**
 * The selection machine a switcher drives, which is the bound stack's — the
 * switcher owns no selection property of its own (adw-view-switcher.c:126-147
 * goes straight to `gtk_selection_model_select_item`).
 *
 * The refusal rows are the ones both ports failed differently: the browser
 * switcher CLAMPED an out-of-range or negative index into range (so `active="-1"`
 * jumped to the first page and `active="99"` to the last), and both stacks
 * accepted a fractional index and then matched no page at all.
 */
export const VIEW_SWITCHER_SELECTION_VECTORS: ReadonlyArray<ViewSwitcherSelectionVector> = [
    {
        rule: 'the first page is selected automatically, and that auto-pick NOTIFIES',
        derivedFrom: 'add_page, adw-view-stack.c:1149-1151 → the notify at :1038-1039',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [],
        opResults: [],
        changes: [],
        selected: 0,
        selectedName: 'a',
        selectedTitle: 'A',
    },
    {
        rule: 'activating another tab selects its page and reports the activation as interactive',
        derivedFrom: 'on_button_toggled → gtk_selection_model_select_item, adw-view-switcher.c:134-139',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [{ kind: 'selectIndex', index: 2 }],
        opResults: [true],
        changes: [{ selected: 2, name: 'c', title: 'C', interactive: true }],
        selected: 2,
        selectedName: 'c',
        selectedTitle: 'C',
    },
    {
        rule: 'activating the ALREADY-active tab is a net no-op',
        derivedFrom:
            'on_button_toggled, adw-view-switcher.c:140-146 — deactivating the active toggle re-reads the model and restores the button',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [{ kind: 'selectIndex', index: 0 }],
        opResults: [false],
        changes: [],
        selected: 0,
        selectedName: 'a',
        selectedTitle: 'A',
    },
    {
        rule: 'REGRESSION PIN — an index past the end is REFUSED, not clamped to the last page (the browser switcher clamped)',
        derivedFrom: 'adw_view_stack_pages_select_item, adw-view-stack.c:682-684 — returns FALSE, no clamp anywhere',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [{ kind: 'selectIndex', index: 5 }],
        opResults: [false],
        changes: [],
        selected: 0,
        selectedName: 'a',
        selectedTitle: 'A',
    },
    {
        rule: 'REGRESSION PIN — a negative index is REFUSED, not clamped to the first page (the browser switcher clamped)',
        derivedFrom: 'positions are guint, so -1 wraps to G_MAXUINT and fails the bound check at adw-view-stack.c:682',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [
            { kind: 'selectIndex', index: 1 },
            { kind: 'selectIndex', index: -1 },
        ],
        opResults: [true, false],
        changes: [{ selected: 1, name: 'b', title: 'B', interactive: true }],
        selected: 1,
        selectedName: 'b',
        selectedTitle: 'B',
    },
    {
        rule: 'REGRESSION PIN — a fractional index is refused; both ports stored it and then matched no page, blanking the widget',
        derivedFrom: 'adw_view_stack_pages_select_item takes a guint position, adw-view-stack.c:675-683',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [
            { kind: 'selectIndex', index: 1.5 },
            { kind: 'selectIndex', index: Number.NaN },
        ],
        opResults: [false, false],
        changes: [],
        selected: 0,
        selectedName: 'a',
        selectedTitle: 'A',
    },
    {
        rule: 'selecting by name works and an unknown name changes nothing',
        derivedFrom: 'adw_view_stack_set_visible_child_name, adw-view-stack.c:2404-2415 (g_warning at :2410)',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [
            { kind: 'selectName', name: 'c' },
            { kind: 'selectName', name: 'missing' },
        ],
        opResults: [true, false],
        changes: [{ selected: 2, name: 'c', title: 'C', interactive: true }],
        selected: 2,
        selectedName: 'c',
        selectedTitle: 'C',
        diagnostics: ["Child name 'missing' not found in AdwViewStack"],
    },
    {
        rule: 'the first VISIBLE page is auto-selected, not the first declared',
        derivedFrom: "add_page's visibility gate, adw-view-stack.c:1149-1151",
        pages: [
            { name: 'a', title: 'A', visible: false },
            { name: 'b', title: 'B' },
        ],
        setupChanges: [{ selected: 1, name: 'b', title: 'B', interactive: false }],
        ops: [],
        opResults: [],
        changes: [],
        selected: 1,
        selectedName: 'b',
        selectedTitle: 'B',
    },
    {
        rule: 'hiding the selected page falls back to the first still-visible one, as an auto-pick',
        derivedFrom: 'update_child_visible → set_visible_child(NULL) scan, adw-view-stack.c:1071-1072, :961-974',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [{ kind: 'setPageVisible', name: 'a', visible: false }],
        opResults: [true],
        changes: [{ selected: 1, name: 'b', title: 'B', interactive: false }],
        selected: 1,
        selectedName: 'b',
        selectedTitle: 'B',
    },
    {
        rule: 'a hidden page cannot be selected — the switcher may still show its (hidden) slot, but the selection refuses',
        derivedFrom: 'adw_view_stack_set_visible_child_name, adw-view-stack.c:2415',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B', visible: false },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        ops: [{ kind: 'selectIndex', index: 1 }],
        opResults: [false],
        changes: [],
        selected: 0,
        selectedName: 'a',
        selectedTitle: 'A',
    },
    {
        rule: 'with every page hidden nothing is selected and nothing is emitted',
        derivedFrom: 'the set_visible_child NULL scan finds nothing, adw-view-stack.c:961-977',
        pages: [
            { name: 'a', title: 'A', visible: false },
            { name: 'b', title: 'B', visible: false },
        ],
        setupChanges: [],
        ops: [],
        opResults: [],
        changes: [],
        selected: -1,
        selectedName: '',
        selectedTitle: '',
    },
    {
        rule: 'the reported title is the PAINTED label, so a mnemonic title reports its stripped form',
        derivedFrom:
            'the button label carries use-underline (adw-view-switcher-button.ui) → adw_strip_mnemonic semantics',
        pages: [
            { name: 'a', title: '_Files', useUnderline: true },
            { name: 'b', title: 'B' },
        ],
        setupChanges: [{ selected: 0, name: 'a', title: 'Files', interactive: false }],
        ops: [],
        opResults: [],
        changes: [],
        selected: 0,
        selectedName: 'a',
        selectedTitle: 'Files',
    },
];

/** One page-list rebuild expectation. */
export interface ViewSwitcherRebuildVector {
    /** What this row pins down. */
    rule: string;
    /** The C function + lines it is derived from. */
    derivedFrom: string;
    /** The initial pages. */
    pages: readonly ViewSwitcherVectorPage[];
    /** A page name to select before the rebuild; omitted keeps the auto-pick. */
    select?: string;
    /** The replacement pages. */
    nextPages: readonly ViewSwitcherVectorPage[];
    /** Changes emitted BY the rebuild, in order. */
    changes: readonly ViewSwitcherVectorChange[];
    /** Selected page index after the rebuild. */
    selected: number;
    /** Selected page name after the rebuild. */
    selectedName: string;
}

/**
 * What happens to the selection when the page list is replaced wholesale — the
 * shape both renderers actually use (`setViews` on NativeScript, a re-parse on
 * the browser side).
 *
 * libadwaita's selection is a page POINTER compared by identity
 * (`adw_view_stack_pages_is_selected`, adw-view-stack.c:660-672), so it follows
 * the page across inserts instead of pinning an index; a rebuild that drops the
 * selected page falls through to the first-visible auto-pick
 * (adw-view-switcher.c:258-263).
 */
export const VIEW_SWITCHER_REBUILD_VECTORS: ReadonlyArray<ViewSwitcherRebuildVector> = [
    {
        rule: 'the selection follows the PAGE across an insert before it, so its index shifts',
        derivedFrom: 'adw_view_stack_pages_is_selected compares page identity, adw-view-stack.c:660-672',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        select: 'b',
        nextPages: [
            { name: 'x', title: 'X' },
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        changes: [{ selected: 2, name: 'b', title: 'B', interactive: false }],
        selected: 2,
        selectedName: 'b',
    },
    {
        rule: 'a rebuild that DROPS the selected page falls back to the first visible one',
        derivedFrom:
            'items_changed_cb → clear + populate (adw-view-switcher.c:258-263) over the auto-pick at adw-view-stack.c:1149-1151',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        select: 'b',
        nextPages: [
            { name: 'a', title: 'A' },
            { name: 'c', title: 'C' },
        ],
        changes: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        selected: 0,
        selectedName: 'a',
    },
    {
        rule: 'a rebuild that leaves the selected page where it was emits nothing',
        derivedFrom: 'set_visible_child idempotence guard, adw-view-stack.c:976-977',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        select: 'b',
        nextPages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        changes: [],
        selected: 1,
        selectedName: 'b',
    },
    {
        rule: 'a page that survives the rebuild but is now HIDDEN loses the selection to the auto-pick',
        derivedFrom: 'the restore goes through select_item, which refuses a hidden page (adw-view-stack.c:2415)',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
        ],
        select: 'b',
        nextPages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B', visible: false },
        ],
        changes: [{ selected: 0, name: 'a', title: 'A', interactive: false }],
        selected: 0,
        selectedName: 'a',
    },
    {
        rule: 'rebuilding to an empty list selects nothing and says so',
        derivedFrom: 'select_item bound check with children->len == 0, adw-view-stack.c:682-683',
        pages: [{ name: 'a', title: 'A' }],
        nextPages: [],
        changes: [{ selected: -1, name: '', title: '', interactive: false }],
        selected: -1,
        selectedName: '',
    },
];

/** One step of a {@link ViewSwitcherDragVector} script. */
export type ViewSwitcherDragStep =
    | { readonly kind: 'enter'; readonly index: number }
    | { readonly kind: 'leave'; readonly index: number }
    | { readonly kind: 'advance'; readonly ms: number };

/** One drag-hover auto-switch expectation. */
export interface ViewSwitcherDragVector {
    /** What this row pins down. */
    rule: string;
    /** The C function + lines it is derived from. */
    derivedFrom: string;
    /** The pages. */
    pages: readonly ViewSwitcherVectorPage[];
    /** The page index selected before the drag starts. */
    initial: number;
    /** The drag script. */
    steps: readonly ViewSwitcherDragStep[];
    /** Changes emitted by the script, in order. */
    changes: readonly ViewSwitcherVectorChange[];
    /** Selected page index once the script has run. */
    selected: number;
}

/**
 * `TIMEOUT_EXPAND` — the 500 ms dwell that switches pages mid-drag. Defined
 * identically in both C files (adw-view-switcher-button.c:14, :58-96;
 * adw-inline-view-switcher.c:80, :194-236) and present in NEITHER port, which
 * only ever listened for `click`/`tap`.
 *
 * `interactive: true` on the resulting change: the C timeout activates the
 * toggle, which runs the very same `on_button_toggled` a click does.
 */
export const VIEW_SWITCHER_DRAG_VECTORS: ReadonlyArray<ViewSwitcherDragVector> = [
    {
        rule: '499 ms of dwell is not enough',
        derivedFrom: 'TIMEOUT_EXPAND 500 with g_timeout_add_once, adw-view-switcher-button.c:14, :85-89',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        initial: 0,
        steps: [
            { kind: 'enter', index: 2 },
            { kind: 'advance', ms: 499 },
        ],
        changes: [],
        selected: 0,
    },
    {
        rule: '500 ms of dwell switches to the hovered page, exactly as a click would',
        derivedFrom:
            'switch_timeout_cb, adw-view-switcher-button.c:58-63; the inline twin at adw-inline-view-switcher.c:194-204',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        initial: 0,
        steps: [
            { kind: 'enter', index: 2 },
            { kind: 'advance', ms: 500 },
        ],
        changes: [{ selected: 2, name: 'c', title: 'C', interactive: true }],
        selected: 2,
    },
    {
        rule: 'hovering the ALREADY-active tab arms nothing at all',
        derivedFrom: 'drag_enter_cb early-returns on an active button, adw-view-switcher-button.c:82-83 (:219 inline)',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        initial: 0,
        steps: [
            { kind: 'enter', index: 0 },
            { kind: 'advance', ms: 1000 },
        ],
        changes: [],
        selected: 0,
    },
    {
        rule: 'leaving before the dwell elapses cancels the pending switch',
        derivedFrom:
            'drag_leave_cb removes the source, adw-view-switcher-button.c:93-96; adw-inline-view-switcher.c:228-236',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        initial: 0,
        steps: [
            { kind: 'enter', index: 2 },
            { kind: 'leave', index: 2 },
            { kind: 'advance', ms: 1000 },
        ],
        changes: [],
        selected: 0,
    },
    {
        rule: 'each button owns its OWN timer — leaving one does not disarm another',
        derivedFrom:
            'the timer is stored per widget: `self->switch_timer` (adw-view-switcher-button.c:50) and the per-toggle "switch-timer" data (adw-inline-view-switcher.c:223-224)',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B' },
            { name: 'c', title: 'C' },
        ],
        initial: 0,
        steps: [
            { kind: 'enter', index: 1 },
            { kind: 'enter', index: 2 },
            { kind: 'leave', index: 1 },
            { kind: 'advance', ms: 500 },
        ],
        changes: [{ selected: 2, name: 'c', title: 'C', interactive: true }],
        selected: 2,
    },
    {
        rule: 'a dwell over a HIDDEN page fires but selects nothing — the selection guard still applies',
        derivedFrom:
            'switch_timeout_cb activates the toggle, whose select_item is refused for a hidden page (adw-view-stack.c:2415)',
        pages: [
            { name: 'a', title: 'A' },
            { name: 'b', title: 'B', visible: false },
        ],
        initial: 0,
        steps: [
            { kind: 'enter', index: 1 },
            { kind: 'advance', ms: 500 },
        ],
        changes: [],
        selected: 0,
    },
];

/** A deterministic stand-in for a platform timer, driven by {@link advance}. */
export interface ViewSwitcherClock extends ViewSwitcherScheduler {
    /** Move the clock forward, firing every dwell whose deadline has passed. */
    advance(ms: number): void;
    /** How many dwells are still pending. */
    readonly pending: number;
}

/**
 * A fake clock for the drag vectors.
 *
 * Note WHAT it is: a clock, not a stand-in for any behaviour under test. It
 * schedules and cancels callbacks and nothing else, so it cannot transcribe the
 * logic it is used to exercise.
 *
 * WHO DRIVES THOSE VECTORS: the core suite, and only it. This said "the core,
 * browser and NativeScript suites all" — a claim of coverage that was never
 * true, which is worse than silence, because it reads as a reason to stop
 * looking. The browser elements construct
 * `new ViewSwitcherState({ scheduler: domViewSwitcherScheduler })` inline
 * (`elements/adw-view-switcher.ts`, `elements/adw-inline-view-switcher.ts`), so
 * there is no seam to hand this clock through, and the NativeScript port has no
 * drag surface at all. Wiring the browser side means giving the elements a
 * scheduler seam first.
 */
export function createViewSwitcherClock(): ViewSwitcherClock {
    let now = 0;
    let nextId = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();

    return {
        schedule(callback: () => void, ms: number): ViewSwitcherTimerHandle {
            const id = nextId++;
            timers.set(id, { at: now + ms, callback });
            return id;
        },
        cancel(handle: ViewSwitcherTimerHandle): void {
            if (typeof handle === 'number') timers.delete(handle);
        },
        advance(ms: number): void {
            now += ms;
            // Snapshot and order by deadline: a callback may schedule or cancel
            // further dwells, and a live Map iterator would trip over both.
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.at <= now)
                .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId);
            for (const [id, timer] of due) {
                if (!timers.has(id)) continue;
                timers.delete(id);
                timer.callback();
            }
        },
        get pending(): number {
            return timers.size;
        },
    };
}
