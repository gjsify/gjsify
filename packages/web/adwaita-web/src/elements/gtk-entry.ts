// <gtk-entry> — Adwaita single-line text entry (e.g. a browser URL bar).
// Attributes: value, placeholder-text (`placeholder` is the older spelling and still read),
//   width-request, type, disabled, maxlength.
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

import type { DispatchedSignals } from '../signals.js';

export class GtkEntry extends HTMLElement {
    /**
     * `protected`, not `private`: `GtkPasswordEntry` and `GtkSearchEntry` subclass this
     * element and restyle or wrap the very input it builds (the password field's Caps Lock
     * and peek listeners, the search field's leading icon and trailing clear button), so the
     * inner node is theirs to reach as well as this class's.
     */
    protected _input!: HTMLInputElement;
    private _initialized = false;
    private _maxLength = 0;
    /** The text last announced, so `changed` fires on a real change only — as `gtk_editable_changed` does. */
    private _announced = '';

    /** The GTK signals this element dispatches, each with the DOM event it arrives as (ADR 0093). */
    static readonly signals: DispatchedSignals = {
        changed: 'changed',
        'notify::text': 'notify::text',
        activate: 'activate',
    };

    static get observedAttributes() {
        return ['value', 'text', 'placeholder-text', 'placeholder', 'width-request', 'type', 'disabled', 'maxlength'];
    }

    get value(): string {
        return this._input ? this._input.value : (this.getAttribute('value') ?? '');
    }

    set value(v: string) {
        const clamped = clampEntryText(v ?? '', this._maxLength);
        if (this._input) {
            this._input.value = clamped;
            this._announceText();
        } else this.setAttribute('value', clamped);
    }

    /** `Gtk.Editable:text`, the GObject name for {@link value}. */
    get text(): string {
        return this.value;
    }

    set text(v: string) {
        this.value = v;
    }

    /** `changed` then `notify::text`, once per real change of the text, typed or set from code. */
    private _announceText(): void {
        const text = this._input.value;
        if (text === this._announced) return;
        this._announced = text;
        this.dispatchEvent(new CustomEvent('changed', { bubbles: true }));
        this.dispatchEvent(new CustomEvent('notify::text', { bubbles: true, detail: { text } }));
    }

    /** `Gtk.Entry:max-length` — 0 means unlimited. Counted in CODE POINTS. */
    get maxLength(): number {
        return this._maxLength;
    }

    set maxLength(value: number) {
        this._maxLength = Number.isFinite(value)
            ? Math.min(ENTRY_ROW_MAX_LENGTH_LIMIT, Math.max(0, Math.trunc(value)))
            : 0;
        if (this._input) {
            this._input.value = clampEntryText(this._input.value, this._maxLength);
            this._announceText();
        }
    }

    /** `Gtk.Entry:text-length` — code points, not UTF-16 units. */
    get textLength(): number {
        return entryTextLength(this.value);
    }

    /**
     * `Gtk.Entry:placeholder-text`, the name a Blueprint file and the gallery trees use.
     * `placeholder` stays for markup written before the GTK spelling was read.
     */
    private placeholderAttribute(): string {
        return this.getAttribute('placeholder-text') ?? this.getAttribute('placeholder') ?? '';
    }

    /** `Gtk.Widget:width-request` — a minimum width in px; -1 or absent leaves the natural one. */
    private applyWidthRequest(): void {
        const width = Number(this.getAttribute('width-request') ?? -1);
        this.style.minWidth = Number.isFinite(width) && width > 0 ? `${width}px` : '';
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
        input.value = clampEntryText(this.getAttribute('value') ?? this.getAttribute('text') ?? '', this._maxLength);
        input.placeholder = this.placeholderAttribute();
        this.applyWidthRequest();
        input.disabled = this.hasAttribute('disabled');
        // Typing past the limit is clamped here, on the way in — the same place
        // NativeScript clamps it, so both renderers refuse the same character.
        input.addEventListener('input', () => {
            const clamped = clampEntryText(input.value, this._maxLength);
            if (clamped !== input.value) input.value = clamped;
            this._announceText();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.dispatchEvent(new CustomEvent('activate', { bubbles: true, detail: { value: input.value } }));
            }
        });

        this._input = input;
        this._announced = input.value;
        this.replaceChildren(input);
    }

    /**
     * Declared so a subclass can override it and still reach the base: the custom-element
     * lifecycle hooks a subclass chains (`super.disconnectedCallback()`) have to exist on
     * the class it extends, and `GtkSearchEntry` drops its pending search timeout here.
     */
    disconnectedCallback() {}

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'maxlength') {
            this.maxLength = Number(value ?? 0);
            return;
        }
        if (name === 'width-request') {
            this.applyWidthRequest();
            return;
        }
        if (!this._input) return;
        if (name === 'value' || name === 'text') {
            this._input.value = clampEntryText(value ?? '', this._maxLength);
            this._announceText();
        } else if (name === 'placeholder-text' || name === 'placeholder')
            this._input.placeholder = this.placeholderAttribute();
        else if (name === 'type') this._input.type = value || 'text';
        else if (name === 'disabled') this._input.disabled = value !== null;
    }
}

customElements.define('gtk-entry', GtkEntry);
