// compute-expand.ts — `gtk_widget_compute_expand`: does a widget tree rooted here want spare space?
//
// GTK does not only read a widget's OWN `hexpand`: a widget that set none expands when one of
// its children does (gtkwidget.c:8387-8423, `gtk_widget_update_computed_expand`). An AdwBin
// whose child is an hexpand editor therefore grows in a horizontal box, where the `[hexpand]`
// rules in `_widget.scss` gave it nothing and the editor came out 0px wide.
//
// THREE RULES, all in the C:
//
//   · a widget that is not visible never expands (gtkwidget.c:8508-8509);
//   · an EXPLICIT value wins and stops the walk — `hexpand_set` is checked before the vfunc
//     runs, so an intermediate `hexpand: false` hides every expanding descendant;
//   · otherwise only a class with a `compute_expand` vfunc looks at its children at all. The
//     base GtkWidget has none, so a leaf (a label, a button's icon) never propagates.
//
// WHY JS AND NOT `:has()`: a selector cannot say "and no widget between here and there set
// hexpand" at arbitrary depth, it cannot tell a container with the vfunc from a leaf without
// one, and a registered subclass (`GObject.registerClass` over AdwBin) is a NEW tag that only
// the prototype chain links back to its base. So the value is computed here, and the box that
// needs it writes it as `data-computed-hexpand` / `data-computed-vexpand` on its children
// (gtk-box.ts) — internal state, never an authored attribute.
//
// The DOM has wrapper elements GTK has no widget for (`.adw-overlay-child`, a view stack's
// page `div`): those are transparent, the walk goes through them to the widgets inside.
//
// Reference: refs/gtk/gtk/gtkwidget.c (gtk_widget_compute_expand, update_computed_expand)
// Reference: refs/gtk/gtk/gtkbox.c:181-194 (every child, OR-ed)
// Reference: refs/gtk/gtk/gtkstack.c:2342-2373 (every page, visible or not)
// Reference: refs/gtk/gtk/gtkoverlay.c:292-301 (the main child only)
// Reference: refs/gtk/gtk/gtkscrolledwindow.c:544-554, gtkviewport.c:211-220 (the child only)
// Reference: refs/libadwaita/src/adw-widget-utils.c:501-536 (adw_widget_compute_expand)
// Copyright (c) The GTK Team. LGPLv2.1+. Copyright (c) The libadwaita authors. LGPLv2.1+.

export type ExpandOrientation = 'horizontal' | 'vertical';

/**
 * Per tag that has a `compute_expand` vfunc: the subtrees of its own that are NOT the children
 * the vfunc reads, and whether it answers on one axis only. A tag missing here behaves as the
 * base GtkWidget — it does not propagate.
 */
interface ExpandVfunc {
    readonly skip?: string;
    readonly horizontalOnly?: boolean;
}

/** `adw_widget_compute_expand` (adw-widget-utils.c:501), by the class_init that installs it. */
const ADW_WIDGET: ExpandVfunc = {};

const VFUNCS: ReadonlyMap<string, ExpandVfunc> = new Map<string, ExpandVfunc>([
    ['gtk-box', {}],
    ['gtk-stack', {}],
    // The overlay children are its children too, but `gtk_overlay_compute_expand` reads only `child`.
    ['gtk-overlay', { skip: '.adw-overlay-layer' }],
    // The scrollbars are children the vfunc skips; they are leaves, so skipping them is exact.
    ['gtk-scrolled-window', { skip: 'gtk-scrollbar' }],
    ['gtk-viewport', {}],
    ['adw-bin', ADW_WIDGET], // adw-bin.c:108
    ['adw-bottom-sheet', ADW_WIDGET], // adw-bottom-sheet.c:795
    ['adw-breakpoint-bin', ADW_WIDGET], // adw-breakpoint-bin.c:623
    ['adw-clamp', ADW_WIDGET], // adw-clamp.c:174
    ['adw-clamp-scrollable', ADW_WIDGET], // adw-clamp-scrollable.c:244
    ['adw-layout-slot', ADW_WIDGET], // adw-layout-slot.c:128
    ['adw-multi-layout-view', ADW_WIDGET], // adw-multi-layout-view.c:354
    ['adw-navigation-view', ADW_WIDGET], // adw-navigation-view.c:1900
    ['adw-overlay-split-view', ADW_WIDGET], // adw-overlay-split-view.c:909
    ['adw-status-page', ADW_WIDGET], // adw-status-page.c:213
    ['adw-toast-overlay', ADW_WIDGET], // adw-toast-overlay.c:543
    ['adw-toolbar-view', ADW_WIDGET], // adw-toolbar-view.c:525
    ['adw-view-stack', ADW_WIDGET], // adw-view-stack.c:1520
    ['adw-header-bar', { horizontalOnly: true }], // adw-header-bar.c:853
]);

const ATTRIBUTE: Record<ExpandOrientation, string> = { horizontal: 'hexpand', vertical: 'vexpand' };

/** The base tag whose vfunc `el` inherits — its own tag, or the one a registered subclass extends. */
function vfuncOf(el: Element): ExpandVfunc | undefined {
    const own = VFUNCS.get(el.localName);
    if (own !== undefined) return own;
    if (typeof customElements.getName !== 'function') return undefined;
    for (let proto = Object.getPrototypeOf(el); proto && proto !== HTMLElement.prototype;) {
        const tag = customElements.getName(proto.constructor as CustomElementConstructor);
        const found = tag === null ? undefined : VFUNCS.get(tag);
        if (found !== undefined) return found;
        proto = Object.getPrototypeOf(proto);
    }
    return undefined;
}

/**
 * A GTK widget, as opposed to a wrapper this renderer added: every element is a custom element,
 * and a plain element an author gave an expand value stands in for one.
 */
function isWidget(el: Element): boolean {
    return el.localName.includes('-') || el.hasAttribute('hexpand') || el.hasAttribute('vexpand');
}

/**
 * A view stack writes `hidden` on every page but the selected one. That is
 * `gtk_widget_set_child_visible` (adw-view-stack.c:1016-1023), not `GtkWidget:visible`, and
 * `gtk_widget_compute_expand` reads only the latter — so a background page still counts.
 */
function isStackPage(el: Element): boolean {
    return el.classList.contains('adw-view-stack-child') && el.parentElement?.localName === 'adw-view-stack';
}

/** The value of an authored `hexpand` / `vexpand`: `""` is true, `"false"` false, absent unset. */
export function explicitExpand(el: Element, orientation: ExpandOrientation): boolean | undefined {
    const raw = el.getAttribute(ATTRIBUTE[orientation]);
    return raw === null ? undefined : raw !== 'false';
}

/** `gtk_widget_compute_expand (el, orientation)`. */
export function computeExpand(el: Element, orientation: ExpandOrientation): boolean {
    if (el.hasAttribute('hidden') && !isStackPage(el)) return false;
    const explicit = explicitExpand(el, orientation);
    if (explicit !== undefined) return explicit;
    const vfunc = vfuncOf(el);
    if (vfunc === undefined) return false;
    if (vfunc.horizontalOnly && orientation === 'vertical') return false;
    return anyChildExpands(el, orientation, vfunc.skip);
}

/** The OR over the widget children of `parent`, reached through any wrapper that is not one. */
function anyChildExpands(parent: Element, orientation: ExpandOrientation, skip: string | undefined): boolean {
    for (const child of parent.children) {
        if (skip !== undefined && child.matches(skip)) continue;
        if (isWidget(child)) {
            if (computeExpand(child, orientation)) return true;
        } else if (anyChildExpands(child, orientation, undefined)) {
            return true;
        }
    }
    return false;
}
