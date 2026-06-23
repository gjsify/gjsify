// <adw-avatar> — A round avatar showing initials derived from a name (with a
// colour picked from the name), or a symbolic fallback icon.
// Attributes: text, size (px, default 48), show-initials (boolean),
//   icon (symbolic fallback name, with or without -symbolic).
// Reference: refs/adwaita-web/adwaita-web/scss/_avatar.scss
// Reference: refs/libadwaita/src/adw-avatar.c (initials + colour derivation)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

// A subset of the libadwaita avatar palette (saturated background + light text).
const AVATAR_COLORS: ReadonlyArray<{ bg: string; fg: string }> = [
    { bg: '#3584e4', fg: '#ffffff' }, // blue
    { bg: '#2596be', fg: '#ffffff' }, // cyan
    { bg: '#3a944a', fg: '#ffffff' }, // green
    { bg: '#c0bb35', fg: '#000000' }, // lime
    { bg: '#cd9309', fg: '#ffffff' }, // yellow
    { bg: '#ed5b00', fg: '#ffffff' }, // orange
    { bg: '#e62d42', fg: '#ffffff' }, // red
    { bg: '#d56199', fg: '#ffffff' }, // pink
    { bg: '#9141ac', fg: '#ffffff' }, // purple
    { bg: '#b5835a', fg: '#ffffff' }, // brown
];

function initialsOf(text: string): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function colorFor(text: string): { bg: string; fg: string } {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
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
            const { bg, fg } = colorFor(text || 'default');
            this.style.backgroundColor = bg;
            this.style.color = fg;
            this._textEl.textContent = initials;
            this._textEl.hidden = false;
            this._iconEl.hidden = true;
        } else {
            this.style.backgroundColor = '';
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
