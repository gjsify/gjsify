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

// --- About dialog (Adw.AboutDialog licences, credits, page visibility) ---
export {
    ADW_ABOUT_DIALOG_LABELS,
    ADW_CREDITS_SECTION_TITLES,
    ADW_LICENSES,
    ADW_LICENSE_ALIASES,
    ADW_LICENSE_DEFAULTS,
    ADW_LICENSE_WARRANTY_TEMPLATE,
    ADW_TRANSLATOR_CREDITS_SENTINELS,
    GTK_LICENSE,
    aboutDialogVisibility,
    creditsSections,
    isLicenseType,
    legalSectionVisible,
    licenseText,
    licenseTypeForSpdxId,
    parseCreditPerson,
    setLicense,
    setLicenseType,
    translatorCreditsPeople,
} from './about-dialog.js';
export type {
    AdwAboutDialogProps,
    AdwAboutDialogVisibility,
    AdwCreditPerson,
    AdwCreditsInput,
    AdwCreditsSection,
    AdwCreditsSectionInput,
    AdwLicenseAlias,
    AdwLicenseInfo,
    AdwLicenseNotify,
    AdwLicenseState,
    AdwLicenseTransition,
    AdwLicenseType,
} from './about-dialog.js';

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
    BUTTON_CONTENT_BOX_SPACING,
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

// --- Button style classes (Gtk.Button + Adwaita style classes) ---
export { ADW_BUTTON_STYLE_ALIASES, ADW_BUTTON_STYLE_CLASSES, buttonStyleClass, buttonStyleClasses } from './button.js';
export type { AdwButtonStyleClass } from './button.js';

// --- Checks + radio-group exclusivity (Adwaita check/radio) ---
export { RadioGroupState, resolveCheckState } from './checks.js';
export type { AdwCheckState, RadioGroupChange, RadioGroupListener } from './checks.js';

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

// --- Accent colours (AdwAccentColor + the OkLab standalone derivation) ---
export {
    ADW_ACCENT_BG_COLORS,
    ADW_ACCENT_COLOR_NAMES,
    ADW_ACCENT_FG_COLOR,
    ADW_DEFAULT_ACCENT_COLOR,
    adwaitaAccent,
    adwaitaAccentBgColor,
    adwaitaAccentColor,
    adwaitaStandaloneColor,
    isAdwAccentColorName,
    onAdwaitaAccentChanged,
    setAdwaitaAccent,
} from './accent.js';
export type { AdwAccentColorName } from './accent.js';

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

// --- Data grid (AdwDataGrid — the aligned numeric grid; ours, not upstream's) ---
export {
    ADW_DATA_GRID_ROW_VARIANTS,
    DATA_GRID_CELL_CLASS,
    DATA_GRID_ROW_CLASS,
    dataGridCellText,
    dataGridColumnAlign,
    dataGridColumnClasses,
    dataGridRowInteractive,
    dataGridTrackTemplate,
    dataGridTracks,
    normalizeDataGridColumns,
    normalizeDataGridVariant,
} from './data-grid.js';
export type {
    AdwDataGridAlign,
    AdwDataGridCellValue,
    AdwDataGridColumn,
    AdwDataGridRow,
    AdwDataGridRowVariant,
    DataGridTrack,
} from './data-grid.js';

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

// --- The portable list model (the item vocabulary + items-changed — ADR 0046) ---
export {
    ADW_COMBO_NO_SELECTION,
    clampListSelection,
    listItemsChanged,
    normalizeComboOptions,
    parseListModel,
} from './list.js';
export type {
    AdwComboOption,
    AdwComboOptionInput,
    AdwListItemsChanged,
    AdwListModel,
    AdwListModelInput,
} from './list.js';

// --- The portable adjustment (Gtk.Adjustment's six numbers + its two signals — ADR 0047) ---
export {
    ADW_ADJUSTMENT_DEFAULTS,
    adjustmentRange,
    clampAdjustmentValue,
    normalizeAdjustment,
    parseAdjustment,
    snapAdjustmentValue,
    SpinState,
} from './adjustment.js';
export type {
    AdwAdjustment,
    AdwAdjustmentInput,
    SpinStateChange,
    SpinStateListener,
    SpinStateRangeListener,
} from './adjustment.js';

// --- Row interaction state machines (Adw.ExpanderRow/ComboRow/ToggleGroup) ---
export { ComboState, ExpanderState, ToggleGroupState } from './rows.js';
export type {
    ComboItemsListener,
    ComboStateChange,
    ComboStateListener,
    ExpanderStateListener,
    ToggleGroupStateChange,
    ToggleGroupStateListener,
} from './rows.js';

