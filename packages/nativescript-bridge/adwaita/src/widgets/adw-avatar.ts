// AdwAvatar — a Libadwaita-style avatar for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` with a circular accent-tinted
// background and a centered initials `Label`. The circle is achieved by setting
// `width == height` and `border-radius` to half the size (via the `adw-avatar`
// CSS class + an inline size). Mirrors `Adw.Avatar`: `text` derives the initials,
// `size` sets the diameter.
//
// NOTE: the NativeScript CSS subset has no `transform`/gradient support, so this
// uses a single flat accent fill rather than libadwaita's per-name gradient
// palette. Initials are derived (first letters of up to two words, uppercased).
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_avatar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label } from '@nativescript/core';

/** Default avatar diameter in DIPs (Adwaita's common avatar size). */
export const DEFAULT_AVATAR_SIZE = 48;

/** Derive up to two-letter initials from a name (`"Ada Lovelace"` → `"AL"`). */
export function avatarInitials(text: string): string {
    const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
    return (words[0]!.charAt(0) + words[words.length - 1]!.charAt(0)).toUpperCase();
}

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
        // Scale the initials with the diameter (Adwaita ≈ 0.4 × size) — a single
        // CSS rule can't size per-instance, so set fontSize inline. Without this
        // the initials are too small to read at size 32 (action-bar avatar).
        this._label.set('fontSize', Math.round(this._size * 0.4));
    }

    /** The name the initials are derived from. */
    get text(): string {
        return this._text;
    }

    set text(value: string) {
        this._text = value ?? '';
        this._label.text = avatarInitials(this._text);
    }

    /** The circular diameter in DIPs. Updates width/height/border-radius. */
    get size(): number {
        return this._size;
    }

    set size(value: number) {
        this._size = Number.isFinite(value) && value > 0 ? value : DEFAULT_AVATAR_SIZE;
        this._applySize();
    }
}
