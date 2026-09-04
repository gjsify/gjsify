// Widget barrel for @gjsify/adwaita-nativescript.
//
// Re-exports every Adwaita NativeScript widget. The barrel has NO top-level side
// effects, so importing a widget class does not eagerly touch the runtime.
//
// THIS BARREL IS INTERNAL. It carries the CLASS names (`AdwWrapBox`, `GtkEntry`),
// which clause 1 derives from each widget's file, and it is not a published subpath:
// the package root offers these widgets under `Adw.*` / `Gtk.*` only (ADR 0034
// § Amendment 9), and a second published door onto the same set under the retired
// spelling would make that removal cosmetic.
//
// USING THESE FROM XML. A plain NativeScript app resolves `<ns:Widget>` by loading
// the module its `xmlns` names and reading `Widget` off the exports
// (`component-builder`'s `createComponentInstance`), so the way in is one app-local
// barrel PER NAMESPACE — which is what makes the prefix carry the library:
//
//   // app/adw.ts                        // app/gtk.ts
//   export * from '@gjsify/adwaita-nativescript/adw';
//                                        export * from '@gjsify/adwaita-nativescript/gtk';
//
//   <adw:WrapBox xmlns:adw="~/adw" childSpacing="8"> … </adw:WrapBox>
//   <gtk:Entry xmlns:gtk="~/gtk" placeholderText="Search" />
//
// TWO BARRELS AND NOT ONE, because the prefix names a MODULE and nothing else: point
// both prefixes at one module and `<adw:Button>` resolves and is wrong, silently. Two
// disjoint modules make the wrong prefix a load-time `Module '~/adw' not found for
// element 'adw:Button'` instead of a lint rule nobody runs.
//
// `@gjsify/vite-plugin-gjsify` registers exactly those `xmlns="~/MOD"` barrels
// (see packages/nativescript-bridge/AGENTS.md). A BARE package specifier does not
// work — measured on Android 2026-08-28, `xmlns:adw="@gjsify/adwaita-nativescript"`
// fails with `Module 'AdwWrapBox' not found for element`.

export { AdwPreferencesPage } from './adw-preferences-page.js';
export { AdwPreferencesGroup } from './adw-preferences-group.js';
export { AdwActionRow } from './adw-action-row.js';
export { AdwSwitchRow, NOTIFY_ACTIVE } from './adw-switch-row.js';
export type { NotifyActiveEventData } from './adw-switch-row.js';
export { AdwEntryRow, NOTIFY_TEXT } from './adw-entry-row.js';
export type { NotifyTextEventData } from './adw-entry-row.js';
export { AdwPasswordEntryRow } from './adw-password-entry-row.js';
// GtkEntry is the STANDALONE entry (the row's counterpart, not its base): no
// core state machine — only the character arithmetic (`clampEntryText` /
// `entryTextLength`) is shared, and it lives in `@gjsify/adwaita-core`.
export { GtkEntry, ACTIVATE as ENTRY_ACTIVATE, NOTIFY_TEXT as NOTIFY_ENTRY_TEXT } from './gtk-entry.js';
export type { NotifyEntryTextEventData } from './gtk-entry.js';
// AdwComboRow keeps the NS render (inline value + chevron + native chooser); the
// selection state machine (ComboState + AdwComboOption) is headless
// (`@gjsify/adwaita-core`, ADR 0004), re-exported here for consumers.
export { AdwComboRow, ComboState, NOTIFY_SELECTED } from './adw-combo-row.js';
export type { AdwComboOption, ComboStateChange, ComboStateListener, NotifySelectedEventData } from './adw-combo-row.js';
// GtkDropDown is the STANDALONE dropdown (Gtk.DropDown's shape) over the very
// same `ComboState` the row composes — one selection model, two surfaces.
export { GtkDropDown, NOTIFY_SELECTED as NOTIFY_DROP_DOWN_SELECTED } from './gtk-drop-down.js';
export type { NotifyDropDownSelectedEventData } from './gtk-drop-down.js';
// AdwSpinRow keeps the NS stepper render; the clamp/step state machine (SpinState)
// is headless (`@gjsify/adwaita-core`, ADR 0004), re-exported here for consumers.
export { AdwSpinRow, NOTIFY_VALUE, SpinState } from './adw-spin-row.js';
export type { NotifyValueEventData, SpinStateChange, SpinStateListener } from './adw-spin-row.js';
export { AdwSliderRow, NOTIFY_SLIDER_VALUE } from './adw-slider-row.js';
export type { NotifySliderValueEventData } from './adw-slider-row.js';
// AdwExpanderRow keeps the NS disclosure render; the expanded state machine
// (ExpanderState) is headless (`@gjsify/adwaita-core`, ADR 0004), re-exported here.
export { AdwExpanderRow, ExpanderState, NOTIFY_EXPANDED } from './adw-expander-row.js';
export type { ExpanderStateListener, NotifyExpandedEventData } from './adw-expander-row.js';
export { GtkButton } from './gtk-button.js';
export type { AdwButtonVariant } from './gtk-button.js';
export { AdwImageButton, DEFAULT_ICON_BUTTON_ICON_SIZE } from './adw-image-button.js';
export { GtkMenuButton, MENU_ITEM_ACTIVATED } from './gtk-menu-button.js';
export type { AdwMenuItem, MenuItemActivatedEventData } from './gtk-menu-button.js';
export { AdwIcon, DEFAULT_ADW_ICON_SIZE } from './adw-icon.js';
export { AdwBanner, BUTTON_CLICKED } from './adw-banner.js';
export { AdwAvatar, DEFAULT_AVATAR_SIZE, avatarInitials } from './adw-avatar.js';
export { AdwWindowTitle } from './adw-window-title.js';
export { AdwClamp, DEFAULT_CLAMP_MAX_SIZE } from './adw-clamp.js';

