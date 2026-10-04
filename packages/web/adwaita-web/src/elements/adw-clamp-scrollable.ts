// <adw-clamp-scrollable> — the CLAMP whose child scrolls, and the widget
// `AdwClamp`'s own header points at for anything that must scroll inside a readable
// width (`adw-clamp-scrollable.c:20-27`: "The primary use case for AdwClampScrollable is
// clamping Gtk.ListView").
//
// SAME ARITHMETIC AS `<adw-clamp>`, both halves of it: the allocation is
// `clampAllocate` out of `@gjsify/adwaita-core` — `lower`/`max`/`upper`, the
// ease-out-cubic tightening region and the `small`/`medium`/`large` class stamped on the
// CHILD — reached through `normalizeClampSize` and the `AdwLengthUnit` conversion
// `adw-clamp-layout.c:166-171` does per property. The difference is the ORIENTATION and
// the scrolling.
//
// THE ORIENTATION IS THE WIDGET, NOT THE CLAMP'S. `set_orientation` forwards to the
// layout manager (adw-clamp-scrollable.c:78-92) and the cap lands on the width for a
// horizontal clamp and on the HEIGHT for a vertical one
// (`child_size_from_clamp` measures along `self->orientation`). A vertical clamp
// therefore centres on the block axis here, where `<adw-clamp>` has no axis to pick.
//
// THE SCROLLING MOVES FROM THE CHILD TO THE HOST, and that is the one deviation worth
// naming. In C the child IS the `Gtk.Scrollable`: the widget binds its `hadjustment`,
// `vadjustment`, `hscroll-policy` and `vscroll-policy` onto it
// (adw-clamp-scrollable.c:440-455) and a child that is not scrollable is four
// `gbinding` warnings at exit 0. A DOM element cannot hand its scrolling to a child that
// does not know it is inside one, so the scrollport is this element (`overflow`) and the
// child is what gets capped — the same visible contract, one level up. `hscroll-policy`
// and `vscroll-policy` therefore land on the HOST's overflow, which is where the C's
// policy ultimately decided whether the child ever scrolled.
//
// `hadjustment`/`vadjustment` have no attribute here: they are `Gtk.Adjustment`
// objects (a widget-valued property on every renderer), and the browser's scroll
// position is its own `scrollTop`/`scrollLeft`. That is a PORT-ONLY gap against the
// `Gtk.Scrollable` interface rather than against `AdwClampScrollable`'s own property
// list, which is why `check-adwaita-element-properties.mjs` has no entry for it.
//
// A11Y: no role. `adw_clamp_scrollable_class_init` sets none.
//
// Reference: refs/libadwaita/src/adw-clamp-scrollable.c (set_orientation, set_child,
//   the four adjustment bindings, class_init's layout manager + `clamp` node)
// Reference: refs/libadwaita/src/adw-clamp-layout.c (child_size_from_clamp, allocate)
// Copyright (c) 2020 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ADW_CLAMP_DEFAULTS,
    ADW_CLAMP_SIZE_CLASSES,
    type AdwLengthUnit,
    adwLengthToPx,
    clampAllocate,
    normalizeBoxOrientation,
    normalizeClampSize,
    normalizeLengthUnit,
    type BoxOrientation,
} from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';

/** `Gtk.ScrollablePolicy`'s three nicks, in enum order. */
export type ScrollPolicy = 'automatic' | 'always' | 'never';

/** `adw_scrollable_policy_to_overflow` — the policy as the CSS `overflow` keyword. */
const POLICY_OVERFLOW: Record<ScrollPolicy, string> = {
    automatic: 'auto',
    always: 'scroll',
    never: 'hidden',
};

export class AdwClampScrollable extends HTMLElement {
    private _resize: ResizeObserver | null = null;
    private _mutations: MutationObserver | null = null;

    static get observedAttributes() {
        return ['maximum-size', 'tightening-threshold', 'unit', 'orientation', 'hscroll-policy', 'vscroll-policy'];
    }

    /** `AdwClampScrollable:maximum-size` — the cap, in `unit`. Default 600. */
    get maximumSize(): number {
        return normalizeClampSize(this.getAttribute('maximum-size'), ADW_CLAMP_DEFAULTS.maximumSize);
    }

    set maximumSize(value: number) {
        this.setAttribute('maximum-size', String(value));
    }

    /** `AdwClampScrollable:tightening-threshold` — where the easing starts. Default 400. */
    get tighteningThreshold(): number {
        return normalizeClampSize(this.getAttribute('tightening-threshold'), ADW_CLAMP_DEFAULTS.tighteningThreshold);
    }

