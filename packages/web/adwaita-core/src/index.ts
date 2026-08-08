// @gjsify/adwaita-core — headless Adwaita widget behavior (ADR 0004).
//
// Renderer-agnostic logic shared by the Adwaita design-identity renderers
// (`@gjsify/adwaita-web`, `@gjsify/adwaita-nativescript`; GTK stays native
// Libadwaita). Pure TS: NO platform imports (no `gi://`, no `@girs/*`, no
// `@nativescript/core`, no DOM assumptions), no `/register` subpath, no
// `globalThis` writes — pure named exports only. Follows the
// `@gjsify/storybook-core` seam pattern: behavior lives here once, renderers
// stay thin adapters.
//
// Seed modules (implementation step 1): breakpoint condition grammar/parser/
// evaluator + the transition-only `AdwBreakpoint` apply/unapply state machine,
// and the light/dark color-scheme observable. Step 2: the toast queue
// (one-at-a-time + auto-dismiss lifecycle) and the alert-dialog response model.
// Step 3: the row interaction state machines — expander disclosure, combo
// selection, spin clamp/step, toggle-group selection. Step 4: pure derivations
// ported straight from the libadwaita C source and held to per-input vectors
// that BOTH renderers assert against — see `@gjsify/adwaita-core/conformance`.

// --- Action-row family (Adw.ActionRow/SwitchRow/ButtonRow/WindowTitle) ---
export {
    ActionRowState,
    BUTTON_ROW_ACTIVATABLE,
    ButtonRowState,
    SwitchRowState,
    WindowTitleState,
    deriveRowLabels,
} from './action-row.js';
export type {
    ActionRowRenderState,
    AdwRowLabelInput,
    AdwRowLabels,
    ButtonRowRenderState,
    WindowTitleRenderState,
} from './action-row.js';

// --- Avatar derivation (Adw.Avatar initials + colour) ---
export {
    AVATAR_COLOR_COUNT,
    AVATAR_COLORS,
    avatarColor,
    avatarColorClass,
    avatarFontSize,
    avatarInitials,
    avatarMaxFontSize,
    avatarMode,
    flattenAvatarGradient,
    gStrHash,
    randomAvatarColorClass,
} from './avatar.js';
export type { AdwAvatarColor, AdwAvatarMode } from './avatar.js';

// --- Banner defaults + derivations (Adw.Banner) ---
export {
    ADW_BANNER_BUTTON_STYLES,
    ADW_BANNER_BUTTON_STYLE_CLASSES,
    ADW_BANNER_DEFAULTS,
    bannerButtonStyleClasses,
    bannerButtonText,
    bannerButtonVisible,
    bannerRenderState,
    isBannerButtonStyle,
    parseBannerButtonStyle,
} from './banner.js';
export type { AdwBannerButtonStyle, AdwBannerProps, AdwBannerRenderState } from './banner.js';

// --- Button content: icon+label slots + the parent-button style class (Adw.ButtonContent) ---
export {
    ADW_BUTTON_CONTENT_DEFAULTS,
    BUTTON_CONTENT_FALLBACK_ICON,
    BUTTON_CONTENT_STYLE_CLASS,
    buttonContentEllipsize,
    buttonContentIconExpands,
    buttonContentIconIsEmpty,
    buttonContentIconName,
    buttonContentLabelText,
    buttonContentLabelVisible,
    buttonContentRenderState,
    buttonContentStyleTargetIndex,
} from './button-content.js';
export type {
    AdwButtonContentProps,
    AdwButtonContentRenderState,
    ButtonContentAncestor,
    ButtonContentEllipsize,
} from './button-content.js';

// --- Responsive breakpoints (Adw.Breakpoint / Adw.BreakpointCondition) ---
export { AdwBreakpoint, evaluateBreakpointCondition, parseBreakpointCondition } from './breakpoint.js';
export type {
    AdwBreakpointHandlers,
    BreakpointBound,
    BreakpointConditionGroup,
    BreakpointConditionLeaf,
    BreakpointConditionNode,
    BreakpointDimension,
    BreakpointSize,
} from './breakpoint.js';

// --- Color scheme (light/dark) ---
export {
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    adwaitaColorScheme,
    isThemeIconColor,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    themeIconColor,
    toggleAdwaitaColorScheme,
} from './color-scheme.js';
export type { AdwColorScheme } from './color-scheme.js';

