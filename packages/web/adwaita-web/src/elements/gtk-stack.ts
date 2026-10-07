// <gtk-stack> — one visible child out of many, with an animated change between them:
// a settings panel, a wizard, an image viewer. It is the widget GtkStackSwitcher and
// GtkStackSidebar switch over, and the content half of GtkNotebook.
//
// THE CHILD IS THE PAGE. Upstream `GtkStackPage` is a GObject, not a widget
// (gtkstack.c:212-233, `struct _GtkStackPage`), so it has no element of its own: its six
// properties (gtkstack.c:499-573) are ATTRIBUTES on the child element and the page
// descriptor {@link GtkStackPageInfo} is what `getPage()` hands back. `child` — the one
// property that cannot be an attribute (gtkstack.c:501-507) — is the element itself.
//   name             — the child's `name` ATTRIBUTE, the id `visible-child-name` speaks
//   title            — `title` attribute; NULL (absent) means NO LABEL, never a fallback
//                      to `name`: `rebuild_child` builds no child at all when both title
//                      and icon-name are NULL (gtkstackswitcher.c:158-176)
//   icon-name        — `icon-name` attribute
//   needs-attention  — `needs-attention` attribute; the switcher puts a `.needs-attention`
//                      class on its button from it (gtkstackswitcher.c:203-206)
//   use-underline    — `use-underline` attribute, read by the switcher's label
//   visible          — NOT an attribute: the DOM's own `hidden`, which is the browser's
//                      spelling of GtkWidget:visible. This element reads `hidden` and
//                      never writes it — see the note on the render pass below.
//
// CSS NODES, PORTED VERBATIM (gtkstack.c:1067, :1564-1613):
//   stack[.transitioning]
//     ├── page.visible-page
//     └── page.visible-page.transitioning-in / .transitioning-out
// GTK paints every non-visible child by NOT allocating it; the browser half is
// `display: none` on everything but the visible page. During a transition both pages
// exist (`last_visible_child`, gtkstack.c:1509-1519), so both are laid out and the
// transition gives each one a direction.
//
// WHICH CHILD IS VISIBLE. `set_visible_child`'s guards, in order (gtkstack.c:1428-1586):
//   · a NULL child means "the FIRST VISIBLE one" (:1437-1450) — which is why hiding the
//     visible page falls back rather than blanking the stack (`update_child_visible`,
//     :3147-3153 calls it with NULL);
//   · the page's WIDGET must be visible as well as its own `visible` flag, else nothing
//     happens at all (:1591-1594, :2329-2332) — so `visible-child-name` naming a `hidden`
//     child is a no-op, not a blank stack;
//   · an unknown name is refused with a warning and NO change (:2323-2327), and a page
//     with no name is never matched (`:info->name != NULL &&`, :2314);
//   · the same page twice is not a change (:1452-1453), so no notify and no transition.
// Both `visible-child` and `visible-child-name` then notify (`:1564-1567`), in that order.
//
// TRANSITIONS. `transition-type` is one of the 23 nicks of `GtkStackTransitionType`
// (gtkstack.c:95-121); the CSS in `_stack.scss` implements each. Three decisions are C:
//   · the EFFECTIVE type, from `get_effective_transition_type` (gtkstack.c:1320-1390):
//     reduced motion turns every transition into a crossfade when the stack is
//     homogeneous on BOTH axes and into nothing when it is not (:1324-1335), and RTL
//     swaps the four left/right pairs and the two rotates (:1341-1371) while the
//     two-way types are left alone (they have no direction until the next decision);
//   · the DIRECTION of a two-way type, from `get_simple_transition_type` on whether the
//     incoming page sits AFTER the outgoing one (`i_first`, gtkstack.c:1540-1556) — the
//     browser reverses the animation instead of having a second set of keyframes;
//   · a direction-dependent type with NO outgoing page (a first page shown into an empty
//     stack) collapses to `none` (:1531-1535), exactly as C does.
// A transition runs only while the stack is on screen and animations are on (:1400-1401);
// `transition-duration` is the progress tracker's length (:1408-1411) and 0 means no
// animation at all (:1402-1403). `transition-running` is READ-ONLY and is reflected, so
// the stylesheet can key off it — C notifies it from the tick callback, once at the end
// (gtkstack.c:1284) and once when the ticks are unscheduled (:1314).
//
// HOMOGENEOUS. `gtk_stack_measure` measures ONLY the visible child on an axis the stack
// is homogeneous on, and the MAX over the rest otherwise (gtkstack.c:2899-2905); the
// browser analogue is the visible page filling the stack on a homogeneous axis and
// taking its own width on the other (see `_stack.scss`).
//
// A11Y: `role="group"`, GtkStack's own accessible role (gtkstack.c:1068), and the
// non-visible pages carry `aria-hidden="true"` — `gtk_accessible_update_state
// (…, GTK_ACCESSIBLE_STATE_HIDDEN, …)` on the PAGE (gtkstack.c:1526-1532, :1543-1547,
// :1610-1613).
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on every
// real change; `items-changed` and `selection-changed` (bubbles, detail
// `{ position, removed, added }` / `{ position, nItems }`) are the `pages` model of
// gtkstack.c:698-745 speaking as DOM events instead of as a GtkSelectionModel;
// `page-updated` (bubbles, detail `{ child }`) is GtkStackPage's own `notify`, which
// `on_page_updated` binds a switcher to (gtkstackswitcher.c:311-321); `transition-start`
// (detail `{ duration }`) and `transition-end` are the widget's two signals
// (gtkstack.c:1420, :1587).
//
// NOT PORTED, and why — properties an attribute cannot carry, not behaviour left out:
//   · `visible-child` (gtkstack.c:1005-1012) takes a Gtk.Widget, and the browser has no
//     widget values; `visible-child-name` (:1014-1021) is the same selection by name and
//     IS implemented. `visibleChild` returns the child ELEMENT for the same selection.
//   · `pages` (:1055-1060) is a GtkSelectionModel; the browser half is `pages` (the page
//     descriptors), `items-changed`, `selection-changed` and `isSelected()`.
//   · `GtkStackPage:child` (gtkstack.c:501-507) is construct-only and is the child node.
//   · `gtk_stack_set_visible_child_full` (:2306-2334) takes a per-call transition; the
//     browser half is `setVisibleChild(child, transitionType?)`.
//
// Reference: refs/gtk/gtk/gtkstack.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { DispatchedSignals } from '../signals.js';

