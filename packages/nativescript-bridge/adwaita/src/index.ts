// @gjsify/adwaita-nativescript — native Adwaita widgets for the NativeScript runtime.
//
// Design-identity axis 4 (parallel to `@gjsify/adwaita-web`), but rendering REAL
// native NativeScript components (StackLayout / GridLayout / Switch / Label)
// instead of a webview. Pure named exports; the only side-effecting entry is the
// explicit `registerAdwaita()` / `registerAdwaitaElements()` call, mirroring the
// `/register` convention spirit (no eager `globalThis`/runtime writes on import).

export { assertNativeScript, isNativeScript, isAndroid, isIOS } from '@gjsify/native-platform';

// Widgets
export {
    NOTIFY_ACTIVE,
    NOTIFY_TEXT,
    ENTRY_ACTIVATE,
    NOTIFY_ENTRY_TEXT,
    ComboState,
    NOTIFY_SELECTED,
    NOTIFY_DROP_DOWN_SELECTED,
    SpinState,
    NOTIFY_VALUE,
    AdwSliderRow,
    NOTIFY_SLIDER_VALUE,
    ExpanderState,
    NOTIFY_EXPANDED,
    AdwImageButton,
    DEFAULT_ICON_BUTTON_ICON_SIZE,
    MENU_ITEM_ACTIVATED,
    DEFAULT_ADW_ICON_SIZE,
    BUTTON_CLICKED,
    DEFAULT_AVATAR_SIZE,
    avatarInitials,
    DEFAULT_CLAMP_MAX_SIZE,
    // Presentation / layout
    AdwDataGrid,
    ROW_ACTIVATED,
    dataGridCellClass,
    dataGridItemSpec,
    dataGridRowClass,
    dataGridShapeKey,
    dataGridTracksKey,
    parseDataGridWidth,
    DATA_GRID_HEADER_CELL_CLASS,
    DATA_GRID_HEADER_ROW_CLASS,
    DATA_GRID_SECTION_CELL_CLASS,
    DEFAULT_SPINNER_SIZE,
    ACTIVATED,
    CLICKED,
    MENU_TAPPED,
    ToggleGroupState,
    NOTIFY_TOGGLE_SELECTED,
    applyAdwaitaNsAccent,
    clearAdwaitaNsAccent,
    ADWAITA_NS_ACCENT_RULES,
    adwaitaNsAccentColor,
    adwaitaNsAccentCss,
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
    // View switching
    NOTIFY_VISIBLE_CHILD,
    AdwViewSwitcherBase,
    NOTIFY_VIEW_SELECTED,
    DEFAULT_CAROUSEL_PAGE_WIDTH,
    NOTIFY_POSITION,
    // Navigation
    NOTIFY_VISIBLE_PAGE,
    AdwSplitViewBase,
    NOTIFY_SHOW_SIDEBAR,
    NsNavigationSplitViewState,
    NsOverlaySplitViewState,
    splitViewColumns,
    NOTIFY_SIDEBAR_SELECTED,
    NOTIFY_OPEN,
    // Feedback / dialogs
    AdwToast,
    AdwToastQueue,
    DEFAULT_TOAST_TIMEOUT,
    TOAST_BUTTON_CLICKED,
    AdwAlertResponses,
    NOTIFY_RESPONSE,
    ABOUT_CLOSED,
    PREFERENCES_CLOSED,
    // Interaction + icon helpers
    attachRowPressFeedback,
    renderSymbolicIcon,
    extractIconPaths,
    extractPathData,
    ADWAITA_ICON_GRID,
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    // Color scheme (light/dark)
    adwaitaColorScheme,
    isThemeIconColor,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    themeIconColor,
    toggleAdwaitaColorScheme,
    // Responsive breakpoints
    AdwBreakpoint,
    addBreakpoints,
    evaluateBreakpointCondition,
    parseBreakpointCondition,
    registerAdwaitaElements,
} from './widgets/index.js';
export type {
    NotifyActiveEventData,
    NotifyTextEventData,
    NotifyEntryTextEventData,
    AdwComboOption,
    ComboStateChange,
    ComboStateListener,
    NotifySelectedEventData,
    NotifyDropDownSelectedEventData,
    NotifyValueEventData,
    SpinStateChange,
    SpinStateListener,
    NotifySliderValueEventData,
    NotifyExpandedEventData,
    ExpanderStateListener,
    AdwButtonVariant,
    AdwMenuItem,
    MenuItemActivatedEventData,
    // Presentation / layout
    MenuTappedEventData,
    RowActivatedEventData,
    DataGridItemSpec,
    NotifyToggleSelectedEventData,
    ToggleGroupStateChange,
    ToggleGroupStateListener,
    AccentRole,
    AccentRule,
    ShortcutLabelRenderPlan,
    ShortcutLabelViewSpec,
    // View switching
    AdwViewStackPage,
    NotifyVisibleChildEventData,
    AdwViewPage,
    NotifyViewSelectedEventData,
    NotifyPositionEventData,
    // Navigation
    NotifyVisiblePageEventData,
    NotifyShowSidebarEventData,
    NsShowSidebarNotification,
    NsSplitViewHost,
    NsSplitViewState,
    NotifySidebarSelectedEventData,
    NotifyOpenEventData,
    // Feedback / dialogs
    AdwToastOptions,
    AdwToastQueueHandlers,
    AdwToastQueueOptions,
    ToastScheduler,
    ToastTimerHandle,
    NotifyResponseEventData,
    AdwAlertResponse,
    AdwResponseAppearance,
    AdwResponseOptions,
    OrderedConfirmResponses,
    // Icon helpers
    SymbolicIconOptions,
    IconPath,
    // Color scheme
    AdwColorScheme,
    // Responsive breakpoints
    AdwBreakpointHandlers,
    BreakpointBound,
    BreakpointConditionGroup,
    BreakpointConditionLeaf,
    BreakpointConditionNode,
    BreakpointDimension,
    BreakpointSize,
} from './widgets/index.js';