    set tighteningThreshold(value: number) {
        this.setAttribute('tightening-threshold', String(value));
    }

    /** `AdwClampScrollable:unit` — the length unit both sizes are written in. Default `sp`. */
    get unit(): AdwLengthUnit {
        return normalizeLengthUnit(this.getAttribute('unit'), 'sp');
    }

    set unit(value: AdwLengthUnit) {
        this.setAttribute('unit', value);
    }

    /** `GtkOrientable:orientation`, which this class overrides. Default horizontal. */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    connectedCallback() {
        // `AdwClampScrollable:child` is a widget PROPERTY, so a `.blp`'s `child: …`
        // authors `slot="child"`. Every child here is already the content, so only the
        // NAME is enrolled — the reason `adw-clamp.ts` gives for not calling
        // `.install()`.
        bindSlottedChildren(this, [{ name: 'child', into: this }]);

        // ResizeObserver delivers an initial observation on `observe()`, so the first
        // allocation lands before paint without a seeding pass.
        this._resize = new ResizeObserver(() => this._allocate());
        this._resize.observe(this);
        // A child appended after connect is capped too; without this it keeps whatever
        // width it arrived with.
        this._mutations = new MutationObserver(() => this._allocate());
        this._mutations.observe(this, { childList: true });

        this._applyOverflow();
        this._allocate();
    }

    disconnectedCallback() {
        this._resize?.disconnect();
        this._resize = null;
        this._mutations?.disconnect();
        this._mutations = null;
    }

    attributeChangedCallback() {
        this._applyOverflow();
        this._allocate();
    }

    /**
     * `Gtk.Scrollable:hscroll-policy` / `vscroll-policy` — the two overrides the class
     * re-declares (adw-clamp-scrollable.c:118-141) and then binds onto the child. They
     * decide here whether this element scrolls at all, which is the question they answer
     * in C.
     */
    private _applyOverflow(): void {
        const horizontal = this.getAttribute('hscroll-policy') as ScrollPolicy | null;
        const vertical = this.getAttribute('vscroll-policy') as ScrollPolicy | null;
        this.style.overflowX = horizontal === null ? 'auto' : (POLICY_OVERFLOW[horizontal] ?? 'auto');
        this.style.overflowY = vertical === null ? 'auto' : (POLICY_OVERFLOW[vertical] ?? 'auto');
    }

    /**
     * `adw_clamp_layout_allocate`, against the AVAILABLE size on the clamped axis.
     *
     * The cap sits on the CHILD, never here: this element is the scrollport, so a cap on
     * itself would feed its own capped width back into its ResizeObserver — a feedback
     * loop rather than a measurement (the reasoning `<adw-clamp>` carries in full).
     */
    private _allocate(): void {
        const vertical = this.orientation === 'vertical';
        const unit = this.unit;
        const available = vertical ? this.clientHeight : this.clientWidth;

        // `childMin` is 0, as in `<adw-clamp>`: a child that declares a minimum keeps it
        // (CSS 2.1 §10.4 lets `min-*` beat `max-*`), and one that declares none has a
        // minimum of 0 — the value a synchronous re-measure would arrive at anyway.
        const params = {
            maximumSize: adwLengthToPx(unit, this.maximumSize),
            tighteningThreshold: adwLengthToPx(unit, this.tighteningThreshold),
            childMin: 0,
            childNat: 0,
        };

        for (const child of Array.from(this.children) as HTMLElement[]) {
            if (available <= 0) {
                // GTK's equivalent is `for_size = -1`: leave the child alone rather than
                // capping it at 0 and collapsing the page.
                child.style.maxWidth = '';
                child.style.maxHeight = '';
                child.style.marginInline = '';
                child.style.marginBlock = '';
                for (const cls of ADW_CLAMP_SIZE_CLASSES) child.classList.remove(cls);
                continue;
            }

            const { childSize, sizeClass } = clampAllocate(available, params);
            if (vertical) {
                child.style.maxWidth = '';
                child.style.maxHeight = `${childSize}px`;
                child.style.marginInline = '';
                child.style.marginBlock = 'auto';
            } else {
                child.style.maxWidth = `${childSize}px`;
                child.style.maxHeight = '';
                child.style.marginInline = 'auto';
                child.style.marginBlock = '';
            }
            for (const cls of ADW_CLAMP_SIZE_CLASSES) child.classList.toggle(cls, cls === sizeClass);
        }
    }
}

customElements.define('adw-clamp-scrollable', AdwClampScrollable);
