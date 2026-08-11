// Headless Adwaita view-switcher derivations (ADR 0004 — headless Adwaita core).
//
// The markup is per-renderer (`AdwViewSwitcher` is a homogeneous `GtkBox` of toggle
// buttons; the browser is a flex row of `<button>`, NativeScript a `StackLayout` of
// tappable `StackLayout`s), so what transfers is the derivation over the page list:
// 1. the button-visibility predicate `visible && (title != NULL || icon_name !=
// NULL)` — an EMPTY title is not NULL, so a titleless-but-named page still gets
// a button while a page with neither title nor icon gets none;
// 2. the `image-missing` substitution for a NULL/empty icon name;
// 3. `update_bar_revealed`: the bar is revealed only when `reveal` is set AND MORE
// THAN ONE page is visible;
// 4. the inline switcher's TWO index spaces — a hidden page produces no toggle, so
// libadwaita stashes the PAGE index on every toggle as `child-index` and maps
// back through it, with `GTK_INVALID_LIST_POSITION` as the "nothing active"
// sentinel;
// 5. the badge / needs-attention label and the screen-reader description
// `AdwIndicatorBin` derives from them.
//
// SELECTION IS NOT REIMPLEMENTED HERE. libadwaita's switchers own no selection
// property at all — every change flows through the bound `AdwViewStack`'s selection
// model — so {@link ViewSwitcherState} COMPOSES {@link ViewStackState} for the index
// guards, the by-name lookup, the first-VISIBLE-page auto-pick and the hide-fallback,
// and adds only the C-faithful page record (nullable title and icon name, plus badge /
// needs-attention / use-underline) plus the derivations above.
//
// Reference: refs/libadwaita/src/adw-view-switcher.c
// Reference: refs/libadwaita/src/adw-view-switcher-button.c
// Reference: refs/libadwaita/src/adw-view-switcher-bar.c
// Reference: refs/libadwaita/src/adw-inline-view-switcher.c
// Reference: refs/libadwaita/src/adw-indicator-bin.c
// Reference: refs/libadwaita/src/adw-widget-utils.c (adw_strip_mnemonic)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { ViewStackState } from './view-stack.js';
import { stripMnemonic } from './glib.js';
import type { AdwViewStackPageInfo, ViewStackStateChange } from './view-stack.js';

/**
 * The "nothing is selected" sentinel, standing in for `GTK_INVALID_LIST_POSITION`.
 * Returned by {@link toggleIndexForPage} / {@link pageIndexForToggle} when the two index
 * spaces have no counterpart for each other — a hidden page has no toggle at all, a state
 * `ToggleGroupState`'s always-non-negative `selected` cannot express.
 */
export const VIEW_SWITCHER_NO_SELECTION = -1;

/** The icon substituted for a NULL or empty icon name. */
export const VIEW_SWITCHER_FALLBACK_ICON = 'image-missing';

/**
 * `TIMEOUT_EXPAND` — how long a drag must dwell over a non-active button before it
 * switches to it. Defined identically in both C files.
 */
export const VIEW_SWITCHER_DRAG_SWITCH_DELAY = 500;

/** The largest badge `AdwIndicatorBin` prints; anything above collapses to `999+`. */
export const VIEW_SWITCHER_BADGE_LIMIT = 999;

/** `AdwViewSwitcherPolicy` — which button layout the switcher forces. */
export type AdwViewSwitcherPolicy = 'narrow' | 'wide';

/**
 * Every policy, in enum order. Doubles as the style-class list: libadwaita adds the
 * current policy's class and removes the other, so a renderer toggles each entry against
 * the current value rather than hard-coding an add/remove pair.
 */
export const VIEW_SWITCHER_POLICIES: readonly AdwViewSwitcherPolicy[] = ['narrow', 'wide'];

/** `AdwInlineViewSwitcherDisplayMode` — what the inline switcher's toggles show. */
export type AdwInlineViewSwitcherDisplayMode = 'labels' | 'icons' | 'both';

/**
 * Every display mode, in enum order — and the toggle-group style classes, same
 * toggle-against-current pattern as {@link VIEW_SWITCHER_POLICIES}.
 */
export const INLINE_VIEW_SWITCHER_DISPLAY_MODES: readonly AdwInlineViewSwitcherDisplayMode[] = [
    'labels',
    'icons',
    'both',
];

/**
 * Whether `value` is a policy libadwaita would accept. The C setter is guarded by the
 * enum's own type (`g_value_get_enum`); coercing an unrecognised value to a default is
 * NOT the same thing — see {@link isInlineViewSwitcherDisplayMode}.
 */
