// @gjsify/adwaita-core/conformance — the cross-renderer spec, as data.
//
// `@gjsify/adwaita-core` holds the behavior; this subpath holds the EXPECTATIONS
// it is judged against, derived row by row from the libadwaita C source. Both
// renderers — `@gjsify/adwaita-web` (Custom Elements) and
// `@gjsify/adwaita-nativescript` (native NS views) — import these tables into
// their own spec suites and drive their real widgets with them, so a renderer
// that re-implements a derivation instead of delegating fails a unit test naming
// the exact input that drifted.
//
// The avatar family is why this exists: the two ports carried near-identical copies of the
// initials + colour derivation, one had drifted to two-letter initials for single-word
// names, and BOTH hashed UTF-16 code units where GLib hashes UTF-8 bytes — so every
// accented name got the wrong colour in both, and nothing was in a position to notice.
//
// EVERY VECTOR CARRIES A `rule`: the C function, selector or edge case that row pins down,
// and why it is a row at all. It is also the test title, so it is what a failure names.
//
// WRITING A VECTOR: CITE THE SELECTOR THAT WINS THE CASCADE. A vector derived from the same
// reading of the source as the implementation cannot catch a MISREADING — it pins the
// misreading down and ships it under the word "conformance". So a `rule` citing CSS must
// name the most SPECIFIC selector that applies to the widget under test, and say when a
// less specific one is beaten. The incident: `SPLIT_BUTTON_DIRECTION_VECTORS` pinned
// `direction="none"` to `open-menu-symbolic`, citing the PLAIN `menubutton arrow` block of
// `_buttons.scss`; further down, inside `splitbutton { … }`,
// `> menubutton > button > arrow.none` re-declares the glyph as `pan-down-symbolic` — four
// element selectors plus a class against two plus a class, so the split button never drew
// the hamburger in GTK. Both renderers drew it anyway and the vector asserted they were
// right. Grep the whole stylesheet for the node you are citing, not just the block you
// found it in first.
//
// Vectors are opt-in via this subpath rather than the package root so shipping
// applications never bundle the test corpus.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

// --- About dialog (Adw.AboutDialog) vectors ---
export {
    ABOUT_DIALOG_CREDITS_LEGAL_VECTORS,
    ABOUT_DIALOG_DETAILS_VECTORS,
    ABOUT_DIALOG_HEADER_VECTORS,
    ABOUT_DIALOG_LABEL_VECTORS,
    ABOUT_DIALOG_SUPPORT_VECTORS,
    CREDITS_SECTIONS_VECTORS,
    CREDIT_PERSON_VECTORS,
    LEGAL_SECTION_VECTORS,
    LICENSE_INFO_VECTORS,
    LICENSE_SETTER_VECTORS,
    LICENSE_SPDX_VECTORS,
    LICENSE_TEXT_VECTORS,
    TRANSLATOR_CREDITS_VECTORS,
} from './about-dialog.js';
export type {
    AboutDialogCreditsLegalVector,
    AboutDialogDetailsVector,
    AboutDialogHeaderVector,
    AboutDialogLabelVector,
    AboutDialogSupportVector,
    CreditPersonVector,
    CreditsSectionsVector,
    LegalSectionVector,
    LicenseInfoVector,
    LicenseSetterStep,
    LicenseSetterVector,
    LicenseSpdxVector,
    LicenseTextVector,
    TranslatorCreditsVector,
} from './about-dialog.js';

export {
    AVATAR_COLOR_VECTORS,
    AVATAR_FONT_SIZE_VECTORS,
    AVATAR_INITIALS_VECTORS,
    AVATAR_MODE_VECTORS,
} from './avatar.js';
export type { AvatarColorVector, AvatarFontSizeVector, AvatarInitialsVector, AvatarModeVector } from './avatar.js';

// --- Action-row family (Adw.ActionRow/SwitchRow/ButtonRow/WindowTitle) vectors ---
export {
    ACTION_ROW_ACTIVATION_VECTORS,
    BUTTON_ROW_ACTIVATABLE_VECTORS,
    BUTTON_ROW_ICON_VECTORS,
    LABEL_VISIBILITY_VECTORS,
    SWITCH_ROW_NOTIFY_VECTORS,
    WINDOW_TITLE_VECTORS,
} from './action-row.js';
export type {
    ActionRowActivationVector,
    ActionRowStep,
    ButtonRowActivatableVector,
    ButtonRowIconVector,
    LabelVisibilityVector,
    SwitchRowNotifyVector,
    SwitchRowStep,
    WindowTitleStep,
    WindowTitleVector,
} from './action-row.js';

// --- Banner defaults + derivations (Adw.Banner) vectors ---
export {
    BANNER_BUTTON_STYLE_PARSE_VECTORS,
    BANNER_BUTTON_STYLE_VECTORS,
    BANNER_BUTTON_TEXT_VECTORS,
    BANNER_BUTTON_VISIBLE_VECTORS,
    BANNER_DEFAULT_VECTORS,
} from './banner.js';
export type {
    BannerButtonStyleParseVector,
    BannerButtonStyleVector,
    BannerButtonTextVector,
    BannerButtonVisibleVector,
    BannerDefaultVector,
} from './banner.js';

