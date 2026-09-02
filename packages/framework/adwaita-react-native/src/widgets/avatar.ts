// `AdwAvatar` — the base module. See `../refuse.ts` for who reaches this and why it throws
// instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwAvatarProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A round avatar showing initials derived from a name, or a fallback icon.
 *
 * BOTH HALVES DERIVE THE SAME TWO THINGS FROM THE SAME PORT. The initials and the
 * palette entry come from `@gjsify/adwaita-core`'s `avatarInitials` / `avatarColor` —
 * `extract_initials_from_text` and `set_class_color` in TypeScript, hashing UTF-8 bytes
 * as `g_str_hash` does. On GTK the real `Adw.Avatar` runs the C original and stamps
 * `color11` on its internal gizmo; the React Native half paints the same palette entry.
 * The suites assert that pair by NAME, not by "an avatar appeared".
 */
export function AdwAvatar(_props: AdwAvatarProps): ReactElement | null {
    return refuseBaseModule('AdwAvatar');
}