export function isViewSwitcherPolicy(value: unknown): value is AdwViewSwitcherPolicy {
    return value === 'narrow' || value === 'wide';
}

/**
 * Whether `value` is a display mode libadwaita would accept.
 * `adw_inline_view_switcher_set_display_mode` opens with
 * `g_return_if_fail (mode <= ADW_INLINE_VIEW_SWITCHER_BOTH)`, which REJECTS the call and
 * leaves the current mode alone — substituting a default instead would let a typo in one
 * attribute silently change what every toggle displays.
 */
export function isInlineViewSwitcherDisplayMode(value: unknown): value is AdwInlineViewSwitcherDisplayMode {
    return value === 'labels' || value === 'icons' || value === 'both';
}

/**
 * The page record every switcher flavour reads — `AdwViewStackPage`'s properties with
 * their C defaults.
 *
 * `null` vs `''` is LOAD-BEARING and is why this record exists next to
 * {@link AdwViewStackPageInfo} rather than being replaced by it: the button-visibility
 * rule tests `title != NULL` and an empty title is not NULL, while the stack page model
 * resolves an absent title to the page NAME. So "had no title at all" only survives where
 * the switcher owns its own pages.
 */
export interface AdwViewSwitcherPage {
    /** Stable id, matching `AdwViewStackPage`'s name. */
    name: string;
    /** `AdwViewStackPage:title` — `null` when the page has none (C default). */
    title: string | null;
    /** `AdwViewStackPage:icon-name` — `null` when the page has none (C default). */
    iconName: string | null;
    /** `AdwViewStackPage:visible` — default `true`. Gates both the button and the toggle. */
    visible: boolean;
    /** `AdwViewStackPage:use-underline` — default `false`. An `_` in the title marks a mnemonic. */
    useUnderline: boolean;
    /** `AdwViewStackPage:badge-number` — default `0`, i.e. no badge. */
    badgeNumber: number;
    /** `AdwViewStackPage:needs-attention` — default `false`, i.e. no dot. */
    needsAttention: boolean;
}

/** What a caller has to supply for a page: the name, plus whatever it knows. */
export interface AdwViewSwitcherPageInit extends Partial<AdwViewSwitcherPage> {
    /** Stable id, matching `AdwViewStackPage`'s name. */
    name: string;
}

/**
 * Normalize a partial page into the full record with the C defaults applied, so a renderer
 * that only knows `{ name, title }` gets the same derivations as one that knows badges.
 * `undefined` collapses to the C default, an explicit `null` title or icon name stays
 * `null`, and the badge becomes a non-negative integer because `badge-number` is a `guint`.
 */
export function createViewSwitcherPage(init: AdwViewSwitcherPageInit): AdwViewSwitcherPage {
    return {
        name: init.name,
        title: init.title ?? null,
        iconName: init.iconName ?? null,
        visible: init.visible ?? true,
        useUnderline: init.useUnderline ?? false,
        badgeNumber: normalizeBadgeNumber(init.badgeNumber),
        needsAttention: init.needsAttention ?? false,
    };
}

/**
 * Project a stack page descriptor onto a switcher page, for a switcher BOUND to an
 * `Adw.ViewStack` rather than owning its own pages. Fidelity note:
 * `AdwViewStackPageInfo.title` is already resolved against the page name, so it is never
 * `null` and the button-visibility rule reduces to the `visible` flag.
 */
export function viewSwitcherPageFromStackPage(page: AdwViewStackPageInfo): AdwViewSwitcherPage {
    return createViewSwitcherPage({
        name: page.name,
        title: page.title,
        // `''` is the stack model's spelling of "no icon"; the switcher's is
        // `null`, which is what turns on the image-missing fallback.
        iconName: page.icon.length > 0 ? page.icon : null,
        visible: page.visible,
        badgeNumber: page.badgeNumber,
        needsAttention: page.needsAttention,
        useUnderline: page.useUnderline,
    });
}

/** {@link viewSwitcherPageFromStackPage} over a whole page list. */
export function viewSwitcherPagesFromStack(pages: readonly AdwViewStackPageInfo[]): AdwViewSwitcherPage[] {
    return pages.map((page) => viewSwitcherPageFromStackPage(page));
}

/**
 * `update_button`'s visibility rule: `visible && (title != NULL || icon_name != NULL)`.
 * The empty string is NOT NULL, so `title: ''` still yields a button; `undefined` is read
 * as absent, i.e. as C's NULL.
 */
