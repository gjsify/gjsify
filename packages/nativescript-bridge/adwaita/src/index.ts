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
    AdwEntry,
    ENTRY_ACTIVATE,
    NOTIFY_ENTRY_TEXT,
    AdwComboRow,
    ComboState,
    NOTIFY_SELECTED,
    AdwDropDown,
    NOTIFY_DROP_DOWN_SELECTED,
    AdwSpinRow,
    SpinState,
    NOTIFY_VALUE,
    AdwSliderRow,
    NOTIFY_SLIDER_VALUE,
    AdwExpanderRow,
    ExpanderState,
    NOTIFY_EXPANDED,
    AdwButton,
    AdwImageButton,
    DEFAULT_ICON_BUTTON_ICON_SIZE,
    AdwMenuButton,
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
