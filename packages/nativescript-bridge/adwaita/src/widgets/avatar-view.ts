// Avatar fallback rendering for NativeScript — the pure half.
//
// `update_visibility` gates a custom image over derived initials over a fallback icon
// (refs/libadwaita/src/adw-avatar.c:117#update_visibility); `avatarMode` in
// `@gjsify/adwaita-core` is that decision, and this module is what a NativeScript view
// takes from it.
//
// WHY THE PORT SHOWED INITIALS AND NOTHING ELSE. The widget carried `text` and `size` and
// no third property, on the stated grounds that "the CSS-subset widget has no icon-theme
// lookup". It has none — and never needed one: six widgets in this directory already took
// an Adwaita symbolic as an SVG SOURCE under the GTK property name, as `split-button.ts`
// states outright ("The SVG string IS the icon identity on NativeScript, so it goes where
// GTK puts the icon NAME"). The missing lookup was real, the conclusion drawn from it was
// not.
//
// THE DEFAULT ICON IS THE ICON THEME'S, NOT LIBADWAITA'S. C falls back to
// `adw-avatar-default-symbolic` (refs/libadwaita/src/adw-avatar.c:192-195#adw-avatar-default-symbolic),
// which libadwaita draws as `fill="none"` plus a 2px STROKE — and `extractIconPaths` reads
// `fill="none"` as "inherit the caller's colour" while every renderer here FILLS what it
// extracts, so that asset would paint a solid disc where GTK draws an outline of a person.
// `avatar-default-symbolic` is the same glyph authored as a fill.
//
// Free of `@nativescript/core` value imports so the spec suite exercises the shipping
// code; `adw-avatar.ts` cannot, because `extends GridLayout` evaluates the bare specifier
// at module-eval.
//
// Reference: refs/libadwaita/src/adw-avatar.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { type AdwAvatarMode, avatarMode } from '@gjsify/adwaita-core';
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
 * `'image'` is REACHABLE and shows NEITHER child, rather than being folded into `'icon'`:
 * a function that cannot express the third mode is how the web element shipped a
 * `hasCustomImage: false` no vector could falsify.
 */
export function avatarVisibilities(mode: AdwAvatarMode): AvatarVisibilities {
    return {
        label: nsVisibility(mode === 'initials'),
        icon: nsVisibility(mode === 'icon'),
    };
}

/** What `AdwAvatar` sets on its two children for a given property state. */
export interface AvatarViewState extends AvatarVisibilities {
    /** The mode `update_visibility` picked. */
    mode: AdwAvatarMode;
    /** The SVG the icon child renders — the default when the caller set none. */
    iconSvg: string;
}

/**
 * The WHOLE decision `AdwAvatar` makes, so that a spec can drive it.
 *
 * It lives here for a reason a mutation showed: `extends GridLayout` puts the class out of
 * reach of every unit test in this package, so anything decided inside it is
 * unfalsifiable — the fallback was reverted to "always initials" in the widget body and
 * the whole suite, plus every gate that reads this tree, stayed green. What is left
 * unreachable is three assignments; no test here closes that.
 *
 * `hasCustomImage` is hard `false` because the port has no `custom-image` counterpart
 * (status/open-todos.md); when it lands, only this argument changes.
 */
export function avatarViewState(input: { showInitials: boolean; text: string; iconName: string }): AvatarViewState {
    const mode = avatarMode({ hasCustomImage: false, showInitials: input.showInitials, text: input.text });
    return { mode, ...avatarVisibilities(mode), iconSvg: avatarIconSvg(input.iconName) };
}
