// Headless Adwaita view-switcher derivations (ADR 0004 — headless Adwaita core).
//
// A view switcher renders nothing a renderer can share: `AdwViewSwitcher` is a
// homogeneous `GtkBox` of toggle buttons, the browser port is a flex row of
// `<button>`, the NativeScript port a `StackLayout` of tappable `StackLayout`s.
// What DOES transfer is everything that decides WHAT to show, and that half is
// pure derivation over the page list — which is exactly the half both ports had
// skipped or duplicated.
//
// Five C rules lived in NEITHER port before this module:
//   1. the button-visibility predicate `visible && (title != NULL || icon_name
//      != NULL)` (adw-view-switcher.c:178) — note an EMPTY title is not NULL, so
//      a titleless-but-named page still gets a button, while a page with neither
//      title nor icon gets none. Both ports rendered an empty, clickable,
//      space-consuming button there;
//   2. the `image-missing` substitution for a NULL/empty icon name
//      (adw-view-switcher-button.c:399-405, adw-inline-view-switcher.c:137-142);
//      both ports rendered no icon at all;
//   3. `update_bar_revealed` (adw-view-switcher-bar.c:104-126): the bar is
//      revealed only when `reveal` is set AND MORE THAN ONE page is visible.
//      Missing from both, which is why a one-page stack showed an empty strip;
//   4. the inline switcher's TWO index spaces — a hidden page produces no
//      toggle, so libadwaita stashes the PAGE index on every toggle as
//      `child-index` (adw-inline-view-switcher.c:346) and maps back through it
//      (:114-129, :434-453), with `GTK_INVALID_LIST_POSITION` as the "nothing
//      active" sentinel. Neither port filtered hidden pages, so the two spaces
//      collapsed into one and the sentinel had no spelling;
//   5. the badge / needs-attention label and the screen-reader description
//      `AdwIndicatorBin` derives from them (adw-indicator-bin.c:59-112).
//
// SELECTION IS NOT REIMPLEMENTED HERE. libadwaita's switchers own no selection
// property at all — every change flows through the bound `AdwViewStack`'s
// selection model — so {@link ViewSwitcherState} COMPOSES the wave-1
// {@link ViewStackState} for the index guards, the by-name lookup, the
// first-VISIBLE-page auto-pick and the hide-fallback, and adds only what the
// switcher itself contributes: the C-faithful page record (a nullable title and
// icon name, plus badge / needs-attention / use-underline) and the derivations
// above.
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
 * The "nothing is selected" sentinel, standing in for
 * `GTK_INVALID_LIST_POSITION` (adw-inline-view-switcher.c:366, :441).
 *
 * Returned by {@link toggleIndexForPage} / {@link pageIndexForToggle} when the
 * two index spaces have no counterpart for each other — a hidden page has no
 * toggle at all, which is a state `ToggleGroupState`'s always-non-negative
 * `selected` cannot express.
 */
export const VIEW_SWITCHER_NO_SELECTION = -1;

/**
 * The icon substituted for a NULL or empty icon name
 * (adw-view-switcher-button.c:347, :399-405; adw-inline-view-switcher.c:131-145).
 */
export const VIEW_SWITCHER_FALLBACK_ICON = 'image-missing';

/**
 * `TIMEOUT_EXPAND` — how long a drag has to dwell over a non-active button
 * before it switches to it (adw-view-switcher-button.c:14,
 * adw-inline-view-switcher.c:80). Defined identically in both C files.
 */
export const VIEW_SWITCHER_DRAG_SWITCH_DELAY = 500;

/** The largest badge `AdwIndicatorBin` prints; anything above collapses to `999+`. */
export const VIEW_SWITCHER_BADGE_LIMIT = 999;

/** `AdwViewSwitcherPolicy` — which button layout the switcher forces. */
export type AdwViewSwitcherPolicy = 'narrow' | 'wide';

/**
 * Every policy, in enum order. Doubles as the style-class list: libadwaita adds
 * the current policy's class and removes the other (adw-view-switcher.c:539-545),
 * so a renderer toggles each entry against the current value rather than
 * hard-coding an add/remove pair.
 */
export const VIEW_SWITCHER_POLICIES: readonly AdwViewSwitcherPolicy[] = ['narrow', 'wide'];

/** `AdwInlineViewSwitcherDisplayMode` — what the inline switcher's toggles show. */
export type AdwInlineViewSwitcherDisplayMode = 'labels' | 'icons' | 'both';