// --- Presentation / layout ---
export { AdwHeaderBar } from './adw-header-bar.js';
export { AdwToolbarView } from './adw-toolbar-view.js';
export { AdwWrapBox } from './adw-wrap-box.js';
// AdwDataGrid is ONE GridLayout with the cells as direct children — NativeScript
// has no subgrid, and per-row grids would each resolve their own `auto` tracks
// and stagger the columns. The derivations are headless (`@gjsify/adwaita-core`,
// ADR 0004); the descriptor→ItemSpec mapping is the pure `data-grid-model.ts`.
export { AdwDataGrid, ROW_ACTIVATED } from './adw-data-grid.js';
export type { RowActivatedEventData } from './adw-data-grid.js';
export {
    DATA_GRID_HEADER_CELL_CLASS,
    DATA_GRID_HEADER_ROW_CLASS,
    DATA_GRID_SECTION_CELL_CLASS,
    dataGridCellClass,
    dataGridItemSpec,
    dataGridRowClass,
    dataGridShapeKey,
    dataGridTracksKey,
    parseDataGridWidth,
} from './data-grid-model.js';
export type { DataGridItemSpec } from './data-grid-model.js';
export { AdwSpinner, DEFAULT_SPINNER_SIZE } from './adw-spinner.js';
export { AdwStatusPage } from './adw-status-page.js';
export { AdwButtonRow, ACTIVATED } from './adw-button-row.js';
export { AdwButtonContent } from './adw-button-content.js';
export { AdwSplitButton, CLICKED, MENU_TAPPED } from './adw-split-button.js';
export type { MenuTappedEventData } from './adw-split-button.js';
// AdwToggleGroup keeps the NS segment render (+ per-toggle icons); the selection
// state machine (ToggleGroupState) is headless (`@gjsify/adwaita-core`, ADR 0004),
// re-exported here for consumers.
export { AdwToggleGroup, NOTIFY_SELECTED as NOTIFY_TOGGLE_SELECTED, ToggleGroupState } from './adw-toggle-group.js';
export type {
    NotifyToggleSelectedEventData,
    ToggleGroupStateChange,
    ToggleGroupStateListener,
} from './adw-toggle-group.js';
// Runtime accent override. The theme inlines the accent as a literal (the NS CSS
// subset has no custom properties), so switching it means generating rules for the
// exact selectors that carry it — the table lives in the pure `accent-theme.ts` and
// is gated against the stylesheet by scripts/check-nativescript-accent-rules.mjs.
export { applyAdwaitaNsAccent, clearAdwaitaNsAccent } from './adw-accent.js';
export { ADWAITA_NS_ACCENT_RULES, adwaitaNsAccentColor, adwaitaNsAccentCss } from './accent-theme.js';
export type { AccentRole, AccentRule } from './accent-theme.js';
// AdwShortcutLabel draws an accelerator as keycaps. The grammar, the keycap order
// and the label lookup are headless (`@gjsify/adwaita-core`, ADR 0004); the NS view
// TREE is the pure `shortcut-label.ts`, so the spec suite drives the conformance
// vectors against the shipping structure off-device.
export { AdwShortcutLabel } from './adw-shortcut-label.js';
export {
    SHORTCUT_LABEL_CAP_TEXT_CLASS,
    SHORTCUT_LABEL_CLASS,
    SHORTCUT_LABEL_DIMMED_CLASS,
    SHORTCUT_LABEL_DISABLED_CLASS,
    SHORTCUT_LABEL_KEYCAP_CLASS,
    SHORTCUT_LABEL_KEYS_CLASS,
    SHORTCUT_LABEL_SIDE_CLASS,
    SHORTCUT_LABEL_SPACED_CLASS,
    shortcutLabelDirection,
    shortcutLabelPlatform,
    shortcutLabelRenderPlan,
} from './shortcut-label.js';
export type { ShortcutLabelRenderPlan, ShortcutLabelViewSpec } from './shortcut-label.js';

