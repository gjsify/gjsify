// AdwAvatar — a Libadwaita-style avatar for NativeScript.
//
// A REAL NativeScript `GridLayout` with a circular accent-tinted background and, in one
// shared cell, the two things `Adw.Avatar` falls back to: a centered initials `Label` and
// a symbolic icon. The circle is `width == height` plus a `border-radius` of half the size
// (the `adw-avatar` CSS class + an inline size). WHICH child is shown, and why the
// fallback icon needed no icon-theme lookup, is `avatar-view.ts`.
//
// `showInitials` DEFAULTS TO FALSE, which is a behaviour change and deliberately the C's
// default (refs/libadwaita/src/adw-avatar.c:434-435#show-initials) — the same one
// `<adw-avatar>` on the web already takes, where an absent attribute is false. The port
// used to show initials unconditionally; a bare avatar carrying a name now renders the
// fallback person icon, exactly as `new Adw.Avatar()` does under GTK.
//
// The per-name colour is applied in EVERY mode, because C runs `set_class_color`
// regardless of `show-initials` and the property's own doc says the text "is only used to
// generate the color if show-initials is FALSE". The derivation is headless (ADR 0004);
// the flat-fill wrapper is `avatar-color.ts`, NS-core-free so a spec can drive it. The
// palette + hash used to be a local copy of the web renderer's copy, and both hashed
// UTF-16 code units where GLib hashes UTF-8 bytes, so every accented name got the wrong
// colour on both renderers — pinned to the C by the shared conformance vectors since.
//
// `custom-image` has no counterpart here — the value has one (`ImageSource`), the
// CIRCULAR CLIP does not, and `status/open-todos.md` holds what a device run must answer.
//
// Reference: refs/libadwaita/src/adw-avatar.c (set_class_color, update_visibility)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label } from '@nativescript/core';

import { avatarIconSize, avatarMaxFontSize } from '@gjsify/adwaita-core';

import { avatarColor, avatarInitials } from './avatar-color.js';
import { AVATAR_DEFAULT_ICON, avatarViewState } from './avatar-view.js';
import { GtkImage } from './gtk-image.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** Default avatar diameter in DIPs (Adwaita's common avatar size). */
export const DEFAULT_AVATAR_SIZE = 48;

// Re-exported so existing consumers keep importing both from this module.
export { avatarColor, avatarInitials };
export { AVATAR_DEFAULT_ICON };

export class AdwAvatar extends GridLayout {
    /** The centered initials label. */
    protected readonly _label: Label;
    /** The fallback symbolic icon, shown when the initials are not. */
    protected readonly _icon: GtkImage;
    private _text = '';
    private _size = DEFAULT_AVATAR_SIZE;
    private _showInitials = false;
    private _iconName = '';

    constructor() {
        super();

        this.className = 'adw-avatar';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        const label = new Label();
        label.className = 'adw-avatar-label';
        label.horizontalAlignment = 'center';
        label.verticalAlignment = 'middle';
        GridLayout.setColumn(label, 0);
        GridLayout.setRow(label, 0);
        this.addChild(label);
        this._label = label;

        // The icon shares the cell with the label — `update_visibility` guarantees at
        // most one of the two is in the layout, so they never overlap.
        const icon = new GtkImage();
        // Keeps `GtkImage`'s own base class and adds the avatar's hook beside it —
        // dropping the base would take the glyph out of every `.adw-icon` rule.
        icon.className = 'adw-icon adw-avatar-icon';
        icon.horizontalAlignment = 'center';
        icon.verticalAlignment = 'middle';
        GridLayout.setColumn(icon, 0);
        GridLayout.setRow(icon, 0);
        this.addChild(icon);
        this._icon = icon;

        this._applySize();
        this._applyColor();
        this._applyMode();
    }

    /** Sync the inline width/height/border-radius/font-size for the current size. */
    private _applySize(): void {
        this.width = this._size;
        this.height = this._size;
        // border-radius is an inline style: half the diameter makes a circle.
        // NS exposes it on the style object; set via the public `set` to stay
        // within the ambient surface.
        this.set('borderRadius', this._size / 2);
        // Scale the initials with the diameter — a single CSS rule can't size
        // per-instance, so set fontSize inline. Without this the initials are
        // too small to read at size 32 (action-bar avatar).
        //
        // `update_font_size` derives the real value from the MEASURED label, and
        // NativeScript exposes no text metrics here, so the 0.4 heuristic stays
        // — but clamped to libadwaita's cap, which it exceeded above ~54 DIPs
        // (at size 128 it asked for 51px against a 44px cap and the initials
        // spilled out of the circle).
        this._label.set('fontSize', Math.round(Math.min(this._size * 0.4, avatarMaxFontSize(this._size))));
        // The glyph scales with the circle by the same factor the web renderer uses;
        // the number lives in the core so the two cannot drift apart.
        this._icon.iconSize = avatarIconSize(this._size);
    }

    /**
     * Paint the per-name colour (`set_class_color`) onto the circle and both children.
     *
     * The glyph is PINNED to the palette's `fg` rather than left following the light/dark
     * scheme: it sits on the accent fill in both, where a scheme-coloured symbolic would
     * go near-black on light and vanish.
     */
    private _applyColor(): void {
        const { fill, fg } = avatarColor(this._text);
        this.set('backgroundColor', fill);
        this._label.set('color', fg);
        this._icon.iconColor = fg;
    }

    /** Show the child `update_visibility` says, and give the icon arm its glyph. */
    private _applyMode(): void {
        const state = avatarViewState({
            showInitials: this._showInitials,
            text: this._text,
            iconName: this._iconName,
        });
        this._label.visibility = state.label;
        this._icon.visibility = state.icon;
        // Only when it is on screen: assigning `iconName` rasterises a bitmap.
        if (state.icon === 'visible') this._icon.iconName = state.iconSvg;
    }

    /** The name the initials are derived from, and the colour is hashed from. */
    get text(): string {
        return this._text;
    }

    set text(value: string) {
        this._text = value ?? '';
        this._label.text = avatarInitials(this._text);
        this._applyColor();
        // The name is half of `has_initials`, so emptying it falls back to the icon.
        this._applyMode();
    }

    /** The circular diameter in DIPs. Updates width/height/border-radius. */
    get size(): number {
        return this._size;
    }

    set size(value: number | string) {
        const size = xmlNumber(value, DEFAULT_AVATAR_SIZE);
        this._size = size > 0 ? size : DEFAULT_AVATAR_SIZE;
        this._applySize();
    }

    /**
     * Whether the derived initials are shown instead of the fallback icon.
     *
     * `false` by default, as in the C — and a name alone does not switch it: both
     * halves of `has_initials` must hold.
     */
    get showInitials(): boolean {
        return this._showInitials;
    }

    set showInitials(value: boolean | string) {
        this._showInitials = xmlBoolean(value, false);
        this._applyMode();
    }

    /**
     * The fallback icon, as an Adwaita symbolic SVG string (e.g. `contactNewSymbolic`
     * from `@gjsify/adwaita-icons`) — NOT an icon-theme name, because nothing on this
     * runtime resolves one. Empty falls back to {@link AVATAR_DEFAULT_ICON}, the way an
     * unset `icon-name` falls back to `adw-avatar-default-symbolic` under GTK.
     */
    get iconName(): string {
        return this._iconName;
    }

    set iconName(value: string) {
        this._iconName = value ?? '';
        this._applyMode();
    }
}
