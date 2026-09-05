// Avatar fallback rendering for NativeScript — the pure half.
//
// `Adw.Avatar` shows exactly ONE of three things, and which one is not a rendering
// detail: `update_visibility` gates a custom image over derived initials over a
// fallback icon (refs/libadwaita/src/adw-avatar.c:117#update_visibility). The decision
// itself is headless and already lives in `@gjsify/adwaita-core` as `avatarMode`, with
// the vectors both renderers assert against; this module only turns its answer into the
// two `visibility` values a NativeScript view takes, and picks the SVG for the icon arm.
//
// WHY THE PORT SHOWED INITIALS AND NOTHING ELSE. The widget carried `text` and `size`
// and no third property, on the stated grounds that "the CSS-subset widget has no
// icon-theme lookup". It has none — and it never needed one: seven widgets in this same
// directory already take an Adwaita symbolic as an SVG SOURCE under the GTK property
// name, which `split-button.ts` states outright ("The SVG string IS the icon identity on
// NativeScript, so it goes where GTK puts the icon NAME"). The missing lookup was real
// and the conclusion drawn from it was not.
//
// THE DEFAULT ICON IS THE ICON THEME'S, NOT LIBADWAITA'S, and that is a measured
// substitution rather than a shortcut. C falls back to `adw-avatar-default-symbolic`
// (refs/libadwaita/src/adw-avatar.c:192-195#adw-avatar-default-symbolic), an asset
// libadwaita ships itself — and it is drawn with `fill="none"` plus a 2px STROKE, while
// `extractIconPaths` reads `fill="none"` as "inherit the caller's colour" and every
// renderer here FILLS what it extracts. Rasterising libadwaita's own file would paint a
// solid disc where GTK draws an outline of a person. `avatar-default-symbolic` from
// `@gjsify/adwaita-icons` is the same glyph authored as a fill, so it is the one asset
// this renderer can actually draw.
//
// Free of `@nativescript/core` value imports so the spec suite exercises the shipping
// code; `adw-avatar.ts` cannot, because `extends GridLayout` evaluates the bare
// specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-avatar.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwAvatarMode } from '@gjsify/adwaita-core';
import { avatarDefaultSymbolic } from '@gjsify/adwaita-icons/status';

import { type NsVisibility, nsVisibility } from './row-state.js';

export type { AdwAvatarMode };

/** The fallback glyph, exported because it is a SUBSTITUTION a caller can see. */
export const AVATAR_DEFAULT_ICON = avatarDefaultSymbolic;

/**
 * `update_icon`: the caller's icon, or the default when none was set.
 *
 * The emptiness test is the port's, not the C's — C keys on `icon_name != NULL`, and a
 * NativeScript setter has no null to tell from `''`. Same reading `AdwStatusPage` takes.
 */
export function avatarIconSvg(iconName: string | null | undefined): string {
    return iconName ? iconName : AVATAR_DEFAULT_ICON;
}

/** Which of the avatar's two NativeScript children is in the layout. */
export interface AvatarVisibilities {
    /** The initials label. */
    label: NsVisibility;
    /** The fallback symbolic icon. */
    icon: NsVisibility;
}

/**
 * The two `visibility` values for a mode, straight off `update_visibility`'s three
 * `gtk_widget_set_visible` calls (refs/libadwaita/src/adw-avatar.c:122-123#has_custom_image).
 *
 * `'image'` is REACHABLE here and shows neither child, rather than being folded into
 * `'icon'`: this port has no `custom-image` counterpart yet (see `status/open-todos.md`),
 * and a function that silently could not express the third mode is how the web element
 * shipped a `hasCustomImage: false` that no vector could ever falsify. The widget passes
 * `false` today; this function does not have to be rewritten when it stops.
 */
export function avatarVisibilities(mode: AdwAvatarMode): AvatarVisibilities {
    return {
        label: nsVisibility(mode === 'initials'),
        icon: nsVisibility(mode === 'icon'),
    };
}
