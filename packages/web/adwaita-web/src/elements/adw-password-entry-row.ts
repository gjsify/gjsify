// <adw-password-entry-row> — A boxed-list entry row tailored for secrets: the
// title floats as a label, the editable text is masked, and a trailing peek
// button toggles between hiding and revealing the contents. A specialization of
// <adw-entry-row> (Adw.PasswordEntryRow extends Adw.EntryRow).
// Attributes: title, text, revealed (boolean — show the contents in clear text).
// Property: text (get/set, proxies the inner input); revealed (get/set).
// Events: `changed` (CustomEvent) on every edit — mirrors Adw.EntryRow's
//   `changed` signal so it drives the same code path as the GTK renderer.
//   `notify::revealed` (CustomEvent) when the peek toggle flips visibility.
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/passwordentryrow.md
// Reference: refs/libadwaita/src/adw-password-entry-row.c (peek toggle: the
//   view-reveal / view-conceal symbolic swap; CSS node `row` carries `.entry`
//   and `.password` style classes).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwPasswordEntryRow extends HTMLElement {
    private _input!: HTMLInputElement;
    private _titleEl!: HTMLSpanElement;
    private _toggle!: HTMLButtonElement;
    private _toggleIcon!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'text', 'revealed'];
    }

    get text(): string {
        return this._input ? this._input.value : (this.getAttribute('text') ?? '');
    }

    set text(value: string) {
        if (this._input) this._input.value = value;
        else this.setAttribute('text', value);
    }

    /** Whether the contents are shown in clear text (peek toggle is engaged). */
    get revealed(): boolean {
        return this.hasAttribute('revealed');
    }

    set revealed(value: boolean) {
        if (value) this.setAttribute('revealed', '');
        else this.removeAttribute('revealed');
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._titleEl.textContent = this.getAttribute('title') ?? '';

        this._input = document.createElement('input');
        this._input.className = 'adw-password-entry-row-input';
        // Masked by default — Adw.PasswordEntryRow sets GTK_INPUT_PURPOSE_PASSWORD
        // and starts with visibility off.
        this._input.type = this.hasAttribute('revealed') ? 'text' : 'password';
        this._input.value = this.getAttribute('text') ?? '';
        this._input.autocomplete = 'off';
        this._input.addEventListener('input', () => {
            this.dispatchEvent(new CustomEvent('changed', { bubbles: true, detail: { text: this._input.value } }));
        });

        // Title floats as a small label above the masked value, both left-aligned
        // in a column (the filled Adw.EntryRow look).
        const text = document.createElement('div');
        text.className = 'adw-password-entry-row-text';
        text.append(this._titleEl, this._input);

        // Trailing peek toggle — a flat icon button, vertically centred. Swaps
        // between the reveal / conceal symbolics like the native widget.
        this._toggle = document.createElement('button');
        this._toggle.className = 'adw-button flat circular icon-only adw-password-entry-row-toggle';
        this._toggle.type = 'button';
        this._toggleIcon = document.createElement('span');
        this._toggleIcon.setAttribute('aria-hidden', 'true');
        this._toggle.appendChild(this._toggleIcon);
        this._toggle.addEventListener('click', () => {
            this.revealed = !this.revealed;
        });

        // Trailing edit pencil (before the peek toggle), mirroring native.
        const edit = document.createElement('span');
        edit.className = 'adw-row-edit adw-icon adw-icon--document-edit';
        edit.setAttribute('aria-hidden', 'true');
        edit.addEventListener('click', () => this._input.focus());

        this.replaceChildren(text, edit, this._toggle);
        this._renderRevealed();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'title') {
            this._titleEl.textContent = value ?? '';
        } else if (name === 'text') {
            if (this._input.value !== (value ?? '')) this._input.value = value ?? '';
        } else if (name === 'revealed') {
            this._renderRevealed();
            this.dispatchEvent(
                new CustomEvent('notify::revealed', { bubbles: true, detail: { revealed: this.revealed } }),
            );
        }
    }

    private _renderRevealed() {
        const revealed = this.revealed;
        this._input.type = revealed ? 'text' : 'password';
        // view-conceal when revealed (offer to hide), view-reveal when masked.
        const icon = revealed ? 'view-conceal' : 'view-reveal';
        this._toggleIcon.className = `adw-icon adw-icon--${icon}`;
        const labelText = revealed ? 'Hide Password' : 'Show Password';
        this._toggle.title = labelText;
        this._toggle.setAttribute('aria-label', labelText);
        this._toggle.setAttribute('aria-pressed', String(revealed));
    }
}

customElements.define('adw-password-entry-row', AdwPasswordEntryRow);