// ADR 0034 clause 2 — the widgets under their GIR names (`Adw.SwitchRow`, `Gtk.Entry`),
// and since § Amendment 9 that is their ONLY name here: the prefixed `AdwSwitchRow` /
// `GtkEntry` exports above are gone. `export * as`, not an object literal, so a member
// carries the TYPE meaning too — see the header of `./namespace/adw.ts`.
//
// The widgets with NO member keep their flat export a few lines up, and that is not an
// oversight: `AdwSliderRow` and `AdwDataGrid` have no counterpart type and `AdwImageButton`
// no single GIR name, so a flat name that is a widget's ONLY name is not a second spelling.
export * as Adw from './namespace/adw.js';
export * as Gtk from './namespace/gtk.js';

// Fonts
export {
    ADWAITA_SANS_FONT_FAMILY,
    ADWAITA_SANS_TTF_FILES,
    adwaitaFontInstallInstructions,
    hasAdwaitaSans,
} from './fonts.js';

import { assertNativeScript } from '@gjsify/native-platform';
import { registerAdwaitaElements } from './widgets/index.js';

/**
 * One-call convenience setup for the Adwaita NativeScript layer.
 *
 * Asserts we are running under NativeScript (throws `'Platform not supported'`
 * otherwise — same guard `@gjsify/native-fs-bridge` uses) and registers every
 * Adwaita widget as an XML element so markup like `<AdwSwitchRow />` resolves.
 * Idempotent. Note: the Adwaita CSS theme and the Adwaita Sans fonts are NOT
 * auto-installed — wire `./theme/adwaita.css` into your app CSS and copy the
 * fonts per {@link adwaitaFontInstallInstructions} (a bundler can't drop files
 * into the native resource dirs).
 */
export function registerAdwaita(): void {
    assertNativeScript();
    registerAdwaitaElements();
}
