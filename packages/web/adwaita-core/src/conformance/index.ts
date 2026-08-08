// @gjsify/adwaita-core/conformance — the cross-renderer spec, as data.
//
// WHY THIS IS A SEPARATE SUBPATH, AND WHY IT IS DATA
//
// `@gjsify/adwaita-core` holds the behavior; this subpath holds the EXPECTATIONS
// that behavior is judged against, derived row by row from the libadwaita C
// source. Both renderers — `@gjsify/adwaita-web` (Custom Elements) and
// `@gjsify/adwaita-nativescript` (native NS views) — import these tables into
// their own spec suites and drive their real widgets with them.
//
// That is the point: a renderer which quietly re-implements a derivation instead
// of delegating to core does not fail "eventually, in a screenshot diff" — it
// fails a unit test, on the machine, in CI, naming the exact input that drifted.
// The avatar family is why this exists: the two ports carried near-identical
// copies of the initials + colour derivation, one of them had silently drifted
// to two-letter initials for single-word names, and BOTH hashed UTF-16 code
// units where GLib hashes UTF-8 bytes — so every accented name got the wrong
// colour in both. Nothing in the build was in a position to notice.
//
// Vectors are opt-in via this subpath rather than the package root so shipping
// applications never bundle the test corpus.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

export {
    AVATAR_COLOR_VECTORS,
    AVATAR_FONT_SIZE_VECTORS,
    AVATAR_INITIALS_VECTORS,
    AVATAR_MODE_VECTORS,
} from './avatar.js';
export type { AvatarColorVector, AvatarFontSizeVector, AvatarInitialsVector, AvatarModeVector } from './avatar.js';

// --- View stack selection (Adw.ViewStack) vectors ---
export { VIEW_STACK_ICON_NAME_VECTORS, VIEW_STACK_PAGE_VECTORS, VIEW_STACK_VECTORS } from './view-stack.js';
export type {
    ViewStackIconNameVector,
    ViewStackPageDescriptorVector,
    ViewStackVector,
    ViewStackVectorChange,
    ViewStackVectorOp,
    ViewStackVectorPage,
} from './view-stack.js';

// --- Navigation stack (Adw.NavigationView) vectors ---
export {
    NAVIGATION_VIEW_VECTORS,
    collectNavigationState,
    navigationEventLog,
    runNavigationSteps,
} from './navigation-view.js';
export type {
    ExpectedNavigationChange,
    ExpectedPageState,
    NavigationEventRecord,
    NavigationExpectation,
    NavigationPageId,
    NavigationStateCheck,
    NavigationStep,
    NavigationStepOutcome,
    NavigationVector,
    NavigationVectorAdapter,
} from './navigation-view.js';

// --- Sidebar selection + sections (Adw.Sidebar) vectors ---
export {
    SIDEBAR_ACTIVATION_VECTORS,
    SIDEBAR_CLAMP_VECTORS,
    SIDEBAR_FILTER_VECTORS,
    SIDEBAR_ITEMS_CHANGED_VECTORS,
    SIDEBAR_ITEM_FLAG_VECTORS,
    SIDEBAR_MODEL_VECTORS,
    SIDEBAR_MODE_VECTORS,
} from './sidebar.js';
export type {
    SidebarActivationVector,
    SidebarClampVector,
    SidebarFilterVector,
    SidebarItemFlagsVector,
    SidebarItemsChangedVector,
    SidebarModeVector,
    SidebarModelVector,
} from './sidebar.js';

// --- Entry rows (Adw.EntryRow / Adw.PasswordEntryRow) vectors ---
export {
    ENTRY_MAX_LENGTH_VECTORS,
    ENTRY_ROW_ACTIVATION_VECTORS,
    ENTRY_ROW_GUARD_VECTORS,
    ENTRY_ROW_STATE_VECTORS,
    ENTRY_TEXT_LENGTH_VECTORS,
    PASSWORD_ENTRY_ROW_VECTORS,
    PASSWORD_REVEAL_GUARD_VECTORS,
} from './entry-row.js';
export type {
    EntryMaxLengthVector,
    EntryRowActivationVector,
    EntryRowGuardVector,
    EntryRowStateVector,
    EntryRowStep,
    EntryTextLengthVector,
    PasswordEntryRowStep,
    PasswordEntryRowVector,
    PasswordRevealGuardVector,
} from './entry-row.js';