/**
 * Every display mode, in enum order — and the toggle-group style classes
 * (adw-inline-view-switcher.c:826-850), same toggle-against-current pattern as
 * {@link VIEW_SWITCHER_POLICIES}.
 */
export const INLINE_VIEW_SWITCHER_DISPLAY_MODES: readonly AdwInlineViewSwitcherDisplayMode[] = [
    'labels',
    'icons',
    'both',
];

/**
 * Whether `value` is a policy libadwaita would accept.
 *
 * The C setter is guarded by the enum's own type (`g_value_get_enum`), and the
 * browser port instead coerced anything unrecognised to a default — see
 * {@link isInlineViewSwitcherDisplayMode} for why that is not the same thing.
 */
export function isViewSwitcherPolicy(value: unknown): value is AdwViewSwitcherPolicy {
    return value === 'narrow' || value === 'wide';
}

/**
 * Whether `value` is a display mode libadwaita would accept.
 *
 * `adw_inline_view_switcher_set_display_mode` opens with
 * `g_return_if_fail (mode <= ADW_INLINE_VIEW_SWITCHER_BOTH)`
 * (adw-inline-view-switcher.c:819), which REJECTS the call and leaves the
 * current mode alone. The browser port's `includes(raw) ? raw : 'both'` replaced
 * the current mode with `'both'` instead, so a typo in one attribute silently
 * changed what every toggle displayed.
 */
export function isInlineViewSwitcherDisplayMode(value: unknown): value is AdwInlineViewSwitcherDisplayMode {
    return value === 'labels' || value === 'icons' || value === 'both';
}

/**
 * The page record every switcher flavour reads — `AdwViewStackPage`'s properties
 * with their C defaults (adw-view-stack.c:373-436).
 *
 * `null` vs `''` is LOAD-BEARING and is why this record exists next to
 * {@link AdwViewStackPageInfo} rather than being replaced by it: the
 * button-visibility rule tests `title != NULL`, and an empty title is not NULL.
 * Wave 1's stack page model resolves an absent title to the page NAME (a
 * deliberate, documented deviation), so a page's "had no title at all" state
 * only survives where the switcher owns its own pages.
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
 * Normalize a partial page into the full record with the C defaults applied, so
 * a renderer that only knows `{ name, title }` gets exactly the same derivations
 * as one that knows badges.
 *
 * `undefined` collapses to the C default; an explicit `null` title or icon name
 * stays `null`. The badge is normalized to a non-negative integer because
 * `badge-number` is a `guint` (adw-view-stack.c:420-423) and every derivation
 * below assumes it.
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
 * Project a wave-1 stack page descriptor onto a switcher page, for a switcher
 * BOUND to an `Adw.ViewStack` rather than owning its own pages.
 *
 * One fidelity note remains: `AdwViewStackPageInfo.title` is already resolved
 * against the page name, so it is never `null` and the button-visibility rule
 * reduces to the `visible` flag.
 *
 * The second one is gone. This used to say the stack page carried none of
 * `badge-number`, `needs-attention` or `use-underline`, "so a bound switcher
 * derives an empty badge and no description" — which made a switcher bound to a
 * stack STRUCTURALLY unable to show a badge, and both `ViewSwitcherBar`s go
 * through here. The stack page carries all three now.
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
 * `update_button`'s visibility rule (adw-view-switcher.c:178):
 * `visible && (title != NULL || icon_name != NULL)`.
 *
 * The empty string is NOT NULL, so `title: ''` still yields a button — the
 * opposite of what both ports did, which was to keep the button and hide only
 * its label. `undefined` is read as absent, i.e. as C's NULL.
 */
export function isViewSwitcherButtonVisible(
    page: Pick<AdwViewSwitcherPage, 'visible' | 'title' | 'iconName'>,
): boolean {
    return page.visible && (isPresent(page.title) || isPresent(page.iconName));
}

/**
 * The icon a switcher actually renders: a NULL or EMPTY name becomes
 * `image-missing` (adw-view-switcher-button.c:399-405,
 * adw-inline-view-switcher.c:137-142 — `icon_name && *icon_name` fails on `''`).
 *
 * Never returns `''`, so a renderer has an icon to paint in every mode where the
 * C widget creates a `GtkImage` at all. Both ports instead omitted the icon
 * node, which is why an icon-only toggle for a page without an icon rendered as
 * a blank box.
 */
