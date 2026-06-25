// Widget barrel for @gjsify/adwaita-nativescript.
//
// Re-exports every Adwaita NativeScript widget AND wires them into NativeScript's
// XML element registry via the global `registerElement` so they can be used from
// markup: `<AdwPreferencesGroup>`, `<AdwActionRow>`, `<AdwSwitchRow>`, etc. The
// barrel itself has NO top-level side effects — registration is explicit via
// `registerAdwaitaElements()` (mirroring the `/register` convention spirit), so
// importing a widget class does not eagerly touch the runtime.

export { AdwPreferencesPage } from './adw-preferences-page.js';
export { AdwPreferencesGroup } from './adw-preferences-group.js';
export { AdwActionRow } from './adw-action-row.js';
export { AdwSwitchRow, NOTIFY_ACTIVE } from './adw-switch-row.js';
export type { NotifyActiveEventData } from './adw-switch-row.js';
export { AdwEntryRow, NOTIFY_TEXT } from './adw-entry-row.js';
export type { NotifyTextEventData } from './adw-entry-row.js';
export { AdwPasswordEntryRow } from './adw-password-entry-row.js';
export { AdwComboRow, NOTIFY_SELECTED } from './adw-combo-row.js';
export type { AdwComboOption, NotifySelectedEventData } from './adw-combo-row.js';
export { AdwSpinRow, NOTIFY_VALUE } from './adw-spin-row.js';
export type { NotifyValueEventData } from './adw-spin-row.js';
export { AdwExpanderRow, NOTIFY_EXPANDED } from './adw-expander-row.js';
export type { NotifyExpandedEventData } from './adw-expander-row.js';
export { AdwButton } from './adw-button.js';
export type { AdwButtonVariant } from './adw-button.js';
export { AdwBanner, BUTTON_CLICKED } from './adw-banner.js';
export { AdwAvatar, DEFAULT_AVATAR_SIZE, avatarInitials } from './adw-avatar.js';
export { AdwWindowTitle } from './adw-window-title.js';
export { AdwClamp, DEFAULT_CLAMP_MAX_SIZE } from './adw-clamp.js';

import { AdwPreferencesPage } from './adw-preferences-page.js';
import { AdwPreferencesGroup } from './adw-preferences-group.js';
import { AdwActionRow } from './adw-action-row.js';
import { AdwSwitchRow } from './adw-switch-row.js';
import { AdwEntryRow } from './adw-entry-row.js';
import { AdwPasswordEntryRow } from './adw-password-entry-row.js';
import { AdwComboRow } from './adw-combo-row.js';
import { AdwSpinRow } from './adw-spin-row.js';
import { AdwExpanderRow } from './adw-expander-row.js';
import { AdwButton } from './adw-button.js';
import { AdwBanner } from './adw-banner.js';
import { AdwAvatar } from './adw-avatar.js';
import { AdwWindowTitle } from './adw-window-title.js';
import { AdwClamp } from './adw-clamp.js';

/** XML element name → constructor map registered with NativeScript. */
const ELEMENTS = {
    AdwPreferencesPage,
    AdwPreferencesGroup,
    AdwActionRow,
    AdwSwitchRow,
    AdwEntryRow,
    AdwPasswordEntryRow,
    AdwComboRow,
    AdwSpinRow,
    AdwExpanderRow,
    AdwButton,
    AdwBanner,
    AdwAvatar,
    AdwWindowTitle,
    AdwClamp,
} as const;

let registered = false;

/**
 * Register all Adwaita widgets as NativeScript XML elements (idempotent).
 *
 * After calling this once at app bootstrap, markup like
 * `<AdwSwitchRow title="Dark mode" />` resolves to the corresponding class.
 * No-op (returns silently) when the `registerElement` runtime global is absent
 * — i.e. off NativeScript, or when the bundler context has not injected it yet —
 * so the call is safe to make unconditionally.
 */
export function registerAdwaitaElements(): void {
    if (registered) return;
    if (typeof registerElement !== 'function') return;
    for (const [name, ctor] of Object.entries(ELEMENTS)) {
        registerElement(name, () => ctor);
    }
    registered = true;
}
