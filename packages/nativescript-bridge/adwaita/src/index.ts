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
    AdwComboRow,
    NOTIFY_SELECTED,
    AdwSpinRow,
    NOTIFY_VALUE,
    AdwExpanderRow,
    NOTIFY_EXPANDED,
    AdwButton,
    AdwImageButton,
    DEFAULT_ICON_BUTTON_ICON_SIZE,
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
    NOTIFY_TOGGLE_SELECTED,
    // View switching
    AdwViewSwitcherBase,
    NOTIFY_VIEW_SELECTED,
    AdwViewSwitcher,
    AdwInlineViewSwitcher,
    AdwTabView,
    AdwCarousel,
    DEFAULT_CAROUSEL_PAGE_WIDTH,
    NOTIFY_POSITION,
    // Navigation
    AdwNavigationView,
    NOTIFY_VISIBLE_PAGE,
    AdwSplitViewBase,
    DEFAULT_SIDEBAR_WIDTH,
    NOTIFY_SHOW_SIDEBAR,
    AdwNavigationSplitView,
    AdwOverlaySplitView,
    AdwSidebar,
    NOTIFY_SIDEBAR_SELECTED,
    AdwBottomSheet,
    NOTIFY_OPEN,
    // Feedback / dialogs
    AdwToast,
    AdwToastOverlay,
    DEFAULT_TOAST_TIMEOUT,
    TOAST_BUTTON_CLICKED,
    AdwAlertDialog,
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
    registerAdwaitaElements,
} from './widgets/index.js';
export type {
    NotifyActiveEventData,
    NotifyTextEventData,
    AdwComboOption,
    NotifySelectedEventData,
    NotifyValueEventData,
    NotifyExpandedEventData,
    AdwButtonVariant,
    // Presentation / layout
    MenuTappedEventData,
    NotifyToggleSelectedEventData,
    // View switching
    AdwViewPage,
    NotifyViewSelectedEventData,
    NotifyPositionEventData,
    // Navigation
    NotifyVisiblePageEventData,
    NotifyShowSidebarEventData,
    NotifySidebarSelectedEventData,
    NotifyOpenEventData,
    // Feedback / dialogs
    AdwToastOptions,
    NotifyResponseEventData,
    // Icon helpers
    SymbolicIconOptions,
    IconPath,
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