// --- View switching ---
export { AdwViewStack, NOTIFY_VISIBLE_CHILD } from './adw-view-stack.js';
export type { AdwViewStackPage, NotifyVisibleChildEventData } from './adw-view-stack.js';
export { AdwViewSwitcherBase, NOTIFY_SELECTED as NOTIFY_VIEW_SELECTED } from './view-switcher-base.js';
export type { AdwViewPage, NotifyViewSelectedEventData } from './view-switcher-base.js';
export { AdwViewSwitcher } from './adw-view-switcher.js';
export { AdwViewSwitcherBar } from './adw-view-switcher-bar.js';
export { AdwInlineViewSwitcher } from './adw-inline-view-switcher.js';
// AdwTabView keeps the NS chrome (the top chip bar + the ✕ close button); the
// MODEL — the pinned partition, the parent-aware close successor, the two-phase
// close protocol and the ordering rules — is headless (`@gjsify/adwaita-core`,
// ADR 0004), with the NS-specific projection in `tab-view-state.ts`.
export { AdwTabView, CLOSE_PAGE, NOTIFY_SELECTED_PAGE, PAGES_CHANGED } from './adw-tab-view.js';
export type { ClosePageEventData, NotifySelectedPageEventData, PagesChangedEventData } from './adw-tab-view.js';
export {
    applyTabViewVisibility,
    createTabViewState,
    tabBarVisibility,
    tabCloseVisibilities,
    tabLabelText,
    tabPageVisibilities,
    tabTooltipText,
    tabViewNotifyPayload,
} from './tab-view-state.js';
export type { AdwTabPage, NsVisibility, TabViewNotifyPayload } from './tab-view-state.js';
export {
    AdwCarousel,
    DEFAULT_CAROUSEL_PAGE_WIDTH,
    NOTIFY_N_PAGES,
    NOTIFY_POSITION,
    PAGE_CHANGED,
} from './adw-carousel.js';
export type { NotifyPositionEventData, PageChangedEventData } from './adw-carousel.js';
// The carousel's NS-specific projection — scroll offsets, dot classes and the
// scroll/model sync. Free of `@nativescript/core` VALUE imports, so the spec
// suite exercises the shipping code instead of a transcription of it.
export {
    CarouselScrollSync,
    applyCarouselDots,
    carouselDotClasses,
    carouselNotifyPayload,
    carouselPositionAtOffset,
    carouselScrollOffset,
    createCarouselState,
    normalizeCarouselPageWidth,
} from './carousel-state.js';
export type { CarouselNotifyPayload, NsCarouselStateOptions } from './carousel-state.js';

// --- Navigation ---
export { AdwNavigationView, NOTIFY_VISIBLE_PAGE } from './adw-navigation-view.js';
export type { NotifyVisiblePageEventData } from './adw-navigation-view.js';
export { AdwSplitViewBase, NOTIFY_SHOW_SIDEBAR } from './split-view-base.js';
export type { NotifyShowSidebarEventData } from './split-view-base.js';
export { AdwNavigationSplitView } from './adw-navigation-split-view.js';
export { AdwOverlaySplitView } from './adw-overlay-split-view.js';
export { NsNavigationSplitViewState, NsOverlaySplitViewState, splitViewColumns } from './split-view-state.js';
export type { NsShowSidebarNotification, NsSplitViewHost, NsSplitViewState } from './split-view-state.js';
export { AdwSidebar, NOTIFY_SELECTED as NOTIFY_SIDEBAR_SELECTED } from './adw-sidebar.js';
export type { NotifySidebarSelectedEventData } from './adw-sidebar.js';
export { AdwBottomSheet, CLOSE_ATTEMPT, NOTIFY_OPEN, SHEET_CLOSE } from './adw-bottom-sheet.js';
export type { NotifyOpenEventData } from './adw-bottom-sheet.js';