export function isViewSwitcherButtonVisible(
    page: Pick<AdwViewSwitcherPage, 'visible' | 'title' | 'iconName'>,
): boolean {
    return page.visible && (isPresent(page.title) || isPresent(page.iconName));
}

/**
 * The icon a switcher actually renders: a NULL or EMPTY name becomes `image-missing` (C's
 * `icon_name && *icon_name` fails on `''`). Never returns `''`, so a renderer has an icon
 * to paint in every mode where the C widget creates a `GtkImage` at all — otherwise an
 * icon-only toggle for a page without an icon renders as a blank box.
 */
export function viewSwitcherIconName(iconName: string | null | undefined): string {
    return isPresent(iconName) && iconName.length > 0 ? iconName : VIEW_SWITCHER_FALLBACK_ICON;
}

/**
 * The text a switcher paints for a page: `''` for a NULL title, otherwise the title with
 * its mnemonic stripped when `use-underline` is set. GTK DISPLAYS `_Files` as `Files` with
 * an underlined F (the template label carries `use-underline` too), so a renderer with no
 * accelerator layer must display the same text — keeping the underscore renders a literal
 * one.
 */
export function viewSwitcherLabel(page: Pick<AdwViewSwitcherPage, 'title' | 'useUnderline'>): string {
    if (!isPresent(page.title)) return '';
    return page.useUnderline ? stripMnemonic(page.title) : page.title;
}

/**
 * `get_badge_label`: `''` for 0, `999+` above 999, the decimal otherwise. 999 itself
 * prints, because the test is `> 999`.
 */
export function viewSwitcherBadgeLabel(badgeNumber: number): string {
    const badge = normalizeBadgeNumber(badgeNumber);
    if (badge > VIEW_SWITCHER_BADGE_LIMIT) return `${VIEW_SWITCHER_BADGE_LIMIT}+`;
    if (badge === 0) return '';
    return String(badge);
}

/**
 * The message catalogue {@link viewSwitcherIndicatorDescription} composes, so the core
 * needs no gettext dependency while the composition ORDER stays pinned. C reads these
 * through `C_("view switcher button badge", …)`; a renderer with a translation layer
 * passes its own catalogue.
 */
export interface IndicatorDescriptionStrings {
    /** `needs-attention` clause — C's "Attention requested." */
    attentionRequested: string;
    /** Badge clause above the limit — C's "Has a badge: more than 999." */
    badgeOverflow: string;
    /** Badge clause for a printable count — C's "Has a badge: %u." */
    badge: (badgeNumber: number) => string;
}

/** The English source strings from `adw-indicator-bin.c`. */
export const DEFAULT_INDICATOR_DESCRIPTION_STRINGS: IndicatorDescriptionStrings = {
    attentionRequested: 'Attention requested.',
    badgeOverflow: `Has a badge: more than ${VIEW_SWITCHER_BADGE_LIMIT}.`,
    badge: (badgeNumber: number) => `Has a badge: ${badgeNumber}.`,
};

/**
 * `update_description` — the screen-reader description bound onto the switcher button or
 * the inline toggle. The BADGE clause comes first when both apply (`"%s %s",
 * badge_description, needs_attention_description`), and `''` when neither applies: C
 * stores the empty string there, not NULL, and the button then RESETS the accessible
 * property rather than setting it.
 */
export function viewSwitcherIndicatorDescription(
    needsAttention: boolean,
    badgeNumber: number,
    strings: IndicatorDescriptionStrings = DEFAULT_INDICATOR_DESCRIPTION_STRINGS,
): string {
    const badge = normalizeBadgeNumber(badgeNumber);
    const attention = needsAttention ? strings.attentionRequested : '';
    let badgeDescription = '';
    if (badge > VIEW_SWITCHER_BADGE_LIMIT) badgeDescription = strings.badgeOverflow;
    else if (badge > 0) badgeDescription = strings.badge(badge);

    if (attention && badgeDescription) return `${badgeDescription} ${attention}`;
    return attention || badgeDescription;
}

/**
 * `update_tooltip`: the empty string in every display mode except `icons`, where it is
 * the title with the mnemonic stripped when `use-underline` is set. Returns PLAIN text —
 * see {@link stripMnemonic} on why the C markup escape does not belong in a port. A NULL
 * title yields `''`, a case C avoids by every rendered page having a title.
 */