/** `GtkStackTransitionType`, spelled as the GIR's enum nicks (gtkstack.c:95-121). */
export type StackTransitionType =
    | 'none'
    | 'crossfade'
    | 'slide-right'
    | 'slide-left'
    | 'slide-up'
    | 'slide-down'
    | 'slide-left-right'
    | 'slide-up-down'
    | 'over-up'
    | 'over-down'
    | 'over-left'
    | 'over-right'
    | 'under-up'
    | 'under-down'
    | 'under-left'
    | 'under-right'
    | 'over-up-down'
    | 'over-down-up'
    | 'over-left-right'
    | 'over-right-left'
    | 'rotate-left'
    | 'rotate-right'
    | 'rotate-left-right';

const TRANSITION_TYPES: readonly string[] = [
    'none',
    'crossfade',
    'slide-right',
    'slide-left',
    'slide-up',
    'slide-down',
    'slide-left-right',
    'slide-up-down',
    'over-up',
    'over-down',
    'over-left',
    'over-right',
    'under-up',
    'under-down',
    'under-left',
    'under-right',
    'over-up-down',
    'over-down-up',
    'over-left-right',
    'over-right-left',
    'rotate-left',
    'rotate-right',
    'rotate-left-right',
];

/**
 * The types whose direction depends on WHERE the incoming page sits (gtkstack.c:1539-1556):
 * `get_simple_transition_type` resolves them to the one-directional type before the
 * animation starts. `slide-left-right`, `slide-up-down`, `over-*-*` and `rotate-left-right`.
 */
const DIRECTION_DEPENDENT = new Set([
    'slide-left-right',
    'slide-up-down',
    'over-up-down',
    'over-down-up',
    'over-left-right',
    'over-right-left',
    'rotate-left-right',
]);

/**
 * The RTL swaps of `get_effective_transition_type` (gtkstack.c:1341-1371): four pairs,
 * and nothing else — the two-way types fall through `default:` unchanged, because they
 * have no direction until `get_simple_transition_type` gives them one.
 */