// --- Toast queue (Adw.ToastOverlay / Adw.Toast) ---
export { AdwToast, AdwToastQueue, DEFAULT_TOAST_TIMEOUT } from './toast.js';
export type {
    AdwToastOptions,
    AdwToastQueueHandlers,
    AdwToastQueueOptions,
    ToastScheduler,
    ToastTimerHandle,
} from './toast.js';

// --- Dialogs: alert responses + bottom-sheet dismissal (Adw.AlertDialog / Adw.BottomSheet) ---
export { AdwAlertResponses, BottomSheetPresentation, resolveBottomSheetClose } from './dialog.js';
export type {
    AdwAlertResponse,
    AdwResponseAppearance,
    AdwResponseOptions,
    BottomSheetCloseOutcome,
    BottomSheetCloseSource,
    BottomSheetCloseState,
    BottomSheetPresentationListener,
    BottomSheetPresentationOptions,
    BottomSheetTeardownCallback,
    OrderedConfirmResponses,
} from './dialog.js';

// --- Row interaction state machines (Adw.ExpanderRow/ComboRow/SpinRow/ToggleGroup) ---
export { ComboState, ExpanderState, SpinState, ToggleGroupState, normalizeComboOptions } from './rows.js';
export type {
    AdwComboOption,
    AdwComboOptionInput,
    ComboStateChange,
    ComboStateListener,
    ExpanderStateListener,
    SpinStateChange,
    SpinStateListener,
    ToggleGroupStateChange,
    ToggleGroupStateListener,
} from './rows.js';

// --- GLib primitives Adwaita arithmetic is written in ---
export { glibClamp, stringIsNotEmpty } from './glib.js';

// --- View stack selection (Adw.ViewStack) ---
export { ViewStackState, normalizeIconName, resolvePageTitle } from './view-stack.js';
export type {
    AdwViewStackPageInfo,
    AdwViewStackPageSpec,
    ViewStackStateChange,
    ViewStackStateListener,
} from './view-stack.js';

// --- Navigation stack (Adw.NavigationView) ---
export { BACK_BUTTON_FALLBACK_TOOLTIP, NavigationViewState, describeNavigationDiagnostic } from './navigation-view.js';
export type {
    AdwNavigationPageProps,
    NavigationChangeReason,
    NavigationDiagnostic,
    NavigationDiagnosticCode,
    NavigationDiagnosticListener,
    NavigationPagePropsResolver,
    NavigationShortcutResult,
    NavigationStackChange,
    NavigationStackListener,
    NavigationViewOptions,
} from './navigation-view.js';

// --- Sidebar selection + sections (Adw.Sidebar) ---
export {
    ADW_SIDEBAR_NO_SELECTION,
    SidebarState,
    adjustSidebarSelection,
    clampSidebarSelection,
    flattenSidebarItems,
    sidebarHeaders,
} from './sidebar.js';
export type {
    AdwSidebarItemSpec,
    AdwSidebarMode,
    AdwSidebarSectionSpec,
    SidebarActivation,
    SidebarFlatItem,
    SidebarHeaderSpec,
    SidebarItemFilter,
    SidebarSelectionChange,
    SidebarStateListener,
} from './sidebar.js';

// --- Entry rows (Adw.EntryRow / Adw.PasswordEntryRow) ---
export {
    CAPS_LOCK_ICON_NAME,
    CAPS_LOCK_TOOLTIP,
    EMPTY_ANIMATION_DURATION_MS,
    ENTRY_ROW_APPLY_ICON_NAME,
    ENTRY_ROW_APPLY_TOOLTIP,
    ENTRY_ROW_EDIT_ICON_NAME,
    ENTRY_ROW_MAX_LENGTH_LIMIT,
    ENTRY_ROW_TITLE_SPACING,
    EntryRowState,
    PASSWORD_CONCEAL_ICON_NAME,
    PASSWORD_CONCEAL_LABEL,
    PASSWORD_REVEAL_ICON_NAME,
    PASSWORD_REVEAL_LABEL,
    PasswordEntryRowState,
    clampEntryText,
    entryTextLength,
} from './entry-row.js';
export type {
    EntryRowActivation,
    EntryRowRenderState,
    EntryRowStateListener,
    PasswordEntryRowRenderState,
    PasswordEntryRowStateListener,
} from './entry-row.js';