export function inlineToggleTooltip(
    page: Pick<AdwViewSwitcherPage, 'title' | 'useUnderline'>,
    displayMode: AdwInlineViewSwitcherDisplayMode,
): string {
    if (displayMode !== 'icons') return '';
    return viewSwitcherLabel(page);
}

/**
 * `update_bar_revealed`: the bar is revealed only when `reveal` is set AND more than one
 * page is VISIBLE. When `reveal` is false the C loop never runs, so the count stays 0 —
 * the clauses are not independent and must not be reordered into `visibleCount > 1 ||
 * reveal`. Takes the minimal shape so a caller can pass either
 * {@link AdwViewSwitcherPage}s or {@link AdwViewStackPageInfo}s.
 */
export function shouldRevealViewSwitcherBar(reveal: boolean, pages: readonly { readonly visible: boolean }[]): boolean {
    if (!reveal) return false;
    let count = 0;
    for (const page of pages) {
        if (!page.visible) continue;
        count++;
        if (count > 1) return true;
    }
    return false;
}

/**
 * The button orientation the policy implies — `WIDE` is horizontal, anything else
 * vertical. C uses the same ternary at button creation and on a policy change.
 */
export function viewSwitcherButtonOrientation(policy: AdwViewSwitcherPolicy): 'horizontal' | 'vertical' {
    return policy === 'wide' ? 'horizontal' : 'vertical';
}

/** The fully-derived per-button view model an `AdwViewSwitcher` renderer paints. */
export interface ViewSwitcherButtonModel {
    /** Position in the PAGE list — `AdwViewSwitcher` keeps a button per page, so this is also the button index. */
    pageIndex: number;
    /** The page name, for a renderer that addresses pages by name. */
    name: string;
    /** The text to paint — {@link viewSwitcherLabel}, so already mnemonic-stripped. */
    label: string;
    /** The icon to paint — {@link viewSwitcherIconName}, never empty. */
    iconName: string;
    /** Whether the BUTTON is shown at all — {@link isViewSwitcherButtonVisible}. */
    visible: boolean;
    /** Whether this button's page is the selected one. */
    selected: boolean;
    /** Icon/label arrangement — {@link viewSwitcherButtonOrientation}. */
    orientation: 'horizontal' | 'vertical';
    /** Badge text, `''` when there is no badge — {@link viewSwitcherBadgeLabel}. */
    badgeLabel: string;
    /** Whether to paint the needs-attention dot. */
    needsAttention: boolean;
    /** Screen-reader description, `''` when neither badge nor attention applies. */
    description: string;
}

/**
 * One model per page for `AdwViewSwitcher`, in PAGE index space: `populate_switcher` adds
 * a button for EVERY page and `update_button` merely hides the ones that fail the
 * visibility rule, so the index space is preserved — unlike the inline switcher, which
 * drops hidden pages entirely. `selected` is the page index; `-1` selects nothing.
 */
export function buildViewSwitcherButtons(
    pages: readonly AdwViewSwitcherPage[],
    selected: number,
    policy: AdwViewSwitcherPolicy,
    strings: IndicatorDescriptionStrings = DEFAULT_INDICATOR_DESCRIPTION_STRINGS,
): ViewSwitcherButtonModel[] {
    const orientation = viewSwitcherButtonOrientation(policy);
    return pages.map((page, pageIndex) => ({
        pageIndex,
        name: page.name,
        label: viewSwitcherLabel(page),
        iconName: viewSwitcherIconName(page.iconName),
        visible: isViewSwitcherButtonVisible(page),
        selected: pageIndex === selected,
        orientation,
        badgeLabel: viewSwitcherBadgeLabel(page.badgeNumber),
        needsAttention: page.needsAttention,
        description: viewSwitcherIndicatorDescription(page.needsAttention, page.badgeNumber, strings),
    }));
}

/** The fully-derived per-toggle view model an `AdwInlineViewSwitcher` renderer paints. */
export interface InlineToggleModel {
    /** Position among the TOGGLES — compacted, hidden pages skipped. */
    toggleIndex: number;
    /** Position in the PAGE list — libadwaita's `child-index`. */
    pageIndex: number;
    /** The page name. */
    name: string;
    /** The text to paint — already mnemonic-stripped. */
    label: string;
    /** The icon to paint, never empty. */
    iconName: string;
    /** Whether this display mode builds an icon at all (`labels` does not). */
    showIcon: boolean;
    /** Whether this display mode builds a label at all (`icons` does not). */
    showLabel: boolean;
    /** Tooltip text, `''` outside `icons` mode — {@link inlineToggleTooltip}. */
    tooltip: string;
    /** Badge text, `''` when there is no badge. */
    badgeLabel: string;
    /** Whether to paint the needs-attention dot. */
    needsAttention: boolean;
    /** Screen-reader description, `''` when neither badge nor attention applies. */
    description: string;
}