export function viewSwitcherIconName(iconName: string | null | undefined): string {
    return isPresent(iconName) && iconName.length > 0 ? iconName : VIEW_SWITCHER_FALLBACK_ICON;
}

/**
 * The text a switcher paints for a page: `''` for a NULL title, otherwise the
 * title with its mnemonic stripped when `use-underline` is set.
 *
 * `update_button` binds `title` onto the button's label together with
 * `use-underline` (adw-view-switcher.c:170-176), and the template label carries
 * `use-underline` too (adw-view-switcher-button.ui) — so GTK DISPLAYS `_Files`
 * as `Files` with an underlined F. A renderer with no accelerator layer displays
 * the same text; keeping the underscore would render a literal one, which is
 * what the browser port did in the inline switcher's tooltip.
 */
export function viewSwitcherLabel(page: Pick<AdwViewSwitcherPage, 'title' | 'useUnderline'>): string {
    if (!isPresent(page.title)) return '';
    return page.useUnderline ? stripMnemonic(page.title) : page.title;
}

/**
 * `get_badge_label` (adw-indicator-bin.c:58-68): `''` for 0, `999+` above 999,
 * the decimal otherwise. 999 itself prints, because the test is `> 999`.
 */
export function viewSwitcherBadgeLabel(badgeNumber: number): string {
    const badge = normalizeBadgeNumber(badgeNumber);
    if (badge > VIEW_SWITCHER_BADGE_LIMIT) return `${VIEW_SWITCHER_BADGE_LIMIT}+`;
    if (badge === 0) return '';
    return String(badge);
}

/**
 * The message catalogue {@link viewSwitcherIndicatorDescription} composes, so the
 * core needs no gettext dependency while the composition ORDER stays pinned.
 *
 * C reads these through `C_("view switcher button badge", …)`; a renderer with a
 * translation layer passes its own catalogue.
 */
export interface IndicatorDescriptionStrings {
    /** `needs-attention` clause — C's "Attention requested." */
    attentionRequested: string;
    /** Badge clause above the limit — C's "Has a badge: more than 999." */
    badgeOverflow: string;
    /** Badge clause for a printable count — C's "Has a badge: %u." */
    badge: (badgeNumber: number) => string;
}

/** The English source strings from adw-indicator-bin.c:77-92. */
export const DEFAULT_INDICATOR_DESCRIPTION_STRINGS: IndicatorDescriptionStrings = {
    attentionRequested: 'Attention requested.',
    badgeOverflow: `Has a badge: more than ${VIEW_SWITCHER_BADGE_LIMIT}.`,
    badge: (badgeNumber: number) => `Has a badge: ${badgeNumber}.`,
};

/**
 * `update_description` (adw-indicator-bin.c:70-113) — the screen-reader
 * description bound onto the switcher button (adw-view-switcher-button.c:98-113)
 * or the inline toggle (adw-inline-view-switcher.c:267).
 *
 * The BADGE clause comes first when both apply: the format string is
 * `"%s %s", badge_description, needs_attention_description` (:96). `''` when
 * neither applies — C stores the empty string there, not NULL, and the button
 * then RESETS the accessible property rather than setting it.
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
 * `update_tooltip` (adw-inline-view-switcher.c:163-192): the empty string in
 * every display mode except `icons`, where it is the title with the mnemonic
 * stripped when `use-underline` is set.
 *
 * Returns PLAIN text — see {@link stripMnemonic} on why the C markup escape does
 * not belong in a port. A NULL title yields `''`: C would hand NULL to
 * `g_markup_escape_text`, which every page libadwaita renders avoids by always
 * having a title.
 */
export function inlineToggleTooltip(
    page: Pick<AdwViewSwitcherPage, 'title' | 'useUnderline'>,
    displayMode: AdwInlineViewSwitcherDisplayMode,
): string {
    if (displayMode !== 'icons') return '';
    return viewSwitcherLabel(page);
}