// --- GLib primitives Adwaita arithmetic is written in ---
export { glibClamp, gStrStrip, stringIsNotEmpty } from './glib.js';

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

// --- Interpolation + easing (adw_lerp, AdwEasing) ---
export { adwLerp, easeInOutSine, easeOutCubic, inverseLerp } from './easing.js';

// --- Adw.Spinner animation (AdwSpinnerPaintable's breathing arc) ---
export {
    ADW_SPINNER_CYCLES_PER_LOOP,
    ADW_SPINNER_CYCLE_LENGTH,
    ADW_SPINNER_CONTRACT_DISTANCE,
    ADW_SPINNER_EXTEND_DISTANCE,
    ADW_SPINNER_IDLE_DISTANCE,
    ADW_SPINNER_MAX_ARC_LENGTH,
    ADW_SPINNER_MIN_ARC_LENGTH,
    ADW_SPINNER_N_CYCLES,
    ADW_SPINNER_OVERLAP_DISTANCE,
    ADW_SPINNER_SPIN_DURATION_MS,
    ADW_SPINNER_START_ANGLE,
    ADW_SPINNER_STILL_PROGRESS,
    ADW_SPINNER_TRACK_OPACITY,
    normalizeSpinnerAngle,
    spinnerArc,
    spinnerArcEnd,
    spinnerArcStart,
    spinnerProgressAt,
} from './spinner.js';
export type { SpinnerArc } from './spinner.js';

// --- Shortcut labels (Adw.ShortcutLabel — accelerator string → keycaps) ---
export { parseAccelerator, parseShortcutLabel, shortcutKeycaps } from './shortcut-label.js';
export type { ShortcutKeycap, ShortcutLabelNode, ShortcutLabelOptions, ShortcutLabelParse } from './shortcut-label.js';

// --- Length units (AdwLengthUnit — split views, wrap box, clamp) ---
export { ADW_LENGTH_UNITS, DEFAULT_DPI, adwLengthToPx, normalizeLengthUnit } from './length-unit.js';
export type { AdwLengthUnit } from './length-unit.js';