/**
 * `populate_group`'s filter + order: a page with `visible == FALSE` produces NO toggle,
 * which is why every model carries BOTH indices — `toggleIndex` is the compacted `0..k-1`
 * position the toggle group knows, `pageIndex` the position the selection model knows, and
 * libadwaita reconciles them through the `child-index` it stashes on each toggle.
 *
 * Uses the page's `visible` flag ALONE — the title-or-icon rule belongs to
 * `AdwViewSwitcher.update_button` and has no counterpart here, so a page with neither
 * title nor icon still gets an (empty) toggle.
 */
export function buildInlineToggles(
    pages: readonly AdwViewSwitcherPage[],
    displayMode: AdwInlineViewSwitcherDisplayMode,
    strings: IndicatorDescriptionStrings = DEFAULT_INDICATOR_DESCRIPTION_STRINGS,
): InlineToggleModel[] {
    // `update_toggle` builds a label in LABELS/BOTH and an image in ICONS/BOTH,
    // unconditionally — which is what the image-missing fallback is for.
    const showIcon = displayMode !== 'labels';
    const showLabel = displayMode !== 'icons';

    const toggles: InlineToggleModel[] = [];
    pages.forEach((page, pageIndex) => {
        if (!page.visible) return;
        toggles.push({
            toggleIndex: toggles.length,
            pageIndex,
            name: page.name,
            label: viewSwitcherLabel(page),
            iconName: viewSwitcherIconName(page.iconName),
            showIcon,
            showLabel,
            tooltip: inlineToggleTooltip(page, displayMode),
            badgeLabel: viewSwitcherBadgeLabel(page.badgeNumber),
            needsAttention: page.needsAttention,
            description: viewSwitcherIndicatorDescription(page.needsAttention, page.badgeNumber, strings),
        });
    });
    return toggles;
}

/**
 * Page index → toggle index, or {@link VIEW_SWITCHER_NO_SELECTION} when the page is
 * hidden or out of range — `selection_changed_cb`, where `index` stays
 * `GTK_INVALID_LIST_POSITION` unless the visible child's page is itself visible.
 * Non-integers are refused because the C position is a `guint`.
 */
export function toggleIndexForPage(pages: readonly AdwViewSwitcherPage[], pageIndex: number): number {
    if (!Number.isInteger(pageIndex)) return VIEW_SWITCHER_NO_SELECTION;
    if (pageIndex < 0 || pageIndex >= pages.length) return VIEW_SWITCHER_NO_SELECTION;
    if (!pages[pageIndex]!.visible) return VIEW_SWITCHER_NO_SELECTION;

    let toggleIndex = 0;
    for (let index = 0; index < pageIndex; index++) {
        if (pages[index]!.visible) toggleIndex++;
    }
    return toggleIndex;
}

/**
 * Toggle index → page index, or {@link VIEW_SWITCHER_NO_SELECTION} when there is no such
 * toggle — `notify_active_cb` reads the active toggle's `child-index` and selects THAT
 * page position.
 */
export function pageIndexForToggle(pages: readonly AdwViewSwitcherPage[], toggleIndex: number): number {
    if (!Number.isInteger(toggleIndex) || toggleIndex < 0) return VIEW_SWITCHER_NO_SELECTION;

    let seen = 0;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        if (!pages[pageIndex]!.visible) continue;
        if (seen === toggleIndex) return pageIndex;
        seen++;
    }
    return VIEW_SWITCHER_NO_SELECTION;
}

/** Opaque handle a {@link ViewSwitcherScheduler} returns for a pending dwell. */
export type ViewSwitcherTimerHandle = unknown;

/**
 * The injected timing seam for the drag-hover auto-switch. Same SHAPE as `ToastScheduler`
 * in `toast.ts`, so a renderer writes ONE adapter over its platform timer and passes it to
 * both. The core never reaches for a global `setTimeout` — `gjsify.headless: true`
 * machine-checks that.
 */
export interface ViewSwitcherScheduler {
    /** Run `callback` after `ms`; return a handle {@link cancel} understands. */
    schedule(callback: () => void, ms: number): ViewSwitcherTimerHandle;
    /** Cancel a pending {@link schedule}. A stale or unknown handle must be a no-op. */
    cancel(handle: ViewSwitcherTimerHandle): void;
}