// --- Feedback / dialogs ---
// AdwToastOverlay is the NS View render; the AdwToast value object + the
// AdwToastQueue one-at-a-time/auto-dismiss state machine are headless
// (`@gjsify/adwaita-core`, ADR 0004), re-exported here for consumers.
export {
    AdwToast,
    AdwToastOverlay,
    AdwToastQueue,
    DEFAULT_TOAST_TIMEOUT,
    TOAST_BUTTON_CLICKED,
} from './adw-toast-overlay.js';
export type {
    AdwToastOptions,
    AdwToastQueueHandlers,
    AdwToastQueueOptions,
    ToastScheduler,
    ToastTimerHandle,
} from './adw-toast-overlay.js';
// AdwAlertDialog is the NS binding onto native confirm()/action(); the response
// registry + ordering + resolution are headless (AdwAlertResponses), re-exported.
export { AdwAlertDialog, AdwAlertResponses, NOTIFY_RESPONSE } from './adw-alert-dialog.js';
export type {
    AdwAlertResponse,
    AdwResponseAppearance,
    AdwResponseOptions,
    NotifyResponseEventData,
    OrderedConfirmResponses,
} from './adw-alert-dialog.js';
export { AdwAboutDialog, CLOSED as ABOUT_CLOSED } from './adw-about-dialog.js';
export { AdwPreferencesDialog, CLOSED as PREFERENCES_CLOSED } from './adw-preferences-dialog.js';

// --- Interaction helpers ---
// Wire Adwaita press-darken onto a custom activatable row (the built-in
// activatable rows already call this internally).
export { attachRowPressFeedback } from './row-press.js';

// --- Icon rendering ---
// Rasterise an Adwaita symbolic SVG (e.g. from `@gjsify/adwaita-icons`) to a native
// image — NativeScript has no SVG decoder. `AdwImageButton` uses this internally.
export {
    ADWAITA_ICON_GRID,
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    extractIconPaths,
    extractPathData,
    renderSymbolicIcon,
} from './icons.js';
export type { IconPath, SymbolicIconOptions } from './icons.js';

// --- Color scheme (light/dark) ---
// The host app flips this alongside the `ns-dark` class; theme-aware icons
// re-render their bitmap in the light/dark fg.
export {
    adwaitaColorScheme,
    isThemeIconColor,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    themeIconColor,
    toggleAdwaitaColorScheme,
} from './color-scheme.js';
export type { AdwColorScheme } from './color-scheme.js';

// --- Responsive breakpoints ---
// Libadwaita-style `Adw.Breakpoint`: flip a layout (collapse a split view, hide
// chrome) as the bound view crosses a width/height threshold — the adaptive
// primitive that gives a wide (tablet / desktop) screen its multi-pane layout.
export { AdwBreakpoint, addBreakpoints, evaluateBreakpointCondition, parseBreakpointCondition } from './breakpoint.js';
export type {
    AdwBreakpointHandlers,
    BreakpointBound,
    BreakpointConditionGroup,
    BreakpointConditionLeaf,
    BreakpointConditionNode,
    BreakpointDimension,
    BreakpointSize,
} from './breakpoint.js';

