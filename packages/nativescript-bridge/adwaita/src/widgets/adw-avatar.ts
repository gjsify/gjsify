// AdwAvatar — a Libadwaita-style avatar for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` with a circular accent-tinted
// background and a centered initials `Label`. The circle is achieved by setting
// `width == height` and `border-radius` to half the size (via the `adw-avatar`
// CSS class + an inline size). Mirrors `Adw.Avatar`: `text` derives the initials,
// `size` sets the diameter.
//
// The background COLOUR is derived from the name exactly like `Adw.Avatar`:
// `(g_str_hash(text) % 14) + 1` picks one of the 14 libadwaita avatar colours.
// The NS CSS subset has no gradient, so the flat fill is the 50/50 blend of the
// palette's start→stop gradient (and the initials take the matching light `fg`).
//
// Both derivations are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004);
// the flat-fill wrapper sits in `avatar-color.ts` (NS-core-free, so the spec can
// drive it off-device) and this module keeps only the GridLayout that paints the
// result. The palette + hash used to be a local copy of the web renderer's copy,
// and both hashed UTF-16 code units where GLib hashes UTF-8 bytes, so every
// accented name got the wrong colour on both renderers. The shared vectors in
// `@gjsify/adwaita-core/conformance` now pin this to the C source.
//
// Reference: refs/libadwaita/src/adw-avatar.c (set_class_color)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label } from '@nativescript/core';

import { avatarMaxFontSize } from '@gjsify/adwaita-core';

import { avatarColor, avatarInitials } from './avatar-color.js';
import { xmlNumber } from './xml-values.js';

/** Default avatar diameter in DIPs (Adwaita's common avatar size). */
export const DEFAULT_AVATAR_SIZE = 48;

// Re-exported so existing consumers keep importing both from this module.
export { avatarColor, avatarInitials };

export class AdwAvatar extends GridLayout {
    /** The centered initials label. */
    protected readonly _label: Label;
    private _text = '';
    private _size = DEFAULT_AVATAR_SIZE;

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

        this._applySize();
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
    }

    /** The name the initials are derived from. */
    get text(): string {
        return this._text;
    }

    set text(value: string) {
        this._text = value ?? '';
        this._label.text = avatarInitials(this._text);
        // Pick the per-name colour exactly like Adw.Avatar (g_str_hash % 14) and
        // apply the flat fill + light initials colour inline (a single CSS rule
        // can't vary per instance).
        const { fill, fg } = avatarColor(this._text);
        this.set('backgroundColor', fill);
        this._label.set('color', fg);
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
}
