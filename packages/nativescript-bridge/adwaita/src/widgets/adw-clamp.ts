// AdwClamp — a Libadwaita-style width clamp for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (single `*` column/row) whose single
// child is centered and clamped. Mirrors `Adw.Clamp`: on a phone the child is
// full-width, and the cap only matters on tablets / landscape, where it keeps
// content readable instead of stretching edge-to-edge.
//
// FIDELITY: the tightening curve, the cap and the `small`/`medium`/`large` class
// now come from `@gjsify/adwaita-core` (`clampAllocationFor`), evaluated against
// the container's real width on every `layoutChanged` — the same size source the
// split views use. Before that this widget did `view.width = maximumSize`, and an
// NS `width` is an EXACT size: a 360 DIP phone got a 600 DIP child that
// overflowed the screen, where `Adw.Clamp` gives it all 360 (adw-clamp-layout.c:226-227).
//
// Reference: refs/libadwaita/src/adw-clamp-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, View } from '@nativescript/core';

import {
    type ClampProps,
    DEFAULT_CLAMP_MAX_SIZE,
    DEFAULT_CLAMP_TIGHTENING_THRESHOLD,
    clampAllocationFor,
    clampChildClassName,
    defaultClampProps,
    normalizeClampProp,
} from './chrome.js';

export { DEFAULT_CLAMP_MAX_SIZE, DEFAULT_CLAMP_TIGHTENING_THRESHOLD };

export class AdwClamp extends GridLayout {
    private _props: ClampProps = defaultClampProps();
    private _child: View | null = null;
    /** The container width the child was last clamped against, in DIPs. */
    private _measuredWidth = 0;

    constructor() {
        super();

        this.className = 'adw-clamp';
        this.addColumn(new ItemSpec(1, 'star'));
        // Width-only clamp: the row is `auto` (size to the child's natural height),
        // NOT `star` — `Adw.Clamp` is vertically transparent (it never stretches its
        // child to fill). A `star` row made the clamp expand to fill its parent, so a
        // clamp inside an `AdwStatusPage` pushed the content to the top instead of
        // letting the status page centre it. Scrolling is the surrounding
        // `ScrollView`'s job, so content-height here is always correct.
        this.addRow(new ItemSpec(1, 'auto'));
        // NativeScript has no window-resize signal, so the container's own
        // post-layout size is the size source the curve is evaluated against.
        this.addEventListener('layoutChanged', () => this._allocate());
    }

    /** Set (or replace) the clamped, centered child. Pass `null` to clear it. */
    setChild(view: View | null): void {
        if (this._child) {
            // Hand the child back the way it arrived — the size class is the
            // clamp's, not the consumer's.
            this._child.className = clampChildClassName(this._child.className, null);
            this.removeChild(this._child);
            this._child = null;
        }
        if (view) {
            view.horizontalAlignment = 'center';
            GridLayout.setColumn(view, 0);
            GridLayout.setRow(view, 0);
            this.addChild(view);
            this._child = view;
            this._allocate();
        }
    }

    /** The currently-clamped child, or `null`. */
    get child(): View | null {
        return this._child;
    }

    /**
     * XML inflation — every child a template declares is THE clamped child.
     *
     * Without this the `LayoutBase` default calls `addChild`, which puts the view
     * in the grid and leaves `_child` null, so `_allocate` returns early: measured
     * on Android, a clamp written in markup rendered its child at full width with
     * no size class at all, i.e. as if there were no clamp around it. The name is
     * ignored because there is only one destination — `<AdwClamp.child>` and a
     * bare child mean the same thing.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.setChild(view);
    }

    /** `Adw.Clamp:maximum-size` — the widest the child may ever get, in DIPs. */
    get maximumSize(): number {
        return this._props.maximumSize;
    }

    set maximumSize(value: number | string) {
        this._props.maximumSize = normalizeClampProp(value, DEFAULT_CLAMP_MAX_SIZE);
        this._allocate();
    }

    /**
     * `Adw.Clamp:tightening-threshold` — the width above which the clamp starts
     * tightening its grip, easing the child toward {@link maximumSize} instead of
     * snapping to it. The storybook has exposed this control all along; until now
     * only the GTK pane responded to it.
     */
    get tighteningThreshold(): number {
        return this._props.tighteningThreshold;
    }

    set tighteningThreshold(value: number | string) {
        this._props.tighteningThreshold = normalizeClampProp(value, DEFAULT_CLAMP_TIGHTENING_THRESHOLD);
        this._allocate();
    }

    /**
     * Re-run libadwaita's allocation against the container's current width.
     *
     * The class assignment is guarded on a real change: this runs from
     * `layoutChanged`, and re-styling a view can schedule another layout pass.
     */
    private _allocate(): void {
        const size = this.getActualSize?.();
        if (size && size.width > 0) this._measuredWidth = size.width;
        if (!this._child) return;

        const { width, sizeClass } = clampAllocationFor(this._measuredWidth, this._props);
        this._child.width = width;
        const className = clampChildClassName(this._child.className, sizeClass);
        if (this._child.className !== className) this._child.className = className;
    }
}