/** Construction seams for {@link ViewSwitcherDragSwitch}. */
export interface ViewSwitcherDragSwitchOptions {
    /** The platform timer adapter. */
    scheduler: ViewSwitcherScheduler;
    /** Called with the index that has been dwelt on long enough. */
    onSwitch: (index: number) => void;
    /** Dwell time in ms; defaults to {@link VIEW_SWITCHER_DRAG_SWITCH_DELAY}. */
    delay?: number;
}

/**
 * The 500 ms drag-hover auto-switch: hovering a non-active button while dragging switches
 * to it, and leaving before the dwell elapses cancels. Each button/toggle owns its OWN
 * timer in C, so this keeps one pending handle per index rather than a single global one —
 * an enter on a second index does not silently disarm the first.
 */
export class ViewSwitcherDragSwitch {
    private readonly _scheduler: ViewSwitcherScheduler;
    private readonly _onSwitch: (index: number) => void;
    private readonly _delay: number;
    private readonly _timers = new Map<number, ViewSwitcherTimerHandle>();

    constructor(options: ViewSwitcherDragSwitchOptions) {
        this._scheduler = options.scheduler;
        this._onSwitch = options.onSwitch;
        this._delay = options.delay ?? VIEW_SWITCHER_DRAG_SWITCH_DELAY;
    }

    /**
     * A drag entered the button at `index` while `activeIndex` is selected.
     * Returns whether a dwell was armed.
     *
     * `drag_enter_cb` early-returns when the hovered button is already active (the inline
     * twin compares indices instead), so hovering the current tab schedules nothing.
     */
    enter(index: number, activeIndex: number): boolean {
        if (!Number.isInteger(index) || index < 0) return false;
        if (index === activeIndex) return false;
        // Re-entering an already-armed button restarts nothing in C either: the
        // controller emits `enter` once per crossing.
        if (this._timers.has(index)) return false;

        const handle = this._scheduler.schedule(() => {
            this._timers.delete(index);
            this._onSwitch(index);
        }, this._delay);
        this._timers.set(index, handle);
        return true;
    }

    /** The drag left the button at `index` — `drag_leave_cb` removes its source. */
    leave(index: number): void {
        const handle = this._timers.get(index);
        if (handle === undefined) return;
        this._timers.delete(index);
        this._scheduler.cancel(handle);
    }

    /** Drop every pending dwell — used when the page list is rebuilt under the drag. */
    cancel(): void {
        for (const handle of this._timers.values()) this._scheduler.cancel(handle);
        this._timers.clear();
    }

    /** Indices with a dwell still pending, ascending. Lets a test assert on the arming. */
    get pending(): readonly number[] {
        return [...this._timers.keys()].sort((left, right) => left - right);
    }
}

/** Payload of a switcher selection change. */
export interface ViewSwitcherStateChange {
    /** Index of the newly-selected PAGE, `-1` when nothing is selected. */
    selected: number;
    /** Its name, `''` when nothing is selected. */
    name: string;
    /** Its rendered label ({@link viewSwitcherLabel}), `''` when nothing is selected. */
    title: string;
    /**
     * `true` for a user activation or an explicit select, `false` for a model-driven
     * auto-pick (page list rebuild, visibility flip). Same convention as
     * `ComboState`/`SpinState`/`ViewStackState`; libadwaita notifies on both paths, so this
     * is for suppressing feedback loops, not for dropping the notification.
     */
    interactive: boolean;
}

/** Subscriber for {@link ViewSwitcherState} changes. */
export type ViewSwitcherStateListener = (change: ViewSwitcherStateChange) => void;

/** Construction seams for {@link ViewSwitcherState}. */
export interface ViewSwitcherStateOptions {
    /** Platform timer adapter; without it the drag-hover auto-switch is inert. */
    scheduler?: ViewSwitcherScheduler;
    /** Dwell time in ms; defaults to {@link VIEW_SWITCHER_DRAG_SWITCH_DELAY}. */
    dragSwitchDelay?: number;
}

/**
 * The page model + selection of a switcher that OWNS its pages — the browser and
 * NativeScript switchers, which bundle the `AdwViewStack` libadwaita keeps separate.
 *
 * Selection is DELEGATED to {@link ViewStackState}: the integer/range/already-selected/
 * hidden guards, the by-name lookup, the first-VISIBLE-page auto-pick and the
 * hide-fallback all come from there, where their conformance vectors already live. This
 * class adds the C-faithful page record and a name-preserving {@link setPages}, because
 * renderers rebuild their page list wholesale and libadwaita's selection follows the page
 * OBJECT across such a rebuild rather than the index.
 *
 * Policy and display mode are deliberately NOT here: each is one enum value plus one style
 * class, validated by {@link isViewSwitcherPolicy} /
 * {@link isInlineViewSwitcherDisplayMode}.
 */