// --- Split views (Adw.NavigationSplitView / Adw.OverlaySplitView) ---
export {
    ADW_SWIPE_BORDER,
    DEFAULT_DPI,
    DEFAULT_MAX_SIDEBAR_WIDTH,
    DEFAULT_MIN_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH_FRACTION,
    DEFAULT_SIDEBAR_WIDTH_UNIT,
    INSTANT_SPLIT_VIEW_ANIMATOR,
    NAVIGATION_SPLIT_VIEW_CRITICALS,
    NavigationSplitViewState,
    OverlaySplitViewState,
    adwLengthToPx,
    isSidebarAtVisualStart,
    layoutNavigationSplitView,
    layoutOverlaySplitView,
    measureSplitViewHorizontal,
    resolveNaturalSidebarWidth,
    resolveNavigationAction,
    resolveNavigationSidebarWidth,
    resolveNavigationStack,
    resolveOverlaySidebarWidth,
    resolveSidebarBounds,
    resolveSwipeArea,
    resolveSwipeRelease,
    resolveSwipeSnapPoints,
    resolveSwipeStart,
    swipeCancelProgress,
    tagsConflict,
} from './split-view.js';
export type {
    AdwLengthUnit,
    AdwPackType,
    AdwTextDirection,
    NavigationActionInput,
    NavigationActionResult,
    NavigationPageRef,
    NavigationSplitViewChange,
    NavigationSplitViewHandlers,
    NavigationSplitViewLayout,
    NavigationSplitViewListener,
    NavigationSplitViewOptions,
    NavigationSplitViewProperty,
    NavigationStackPlan,
    OverlaySplitViewChange,
    OverlaySplitViewLayout,
    OverlaySplitViewListener,
    OverlaySplitViewOptions,
    OverlaySplitViewProperty,
    SidebarBounds,
    SidebarWidthInput,
    SidebarWidthSpec,
    SplitViewAnimation,
    SplitViewAnimationRequest,
    SplitViewAnimator,
    SplitViewMeasureInput,
    SplitViewPane,
    SplitViewPaneRect,
    SwipeReleasePlan,
} from './split-view.js';

// --- Split button + menu model (Adw.SplitButton) ---
export {
    DEFAULT_DROPDOWN_TOOLTIP,
    SPLIT_BUTTON_DISABLED_OPACITY,
    SplitButtonState,
    isSplitButtonDirection,
    menuButtonArrowIcon,
    menuButtonPopupDirection,
    parseMenuEntries,
    resolveDropdownTooltip,
    splitButtonArrowIcon,
    splitButtonPopupDirection,
    splitButtonRootState,
    splitButtonStyleClasses,
} from './split-button.js';
export type {
    AdwArrowIcon,
    AdwMenuEntry,
    SplitButtonChange,
    SplitButtonContentMode,
    SplitButtonDirection,
    SplitButtonHalfState,
    SplitButtonListener,
    SplitButtonProperty,
    SplitButtonStyleClass,
} from './split-button.js';

// --- View switcher + bar (Adw.ViewSwitcher / Adw.InlineViewSwitcher) ---
export {
    DEFAULT_INDICATOR_DESCRIPTION_STRINGS,
    INLINE_VIEW_SWITCHER_DISPLAY_MODES,
    VIEW_SWITCHER_BADGE_LIMIT,
    VIEW_SWITCHER_DRAG_SWITCH_DELAY,
    VIEW_SWITCHER_FALLBACK_ICON,
    VIEW_SWITCHER_NO_SELECTION,
    VIEW_SWITCHER_POLICIES,
    ViewSwitcherBarState,
    ViewSwitcherDragSwitch,
    ViewSwitcherState,
    buildInlineToggles,
    buildViewSwitcherButtons,
    createViewSwitcherPage,
    inlineToggleTooltip,
    isInlineViewSwitcherDisplayMode,
    isViewSwitcherButtonVisible,
    isViewSwitcherPolicy,
    pageIndexForToggle,
    shouldRevealViewSwitcherBar,
    stripMnemonic,
    toggleIndexForPage,
    viewSwitcherBadgeLabel,
    viewSwitcherButtonOrientation,
    viewSwitcherIconName,
    viewSwitcherIndicatorDescription,
    viewSwitcherLabel,
    viewSwitcherPageFromStackPage,
    viewSwitcherPagesFromStack,
} from './view-switcher.js';
export type {
    AdwInlineViewSwitcherDisplayMode,
    AdwViewSwitcherPage,
    AdwViewSwitcherPageInit,
    AdwViewSwitcherPolicy,
    IndicatorDescriptionStrings,
    InlineToggleModel,
    ViewSwitcherBarChange,
    ViewSwitcherBarListener,
    ViewSwitcherButtonModel,
    ViewSwitcherDragSwitchOptions,
    ViewSwitcherScheduler,
    ViewSwitcherStateChange,
    ViewSwitcherStateListener,
    ViewSwitcherStateOptions,
    ViewSwitcherTimerHandle,
} from './view-switcher.js';