import { AdwPreferencesPage } from './adw-preferences-page.js';
import { AdwPreferencesGroup } from './adw-preferences-group.js';
import { AdwActionRow } from './adw-action-row.js';
import { AdwSwitchRow } from './adw-switch-row.js';
import { AdwEntryRow } from './adw-entry-row.js';
import { AdwPasswordEntryRow } from './adw-password-entry-row.js';
import { GtkEntry } from './gtk-entry.js';
import { AdwComboRow } from './adw-combo-row.js';
import { GtkDropDown } from './gtk-drop-down.js';
import { AdwSpinRow } from './adw-spin-row.js';
import { AdwSliderRow } from './adw-slider-row.js';
import { AdwExpanderRow } from './adw-expander-row.js';
import { GtkButton } from './gtk-button.js';
import { AdwImageButton } from './adw-image-button.js';
import { GtkMenuButton } from './gtk-menu-button.js';
import { AdwIcon } from './adw-icon.js';
import { AdwBanner } from './adw-banner.js';
import { AdwAvatar } from './adw-avatar.js';
import { AdwWindowTitle } from './adw-window-title.js';
import { AdwClamp } from './adw-clamp.js';
import { AdwHeaderBar } from './adw-header-bar.js';
import { AdwToolbarView } from './adw-toolbar-view.js';
import { AdwWrapBox } from './adw-wrap-box.js';
import { AdwDataGrid } from './adw-data-grid.js';
import { AdwSpinner } from './adw-spinner.js';
import { AdwStatusPage } from './adw-status-page.js';
import { AdwButtonRow } from './adw-button-row.js';
import { AdwButtonContent } from './adw-button-content.js';
import { AdwSplitButton } from './adw-split-button.js';
import { AdwToggleGroup } from './adw-toggle-group.js';
import { AdwShortcutLabel } from './adw-shortcut-label.js';
import { AdwViewStack } from './adw-view-stack.js';
import { AdwViewSwitcher } from './adw-view-switcher.js';
import { AdwViewSwitcherBar } from './adw-view-switcher-bar.js';
import { AdwInlineViewSwitcher } from './adw-inline-view-switcher.js';
import { AdwTabView } from './adw-tab-view.js';
import { AdwCarousel } from './adw-carousel.js';
import { AdwNavigationView } from './adw-navigation-view.js';
import { AdwNavigationSplitView } from './adw-navigation-split-view.js';
import { AdwOverlaySplitView } from './adw-overlay-split-view.js';
import { AdwSidebar } from './adw-sidebar.js';
import { AdwBottomSheet } from './adw-bottom-sheet.js';
import { AdwToastOverlay } from './adw-toast-overlay.js';
import { AdwAboutDialog } from './adw-about-dialog.js';
import { AdwPreferencesDialog } from './adw-preferences-dialog.js';

/** XML element name → constructor map registered with NativeScript. */
const ELEMENTS = {
    AdwPreferencesPage,
    AdwPreferencesGroup,
    AdwActionRow,
    AdwSwitchRow,
    AdwEntryRow,
    AdwPasswordEntryRow,
    GtkEntry,
    AdwComboRow,
    GtkDropDown,
    AdwSpinRow,
    AdwSliderRow,
    AdwExpanderRow,
    GtkButton,
    AdwImageButton,
    GtkMenuButton,
    AdwIcon,
    AdwBanner,
    AdwAvatar,
    AdwWindowTitle,
    AdwClamp,
    // Presentation / layout
    AdwHeaderBar,
    AdwToolbarView,
    AdwWrapBox,
    AdwDataGrid,
    AdwSpinner,
    AdwStatusPage,
    AdwButtonRow,
    AdwButtonContent,
    AdwSplitButton,
    AdwToggleGroup,
    AdwShortcutLabel,
    // View switching
    AdwViewStack,
    AdwViewSwitcher,
    AdwViewSwitcherBar,
    AdwInlineViewSwitcher,
    AdwTabView,
    AdwCarousel,
    // Navigation
    AdwNavigationView,
    AdwNavigationSplitView,
    AdwOverlaySplitView,
    AdwSidebar,
    AdwBottomSheet,
    // Feedback (View-based overlays only; AdwAlertDialog/AdwToast are not Views)
    AdwToastOverlay,
    AdwAboutDialog,
    AdwPreferencesDialog,
} as const;

let registered = false;

/**
 * Register all Adwaita widgets as UNPREFIXED NativeScript XML elements, where a
 * framework integration provides the `registerElement` global (idempotent).
 *
 * That global is NOT part of NativeScript itself: `@nativescript/core` 9.1 does
 * not contain the identifier at all, and it is `undefined` in a plain app built
 * with `@nativescript/vite` — measured on an Android emulator, 2026-08-28, where
 * this function therefore returned silently and `<AdwSwitchRow>` resolved to
 * nothing. It comes from `@nativescript/angular` / `nativescript-vue`, which is
 * where this call earns its keep; a plain XML app uses the `xmlns` barrel above
 * instead and needs no registration at all.
 *
 * The no-op is the safe branch of that split, not a fallback: it is why the call
 * can be made unconditionally, and why it must never be the only thing an app
 * does before writing `<AdwSwitchRow>` in markup.
 */
export function registerAdwaitaElements(): void {
    if (registered) return;
    if (typeof registerElement !== 'function') return;
    for (const [name, ctor] of Object.entries(ELEMENTS)) {
        registerElement(name, () => ctor);
    }
    registered = true;
}
