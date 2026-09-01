/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwAvatar` on GTK — the real `Adw.Avatar`. Libadwaita derives the initials and picks
// the colour. (The pragma above is required of every platform module; the reason is in
// `bin.gtk.tsx`.)
//
// `avatarInitials` / `avatarColor` ARE NOT USED HERE, for the reason `clamp.gtk.tsx`
// gives about `clampAllocate`: on GTK the C original is right there, and deriving the
// same initials twice would give the widget two authorities for its own label. The
// core's value on this path is as the ORACLE the React Native half is measured against —
// and here that oracle is unusually direct, because libadwaita publishes its answer:
// `set_class_color` puts `color{n}` on the avatar's internal gizmo, so
// `content.gtk.spec.tsx` reads the class off the live tree and
// `avatar.native.spec.tsx` asserts the palette entry with the same index.
//
// EVERY PROPERTY IS PASSED THROUGH VERBATIM, INCLUDING THE OMITTED ONES. There is no
// `authoredSize`-style normaliser here because `size` is REQUIRED on this surface — the
// measured reason (a `-1` avatar is 20×18 and raises a `Pango-CRITICAL` that
// `installDiagnosticsGate` fails on) is in `props.ts`.

import type { ReactElement } from 'react';

import type { AdwAvatarProps } from '../props.js';

/** {@link import('./avatar.js').AdwAvatar} on GTK. */
export function AdwAvatar({ size, text, showInitials, iconName }: AdwAvatarProps): ReactElement | null {
    return <adw-avatar size={size} text={text} show-initials={showInitials} icon-name={iconName} />;
}