// --- Split views (Adw.NavigationSplitView / Adw.OverlaySplitView) vectors ---
export {
    ADW_LENGTH_UNIT_VECTORS,
    GLIB_CLAMP_VECTORS,
    NATURAL_SIDEBAR_WIDTH_VECTORS,
    NAVIGATION_ACTION_VECTORS,
    NAVIGATION_SPLIT_VIEW_LAYOUT_VECTORS,
    NAVIGATION_STACK_VECTORS,
    OVERLAY_COLLAPSE_VECTORS,
    OVERLAY_SPLIT_VIEW_LAYOUT_VECTORS,
    OVERLAY_SWIPE_AREA_VECTORS,
    OVERLAY_SWIPE_CANCEL_VECTORS,
    OVERLAY_SWIPE_RELEASE_VECTORS,
    OVERLAY_SWIPE_SNAP_POINT_VECTORS,
    OVERLAY_SWIPE_START_VECTORS,
    SIDEBAR_BOUNDS_VECTORS,
    SIDEBAR_WIDTH_VECTORS,
    SPLIT_VIEW_MEASURE_VECTORS,
    TAGS_CONFLICT_VECTORS,
} from './split-view.js';
export type {
    AdwLengthUnitVector,
    GlibClampVector,
    NaturalSidebarWidthVector,
    NavigationActionVector,
    NavigationLayoutVector,
    NavigationStackVector,
    OverlayCollapseVector,
    OverlayLayoutVector,
    OverlaySplitViewSnapshot,
    SidebarBoundsVector,
    SidebarWidthVector,
    SplitViewMeasureVector,
    SwipeAreaVector,
    SwipeCancelVector,
    SwipeReleaseVector,
    SwipeSnapPointVector,
    SwipeStartVector,
    TagsConflictVector,
} from './split-view.js';

// --- Split button + menu model (Adw.SplitButton) vectors ---
export {
    SPLIT_BUTTON_CONTENT_VECTORS,
    SPLIT_BUTTON_DIRECTION_VECTORS,
    SPLIT_BUTTON_DROPDOWN_VECTORS,
    SPLIT_BUTTON_MENU_ACTIVATION_VECTORS,
    SPLIT_BUTTON_MENU_PARSE_VECTORS,
    SPLIT_BUTTON_ROOT_STATE_VECTORS,
    SPLIT_BUTTON_STYLE_CLASS_VECTORS,
    SPLIT_BUTTON_TOOLTIP_VECTORS,
} from './split-button.js';
export type {
    SplitButtonContentStep,
    SplitButtonContentVector,
    SplitButtonDirectionVector,
    SplitButtonDropdownVector,
    SplitButtonMenuActivationVector,
    SplitButtonMenuParseVector,
    SplitButtonRootStateVector,
    SplitButtonStyleClassVector,
    SplitButtonTooltipVector,
} from './split-button.js';

// --- View switcher + bar (Adw.ViewSwitcher / Adw.InlineViewSwitcher) vectors ---
export {
    INLINE_TOGGLE_VECTORS,
    INLINE_TOOLTIP_VECTORS,
    VIEW_SWITCHER_BADGE_VECTORS,
    VIEW_SWITCHER_BAR_REVEAL_VECTORS,
    VIEW_SWITCHER_BAR_VECTORS,
    VIEW_SWITCHER_BUTTON_VECTORS,
    VIEW_SWITCHER_BUTTON_VISIBILITY_VECTORS,
    VIEW_SWITCHER_DRAG_VECTORS,
    VIEW_SWITCHER_ICON_VECTORS,
    VIEW_SWITCHER_MNEMONIC_VECTORS,
    VIEW_SWITCHER_REBUILD_VECTORS,
    VIEW_SWITCHER_SELECTION_VECTORS,
    createViewSwitcherClock,
} from './view-switcher.js';
export type {
    ExpectedInlineToggle,
    ExpectedViewSwitcherButton,
    InlineToggleVector,
    InlineTooltipVector,
    MnemonicVector,
    ViewSwitcherBadgeVector,
    ViewSwitcherBarRevealVector,
    ViewSwitcherBarSnapshot,
    ViewSwitcherBarStep,
    ViewSwitcherBarVector,
    ViewSwitcherButtonVector,
    ViewSwitcherButtonVisibilityVector,
    ViewSwitcherClock,
    ViewSwitcherDragStep,
    ViewSwitcherDragVector,
    ViewSwitcherIconVector,
    ViewSwitcherRebuildVector,
    ViewSwitcherSelectionVector,
    ViewSwitcherVectorChange,
    ViewSwitcherVectorOp,
    ViewSwitcherVectorPage,
} from './view-switcher.js';