export class ViewSwitcherState {
    private _pages: AdwViewSwitcherPage[] = [];
    private _pagesView: readonly AdwViewSwitcherPage[] | null = null;
    private _stack = new ViewStackState();
    private readonly _listeners = new Set<ViewSwitcherStateListener>();
    private readonly _drag: ViewSwitcherDragSwitch | null;

    constructor(options: ViewSwitcherStateOptions = {}) {
        this._drag = options.scheduler
            ? new ViewSwitcherDragSwitch({
                  scheduler: options.scheduler,
                  delay: options.dragSwitchDelay,
                  onSwitch: (index) => {
                      this.setSelected(index);
                  },
              })
            : null;
        this._subscribeStack();
    }

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: ViewSwitcherStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** The pages, in declaration order — frozen, so a renderer cannot mutate the model. */
    get pages(): readonly AdwViewSwitcherPage[] {
        this._pagesView ??= Object.freeze(this._pages.slice());
        return this._pagesView;
    }

    /**
     * Replace the whole page list, keeping the SELECTED PAGE selected across the
     * rebuild whenever a page of the same name survives.
     *
     * libadwaita's selection is a page pointer compared by identity
     * (`adw_view_stack_pages_is_selected`), so an insert before the selected page shifts its
     * index without changing what is shown; a rebuild that dropped the selected page falls
     * through to the first-visible auto-pick. Emits at most ONE change, tagged
     * `interactive: false` — the page set changed, the user did not click.
     */
    setPages(specs: readonly AdwViewSwitcherPageInit[]): void {
        const previousIndex = this.selected;
        const previousName = previousIndex >= 0 ? this.selectedName : null;

        this._pages = specs.map((spec) => createViewSwitcherPage(spec));
        this._pagesView = null;

        // A fresh state rather than a mutated one: `ViewStackState` has no bulk clear, and
        // building it BEFORE subscribing keeps the per-page auto-pick notifications out of
        // the renderer's listener — the job C's `block_notify_active` counter does.
        const stack = new ViewStackState();
        for (const page of this._pages) {
            stack.addPage({ name: page.name, title: page.title, visible: page.visible });
        }
        if (previousName !== null) {
            const index = stack.indexOfName(previousName);
            // `setVisibleIndex` refuses a hidden page, leaving the auto-pick in place — the
            // C behaviour for a page that survived the rebuild but is no longer visible.
            if (index >= 0) stack.setVisibleIndex(index, false);
        }
        this._stack = stack;
        this._subscribeStack();
        this._drag?.cancel();

        if (this.selected !== previousIndex || this.selectedName !== (previousName ?? '')) this._emit(false);
    }

    /** Index of the selected page, `-1` when nothing is selected. */
    get selected(): number {
        return this._stack.visibleIndex;
    }

    /** Name of the selected page, `''` when nothing is selected. */
    get selectedName(): string {
        return this._stack.visibleName;
    }

    /** The selected page record, or `undefined`. */
    get selectedPage(): AdwViewSwitcherPage | undefined {
        return this._pages[this.selected];
    }

    /** Number of pages. */
    get count(): number {
        return this._pages.length;
    }

    /**
     * Select by page index. Returns whether the selection changed.
     *
     * Every guard is {@link ViewStackState.setVisibleIndex}'s: a non-integer, a negative, an
     * out-of-range and a hidden page are all silent no-ops, NOT clamped into range —
     * `adw_view_stack_pages_select_item` simply returns FALSE.
     */
    setSelected(index: number, interactive = true): boolean {
        return this._stack.setVisibleIndex(index, interactive);
    }

    /** Select by page name. Returns whether the selection changed. */
    selectName(name: string | null | undefined, interactive = true): boolean {
        return this._stack.setVisibleName(name, interactive);
    }

    /**
     * Flip a page's `visible` flag. Returns whether the SELECTION moved.
     *
     * Both the switcher's page record and the delegated stack are updated, so the derived
     * buttons and toggles rebuild against the same truth the selection fallback used
     * (`update_child_visible`).
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const index = this._pages.findIndex((page) => page.name === name);
        if (index < 0) return false;

        const page = this._pages[index]!;
        const next = !!visible;
        if (page.visible === next) return false;

        this._pages[index] = { ...page, visible: next };
        this._pagesView = null;
        return this._stack.setPageVisible(name, next);
    }

    /** A drag entered the button/toggle for page `pageIndex`; arms the dwell. */
    dragEnter(pageIndex: number): void {
        this._drag?.enter(pageIndex, this.selected);
    }

