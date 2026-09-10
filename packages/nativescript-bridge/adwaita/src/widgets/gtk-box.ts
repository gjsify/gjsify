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
// for another runtime (ADR 0034 § Amendment 14's `composition` kind). Three of those panes
// were a `StackLayout` standing in for a `Gtk.Box`. The class is thin on purpose — it
// EXTENDS the real `StackLayout` — and what it adds is exactly what the platform has no
// word for:
//
//   · `spacing`, which no NativeScript layout has (`Style` carries no `columnGap`/`rowGap`);
//     the gap comes out of the children's margins, per `box-layout.ts`;
//   · `append`/`prepend`/`remove`/`insert_child_after`/`reorder_child_after`, GTK's own
//     child verbs, with `gtk_widget_insert_after`'s NULL-means-FIRST rule;
//   · `add_css_class` and its siblings, the line every Adwaita snippet uses to give a
//     widget a look.
//
// `orientation` IS NOT DECLARED HERE, AND THAT IS DELIBERATE. `StackLayout.orientation`
// already takes `'horizontal' | 'vertical'` — the same two words `Gtk.Orientation`'s nicks
// are — so the convergent spelling is already the platform's own, and it is a NativeScript
// `Property`: an accessor of that name in a subclass SHADOWS the prototype accessor NS
// installed, and the native layout then never learns the axis. That is the `cssClasses`
// hazard `style-classes.ts` records, one property over. The box instead LISTENS for the
// `orientationChange` event NS's `Property` emits, so the gap moves to the other axis when
// the axis changes — the same convention `textChange` and `checkedChange` are read by
// elsewhere in this package.
//
// WHAT IT DOES NOT DO: `homogeneous`, `baseline-child` and `baseline-position` are declared
// gaps in `check-nativescript-widget-coverage.mjs`. A `StackLayout` measures each child at
// its natural size along the axis and has no equal-share mode, and NativeScript aligns
// boxes rather than text baselines — the same absence `gtk-align.ts` already declares for
// the three baseline members of `Gtk.Align`.
//
// Reference: refs/gtk gtk/gtkbox.c (GtkBox)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { StackLayout, type View } from '@nativescript/core';

import {
    boxChildMargin,
    boxSpacingChanges,
    DEFAULT_BOX_SPACING,
    normalizeBoxSpacing,
    resolveBoxChildOrder,
    type BoxOrientation,
} from './box-layout.js';
import { classNameWith, normalizeStyleClasses, withCssClass, withoutCssClass } from './style-classes.js';
import { xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

export { DEFAULT_BOX_SPACING };

export class GtkBox extends withSignals(StackLayout) {
    private _spacing = DEFAULT_BOX_SPACING;
    private _styleClasses: string[] = [];

    constructor(props?: ConstructProps<GtkBox>) {
        super();

        // NO BASE CLASS OF ITS OWN, so the constructor writes no `className` at all.
        // GTK's `box` is a CSS NAME, never a member of `css-classes`
        // (`gtk_widget_get_css_classes` on a fresh box answers `[]`), and there is no
        // Adwaita fill, radius or padding for a box to carry — the widgets inside it are
        // what libadwaita styles. So `className` holds exactly what a caller puts there,
        // and an untouched box leaves the property as NativeScript left it rather than
        // writing an empty string through the CSS engine.

        // The axis is NativeScript's own property (see the header), so the box hears
        // about a change rather than owning the setter. Re-applying the margins is the
        // whole reaction: the gap belongs on the leading edge of the NEW axis.
        this.addEventListener('orientationChange', () => this._applyChildren());

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
        this._applyChildren();
    }

    /** Remove a previously-added child — `gtk_box_remove`. */
    remove(view: View): void {
        this.removeChild(view);
        this._applyChildren();
    }

    /**
     * Every path a child can enter by — `append()`, a direct `addChild()`, and XML
     * inflation through `_addChildFromBuilder` — ends here, which is why the spacing is
     * applied here and not in `append()`. `AdwWrapBox` records the incident that rule
     * comes from: applied in `append()` only, a child declared in markup got no spacing
     * at all.
     */
    addChild(view: View): void {
        super.addChild(view);
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

    /**
     * `GtkWidget:css-classes`, spelled `styleClasses` — the platform owns `cssClasses` as a
     * live `Set`, and taking that name is fatal inside the widget's own constructor
     * (`style-classes.ts`). From XML it is a space-separated list, which is what an
     * attribute can carry: `<gtk:Box styleClasses="card" />`.
     */
    get styleClasses(): string[] {
        return [...this._styleClasses];
    }

    set styleClasses(value: string | null | undefined) {
        this._setClasses(normalizeStyleClasses(value));
    }

    // --- style classes, under GTK's own method names ---

    /** `gtk_widget_add_css_class`. A class the box already carries is a no-op. */
    add_css_class(name: string): void {
        this._setClasses(withCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_remove_css_class`. A class it does not carry is a no-op. */
    remove_css_class(name: string): void {
        this._setClasses(withoutCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_has_css_class`. */
    has_css_class(name: string): boolean {
        return this._styleClasses.includes((name ?? '').trim());
    }

    /** `gtk_widget_get_css_classes` — the list, without the widget's own CSS name. */
    get_css_classes(): string[] {
        return [...this._styleClasses];
    }

    /** `gtk_widget_set_css_classes` — REPLACES the list, as in C. */
    set_css_classes(names: readonly string[]): void {
        this._setClasses(normalizeStyleClasses([...names].join(' ')));
    }

    private _setClasses(classes: readonly string[]): void {
        this._styleClasses = [...classes];
        this.className = classNameWith('', this._styleClasses);
    }

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
        this._applyChildren();
        return true;
    }

    /**
     * Give every child its share of the gap.
     *
     * The WHOLE set, not just the newcomer: adding a second child changes the FIRST one's
     * answer too when the box is re-ordered, and a removal shifts every index after it.
     */
    private _applyChildren(): void {
        const orientation = (this.orientation ?? 'vertical') as BoxOrientation;
        const children = this._childViews();
        for (const [index, view] of children.entries()) {
            view.set('margin', boxChildMargin(index, this._spacing, orientation));
        }
    }
}
