// <adw-clamp> — Constrains its children to a maximum width and centers them.
// Attributes: maximum-size (px, default 600), tightening-threshold (px, default 400).
//
// The clamp is NOT a `max-width`: Adwaita eases the child from "all the available width"
// into the cap across a tightening region and stamps a `small`/`medium`/`large` class on
// it. The arithmetic lives in `@gjsify/adwaita-core` (`clampAllocate`), so this element and
// the NativeScript widget produce the same width for the same viewport.
//
// The cap sits on the CHILDREN, not on this element, which has to keep reporting the
// AVAILABLE width — that is what the curve is evaluated against. An element that caps
// itself reports the capped width back to its own ResizeObserver, which is a feedback
// loop, not a measurement.
//
// `childMin` is passed as 0 rather than measured. libadwaita's
// `lower = MAX (…, child_min)` says a child is never squeezed below its own
// minimum, and the browser already applies that rule at the other end: `min-width`
// wins over `max-width` (CSS 2.1 §10.4), so a child that declares a minimum keeps
// it whatever cap this element writes. A child that declares none has a minimum of
// 0, which is the value passed here — measuring `min-content` per child on every
// resize would cost a synchronous reflow to arrive at the same layout.
//
// Reference: refs/libadwaita/src/adw-clamp-layout.c (child_size_from_clamp, allocate)
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/clamp.md
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { ADW_CLAMP_DEFAULTS, ADW_CLAMP_SIZE_CLASSES, clampAllocate, normalizeClampSize } from '@gjsify/adwaita-core';

export class AdwClamp extends HTMLElement {
    private _resize: ResizeObserver | null = null;
    private _mutations: MutationObserver | null = null;

    static get observedAttributes() {
        return ['maximum-size', 'tightening-threshold'];
    }

    connectedCallback() {
        // ResizeObserver delivers an initial observation on observe(), so the
        // first allocation lands before paint without a separate seeding pass.
        this._resize = new ResizeObserver(() => this._allocate());
        this._resize.observe(this);
        // Children appended AFTER connect are clamped too. Without this they
        // would keep whatever width they came with — the "evaluated once at
        // connect time" bug that cost six container getters their layout;
        // `src/empty-sections.ts` is the same technique for the `hidden` half.
        this._mutations = new MutationObserver(() => this._allocate());
        this._mutations.observe(this, { childList: true });
        this._allocate();
    }

    disconnectedCallback() {
        this._resize?.disconnect();
        this._resize = null;
        this._mutations?.disconnect();
        this._mutations = null;
    }

    attributeChangedCallback() {
        this._allocate();
    }

    private _allocate(): void {
        const params = {
            maximumSize: normalizeClampSize(this.getAttribute('maximum-size'), ADW_CLAMP_DEFAULTS.maximumSize),
            tighteningThreshold: normalizeClampSize(
                this.getAttribute('tightening-threshold'),
                ADW_CLAMP_DEFAULTS.tighteningThreshold,
            ),
            childMin: 0,
            childNat: 0,
        };

        const available = this.clientWidth;
        const children = Array.from(this.children) as HTMLElement[];

        // No box yet (disconnected, or measured before the first layout). GTK's
        // equivalent is `for_size = -1`, where the child reports its natural size
        // rather than being squeezed to nothing — so leave the children alone
        // instead of capping them at 0 and collapsing the page.
        if (available <= 0) {
            for (const child of children) {
                child.style.maxWidth = '';
                child.style.marginInline = '';
                for (const cls of ADW_CLAMP_SIZE_CLASSES) child.classList.remove(cls);
            }
            return;
        }

        const { childSize, sizeClass } = clampAllocate(available, params);
        for (const child of children) {
            child.style.maxWidth = `${childSize}px`;
            child.style.marginInline = 'auto';
            for (const cls of ADW_CLAMP_SIZE_CLASSES) child.classList.toggle(cls, cls === sizeClass);
        }
    }
}

customElements.define('adw-clamp', AdwClamp);
