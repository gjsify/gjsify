// AdwAvatar — a Libadwaita-style avatar for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` with a circular accent-tinted
// background and a centered initials `Label`. The circle is achieved by setting
// `width == height` and `border-radius` to half the size (via the `adw-avatar`
// CSS class + an inline size). Mirrors `Adw.Avatar`: `text` derives the initials,
// `size` sets the diameter.
//
// The background COLOUR is derived from the name exactly like `Adw.Avatar`:
// `g_str_hash(text) % 14` picks one of the 14 libadwaita avatar colours. The NS
// CSS subset has no gradient, so the flat fill is the 50/50 blend of the
// palette's start→stop gradient (and the initials take the matching light `fg`).
// Initials are derived (first letters of up to two words, uppercased).
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_avatar.scss ($avatarcolorlist)
// (palette + g_str_hash ported from @gjsify/adwaita-web's adw-avatar.ts).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label } from '@nativescript/core';

/** Default avatar diameter in DIPs (Adwaita's common avatar size). */
export const DEFAULT_AVATAR_SIZE = 48;

/** The 14 libadwaita avatar colours: a light `fg` over a start→stop gradient. */
const AVATAR_COLORS: ReadonlyArray<{ fg: string; start: string; stop: string }> = [
    { fg: '#cfe1f5', start: '#83b6ec', stop: '#337fdc' }, // blue
    { fg: '#caeaf2', start: '#7ad9f1', stop: '#0f9ac8' }, // cyan
    { fg: '#cef8d8', start: '#8de6b1', stop: '#29ae74' }, // green
    { fg: '#e6f9d7', start: '#b5e98a', stop: '#6ab85b' }, // lime
    { fg: '#f9f4e1', start: '#f8e359', stop: '#d29d09' }, // yellow
    { fg: '#ffead1', start: '#ffcb62', stop: '#d68400' }, // gold
    { fg: '#ffe5c5', start: '#ffa95a', stop: '#ed5b00' }, // orange
    { fg: '#f8d2ce', start: '#f78773', stop: '#e62d42' }, // raspberry
    { fg: '#fac7de', start: '#e973ab', stop: '#e33b6a' }, // magenta
    { fg: '#e7c2e8', start: '#cb78d4', stop: '#9945b5' }, // purple
    { fg: '#d5d2f5', start: '#9e91e8', stop: '#7a59ca' }, // violet
    { fg: '#f2eade', start: '#e3cf9c', stop: '#b08952' }, // beige
    { fg: '#e5d6ca', start: '#be916d', stop: '#785336' }, // brown
    { fg: '#d8d7d3', start: '#c0bfbc', stop: '#6e6d71' }, // gray
];

/** GLib `g_str_hash` (DJB2: h = h*33 + c, as uint32) — matches `Adw.Avatar` exactly. */
function gStrHash(text: string): number {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) >>> 0;
    return h >>> 0;
}

/** Mix two `#rrggbb` colours 50/50 (the flat stand-in for the gradient). */
function blendHex(a: string, b: string): string {
    const pa = Number.parseInt(a.slice(1), 16);
    const pb = Number.parseInt(b.slice(1), 16);
    const mix = (shift: number) =>
        Math.round((((pa >> shift) & 0xff) + ((pb >> shift) & 0xff)) / 2)
            .toString(16)
            .padStart(2, '0');
    return `#${mix(16)}${mix(8)}${mix(0)}`;
}

/** The flat fill + initials colour `Adw.Avatar` would pick for `text`. */
export function avatarColor(text: string): { fill: string; fg: string } {
    const c = AVATAR_COLORS[gStrHash(text ?? '') % AVATAR_COLORS.length]!;
    return { fill: blendHex(c.start, c.stop), fg: c.fg };
}

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

    set size(value: number) {
        this._size = Number.isFinite(value) && value > 0 ? value : DEFAULT_AVATAR_SIZE;
        this._applySize();
    }
}
