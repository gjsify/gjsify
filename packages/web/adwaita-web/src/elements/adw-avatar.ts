// <adw-avatar> — A round avatar showing initials derived from a name (with a
// colour picked from the name), or a symbolic fallback icon.
// Attributes: text, size (px, default 48), show-initials (boolean),
//   icon (symbolic fallback name, with or without -symbolic).
// Reference: refs/adwaita-web/adwaita-web/scss/_avatar.scss
// Reference: refs/libadwaita/src/adw-avatar.c (initials + colour derivation)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

// A subset of the libadwaita avatar palette (saturated background + light text).
// The exact libadwaita avatar palette: 14 entries of { fg (a light tint), and a
// start→stop gradient background }. Reference:
// refs/libadwaita/src/stylesheet/widgets/_avatar.scss ($avatarcolorlist).
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

function initialsOf(text: string): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// GLib's g_str_hash (DJB2 variant: h = h*33 + c, as uint32) so the picked colour
// matches Adw.Avatar exactly (it uses g_str_hash(text) % 14).
function gStrHash(text: string): number {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) >>> 0;
    return h >>> 0;
}

function colorFor(text: string): { fg: string; start: string; stop: string } {
    return AVATAR_COLORS[gStrHash(text) % AVATAR_COLORS.length];
}

export class AdwAvatar extends HTMLElement {
    private _textEl!: HTMLSpanElement;
    private _iconEl!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['text', 'size', 'show-initials', 'icon'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._textEl = document.createElement('span');
        this._textEl.className = 'adw-avatar-text';

        this._iconEl = document.createElement('span');
        this._iconEl.className = 'adw-avatar-icon adw-icon';
        this._iconEl.setAttribute('aria-hidden', 'true');

        this.replaceChildren(this._textEl, this._iconEl);
        this._render();
    }

    attributeChangedCallback() {
        if (this._initialized) this._render();
    }

    private _render() {
        const size = parseFloat(this.getAttribute('size') || '48');
        this.style.width = `${size}px`;
        this.style.height = `${size}px`;
        this.style.fontSize = `${Math.round(size * (size < 32 ? 0.5 : 0.4))}px`;

        const text = this.getAttribute('text') ?? '';
        const initials = initialsOf(text);
        const showInitials = this.hasAttribute('show-initials') && initials.length > 0;

        if (showInitials) {
            const { fg, start, stop } = colorFor(text || 'default');
            this.style.backgroundImage = `linear-gradient(${start}, ${stop})`;
            this.style.color = fg;
            this._textEl.textContent = initials;
            this._textEl.hidden = false;
            this._iconEl.hidden = true;
        } else {
            this.style.backgroundImage = '';
            this.style.color = '';
            this._textEl.hidden = true;
            const icon = (this.getAttribute('icon') ?? 'avatar-default').replace(/-symbolic$/, '');
            this._iconEl.className = `adw-avatar-icon adw-icon adw-icon--${icon}`;
            this._iconEl.style.width = `${Math.round(size * 0.55)}px`;
            this._iconEl.style.height = `${Math.round(size * 0.55)}px`;
            this._iconEl.hidden = false;
        }
    }
}

customElements.define('adw-avatar', AdwAvatar);