/**
 * `update_bar_revealed` (adw-view-switcher-bar.c:104-126): the bar is revealed
 * only when `reveal` is set AND more than one page is VISIBLE.
 *
 * When `reveal` is false the C loop never runs, so the count stays 0 — the two
 * clauses are not independent and a renderer must not reorder them into
 * `visibleCount > 1 || reveal`. Absent from both ports, which is why a bar bound
 * to a one-page stack showed an empty strip libadwaita keeps collapsed.
 *
 * Takes the minimal shape so a caller can pass either
 * {@link AdwViewSwitcherPage}s or wave-1 {@link AdwViewStackPageInfo}s.
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
 * The button orientation the policy implies — `WIDE` is horizontal, anything
 * else vertical (adw-view-switcher.c:219-220, :534-537). The same ternary is
 * used when a button is created and when the policy changes.
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
 * One model per page for `AdwViewSwitcher`, in PAGE index space.
 *
 * `populate_switcher` adds a button for EVERY page and `update_button` merely
 * hides the ones that fail the visibility rule (adw-view-switcher.c:230-238,
 * :178), so the index space is preserved — unlike the inline switcher, which
 * drops hidden pages entirely. `selected` is the page index; `-1` selects
 * nothing.
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
    /** Position in the PAGE list — libadwaita's `child-index` (adw-inline-view-switcher.c:346). */
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
 * `populate_group`'s filter + order (adw-inline-view-switcher.c:360-392): a page
 * with `visible == FALSE` produces NO toggle.
 *
 * Which is why every model carries BOTH indices — `toggleIndex` is the compacted
 * `0..k-1` position the toggle group knows, `pageIndex` is the position the
 * selection model knows, and libadwaita reconciles them through the
 * `child-index` it stashes on each toggle (:346, :114-129). Neither port
 * filtered, so the two spaces coincided and the reconciliation looked
 * unnecessary.
 *
 * Note this uses the page's `visible` flag ALONE — the title-or-icon rule
 * belongs to `AdwViewSwitcher.update_button` and has no counterpart here, so a
 * page with neither title nor icon still gets an (empty) toggle.
 */