const RTL_SWAP: Readonly<Record<string, StackTransitionType>> = {
    'slide-left': 'slide-right',
    'slide-right': 'slide-left',
    'rotate-left': 'rotate-right',
    'rotate-right': 'rotate-left',
    'over-left': 'over-right',
    'over-right': 'over-left',
    'under-left': 'under-right',
    'under-right': 'under-left',
};

/**
 * `get_simple_transition_type` (gtkstack.c:1162-1200), transcribed pair by pair. The
 * result is one of the ONE-DIRECTIONAL types, so the stylesheet needs one rule each and
 * no direction attribute of its own.
 */
function simpleTransitionType(newChildFirst: boolean, type: StackTransitionType): StackTransitionType {
    switch (type) {
        case 'slide-left-right':
            return newChildFirst ? 'slide-right' : 'slide-left';
        case 'rotate-left-right':
            return newChildFirst ? 'rotate-right' : 'rotate-left';
        case 'slide-up-down':
            return newChildFirst ? 'slide-down' : 'slide-up';
        // The two-way OVER types resolve to UNDER when the new page comes first: the page
        // that moves is the one already on screen in either case.
        case 'over-up-down':
            return newChildFirst ? 'under-down' : 'over-up';
        case 'over-down-up':
            return newChildFirst ? 'under-up' : 'over-down';
        case 'over-left-right':
            return newChildFirst ? 'under-right' : 'over-left';
        case 'over-right-left':
            return newChildFirst ? 'under-left' : 'over-right';
        default:
            return type;
    }
}

/** The browser's page descriptor — the stand-in for the `GtkStackPage` GObject. */
export interface GtkStackPageInfo {
    /** `GtkStackPage:name`, `''` for a page with no `name` attribute. */
    name: string;
    /** `GtkStackPage:title` — `null` when absent, which is C's NULL and means NO label. */
    title: string | null;
    /** `GtkStackPage:icon-name` — `null` when absent. */
    iconName: string | null;
    /** `GtkStackPage:needs-attention`. */
    needsAttention: boolean;
    /** `GtkStackPage:use-underline`. */
    useUnderline: boolean;
    /** `GtkStackPage:visible` AND `GtkWidget:visible` — the child's `hidden` attribute. */
    visible: boolean;
    /** `GtkStackPage:child`: the page's own node. */
    child: HTMLElement;
}

/** The five `GtkStackPage` string/boolean properties this element reads off a child. */
const PAGE_ATTRIBUTES = ['name', 'title', 'icon-name', 'use-underline', 'needs-attention'];

export class GtkStack extends HTMLElement {
    /** The GTK signals this element dispatches, each with the DOM event it arrives as (ADR 0093). */
    static readonly signals: DispatchedSignals = { 'notify::visible-child-name': 'notify::visible-child-name' };

    /** The child that is visible, or `null` — C's `priv->visible_child`. */
    private _visible: HTMLElement | null = null;
    /** C's `priv->last_visible_child`: the page being animated away. */
    private _lastVisible: HTMLElement | null = null;
    private _initialized = false;
    private _initializedChildren = new WeakSet<HTMLElement>();
    private _observer: MutationObserver | null = null;
    private _timer: ReturnType<typeof setTimeout> | null = null;
    private _running = false;

    static get observedAttributes() {
        return [
            'visible-child-name',
            'transition-type',
            'transition-duration',
            'hhomogeneous',
            'vhomogeneous',
            'interpolate-size',
        ];
    }

    /** `Gtk.Stack:visible-child-name` — the name of the visible child. */
    get visibleChildName(): string | null {
        return this.getAttribute('visible-child-name');
    }

    set visibleChildName(v: string | null) {
        this._write('visible-child-name', v);
    }

    /**
     * `Gtk.Stack:visible-child` as the browser can spell it: the visible child ELEMENT
     * (the C property takes a `Gtk.Widget`, which no attribute can carry). Writes go
     * through the child's own `name`, so it is `visible-child-name` that is read back.
     */
    get visibleChild(): HTMLElement | null {
        return this._visible;
    }

    set visibleChild(child: HTMLElement | null) {
        this.setVisibleChild(child);
    }

    /** `Gtk.Stack:transition-type`. An unknown nick reads as `none`, the GIR default. */
    get transitionType(): StackTransitionType {
        const raw = this.getAttribute('transition-type');
        return raw !== null && TRANSITION_TYPES.includes(raw) ? (raw as StackTransitionType) : 'none';
    }

    set transitionType(v: StackTransitionType) {
        this._write('transition-type', v);
    }