    /** The drag left page `pageIndex`; cancels its pending dwell. */
    dragLeave(pageIndex: number): void {
        this._drag?.leave(pageIndex);
    }

    /** Drop every pending dwell (the widget was torn down or the drag ended). */
    cancelDrag(): void {
        this._drag?.cancel();
    }

    /** Page indices with a drag dwell still pending — the observable half of the timer. */
    get pendingDragSwitches(): readonly number[] {
        return this._drag?.pending ?? [];
    }

    /** Diagnostics the delegated stack recorded (C's `g_warning` texts). */
    get diagnostics(): readonly string[] {
        return this._stack.diagnostics;
    }

    private _subscribeStack(): void {
        this._stack.subscribe((change: ViewStackStateChange) => this._emit(change.interactive));
    }

    private _emit(interactive: boolean): void {
        const page = this.selectedPage;
        const change: ViewSwitcherStateChange = {
            selected: this.selected,
            name: page?.name ?? '',
            title: page ? viewSwitcherLabel(page) : '',
            interactive,
        };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }
}

/** Payload of a {@link ViewSwitcherBarState} change. */
export interface ViewSwitcherBarChange {
    /** The REQUEST — `AdwViewSwitcherBar:reveal`, default `false`. */
    reveal: boolean;
    /** The DERIVED truth — {@link shouldRevealViewSwitcherBar}. */
    revealed: boolean;
}

/** Subscriber for {@link ViewSwitcherBarState} changes. */
export type ViewSwitcherBarListener = (change: ViewSwitcherBarChange) => void;

/**
 * `AdwViewSwitcherBar`'s reveal state machine: `reveal` is what the layout ASKS for,
 * `revealed` is what the bar actually does. `update_bar_revealed` is re-run from
 * `set_reveal`, from `set_stack` and from the pages' `items-changed`, so the derived value
 * flips both when the flag changes and when the page set does — which is why
 * {@link setPages} exists rather than the count being passed to {@link setReveal}.
 * `reveal` defaults to FALSE, so a freshly constructed bar is collapsed.
 */
export class ViewSwitcherBarState {
    private _reveal = false;
    private _revealed = false;
    private _pages: readonly { readonly visible: boolean }[] = [];
    private readonly _listeners = new Set<ViewSwitcherBarListener>();

    /** Subscribe to reveal changes. Returns an unsubscribe function. */
    subscribe(listener: ViewSwitcherBarListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Whether the layout asked for the bar — `AdwViewSwitcherBar:reveal`. */
    get reveal(): boolean {
        return this._reveal;
    }

    /** Whether the bar is actually shown — the derived truth. */
    get revealed(): boolean {
        return this._revealed;
    }

    /**
     * Set the request. Returns whether `reveal` itself changed (C returns early before its
     * notify when it did not); the subscriber only fires when the DERIVED value moves.
     */
    setReveal(value: boolean): boolean {
        const next = !!value;
        if (next === this._reveal) return false;
        this._reveal = next;
        this._refresh();
        return true;
    }

    /**
     * Feed the bound stack's page list. Returns whether `revealed` flipped —
     * the `items-changed` half of the same derivation.
     */
    setPages(pages: readonly { readonly visible: boolean }[]): boolean {
        this._pages = pages;
        return this._refresh();
    }

    private _refresh(): boolean {
        const next = shouldRevealViewSwitcherBar(this._reveal, this._pages);
        if (next === this._revealed) return false;
        this._revealed = next;

        const change: ViewSwitcherBarChange = { reveal: this._reveal, revealed: this._revealed };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
        return true;
    }
}

/**
 * Whether a nullable C string is PRESENT — the `!= NULL` test, where `''` counts as
 * present and `undefined` is read as an absent property.
 */
function isPresent(value: string | null | undefined): value is string {
    return value !== null && value !== undefined;
}

/**
 * `badge-number` as the `guint` it is: a non-finite or negative input has no C spelling,
 * so it reads as "no badge" rather than wrapping around G_MAXUINT as a C cast would.
 */
function normalizeBadgeNumber(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.trunc(value));
}

// Re-exported so importers of this module keep working; it lives in `glib.ts`.
export { stripMnemonic };
