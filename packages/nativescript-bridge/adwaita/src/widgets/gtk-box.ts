// GtkBox — the plain one-axis container, for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1). libadwaita ships no box
// type; `GtkBox` is GTK's, and libadwaita only styles what a caller puts in one. So this is
// `Gtk.Box` and there is no `adw-` spelling of it.
//
// WHY IT EXISTS AT ALL, when `@nativescript/core` already has a `StackLayout`. Because the
// gallery measured what its absence cost: every documented snippet that needed a box
// reached for `@nativescript/core` directly, and a pane that imports the platform's
// primitives is a DIFFERENT PROGRAM from the `gjs` pane beside it, not the same one spelled
// for another runtime (ADR 0034 § Amendment 14's `composition` kind).
//
// A ONE-AXIS `GridLayout` AND NOT A `StackLayout` (`box-layout.ts` has the reasoning): a
// `*` track per child that expands and an `auto` track for the rest is how this platform
// hands spare space to `hexpand` / `vexpand`, a `pixel` track between children is the
// `spacing`, and every track is `*` for `homogeneous`. What the box adds on top of the
// platform is what it has no word for:
//
//   · `spacing`, as the gap tracks;
//   · `append`/`prepend`/`remove`/`insert_child_after`/`reorder_child_after`, GTK's own
//     child verbs, with `gtk_widget_insert_after`'s NULL-means-FIRST rule;
//   · `add_css_class` and its siblings (`AdwStyledLayoutBase`), the line every Adwaita
//     snippet uses to give a widget a look.
//
// `orientation` IS THE BOX'S OWN, and its default is GTK's: `horizontal`
// (`gtkorientable.c`, and the shared `BOX_ORIENTATION_VECTORS`). A `GridLayout` has no
// orientation property of its own, so there is no platform accessor this could shadow.
//
// WHAT IT DOES NOT DO: `baseline-child` and `baseline-position` are declared gaps in
// `check-nativescript-widget-coverage.mjs`. NativeScript aligns boxes rather than text
// baselines — the same absence `gtk-align.ts` already declares for the three baseline members
// of `Gtk.Align`. An expanding DESCENDANT does not make this box expand; `box-layout.ts` says
// so.
//
// Reference: refs/gtk gtk/gtkbox.c (GtkBox)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ItemSpec, type View } from '@nativescript/core';

