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
    AdwBanner,
    BUTTON_CLICKED,
    AdwAvatar,
    DEFAULT_AVATAR_SIZE,
    avatarInitials,
    AdwWindowTitle,
    AdwClamp,
    DEFAULT_CLAMP_MAX_SIZE,
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