// --- Tab view (Adw.TabView) ---
export {
    DEFAULT_TAB_AUTOHIDE,
    TabViewState,
    isDescendantOfPage,
    successorAfterClose,
    tabCloseVisible,
    tabIconState,
    tabTooltip,
    tabTooltipIsMarkup,
    tabsRevealed,
} from './tab-view.js';
export type {
    AdwTabPageSpec,
    AdwTabPageState,
    TabIconState,
    TabViewHandlers,
    TabViewPagesChange,
    TabViewPagesChangeKind,
    TabViewPagesListener,
    TabViewSelectionChange,
    TabViewSelectionListener,
} from './tab-view.js';

// --- Carousel position + paging (Adw.Carousel) ---
export {
    CAROUSEL_SCROLL_TIMEOUT_MS,
    CAROUSEL_SETTLE_EPSILON,
    CarouselState,
    carouselClampPosition,
    carouselClosestSnapPoint,
    carouselNavigateTarget,
    carouselPageAtPosition,
    carouselRange,
    carouselReorderShift,
    carouselSizesFromSnapPoints,
    carouselSnapPoints,
    carouselWheelStep,
} from './carousel.js';
export type {
    CarouselChangeReason,
    CarouselDirection,
    CarouselOrientation,
    CarouselPageChangedListener,
    CarouselRange,
    CarouselReorderShiftInput,
    CarouselScrollOptions,
    CarouselScrollRequest,
    CarouselScrollSource,
    CarouselStateChange,
    CarouselStateListener,
    CarouselStateOptions,
    CarouselWheelInput,
} from './carousel.js';

// --- Preferences group header + dialog search (Adw.PreferencesDialog) ---
export {
    UNTITLED_PAGE_LABEL,
    collectSearchRows,
    countVisiblePages,
    createSearchRowSubtitle,
    defaultCaseFolder,
    derivePreferencesGroupHeader,
    escapeMarkup,
    makeComparable,
    rowMatchesQuery,
    searchPreferences,
    stripMarkup,
} from './preferences.js';
export type {
    CaseFolder,
    MakeComparableOptions,
    PreferencesGroupHeaderInput,
    PreferencesGroupHeaderState,
    PreferencesSearchEntry,
    PreferencesSearchGroup,
    PreferencesSearchPage,
    PreferencesSearchResult,
    PreferencesSearchRow,
    SearchPreferencesOptions,
    SearchRowSubtitleInput,
} from './preferences.js';

// --- Clamp / spinner / toolbar-view arithmetic ---
export {
    ADW_CLAMP_DEFAULTS,
    ADW_CLAMP_SIZE_CLASSES,
    ADW_SPINNER_MAX_SIZE,
    ADW_SPINNER_MIN_SIZE,
    ADW_TOOLBAR_BAR_CLASSES,
    ADW_TOOLBAR_VIEW_CLASSES,
    ADW_TOOLBAR_VIEW_DEFAULTS,
    clampAllocate,
    clampChildSize,
    clampSizeFromChild,
    clampThresholds,
    normalizeClampSize,
    parseToolbarStyle,
    resolveSpinnerSize,
    spinnerGeometry,
    toolbarBarStyleClasses,
    toolbarViewAllocate,
    toolbarViewClasses,
    toolbarViewContentForSize,
    toolbarViewMeasure,
} from './chrome.js';
export type {
    AdwClampSizeClass,
    AdwMeasurement,
    AdwToolbarStyle,
    ClampAllocation,
    ClampParams,
    ClampThresholds,
    SpinnerGeometry,
    ToolbarViewAllocateInput,
    ToolbarViewAllocation,
    ToolbarViewClassInput,
    ToolbarViewClasses,
    ToolbarViewContentForSize,
    ToolbarViewContentForSizeInput,
    ToolbarViewMeasureInput,
} from './chrome.js';

// --- Popover dismissal + keyboard navigation (GtkPopover surface, shared by
// --- the menu button, drop-down and split button) ---
export {
    POPOVER_ITEM_RADIUS,
    POPOVER_MENU_PADDING,
    POPOVER_PADDING,
    POPOVER_RADIUS,
    PopoverState,
    resolvePopoverKey,
} from './popover.js';
export type {
    PopoverKeyAction,
    PopoverKeyContext,
    PopoverKeyResolution,
    PopoverStateChange,
    PopoverStateListener,
} from './popover.js';