export function buildInlineToggles(
    pages: readonly AdwViewSwitcherPage[],
    displayMode: AdwInlineViewSwitcherDisplayMode,
    strings: IndicatorDescriptionStrings = DEFAULT_INDICATOR_DESCRIPTION_STRINGS,
): InlineToggleModel[] {
    // `update_toggle` builds a label in LABELS/BOTH and an image in ICONS/BOTH
    // (adw-inline-view-switcher.c:246-322) — unconditionally, which is what the
    // image-missing fallback is for.
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
 * Page index → toggle index, or {@link VIEW_SWITCHER_NO_SELECTION} when the page
 * is hidden or out of range — `selection_changed_cb`
 * (adw-inline-view-switcher.c:434-453), where `index` stays
 * `GTK_INVALID_LIST_POSITION` unless the visible child's page is itself visible.
 *
 * Non-integers are refused for the same reason `ViewStackState` refuses them:
 * the C position is a `guint`.
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
 * Toggle index → page index, or {@link VIEW_SWITCHER_NO_SELECTION} when there is
 * no such toggle — `notify_active_cb` (adw-inline-view-switcher.c:114-129), which
 * reads the active toggle's `child-index` and selects THAT page position.
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
 * The injected timing seam for the drag-hover auto-switch.
 *
 * Deliberately the same SHAPE as `ToastScheduler` in `toast.ts`, so a renderer
 * writes ONE adapter over its platform timer and passes it to both. The core
 * never reaches for a global `setTimeout` — that is what `gjsify.headless: true`
 * machine-checks.
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
 * The 500 ms drag-hover auto-switch: hovering a non-active button while dragging
 * switches to it, and leaving before the dwell elapses cancels.
 *
 * Present in BOTH C files and in neither port
 * (adw-view-switcher-button.c:14, :58-63, :79-96; adw-inline-view-switcher.c:80,
 * :194-236). Each button/toggle owns its OWN timer there, so this keeps one
 * pending handle per index rather than a single global one — an enter on a
 * second index does not silently disarm the first.
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
     * `drag_enter_cb` early-returns when the hovered button is already active
     * (adw-view-switcher-button.c:82-83; the inline twin compares indices at
     * adw-inline-view-switcher.c:219), so hovering the current tab never
     * schedules anything.
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
     * `true` for a user activation or an explicit select, `false` for a model-
     * driven auto-pick (a page list rebuild, a visibility flip). Same tagging
     * convention as `ComboState`/`SpinState`/`ViewStackState`; libadwaita
     * notifies on both paths, so this is for suppressing feedback loops, not for
     * dropping the notification.
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
 * NativeScript switchers, which bundle the `AdwViewStack` libadwaita keeps
 * separate.
 *
 * Selection is DELEGATED to {@link ViewStackState}, not re-implemented: the
 * integer/range/already-selected/hidden guards, the by-name lookup, the
 * first-VISIBLE-page auto-pick and the hide-fallback all come from there, which
 * is where their conformance vectors already live. What this class adds is the
 * C-faithful page record (so the button-visibility and badge rules have their
 * inputs) and a name-preserving {@link setPages}, because both renderers rebuild
 * their page list wholesale and libadwaita's selection follows the page OBJECT
 * across such a rebuild (adw-view-stack.c:660-672) rather than the index.
 *
 * Policy and display mode are deliberately NOT here: each is one enum value plus
 * one style class, validated by {@link isViewSwitcherPolicy} /
 * {@link isInlineViewSwitcherDisplayMode} and rendered from
 * {@link VIEW_SWITCHER_POLICIES} / {@link INLINE_VIEW_SWITCHER_DISPLAY_MODES}.
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
     * (`adw_view_stack_pages_is_selected`, adw-view-stack.c:660-672), so an
     * insert before the selected page shifts its index without changing what is
     * shown; a rebuild that dropped the selected page falls through to the
     * first-visible auto-pick. Emits at most ONE change, tagged
     * `interactive: false` — the page set changed, the user did not click.
     */
    setPages(specs: readonly AdwViewSwitcherPageInit[]): void {
        const previousIndex = this.selected;
        const previousName = previousIndex >= 0 ? this.selectedName : null;

        this._pages = specs.map((spec) => createViewSwitcherPage(spec));
        this._pagesView = null;

        // A fresh state rather than a mutated one: `ViewStackState` has no bulk
        // clear, and building it BEFORE subscribing is what keeps the per-page
        // auto-pick notifications out of the renderer's listener — the same job
        // C's `block_notify_active` counter does (adw-inline-view-switcher.c:368).
        const stack = new ViewStackState();
        for (const page of this._pages) {
            stack.addPage({ name: page.name, title: page.title, visible: page.visible });
        }
        if (previousName !== null) {
            const index = stack.indexOfName(previousName);
            // `setVisibleIndex` refuses a hidden page, leaving the auto-pick in
            // place — which is the C behaviour for a page that survived the
            // rebuild but is no longer visible.
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
     * Every guard is {@link ViewStackState.setVisibleIndex}'s: a non-integer, a
     * negative, an out-of-range and a hidden page are all silent no-ops — NOT
     * clamped into range, which is what the browser switcher did (`active="-1"`
     * jumped to the first page, `active="99"` to the last) where
     * `adw_view_stack_pages_select_item` simply returns FALSE
     * (adw-view-stack.c:682-684).
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
     * Both the switcher's page record and the delegated stack are updated, so the
     * derived buttons and toggles rebuild against the same truth the selection
     * fallback used (`update_child_visible`, adw-view-stack.c:1061-1082).
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
 * `AdwViewSwitcherBar`'s reveal state machine: `reveal` is what the layout ASKS
 * for, `revealed` is what the bar actually does.
 *
 * `update_bar_revealed` is re-run from `set_reveal`, from `set_stack` and from
 * the pages' `items-changed` (adw-view-switcher-bar.c:340-343, :383, :277), so
 * the derived value flips both when the flag changes and when the page set does
 * — which is why {@link setPages} exists rather than the count being passed to
 * {@link setReveal}. `reveal` defaults to FALSE (:256-259); the NativeScript bar
 * started life VISIBLE, so a freshly constructed bar covered the screen bottom
 * until someone set `revealed = false`.
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
     * Set the request. Returns whether `reveal` itself changed (C returns early
     * before its notify when it did not, adw-view-switcher-bar.c:379-380); the
     * subscriber only fires when the DERIVED value moves.
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
 * Whether a nullable C string is PRESENT — the `!= NULL` test, where `''` counts
 * as present and `undefined` is read as an absent property.
 */
function isPresent(value: string | null | undefined): value is string {
    return value !== null && value !== undefined;
}

/**
 * `badge-number` as the `guint` it is (adw-view-stack.c:420-423): a non-finite
 * or negative input has no C spelling, so it reads as "no badge" rather than
 * wrapping around G_MAXUINT the way a C cast would.
 */
function normalizeBadgeNumber(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.trunc(value));
}

// Re-exported so existing importers keep working; it lives in `glib.ts`
// because the view switcher needs the same rule.
export { stripMnemonic };