    /** `Gtk.Stack:transition-duration` in milliseconds. `0` disables the animation. */
    get transitionDuration(): number {
        return this._duration();
    }

    set transitionDuration(v: number) {
        this._write('transition-duration', String(v));
    }

    /**
     * `Gtk.Stack:hhomogeneous` — the same width for every child. Defaults to TRUE
     * (gtkstack.c:981-987), which is why this one is NOT a boolean attribute: an absent
     * attribute already means true, so the spelling has to be able to say false.
     */
    get hhomogeneous(): boolean {
        return this._flag('hhomogeneous', true);
    }

    set hhomogeneous(v: boolean) {
        this._write('hhomogeneous', v ? '' : 'false');
    }

    /** `Gtk.Stack:vhomogeneous` — the same height for every child. Defaults to TRUE. */
    get vhomogeneous(): boolean {
        return this._flag('vhomogeneous', true);
    }

    set vhomogeneous(v: boolean) {
        this._write('vhomogeneous', v ? '' : 'false');
    }

    /** `Gtk.Stack:interpolate-size` — let the size change smoothly too. */
    get interpolateSize(): boolean {
        return this.hasAttribute('interpolate-size');
    }

    set interpolateSize(v: boolean) {
        this.toggleAttribute('interpolate-size', !!v);
    }

    /** `Gtk.Stack:transition-running` — READ-ONLY; reflected for the stylesheet. */
    get transitionRunning(): boolean {
        return this.hasAttribute('transition-running');
    }

    /**
     * `Gtk.Stack:pages` — the page descriptors in child order, the browser half of the
     * `GtkStackPages` selection model (gtkstack.c:698-745).
     */
    get pages(): GtkStackPageInfo[] {
        return this._children().map((child) => this._page(child));
    }

    /** `gtk_stack_get_child_by_name` (gtkstack.c:1889-1916), `null` when not found. */
    getChildByName(name: string): HTMLElement | null {
        return this._children().find((child) => this._page(child).name === name) ?? null;
    }

    /** `gtk_stack_get_page` (gtkstack.c:1870-1887) as a descriptor, `null` when absent. */
    getPage(child: HTMLElement): GtkStackPageInfo | null {
        return this._children().includes(child) ? this._page(child) : null;
    }

    /** `gtk_stack_pages_is_selected` (gtkstack.c:647-666) for the model this element is. */
    isSelected(child: HTMLElement): boolean {
        return this._visible === child;
    }

    /** `gtk_stack_add_titled` (gtkstack.c:1644-1663) — append a named, titled child. */
    addTitled(child: HTMLElement, name: string | null, title?: string | null): HTMLElement {
        if (name !== null) child.setAttribute('name', name);
        if (title !== undefined && title !== null) child.setAttribute('title', title);
        return this.addChild(child);
    }

    /** `gtk_stack_add_named` (gtkstack.c:1687-1696). */
    addNamed(child: HTMLElement, name: string | null): HTMLElement {
        return this.addTitled(child, name);
    }

    /** `gtk_stack_add_child` (gtkstack.c:1665-1685) — the unnamed form. */
    addChild(child: HTMLElement): HTMLElement {
        this.appendChild(child);
        this._initChild(child);
        // `gtk_stack_add_page`'s tail (gtkstack.c:1773-1775): a page added while NOTHING
        // is visible becomes the visible one. C reads the widget's own visibility; on the
        // browser the child is not `hidden` yet, unless the author said so.
        if (this._initialized && !this._visible && !child.hasAttribute('hidden')) this._show(child);
        return child;
    }

    /**
     * `gtk_stack_remove` (gtkstack.c:1834-1868), named `removePage` because
     * `HTMLElement.remove()` already occupies the short spelling — the same rename
     * `Adw.ViewStack.remove` took in `adw-view-stack.ts`.
     */
    removePage(child: HTMLElement): void {
        child.remove();
    }

    /**
     * `gtk_stack_set_visible_child` (gtkstack.c:2244-2281), with `gtk_stack_set_visible_
     * child_full`'s per-call transition (gtkstack.c:2306-2334). A child that is not in
     * this stack, or whose page is not visible, changes nothing — C warns and returns.
     */
    setVisibleChild(child: HTMLElement | null, transitionType?: StackTransitionType): boolean {
        if (!child) {
            // `set_visible_child (stack, NULL)` is the first-visible scan (gtkstack.c:1437).
            return this._show(this._firstVisible(), transitionType);
        }
        if (!this._children().includes(child)) return false;
        return this._show(child, transitionType);
    }

