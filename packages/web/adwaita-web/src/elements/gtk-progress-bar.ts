// <gtk-progress-bar> — the DETERMINATE progress indicator, and the partner to
// <adw-spinner>, which only ever covers "busy, no idea how long".
//
// NO CORE STATE MACHINE: the whole behaviour is `CLAMP(fraction, 0, 1)` plus a pulsing
// flag, and ADR 0004 is explicit that trivial behaviour gets no core class. The clamp
// is still shared — `glibClamp` (GLib's CLAMP, high bound tested FIRST) comes from
// `@gjsify/adwaita-core`.
//
// `gtk_progress_bar_pulse()`'s step semantics (the `pulse-step` default, how the block
// reflects at the ends, whether it resets `fraction`) are NOT reproduced: GtkProgressBar
// is a GTK widget, `refs/gtk` is an uninitialized submodule here and libadwaita vendors
// no `gtk-progress-bar.c`, so none of it is verifiable. What ships instead is the
// vendored port's web idiom — a CSS keyframe animation that runs while `pulsing` is set
// — so {@link GtkProgressBar.pulse} ENTERS that state and is idempotent afterwards. The
// default `show-text` label `NN%` is likewise this port's, not GTK's format string.
//
// `osd` is libadwaita's `.osd` STYLE CLASS: a 2px troughless bar for under a header bar.
//
// A11Y: `role="progressbar"`, `aria-valuemin`/`aria-valuemax` fixed at 0/1,
// `aria-valuenow` carrying the clamped fraction. While pulsing `aria-valuenow` is
// REMOVED — that is how ARIA spells "indeterminate", and a stale value there would be
// announced as real progress.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_progress-bar.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_progressbar.scss (the indeterminate animation only)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { glibClamp } from '@gjsify/adwaita-core';

export class GtkProgressBar extends HTMLElement {
    private _trough!: HTMLSpanElement;
    private _progress!: HTMLSpanElement;
    private _text!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['fraction', 'pulsing', 'show-text', 'text', 'inverted', 'osd', 'disabled'];
    }

    /** How much of the bar is filled, 0…1. Always the CLAMPED value. */
    get fraction(): number {
        const raw = Number.parseFloat(this.getAttribute('fraction') ?? '');
        // A missing or unparseable attribute is 0, GtkProgressBar's default — not NaN,
        // which would reach the width and the a11y value.
        if (!Number.isFinite(raw)) return 0;
        return glibClamp(raw, 0, 1);
    }

    set fraction(value: number) {
        this.setAttribute('fraction', String(value));
    }

    /** Whether the bar is indeterminate. */
    get pulsing(): boolean {
        return this.hasAttribute('pulsing');
    }

    set pulsing(value: boolean) {
        this.toggleAttribute('pulsing', !!value);
    }

    /** Whether the text node is shown. */
    get showText(): boolean {
        return this.hasAttribute('show-text');
    }

    set showText(value: boolean) {
        this.toggleAttribute('show-text', !!value);
    }

    /** The shown text. Falls back to the fraction as a percentage. */
    get text(): string {
        const explicit = this.getAttribute('text');
        if (explicit !== null) return explicit;
        return `${Math.round(this.fraction * 100)}%`;
    }

    set text(value: string) {
        this.setAttribute('text', value);
    }

    /** Whether the bar fills from the far end. */
    get inverted(): boolean {
        return this.hasAttribute('inverted');
    }

    set inverted(value: boolean) {
        this.toggleAttribute('inverted', !!value);
    }

    /** Whether the `.osd` hairline variant is used. */
    get osd(): boolean {
        return this.hasAttribute('osd');
    }

    set osd(value: boolean) {
        this.toggleAttribute('osd', !!value);
    }

    /** Whether the widget is dimmed. */
    get disabled(): boolean {
        return this.hasAttribute('disabled');
    }

    set disabled(value: boolean) {
        this.toggleAttribute('disabled', !!value);
    }

    /**
     * Switch the bar to indeterminate — GtkProgressBar's method name for the same
     * intent. The bouncing block is a CSS animation here, so this ENTERS the state and
     * repeat calls are no-ops (see the module header).
     */
    pulse(): void {
        this.pulsing = true;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._trough = document.createElement('span');
        this._trough.className = 'adw-progress-bar-trough';
        this._progress = document.createElement('span');
        this._progress.className = 'adw-progress-bar-progress';
        this._trough.appendChild(this._progress);

        this._text = document.createElement('span');
        this._text.className = 'adw-progress-bar-text';

        this.replaceChildren(this._trough, this._text);

        this.setAttribute('role', 'progressbar');
        this.setAttribute('aria-valuemin', '0');
        this.setAttribute('aria-valuemax', '1');

        this._render();
    }

    attributeChangedCallback() {
        if (!this._initialized) return;
        this._render();
    }

    private _render(): void {
        const fraction = this.fraction;
        const pulsing = this.pulsing;

        // `> trough.empty > progress { all: unset }`: the indicator has to VANISH at 0,
        // not draw a rounded stub. A pulsing bar is never empty — its block is what says
        // "working".
        const empty = !pulsing && fraction === 0;
        this._trough.classList.toggle('empty', empty);
        // The inline width is dropped in the pulsing and the empty case so the rules that
        // own the indicator there (the keyframes, `all: unset`) are not fighting an inline
        // declaration they cannot win against — inline styles beat any author rule.
        this._progress.style.width = pulsing || empty ? '' : `${fraction * 100}%`;

        this._text.textContent = this.text;
        this._text.hidden = !this.showText;

        if (pulsing) this.removeAttribute('aria-valuenow');
        else this.setAttribute('aria-valuenow', String(fraction));
    }
}

customElements.define('gtk-progress-bar', GtkProgressBar);