// --- Button content slots + parent-button style class (Adw.ButtonContent) vectors ---
export {
    BUTTON_CONTENT_DEFAULT_VECTORS,
    BUTTON_CONTENT_ELLIPSIZE_VECTORS,
    BUTTON_CONTENT_ICON_VECTORS,
    BUTTON_CONTENT_LABEL_VECTORS,
    BUTTON_CONTENT_STYLE_TARGET_VECTORS,
    BUTTON_CONTENT_TEXT_VECTORS,
} from './button-content.js';
export type {
    ButtonContentDefaultVector,
    ButtonContentEllipsizeVector,
    ButtonContentIconVector,
    ButtonContentLabelVector,
    ButtonContentStyleTargetVector,
    ButtonContentTextVector,
} from './button-content.js';

// --- Button style-class vectors (Gtk.Button + Adwaita style classes) ---
export { BUTTON_STYLE_CLASS_VECTORS } from './button.js';
export type { ButtonStyleClassVector } from './button.js';

// --- Radio-group exclusivity (Adwaita check/radio) vectors ---
export { RADIO_GROUP_VECTORS } from './checks.js';
export type { RadioGroupStep, RadioGroupVector } from './checks.js';

// --- Row state machines (Adw.ComboRow / Gtk.DropDown selection) vectors ---
export { COMBO_CHOOSER_VECTORS, COMBO_SELECTION_VECTORS } from './rows.js';
export type { ComboChooserVector, ComboSelectionStep, ComboSelectionVector } from './rows.js';

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
    MENU_BUTTON_DIRECTION_VECTORS,
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
    CAROUSEL_PAGE_ALLOCATION_VECTORS,
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
    CarouselPageAllocationVector,
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

// --- Data grid (AdwDataGrid) vectors — derived from OUR widget, not from C ---
export {
    DATA_GRID_CELL_TEXT_VECTORS,
    DATA_GRID_COLUMN_CLASS_VECTORS,
    DATA_GRID_COLUMN_NORMALIZE_VECTORS,
    DATA_GRID_INTERACTIVE_VECTORS,
    DATA_GRID_TRACK_VECTORS,
    DATA_GRID_VARIANT_VECTORS,
} from './data-grid.js';
export type {
    DataGridCellTextVector,
    DataGridColumnClassVector,
    DataGridColumnNormalizeVector,
    DataGridInteractiveVector,
    DataGridTrackVector,
    DataGridVariantVector,
} from './data-grid.js';

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

// --- Popover surface + keyboard navigation (GtkPopover) vectors ---
export { POPOVER_KEY_VECTORS, POPOVER_SURFACE_VECTORS } from './popover.js';
export type { PopoverKeyVector, PopoverSurfaceVariant, PopoverSurfaceVector } from './popover.js';

// --- AdwAccentColor palette + standalone-derivation vectors ---
export { ACCENT_COLOR_VECTORS } from './accent.js';
export type { AccentColorVector } from './accent.js';

// --- Adw.ShortcutLabel accelerator grammar + keycap vectors ---
export { formatShortcutLabelNodes, SHORTCUT_LABEL_VECTORS } from './shortcut-label.js';
export type { ShortcutLabelVector } from './shortcut-label.js';

// --- Adw.Spinner animation vectors ---
export {
    SPINNER_ARC_ENVELOPE,
    SPINNER_ARC_PHASE_VECTORS,
    SPINNER_ARC_TOLERANCE,
    SPINNER_CONSTANT_VECTORS,
} from './spinner.js';
export type { SpinnerArcShapeVector, SpinnerConstantVector } from './spinner.js';

// --- Wrap box line layout, properties + child order (Adw.WrapBox) vectors ---
export {
    WRAP_BOX_CHILD_ORDER_VECTORS,
    WRAP_BOX_LENGTH_VECTORS,
    WRAP_BOX_LINE_VECTORS,
    WRAP_BOX_NATURAL_LENGTH_VECTORS,
    WRAP_BOX_NOTIFY_PROPERTIES,
    WRAP_BOX_POLICY_VECTORS,
    WRAP_BOX_SPACING_NOTIFY_VECTORS,
    WRAP_BOX_SPACING_VECTORS,
} from './wrap-box.js';
export type {
    WrapBoxChildOrderVector,
    WrapBoxLengthVector,
    WrapBoxLineVector,
    WrapBoxNaturalLengthVector,
    WrapBoxPolicyVector,
    WrapBoxSpacingNotifyVector,
    WrapBoxSpacingVector,
} from './wrap-box.js';

export { BREAKPOINT_PICK_VECTORS, BREAKPOINT_TRANSITION_VECTORS } from './breakpoint-bin.js';
export type { BreakpointPickVector, BreakpointTransitionVector } from './breakpoint-bin.js';
