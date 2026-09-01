// <gtk-entry> — Adwaita single-line text entry (e.g. a browser URL bar).
// Attributes: value, placeholder, type, disabled, maxlength.
// Properties: value (get/set, proxies the inner input), maxLength, textLength.
// Events: native `input` bubbles from the inner input; `activate` (CustomEvent)
//   fires on Enter — mirroring Gtk.Entry's `activate` signal.
//
// The character arithmetic is HEADLESS and lives in `@gjsify/adwaita-core`
// (ADR 0004): `entryTextLength` counts CODE POINTS and `clampEntryText` truncates
// on them. `@gjsify/adwaita-nativescript`'s GtkEntry has composed the same two
// since it shipped; this element counted nothing at all, so the same consumer
// got a max length on one renderer and none on the other — and the native
// `maxlength` attribute would not have closed the gap, because the browser
// counts UTF-16 code units: `'🔒é'` is 2 characters to GTK and to NativeScript,
// and 3 to `input.maxLength`. That is why the clamp is applied here rather than
// handed to the platform.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// length arithmetic composed from @gjsify/adwaita-core.

import { ENTRY_ROW_MAX_LENGTH_LIMIT, clampEntryText, entryTextLength } from '@gjsify/adwaita-core';

export class GtkEntry extends HTMLElement {
    private _input!: HTMLInputElement;
    private _initialized = false;
    private _maxLength = 0;

    static get observedAttributes() {
        return ['value', 'placeholder', 'type', 'disabled', 'maxlength'];
    }

    get value(): string {
        return this._input ? this._input.value : (this.getAttribute('value') ?? '');
    }

    set value(v: string) {
        const clamped = clampEntryText(v ?? '', this._maxLength);
        if (this._input) this._input.value = clamped;
        else this.setAttribute('value', clamped);
    }

    /** `Gtk.Entry:max-length` — 0 means unlimited. Counted in CODE POINTS. */
    get maxLength(): number {
        return this._maxLength;
    }

    set maxLength(value: number) {
        this._maxLength = Number.isFinite(value)
            ? Math.min(ENTRY_ROW_MAX_LENGTH_LIMIT, Math.max(0, Math.trunc(value)))
            : 0;
        if (this._input) this._input.value = clampEntryText(this._input.value, this._maxLength);
    }

    /** `Gtk.Entry:text-length` — code points, not UTF-16 units. */
    get textLength(): number {
        return entryTextLength(this.value);
    }

    /** The inner native input (for focus/selection). */
    get input(): HTMLInputElement {
        return this._input;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.maxLength = Number(this.getAttribute('maxlength') ?? 0);

        const input = document.createElement('input');
        input.className = 'adw-entry';
        input.type = this.getAttribute('type') || 'text';
        input.value = clampEntryText(this.getAttribute('value') ?? '', this._maxLength);
        input.placeholder = this.getAttribute('placeholder') ?? '';
        input.disabled = this.hasAttribute('disabled');
        // Typing past the limit is clamped here, on the way in — the same place
        // NativeScript clamps it, so both renderers refuse the same character.
        input.addEventListener('input', () => {
            const clamped = clampEntryText(input.value, this._maxLength);
            if (clamped !== input.value) input.value = clamped;
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.dispatchEvent(new CustomEvent('activate', { bubbles: true, detail: { value: input.value } }));
            }
        });

        this._input = input;
        this.replaceChildren(input);
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'maxlength') {
            this.maxLength = Number(value ?? 0);
            return;
        }
        if (!this._input) return;
        if (name === 'value') this._input.value = clampEntryText(value ?? '', this._maxLength);
        else if (name === 'placeholder') this._input.placeholder = value ?? '';
        else if (name === 'type') this._input.type = value || 'text';
        else if (name === 'disabled') this._input.disabled = value !== null;
    }
}

customElements.define('gtk-entry', GtkEntry);