import {
    boxChildTrack,
    boxSpacingChanges,
    boxTrackPlan,
    DEFAULT_BOX_SPACING,
    normalizeBoxSpacing,
    resolveBoxChildOrder,
    type BoxOrientation,
} from './box-layout.js';
import { normalizeBoxOrientation } from '@gjsify/adwaita-core';
import { xmlBoolean, xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';
import { NOTIFY_HEXPAND, NOTIFY_VEXPAND, type GtkWidgetLayout } from './widget-layout.js';

export { DEFAULT_BOX_SPACING };

/** The two expand flags a child may carry — a plain `@nativescript/core` view carries neither. */
type ExpandFlags = Partial<Pick<GtkWidgetLayout, 'hexpand' | 'vexpand'>>;

export class GtkBox extends AdwStyledLayoutBase {
    static readonly GTypeName: string = 'GtkBox';

    private _spacing = DEFAULT_BOX_SPACING;
    private _orientation: BoxOrientation = 'horizontal';
    private _homogeneous = false;
    // What the track lists were last built for. NOT `_rows`/`_columns`: `GridLayoutBase` owns
    // `_rows` and assigns it in its constructor, and a subclass field of that name replaces it.
    private _trackKey = '';
    private readonly _followers = new Map<View, () => void>();

    constructor(props?: ConstructProps<GtkBox>) {
        super();

        // NO BASE CLASS OF ITS OWN, so the constructor writes no `className` at all.
        // GTK's `box` is a CSS NAME, never a member of `css-classes`
        // (`gtk_widget_get_css_classes` on a fresh box answers `[]`), and there is no
        // Adwaita fill, radius or padding for a box to carry — the widgets inside it are
        // what libadwaita styles. So `className` holds exactly what a caller puts there, and
        // an untouched box leaves the property as NativeScript left it rather than writing an
        // empty string through the CSS engine.

        applyConstructProps(this, props);
    }

    // --- child list ---

    /** Append a child — `gtk_box_append`. */
    append(view: View): void {
        this.addChild(view);
    }

    /** Insert a child at the START — `gtk_box_prepend`. */
    prepend(view: View): void {
        this.insertChild(view, 0);
    }

    /** Remove a previously-added child — `gtk_box_remove`. */
    remove(view: View): void {
        this.removeChild(view);
    }

    /**
     * Every path a child can enter by — `append()`, a direct `addChild()`, and XML
     * inflation through `_addChildFromBuilder` — ends in one of these three, which is why
     * the tracks are planned here and not in `append()`. `AdwWrapBox` records the incident
     * that rule comes from: applied in `append()` only, a child declared in markup got no
     * spacing at all.
     */
    addChild(view: View): void {
        super.addChild(view);
        this._follow(view);
        this._applyChildren();
    }

    insertChild(child: View, atIndex: number): void {
        super.insertChild(child, atIndex);
        this._follow(child);
        this._applyChildren();
    }

    removeChild(view: View): void {
        this._unfollow(view);
        super.removeChild(view);
        this._applyChildren();
    }

    /**
     * `gtk_box_insert_child_after`.
     *
     * A NULL/absent `sibling` inserts at the FIRST position, not the last —
     * `gtk_widget_insert_after`'s documented rule. Returns whether the insert happened; a
     * refusal is where C would have hit a `g_return_if_fail`.
     */
    insert_child_after(view: View, sibling: View | null = null): boolean {
        return this._applyOrder('insert-after', view, sibling);
    }

    /** `gtk_box_reorder_child_after`. Same NULL rule. */
    reorder_child_after(view: View, sibling: View | null = null): boolean {
        return this._applyOrder('reorder-after', view, sibling);
    }

    // --- properties ---

    /** `Gtk.Box:spacing` — the gap between children, in DIPs. Defaults to 0, as in C. */
    get spacing(): number {
        return this._spacing;
    }

    set spacing(value: number | string) {
        // `xmlNumber` and not `normalizeBoxSpacing` alone: `Gtk.Box:spacing` is an `int`,
        // so a CSS-ish `"12px"` is not a spacing GTK has — unlike the clamp's `maximum-size`,
        // which is a LENGTH and is why `normalizeClampSize` is declared string-tolerant.
        const next = xmlNumber(value, this._spacing);
        if (!boxSpacingChanges(this._spacing, next)) return;
        this._spacing = normalizeBoxSpacing(next);
        this._applyChildren();
        this.notify({ eventName: 'notify::spacing', object: this });
    }

    /** `Gtk.Orientable:orientation` — `horizontal` (the default) or `vertical`. */
    get orientation(): BoxOrientation {
        return this._orientation;
    }

    set orientation(value: BoxOrientation) {
        // `Gtk.Orientation.VERTICAL` is 1 — a number from a GJS snippet — and the type names the
        // nicks an attribute carries; `normalizeBoxOrientation` is the shared reading of both.
        const next = normalizeBoxOrientation((value as unknown) === 1 ? 'vertical' : value);
        if (next === this._orientation) return;
        this._orientation = next;
        this._applyChildren();
        this.notify({ eventName: 'notify::orientation', object: this });
    }

    /** `Gtk.Box:homogeneous` — every child the same share of the axis (`*` tracks). */
    get homogeneous(): boolean {
        return this._homogeneous;
    }

    set homogeneous(value: boolean | string) {
        const next = xmlBoolean(value, this._homogeneous);
        if (next === this._homogeneous) return;
        this._homogeneous = next;
        this._applyChildren();
    }

    // --- layout ---

    private _childViews(): View[] {
        const views: View[] = [];
        for (let i = 0; i < this.getChildrenCount(); i++) views.push(this.getChildAt(i));
        return views;
    }

    private _applyOrder(op: 'insert-after' | 'reorder-after', view: View, sibling: View | null): boolean {
        const children = this._childViews();
        const next = resolveBoxChildOrder({ children, child: view, sibling, op });
        if (next === null) return false;
        // `insertChild` does not MOVE an existing child, so a reorder detaches first. An
        // insert never needs it — the resolver only accepted the child because it has no
        // parent in this box.
        if (children.includes(view)) this.removeChild(view);
        this.insertChild(view, next.indexOf(view));
        return true;
    }

    /** Re-plan when a child's `hexpand` / `vexpand` changes after it was added. */
    private _follow(view: View): void {
        if (this._followers.has(view)) return;
        const follower = () => this._applyChildren();
        this._followers.set(view, follower);
        view.addEventListener(NOTIFY_HEXPAND, follower);
        view.addEventListener(NOTIFY_VEXPAND, follower);
    }

    private _unfollow(view: View): void {
        const follower = this._followers.get(view);
        if (follower === undefined) return;
        view.removeEventListener(NOTIFY_HEXPAND, follower);
        view.removeEventListener(NOTIFY_VEXPAND, follower);
        this._followers.delete(view);
    }

    /**
     * Give every child its track and the box the track list that matches.
     *
     * The WHOLE set, not just the newcomer: adding a second child changes the FIRST one's
     * answer too when the box is re-ordered, and a removal shifts every index after it. The
     * track list is rebuilt only when it differs, because re-adding every `ItemSpec` makes
     * the platform re-measure.
     */
    private _applyChildren(): void {
        const vertical = this._orientation === 'vertical';
        const children = this._childViews();
        const expands = children.map((child) => {
            const flags = child as ExpandFlags;
            return (vertical ? flags.vexpand : flags.hexpand) === true;
        });
        const plan = boxTrackPlan(expands, this._spacing, this._homogeneous);
        const key = `${vertical ? 'v' : 'h'}${plan.map(({ unit, value }) => `${unit}${value}`).join(',')}`;
        if (key !== this._trackKey) {
            this._trackKey = key;
            this.removeColumns();
            this.removeRows();
            // The cross axis is one `*` track: a child's own `halign` / `valign` place it in it.
            const cross = () => new ItemSpec(1, 'star');
            const along = (add: (spec: ItemSpec) => void) => {
                for (const { unit, value } of plan) add(new ItemSpec(value, unit));
            };
            if (vertical) {
                this.addColumn(cross());
                along((spec) => this.addRow(spec));
            } else {
                this.addRow(cross());
                along((spec) => this.addColumn(spec));
            }
        }
        for (const [index, child] of children.entries()) {
            GridLayout.setColumn(child, vertical ? 0 : boxChildTrack(index));
            GridLayout.setRow(child, vertical ? boxChildTrack(index) : 0);
        }
    }
}