    /** `gtk_stack_set_visible_child_name` (gtkstack.c:2283-2304). */
    setVisibleChildName(name: string | null): boolean {
        if (name === null) return false;
        const child = this._children().find((page) => this._page(page).name === name);
        // An unknown name is refused with NO change (gtkstack.c:2323-2327); a page with no
        // name is never matched at all (`:info->name != NULL &&`, :2314).
        if (!child) return false;
        return this._show(child);
    }

    connectedCallback() {
        if (this._initialized) {
            this._render();
            return;
        }
        this._initialized = true;
        this.setAttribute('role', 'group');
        for (const child of this._children()) this._initChild(child);
        // `add_page` connects the stack to each page's `notify::visible`
        // (gtkstack.c:1771), which is the browser's mutation observer.
        this._observer = new MutationObserver((records) => this._onChildMutations(records));
        this._observer.observe(this, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [...PAGE_ATTRIBUTES, 'hidden'],
        });
        // Adding the FIRST visible page makes it the visible one (gtkstack.c:1773-1775).
        if (!this._visible) this._show(this._firstVisible());
        this._render();
    }

    disconnectedCallback() {
        this._observer?.disconnect();
        this._observer = null;
        if (this._timer !== null) clearTimeout(this._timer);
        this._timer = null;
        // The observer is re-created in the guarded branch of `connectedCallback`, and a
        // re-parent runs it again with `_initialized` already set — so dropping the flag
        // here is what makes the second connect take that branch rather than the build
        // branch. The same shape `adw-source-view` uses.
        this._initialized = false;
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'visible-child-name') {
            this.setVisibleChildName(this.getAttribute('visible-child-name'));
            return;
        }
        this._render();
        this._notify(name);
    }

    /**
     * The `notify::` detail for `name`: the PROPERTY, parsed, not the raw attribute —
     * `transition-type` in particular reads as `none` for an unknown nick.
     */
    private _property(name: string): string | number | boolean | null {
        switch (name) {
            case 'transition-type':
                return this.transitionType;
            case 'transition-duration':
                return this.transitionDuration;
            case 'hhomogeneous':
                return this.hhomogeneous;
            case 'vhomogeneous':
                return this.vhomogeneous;
            case 'interpolate-size':
                return this.interpolateSize;
            default:
                return this.visibleChildName;
        }
    }

    private _notify(name: string): void {
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    private _write(name: string, value: string | null): void {
        if (value === null) this.removeAttribute(name);
        else if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    /** A boolean property that DEFAULTS TO TRUE: absent means true, like C's spec. */
    private _flag(name: string, fallback: boolean): boolean {
        const raw = this.getAttribute(name);
        if (raw === null) return fallback;
        return raw !== 'false';
    }

    /**
     * `Gtk.Stack:transition-duration`, the `g_param_spec_uint` default of 200
     * (gtkstack.c:1024). An unparseable or negative value is the uint clamp to 0 that
     * the property's own range produces (gtkstack.c:1051-1060), and 0 is what stops the
     * transition from starting at all (gtkstack.c:1402-1403).
     */
    private _duration(): number {
        const raw = this.getAttribute('transition-duration');
        if (raw === null) return 200;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    /** The pages, in child order — `priv->children`, never the shadow root. */
    private _children(): HTMLElement[] {
        return Array.from(this.children) as HTMLElement[];
    }

    /** The page descriptor of one child (gtkstack.c:499-573). */
    private _page(child: HTMLElement): GtkStackPageInfo {
        return {
            name: child.getAttribute('name') ?? '',
            title: child.getAttribute('title'),
            iconName: child.getAttribute('icon-name'),
            useUnderline: child.hasAttribute('use-underline'),
            needsAttention: child.hasAttribute('needs-attention'),
            // `hidden` is the browser's GtkWidget:visible, and `GtkStackPage:visible` is
            // the SAME state here (update_child_visible's `page->visible && widget
            // visible`, gtkstack.c:3145) — so the attribute is the whole of it.
            visible: !child.hasAttribute('hidden'),
            child,
        };
    }

    /** `set_visible_child`'s "pick first visible" scan (gtkstack.c:1437-1450). */
    private _firstVisible(): HTMLElement | null {
        return this._children().find((child) => this._page(child).visible) ?? null;
    }

    private _initChild(child: HTMLElement): void {
        if (this._initializedChildren.has(child)) return;
        this._initializedChildren.add(child);
        child.classList.add('adw-stack-page');
    }

    private _onChildMutations(records: MutationRecord[]): void {
        let added = 0;
        let removed = 0;
        let position = -1;
        let pageUpdated = false;
        for (const record of records) {
            if (record.type === 'childList') {
                for (const node of Array.from(record.removedNodes)) {
                    if (node === this._visible) this._visible = null;
                    if (node === this._lastVisible) this._lastVisible = null;
                    removed += 1;
                }
                for (const node of Array.from(record.addedNodes)) {
                    if (!(node instanceof HTMLElement)) continue;
                    this._initChild(node);
                    added += 1;
                    if (position === -1) position = this._children().indexOf(node);
                }
                continue;
            }
            const name = record.attributeName;
            if (!name) continue;
            if (name === 'hidden') {
                // `stack_child_visibility_notify_cb` (gtkstack.c:1617-1633) re-runs
                // `update_child_visible`: hiding the visible page falls back to the first
                // visible one (which is what the NULL means, :1437-1450), and showing one
                // while none is visible picks it up (:3147-3149).
                this._show(this._firstVisible());
                continue;
            }
            if (PAGE_ATTRIBUTES.includes(name)) pageUpdated = true;
        }
        if (removed > 0 || added > 0) {
            this.dispatchEvent(
                new CustomEvent('items-changed', {
                    bubbles: true,
                    detail: { position: position === -1 ? this._children().length : position, removed, added },
                }),
            );
        }
        if (pageUpdated) {
            for (const record of records) {
                if (record.type !== 'attributes') continue;
                const target = record.target as HTMLElement;
                this.dispatchEvent(new CustomEvent('page-updated', { bubbles: true, detail: { child: target } }));
                // `gtk_stack_page_set_name` re-notifies `visible-child-name` when the
                // renamed page IS the visible one (gtkstack.c:3169-3171) — the selection
                // did not move, but the name it is addressed by did.
                if (target === this._visible && record.attributeName === 'name') {
                    this._write('visible-child-name', this._nameOrNull(this._page(target).name));
                    this.dispatchEvent(
                        new CustomEvent('notify::visible-child-name', {
                            bubbles: true,
                            detail: { 'visible-child-name': this.visibleChildName },
                        }),
                    );
                }
            }
            this._render();
        }
    }

    /** C's NULL page name is an ABSENT attribute, not the empty string (gtkstack.c:2216). */
    private _nameOrNull(name: string): string | null {
        return name === '' ? null : name;
    }

    /**
     * `set_visible_child` (gtkstack.c:1428-1586) reduced to what a browser can decide,
     * with the guards kept in C's order. Returns whether the visible child changed.
     */
    private _show(child: HTMLElement | null, transitionType?: StackTransitionType): boolean {
        if (!child) return false;
        const page = this._page(child);
        // The page's WIDGET must be visible, else C does nothing at all (gtkstack.c:1591).
        if (!page.visible) return false;
        if (this._visible === child) return false;

        const previous = this._visible;
        this._visible = child;
        // The name of the page the selection is BY, kept on the element so a switcher and
        // the host agree without re-walking the children (gtkstack.c:2216-2224).
        this._write('visible-child-name', this._nameOrNull(page.name));
        this._lastVisible = previous;
        this._render();

        // Both properties notify, visible-child FIRST (gtkstack.c:1564-1567).
        this.dispatchEvent(
            new CustomEvent('notify::visible-child', { bubbles: true, detail: { 'visible-child': child } }),
        );
        this.dispatchEvent(
            new CustomEvent('notify::visible-child-name', {
                bubbles: true,
                detail: { 'visible-child-name': this.visibleChildName },
            }),
        );
        if (previous) {
            const position = Math.min(this._children().indexOf(previous), this._children().indexOf(child));
            this.dispatchEvent(
                new CustomEvent('selection-changed', { bubbles: true, detail: { position, nItems: 2 } }),
            );
        } else {
            this.dispatchEvent(
                new CustomEvent('selection-changed', {
                    bubbles: true,
                    detail: { position: this._children().indexOf(child), nItems: 1 },
                }),
            );
        }

        this._startTransition(previous, transitionType ?? this.transitionType);
        return true;
    }

    /**
     * `gtk_stack_start_transition` (gtkstack.c:1389-1426) with
     * `get_effective_transition_type` (gtkstack.c:1320-1390) and, for a two-way type,
     * `get_simple_transition_type` on the page ORDER (gtkstack.c:1539-1561,
     * :1162-1200). The result is always a SIMPLE type, which is what the stylesheet
     * keys on — C resolves the two-way pair into one of the one-directional types
     * before the animation starts, and so does this.
     */
    private _startTransition(outgoing: HTMLElement | null, requested: StackTransitionType): void {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        let type = this._effectiveType(requested);
        // A direction-dependent type with NO outgoing page collapses to none
        // (gtkstack.c:1541-1545).
        if (DIRECTION_DEPENDENT.has(type) && !outgoing) type = 'none';
        else if (DIRECTION_DEPENDENT.has(type) && outgoing) {
            type = simpleTransitionType(this._newChildFirst(outgoing), type);
        }
        // `transition_duration != 0` is one half of the branch that starts the tracker at
        // all (gtkstack.c:1402-1403), so a zero duration is as still as `none` — the
        // other half is `effective_transition_type != NONE`.
        if (type === 'none' || !outgoing || this._duration() === 0) {
            this._running = false;
            this.removeAttribute('transition-running');
            this.classList.remove('transitioning');
            this._lastVisible = null;
            this._render();
            return;
        }
        this.dataset.transitionType = type;
        this._running = true;
        this.setAttribute('transition-running', '');
        this.classList.add('transitioning');
        this._render();
        this.dispatchEvent(
            new CustomEvent('transition-start', { bubbles: true, detail: { duration: this._duration() } }),
        );
        this._timer = setTimeout(() => {
            this._timer = null;
            this._running = false;
            this.removeAttribute('transition-running');
            this.classList.remove('transitioning');
            delete this.dataset.transitionType;
            this._lastVisible = null;
            this._render();
            this.dispatchEvent(new CustomEvent('transition-end', { bubbles: true }));
        }, this._duration());
    }

    /**
     * `i_first` (gtkstack.c:1548-1557): whether the incoming page was ADDED EARLIER than
     * the outgoing one. C walks the children from the start and breaks on whichever it
     * meets first, so the answer is a comparison of positions.
     */
    private _newChildFirst(outgoing: HTMLElement): boolean {
        const children = this._children();
        return children.indexOf(this._visible as HTMLElement) < children.indexOf(outgoing);
    }

    /** `get_effective_transition_type` (gtkstack.c:1320-1390): reduced motion, then RTL. */
    private _effectiveType(requested: StackTransitionType): StackTransitionType {
        let type = requested;
        if (type !== 'none') {
            if (this._reducedMotion()) {
                // Homogeneous on BOTH axes keeps a crossfade; otherwise there is nothing
                // to animate (gtkstack.c:1327-1334).
                type = this.hhomogeneous && this.vhomogeneous ? 'crossfade' : 'none';
            } else if (this.getAttribute('dir') === 'rtl') {
                type = RTL_SWAP[type] ?? type;
            }
        }
        return type;
    }

    /** `gtk_widget_get_settings`'s `gtk-interface-reduced-motion`, read from the media query. */
    private _reducedMotion(): boolean {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * The render pass: which page is visible, which is animating out, and the two
     * `aria-hidden` states GTK raises on the PAGES (gtkstack.c:1526-1532, :1543-1547,
     * :1610-1613). `hidden` is never written — it is the author's own
     * `GtkStackPage:visible`, and overwriting it would destroy the distinction C keeps
     * between the page flag and the widget's own visibility.
     */
    private _render(): void {
        if (!this._initialized) return;
        for (const child of this._children()) {
            const visible = child === this._visible;
            child.classList.toggle('visible-page', visible);
            child.classList.toggle('transitioning-in', visible && this._running);
            child.classList.toggle('transitioning-out', !visible && child === this._lastVisible && this._running);
            if (visible) child.removeAttribute('aria-hidden');
            else child.setAttribute('aria-hidden', 'true');
        }
        this.style.setProperty('--stack-transition-duration', `${this._duration()}ms`);
    }
}

customElements.define('gtk-stack', GtkStack);
