// <adw-wrap-box> — A box-like container that lays its children out in a line and
// wraps them onto new lines when they run out of room (the web analog of
// flexbox `flex-wrap: wrap` with a gap). Mirrors Adw.WrapBox.
// Attributes:
//   child-spacing   (px, default 0) — spacing between children on the same line
//                                      → CSS column-gap
//   line-spacing    (px, default 0) — spacing between lines → CSS row-gap
//   orientation     ("horizontal" | "vertical", default "horizontal") — the main
//                                      axis children are packed along
//   align           (0..1, default 0) — alignment of children within each line
//                                      (cross axis); 0 = start, 0.5 = center, 1 = end
//   justify         ("none" | "fill" | "spread", default "none") — whether/how
//                                      each line is stretched to fill the widget
//   justify-last-line (boolean) — also justify the last (incomplete) line
//   line-homogeneous  (boolean) — make every line take the same amount of space
//   pack-direction  ("start-to-end" | "end-to-start", default "start-to-end") —
//                                      direction children are packed within a line
//   wrap-reverse    (boolean) — reverse the wrap direction (lines wrap upwards)
// Events: notify::child-spacing, notify::line-spacing (CustomEvent, bubbles —
//   mirrors GObject signal naming).
// Reference: refs/libadwaita/src/adw-wrap-box.c / adw-wrap-layout.c (Adw.WrapBox)
// Reference: refs/adwaita-web/adwaita-web/scss/_wrap_box.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** Adw.JustifyMode → flexbox justify-content. */
const JUSTIFY_MAP: Record<string, string> = {
    none: 'flex-start',
    fill: 'space-between',
    spread: 'space-between',
};

export class AdwWrapBox extends HTMLElement {
    private _initialized = false;

    static get observedAttributes() {
        return [
            'child-spacing',
            'line-spacing',
            'orientation',
            'align',
            'justify',
            'justify-last-line',
            'line-homogeneous',
            'pack-direction',
            'wrap-reverse',
        ];
    }

    /** Spacing between children on the same line, in px (CSS column-gap). */
    get childSpacing(): number {
        return parseFloat(this.getAttribute('child-spacing') || '0');
    }

    set childSpacing(value: number) {
        this.setAttribute('child-spacing', String(value));
    }

    /** Spacing between lines, in px (CSS row-gap). */
    get lineSpacing(): number {
        return parseFloat(this.getAttribute('line-spacing') || '0');
    }

    set lineSpacing(value: number) {
        this.setAttribute('line-spacing', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        this._sync();
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        if (!this._initialized) return;
        this._sync();
        if (old === value) return;
        if (name === 'child-spacing') {
            this.dispatchEvent(
                new CustomEvent('notify::child-spacing', {
                    bubbles: true,
                    detail: { childSpacing: this.childSpacing },
                }),
            );
        } else if (name === 'line-spacing') {
            this.dispatchEvent(
                new CustomEvent('notify::line-spacing', {
                    bubbles: true,
                    detail: { lineSpacing: this.lineSpacing },
                }),
            );
        }
    }

    private _sync() {
        const style = this.style;
        const vertical = this.getAttribute('orientation') === 'vertical';
        const reverseWrap = this.hasAttribute('wrap-reverse');
        const packEndToStart = this.getAttribute('pack-direction') === 'end-to-start';

        // Main axis is the packing direction; lines wrap along the cross axis.
        const direction = vertical ? 'column' : 'row';
        const reversed = packEndToStart ? `${direction}-reverse` : direction;
        style.flexDirection = reversed;
        style.flexWrap = reverseWrap ? 'wrap-reverse' : 'wrap';

        // child-spacing is along the line (main axis), line-spacing is between
        // lines (cross axis). For a horizontal box that maps to column-gap /
        // row-gap respectively; the mapping flips for a vertical box.
        const childGap = `${this.childSpacing}px`;
        const lineGap = `${this.lineSpacing}px`;
        if (vertical) {
            style.rowGap = childGap;
            style.columnGap = lineGap;
        } else {
            style.columnGap = childGap;
            style.rowGap = lineGap;
        }

        // justify-content stretches each complete line along the main axis; the
        // last (incomplete) line is only stretched when justify-last-line is set.
        const justify = this.getAttribute('justify') ?? 'none';
        style.justifyContent = JUSTIFY_MAP[justify] ?? 'flex-start';

        // align (0..1) positions children within each line on the cross axis.
        // It is only honoured when the line is not justified.
        const align = Math.max(0, Math.min(1, parseFloat(this.getAttribute('align') || '0')));
        let crossAlign = 'flex-start';
        if (align >= 0.75) crossAlign = 'flex-end';
        else if (align >= 0.25) crossAlign = 'center';
        style.alignItems = crossAlign;

        // line-homogeneous makes every line take the same amount of space, which
        // flexbox approximates by stretching the lines across the cross axis.
        style.alignContent = this.hasAttribute('line-homogeneous') ? 'stretch' : 'flex-start';
    }
}

customElements.define('adw-wrap-box', AdwWrapBox);
