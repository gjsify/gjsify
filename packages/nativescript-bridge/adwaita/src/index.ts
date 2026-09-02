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
    AdwPreferencesPage,
    AdwPreferencesGroup,
    AdwActionRow,
    AdwSwitchRow,
    NOTIFY_ACTIVE,
    AdwEntryRow,
    NOTIFY_TEXT,
    AdwPasswordEntryRow,
    GtkEntry,
    ENTRY_ACTIVATE,
    NOTIFY_ENTRY_TEXT,
    AdwComboRow,
    ComboState,
    NOTIFY_SELECTED,
    GtkDropDown,
    NOTIFY_DROP_DOWN_SELECTED,
    AdwSpinRow,
    SpinState,
    NOTIFY_VALUE,
    AdwSliderRow,
    NOTIFY_SLIDER_VALUE,
    AdwExpanderRow,
    ExpanderState,
    NOTIFY_EXPANDED,
    GtkButton,
    AdwImageButton,
    DEFAULT_ICON_BUTTON_ICON_SIZE,
    GtkMenuButton,
    MENU_ITEM_ACTIVATED,
    AdwIcon,
    DEFAULT_ADW_ICON_SIZE,
    AdwBanner,
    BUTTON_CLICKED,
    AdwAvatar,
    DEFAULT_AVATAR_SIZE,
    avatarInitials,
    AdwWindowTitle,
    AdwClamp,
    DEFAULT_CLAMP_MAX_SIZE,
    // Presentation / layout
    AdwHeaderBar,
    AdwToolbarView,
    AdwWrapBox,
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
    AdwSpinner,
    DEFAULT_SPINNER_SIZE,
    AdwStatusPage,
    AdwButtonRow,
    ACTIVATED,
    AdwButtonContent,
    AdwSplitButton,
    CLICKED,
    MENU_TAPPED,
    AdwToggleGroup,
    ToggleGroupState,
    NOTIFY_TOGGLE_SELECTED,
    applyAdwaitaNsAccent,
    clearAdwaitaNsAccent,
    ADWAITA_NS_ACCENT_RULES,
    adwaitaNsAccentColor,
    adwaitaNsAccentCss,
    AdwShortcutLabel,
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
    AdwViewStack,
    NOTIFY_VISIBLE_CHILD,
    AdwViewSwitcherBase,
    NOTIFY_VIEW_SELECTED,
    AdwViewSwitcher,
    AdwViewSwitcherBar,
    AdwInlineViewSwitcher,
    AdwTabView,
    AdwCarousel,
    DEFAULT_CAROUSEL_PAGE_WIDTH,
    NOTIFY_POSITION,
    // Navigation
    AdwNavigationView,
    NOTIFY_VISIBLE_PAGE,
    AdwSplitViewBase,
    NOTIFY_SHOW_SIDEBAR,
    AdwNavigationSplitView,
    AdwOverlaySplitView,
    NsNavigationSplitViewState,
    NsOverlaySplitViewState,
    splitViewColumns,
    AdwSidebar,
    NOTIFY_SIDEBAR_SELECTED,
    AdwBottomSheet,
    NOTIFY_OPEN,
    // Feedback / dialogs
    AdwToast,
    AdwToastOverlay,
    AdwToastQueue,
    DEFAULT_TOAST_TIMEOUT,
    TOAST_BUTTON_CLICKED,
    AdwAlertDialog,
    AdwAlertResponses,
    NOTIFY_RESPONSE,
    AdwAboutDialog,
    ABOUT_CLOSED,
    AdwPreferencesDialog,
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

// ADR 0034 clause 2 — the same widgets under their GIR names (`Adw.SwitchRow`,
// `Gtk.Entry`). Beside the barrel, never inside it: see the header of `namespace.ts`.
export { Adw, Gtk } from './namespace.js';

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