// --- Tab view (Adw.TabView) vectors ---
export {
    TABS_REVEALED_VECTORS,
    TAB_CLOSE_VISIBLE_VECTORS,
    TAB_DESCENDANT_VECTORS,
    TAB_ICON_STATE_VECTORS,
    TAB_PAGE_DESCRIPTOR_VECTORS,
    TAB_SUCCESSOR_VECTORS,
    TAB_TOOLTIP_VECTORS,
    TAB_VIEW_VECTORS,
    applyTabViewOp,
    seedTabViewPages,
    tabViewClosing,
    tabViewOrder,
} from './tab-view.js';
export type {
    TabCloseVisibleVector,
    TabDescendantVector,
    TabIconStateVector,
    TabPageDescriptorVector,
    TabSuccessorVector,
    TabTooltipVector,
    TabViewVector,
    TabViewVectorHandler,
    TabViewVectorOp,
    TabViewVectorPage,
    TabViewVectorPagesChange,
    TabViewVectorSelection,
    TabViewVectorTarget,
    TabsRevealedVector,
} from './tab-view.js';

// --- Carousel position + paging (Adw.Carousel) vectors ---
export {
    CAROUSEL_CLAMP_VECTORS,
    CAROUSEL_NAVIGATE_VECTORS,
    CAROUSEL_PAGE_AT_POSITION_VECTORS,
    CAROUSEL_PAGE_LIST_VECTORS,
    CAROUSEL_PROPERTY_DEFAULT_VECTORS,
    CAROUSEL_RANGE_VECTORS,
    CAROUSEL_REORDER_SHIFT_VECTORS,
    CAROUSEL_REVEAL_VECTORS,
    CAROUSEL_SIZES_FROM_SNAP_POINTS_VECTORS,
    CAROUSEL_SNAP_POINT_VECTORS,
    CAROUSEL_WHEEL_LOCKOUT_VECTORS,
    CAROUSEL_WHEEL_VECTORS,
} from './carousel.js';
export type {
    CarouselClampVector,
    CarouselNavigateVector,
    CarouselPageAtPositionVector,
    CarouselPageListVector,
    CarouselPageOp,
    CarouselPropertyDefaultVector,
    CarouselRangeVector,
    CarouselReorderShiftVector,
    CarouselRevealOp,
    CarouselRevealVector,
    CarouselSizesFromSnapPointsVector,
    CarouselSnapPointVector,
    CarouselStateSnapshot,
    CarouselWheelLockoutStep,
    CarouselWheelLockoutVector,
    CarouselWheelVector,
} from './carousel.js';

// --- Preferences group header + dialog search (Adw.PreferencesDialog) vectors ---
export {
    CASE_FOLD_VECTORS,
    MAKE_COMPARABLE_VECTORS,
    PREFERENCES_GROUP_HEADER_VECTORS,
    PREFERENCES_SEARCH_PAGES,
    PREFERENCES_SEARCH_VECTORS,
    ROW_MATCH_VECTORS,
    SEARCH_CORPUS_VECTORS,
    SEARCH_ROW_SUBTITLE_VECTORS,
    STRIP_MARKUP_VECTORS,
    STRIP_MNEMONIC_VECTORS,
} from './preferences.js';
export type {
    CaseFoldVector,
    MakeComparableVector,
    PreferencesGroupHeaderVector,
    PreferencesSearchExpectation,
    PreferencesSearchVector,
    RowMatchVector,
    SearchCorpusVector,
    SearchRowSubtitleVector,
    StripMarkupVector,
    StripMnemonicVector,
} from './preferences.js';

// --- Clamp / spinner / toolbar-view arithmetic vectors ---
export {
    CLAMP_ALLOCATE_VECTORS,
    CLAMP_CHILD_SIZE_VECTORS,
    CLAMP_PROPERTY_VECTORS,
    CLAMP_SIZE_FROM_CHILD_VECTORS,
    CLAMP_THRESHOLD_VECTORS,
    SPINNER_GEOMETRY_VECTORS,
    SPINNER_SIZE_VECTORS,
    TOOLBAR_VIEW_ALLOCATE_VECTORS,
    TOOLBAR_VIEW_CLASS_VECTORS,
    TOOLBAR_VIEW_CONTENT_FOR_SIZE_VECTORS,
    TOOLBAR_VIEW_MEASURE_VECTORS,
} from './chrome.js';
export type {
    ClampAllocateVector,
    ClampChildSizeVector,
    ClampPropertyVector,
    ClampSizeFromChildVector,
    ClampThresholdsVector,
    SpinnerGeometryVector,
    SpinnerSizeVector,
    ToolbarViewAllocateVector,
    ToolbarViewClassVector,
    ToolbarViewContentForSizeVector,
    ToolbarViewMeasureVector,
} from './chrome.js';

// --- Bottom-sheet dismissal (Adw.BottomSheet) vectors ---
export { BOTTOM_SHEET_CLOSE_VECTORS, BOTTOM_SHEET_PRESENTATION_VECTORS, runBottomSheetSteps } from './dialog.js';
export type {
    BottomSheetCloseVector,
    BottomSheetPresentationAdapter,
    BottomSheetPresentationStep,
    BottomSheetPresentationVector,
} from './dialog.js';
