// Avatar colour/initials for NativeScript — the pure half.
//
// The derivations are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004).
// NativeScript-specific here is only that the CSS subset has no gradients, so the
// palette's start→stop must collapse to one flat fill.
//
// Free of `@nativescript/core` value imports so the spec suite can exercise the real
// code off-device; `adw-avatar.ts` cannot, because `extends GridLayout` evaluates the
// bare specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-avatar.c (set_class_color)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { avatarColor as adwAvatarColor, avatarInitials, flattenAvatarGradient } from '@gjsify/adwaita-core';

// Re-exported so consumers (and `adw-avatar.ts`) get both halves from one place.
export { avatarInitials };

/** A flat avatar fill plus the light initials colour that goes on top of it. */
export interface NsAvatarColor {
    /** The gradient collapsed to a single `#rrggbb` background. */
    fill: string;
    /** The palette's light `fg`, for the initials label. */
    fg: string;
}

/**
 * The fill + initials colour `Adw.Avatar` would paint for `text`, flattened for
 * the NativeScript CSS subset.
 */
export function avatarColor(text: string): NsAvatarColor {
    const color = adwAvatarColor(text ?? '');
    return { fill: flattenAvatarGradient(color), fg: color.fg };
}