// --- Split views (Adw.NavigationSplitView / Adw.OverlaySplitView) ---
export {
    ADW_SWIPE_BORDER,
    DEFAULT_MAX_SIDEBAR_WIDTH,
    DEFAULT_MIN_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH_FRACTION,
    DEFAULT_SIDEBAR_WIDTH_UNIT,
    INSTANT_SPLIT_VIEW_ANIMATOR,
    NAVIGATION_SPLIT_VIEW_CRITICALS,
    NavigationSplitViewState,
    OverlaySplitViewState,
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

// --- Split button (Adw.SplitButton) ---
export {
    DEFAULT_DROPDOWN_TOOLTIP,
    SPLIT_BUTTON_DISABLED_OPACITY,
    SplitButtonState,
    isSplitButtonDirection,
    menuButtonArrowIcon,
    menuButtonPopupDirection,
    resolveDropdownTooltip,
    splitButtonArrowIcon,
    splitButtonPopupDirection,
    splitButtonRootState,
    splitButtonStyleClasses,
} from './split-button.js';
export type {
    AdwArrowIcon,
    SplitButtonChange,
    SplitButtonContentMode,
    SplitButtonDirection,
    SplitButtonHalfState,
    SplitButtonListener,
    SplitButtonProperty,
    SplitButtonStyleClass,
} from './split-button.js';

// --- The portable menu model (GMenuModel as plain data — ADR 0042) ---
export {
    ADW_MENU_SURFACE_NATIVESCRIPT,
    ADW_MENU_SURFACE_WEB,
    assertMenuRenderable,
    flattenMenu,
    menuItemAt,
    menuNodeAt,
    menuRefusals,
    normalizeMenuModel,
    parseDetailedAction,
    parseMenuModel,
    resolveMenuItemState,
} from './menu.js';
export type {
    AdwDetailedAction,
    AdwMenuAction,
    AdwMenuActions,
    AdwMenuDisplayHint,
    AdwMenuEntryInput,
    AdwMenuFlatRow,
    AdwMenuHiddenWhen,
    AdwMenuInput,
    AdwMenuItem,
    AdwMenuItemInput,
    AdwMenuItemRole,
    AdwMenuItemState,
    AdwMenuModel,
    AdwMenuNode,
    AdwMenuPath,
    AdwMenuRefusal,
    AdwMenuSection,
    AdwMenuSectionInput,
    AdwMenuSubmenu,
    AdwMenuSubmenuInput,
    AdwMenuSurface,
    AdwMenuTextDirection,
} from './menu.js';

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
    tabViewItemsChanged,
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

// --- Swipe gestures (Adw.SwipeTracker) ---
export {
    ADW_SWIPE_DECELERATION_TOUCH,
    ADW_SWIPE_DECELERATION_TOUCHPAD,
    ADW_SWIPE_DRAG_THRESHOLD,
    ADW_SWIPE_EPSILON,
    ADW_SWIPE_HISTORY_THRESHOLD_MS,
    ADW_SWIPE_PARABOLA_MULTIPLIER,
    ADW_SWIPE_TOUCHPAD_BASE_DISTANCE_H,
    ADW_SWIPE_TOUCHPAD_BASE_DISTANCE_V,
    ADW_SWIPE_VELOCITY_CURVE_THRESHOLD,
    ADW_SWIPE_VELOCITY_THRESHOLD_TOUCH,
    ADW_SWIPE_VELOCITY_THRESHOLD_TOUCHPAD,
    SwipeTracker,
    swipeBounds,
    swipeClosestPointIndex,
    swipeEndProgress,
    swipeNextPointIndex,
    swipePreviousPointIndex,
    swipeProjectedPointIndex,
    swipeSlope,
    swipeVelocityThreshold,
} from './swipe.js';
export type { AdwSwipeEnd, AdwSwipeEndInput, AdwSwipeRange, AdwSwipeSource } from './swipe.js';

// --- Carousel position + paging (Adw.Carousel) ---
export {
    CAROUSEL_SCROLL_TIMEOUT_MS,
    CAROUSEL_SETTLE_EPSILON,
    CarouselState,
    carouselClampPosition,
    carouselClosestSnapPoint,
    carouselNavigateTarget,
    carouselPageAllocation,
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
    CarouselPageAllocation,
    CarouselPageChangedListener,
    CarouselPageMeasurement,
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

// --- Breakpoint bin (pick one, and what the change writes) ---
export { BreakpointBinState } from './breakpoint-bin.js';
export type {
    BreakpointDefinition,
    BreakpointSetter,
    BreakpointTransition,
    BreakpointWrite,
} from './breakpoint-bin.js';

// --- Header bar (packing order, the title-widget either/or, title resolution) ---
export { HeaderBarState, resolveHeaderBarTitle } from './header-bar.js';
export type { HeaderBarRenderState, HeaderBarTitleSources } from './header-bar.js';

// --- Scroll edge indicators (GtkScrolledWindow undershoot + overshoot) ---
export {
    ADW_MAX_OVERSHOOT_DISTANCE,
    ADW_OVERSHOOT_SETTLE_MS,
    ADW_UNDERSHOOT_CLASSES,
    ADW_UNDERSHOOT_SIZE,
    accumulateOvershoot,
    isScrolledFromEnd,
    isScrolledFromStart,
    overshootDistance,
    scrollMaxValue,
    scrollUndershootClasses,
} from './scrolling.js';
export type { ScrollAdjustment, ScrollAdjustments } from './scrolling.js';

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

// --- Wrap box (Adw.WrapBox line decision, properties, child order) ---
export {
    ADW_WRAP_BOX_DEFAULT_ALIGN,
    ADW_WRAP_BOX_DEFAULT_JUSTIFY,
    ADW_WRAP_BOX_DEFAULT_JUSTIFY_LAST_LINE,
    ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT,
    ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION,
    ADW_WRAP_BOX_DEFAULT_SPACING,
    ADW_WRAP_BOX_DEFAULT_WRAP_POLICY,
    ADW_WRAP_BOX_JUSTIFY_MODES,
    ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET,
    ADW_WRAP_BOX_PACK_DIRECTIONS,
    ADW_WRAP_POLICIES,
    normalizeNaturalLineLength,
    normalizeWrapBoxAlign,
    normalizeWrapBoxJustify,
    normalizeWrapBoxLengthUnit,
    normalizeWrapBoxPackDirection,
    normalizeWrapBoxSpacing,
    normalizeWrapPolicy,
    resolveWrapBoxChildOrder,
    resolveWrapBoxLine,
    wrapBoxChildFlex,
    wrapBoxFlexStyle,
    wrapBoxLengthToPx,
    wrapPolicyFlexShrink,
} from './wrap-box.js';
export type {
    AdwWrapBoxJustify,
    AdwWrapBoxOrientation,
    AdwWrapBoxPackDirection,
    AdwWrapPolicy,
    WrapBoxChildFlex,
    WrapBoxChildOrderOp,
    WrapBoxFlexInput,
    WrapBoxFlexStyle,
    WrapBoxLineLayout,
} from './wrap-box.js';
