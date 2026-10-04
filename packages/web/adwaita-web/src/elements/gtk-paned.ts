// <gtk-paned> — two children either side of a divider the user drags.
//
// EIGHT attributes, and the two that matter are a pair rather than a set:
//
//   position        the divider, in pixels from the leading edge. This is
//                   `start_child_size`, and it is what `gtk_paned_get_position` returns
//                   (gtkpaned.c:1855-1863).
//   position-set    GTK's READ-ONLY flag, and it is not the inverse of a missing
//                   `position`: `gtk_paned_set_position` raises it on any write of a
//                   non-negative value and lowers it on a write of -1, which means "let
//                   the size requests decide" (gtkpaned.c:1874-1910). So `position = -1`
//                   is how the divider goes back to being derived, and once the element
//                   owns the flag an author cannot move it by writing the attribute — they
//                   write `position`, which is the only door into it.
//   wide-handle     the stronger visual separation, and the only other boolean.
//
// `resize-start-child` / `resize-end-child` and `shrink-start-child` / `shrink-end-child`
// all default to TRUE in the pspec (gtkpaned.c:436-470), which a presence-attribute cannot
// express — so the house rule for a default-true boolean applies and `"false"` is how one
// is turned off, exactly as `<adw-navigation-view can-pop>` reads it.
//
// `min-position` and `max-position` are NOT observed, and the reason is that they are not
// authors' values: `GtkPaned` implements `GtkAccessibleRange` and both come OUT of the
// same computation that places the divider (`gtk_paned_compute_position`,
// gtkpaned.c:1092-1146, writing them at :1921-1948). So they are read-only getters here
// and reach assistive technology as the handle's `aria-valuemin` / `aria-valuemax`, the
// same place GTK puts them (gtkpaned.c:1446-1453). `position` IS observed even though the
// C's setter would refuse to clamp it: "We don't clamp here", because a position written
// together with a new total size refers to the new size, and `compute_position` clamps on
// allocation.
//
// WHERE THE DIVIDER GOES IS `gtk_paned_calc_position` (gtkpaned.c:1021-1053, calling
// `gtk_paned_compute_position` at :1092-1146), PORTED AS A FUNCTION and not delegated to
// flexbox, because the two disagree on the DEFAULT case. With both children resizable and
// no position set, the C divides the paned in proportion to the two size REQUESTS
// (`allocation * start_req / (start_req + end_req)`); flexbox with `flex-grow: 1` on both
// divides it in HALF. So the element measures each child's size request by pinning it to
// `flex: none` for one read, runs the C's arithmetic, and writes the result as the start
// pane's `flex-basis` with no growth — which is then exactly the C's allocation:
// `start_child_allocation.width = MAX (1, start_child_size)` and
// `end_child_allocation.width = MAX (1, width - start_child_size - handle_size)`
// (gtkpaned.c:1350-1355).
//
// The panes are visible only when they have room — `gtk_widget_set_child_visible
// (start_child, start_child_size != 0)`, and the end child against the whole allocation
// (gtkpaned.c:1940-1941) — and the HANDLE is hidden outright when one of them is missing,
// which is the C's "No separator is drawn if one of the children is missing"
// (gtkpaned.c:70). `>= 1` rather than `> 0` is GTK's `MAX (1, …)` on the allocation.
//
// THE HANDLE is a `GtkPanedHandle`, which is NOT a `GtkSeparator`: it shares the CSS NAME
// `separator` (gtkpanedhandle.c:88) and nothing else, which is why libadwaita's
// `paned > separator` rule can say `background: none` while `<gtk-separator>`'s own partial
// paints a fill. So the handle is a plain box carrying the `separator` class and libadwaita's
// `_paned.scss` styles it as upstream does. Its hit area reaches `HANDLE_EXTRA_SIZE` past
// the node on every side unless the handle is wide (`gtk_paned_handle_contains`,
// gtkpanedhandle.c:60-73) — see `_paned.scss`.
//
// A11Y: the HANDLE is the operable thing, so it is the `role="separator"` window splitter
// with `aria-valuenow` / `valuemin` / `valuemax` and `tabindex="0"`. GTK gives the paned no
// role of its own and hangs the value on it; ARIA wants the value on the element carrying
// the role, so the value sits on the handle and the host is a `group`.
//
// Reference: refs/gtk/gtk/gtkpaned.c (every property, calc_position, move_handle, update_drag)
// Reference: refs/gtk/gtk/gtkpanedhandle.c (the handle node, HANDLE_EXTRA_SIZE)
// Reference: refs/libadwaita/src/stylesheet/widgets/_paned.scss
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { glibClamp, normalizeBoxOrientation, type BoxOrientation } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';

/** `gtkpaned.c:131` — `HANDLE_EXTRA_SIZE`, how far the hit area reaches past the node. */
const HANDLE_EXTRA_SIZE = 6;

/** `gtkpaned.c:2290-2292` — `SINGLE_STEP_SIZE` and `PAGE_STEP_SIZE` for `move_handle`. */
const SINGLE_STEP_SIZE = 1;
const PAGE_STEP_SIZE = 75;

/** `Gtk.AccessibleRange`'s `VALUE_MIN`, the one bound GTK writes literally (gtkpaned.c:1447). */
const DEFAULT_MIN_POSITION = 0;

/** The inputs of `gtk_paned_compute_position`, one per field it reads. */
export interface PanedPositionInput {
    /** The paned's own allocation along the axis, minus the handle — its `allocation`. */
    allocation: number;
    /** The start child's size REQUEST along the axis. */
    startRequest: number;
    /** The end child's size REQUEST along the axis. */
    endRequest: number;
    resizeStart: boolean;
    resizeEnd: boolean;
    shrinkStart: boolean;
    shrinkEnd: boolean;
    /** `position_set` — whether the app or the user has placed the divider. */
    positionSet: boolean;
    /** `start_child_size` — the divider as last allocated or set; `0` when unset. */
    startChildSize: number;
    /** `last_allocation` — what `startChildSize` was measured against. */
    lastAllocation: number;
}

/** What `gtk_paned_compute_position` writes back through its three out-parameters. */
export interface PanedPosition {
    min: number;
    max: number;
    position: number;
}

/**
 * `gtk_paned_compute_position` (gtkpaned.c:1092-1146), statement for statement.
 *
 * Exported so a spec can pin the arithmetic without a layout. The branch keyed on
 * `lastAllocation` is the one a browser cannot reach on its own — there is no "position was
 * set before the first allocation" moment in a flex layout — so it is the piece only a table
 * of inputs can hold.
 */
export function computePanedPosition(input: PanedPositionInput): PanedPosition {
    const { allocation, startRequest, endRequest, resizeStart, resizeEnd, shrinkStart, shrinkEnd } = input;

    // min = paned->shrink_start_child ? 0 : start_child_req;
    const min = shrinkStart ? 0 : startRequest;

    // max = allocation; if (!shrink_end_child) max = MAX (1, max - end_child_req);
    // max = MAX (min, max);
    let max = allocation;
    if (!shrinkEnd) max = Math.max(1, max - endRequest);
    max = Math.max(min, max);

    let position: number;
    if (!input.positionSet) {
        if (resizeStart && !resizeEnd) {
            position = Math.max(0, allocation - endRequest);
        } else if (!resizeStart && resizeEnd) {
            position = startRequest;
        } else if (startRequest + endRequest !== 0) {
            // `+ 0.5` is the C's round-to-nearest, kept so an odd remainder lands where GTK
            // lands instead of always rounding down.
            position = allocation * (startRequest / (startRequest + endRequest)) + 0.5;
        } else {
            position = allocation * 0.5 + 0.5;
        }
    } else if (input.lastAllocation > 0) {
        // "If the position was set before the initial allocation … just clamp it and leave
        // it", so the growth branch only runs once there IS an allocation to scale from.
        if (resizeStart && !resizeEnd) {
            position = input.startChildSize + allocation - input.lastAllocation;
        } else if (!(!resizeStart && resizeEnd)) {
            position = allocation * (input.startChildSize / input.lastAllocation) + 0.5;
        } else {
            position = input.startChildSize;
        }
    } else {
        position = input.startChildSize;
    }

    // The C's `pos` is an `int`, so every assignment truncates — which is what makes the
    // `+ 0.5` a round-to-nearest rather than a bias — and `pos = CLAMP (pos, min, max)` runs
    // on the truncated value. Truncating once here is the same statement, because every
    // branch but the two proportional ones already produces an integer.
    position = Math.trunc(position);
    return { min, max, position: glibClamp(position, min, max) };
}

export class GtkPaned extends HTMLElement {
    private _startEl!: HTMLDivElement;
    private _handleEl!: HTMLDivElement;
    private _endEl!: HTMLDivElement;
    private _initialized = false;
    /** `start_child_size` — the divider. `-1` is GTK's "unset". */
    private _position = -1;
    /** `position_set` — GTK's read-only flag; see the header. */
    private _positionSet = false;
    /** What `gtk_paned_compute_position` last produced for `min_position`. */
    private _minPosition = DEFAULT_MIN_POSITION;
    /** …and for `max_position`. */
    private _maxPosition = Number.MAX_SAFE_INTEGER;
    /** `last_allocation` — the allocation the current position was computed against. */
    private _lastAllocation = 0;
    /** `drag_pos` — where inside the handle the gesture began (gtkpaned.c:930-940). */
    private _dragPos = 0;
    private _dragging = false;
    private _resize: ResizeObserver | null = null;

    static get observedAttributes() {
        return [
            'orientation',
            'position',
            'position-set',
            'resize-start-child',
            'resize-end-child',
            'shrink-start-child',
            'shrink-end-child',
            'wide-handle',
        ];
    }

    /** `GtkOrientable:orientation` — which way the divider runs. */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    /** `Gtk.Paned:position` — the divider in pixels; `-1` puts it back to derived. */
    get position(): number {
        return this._position;
    }

    set position(value: number) {
        this.setPosition(value);
    }

    /** `Gtk.Paned:position-set` — read-only in GTK; only `position` moves it. */
    get positionSet(): boolean {
        return this._positionSet;
    }

    /** `Gtk.AccessibleRange:min-position` as the last computation left it. */
    get minPosition(): number {
        return this._minPosition;
    }

    /** `Gtk.AccessibleRange:max-position` as the last computation left it. */
    get maxPosition(): number {
        return this._maxPosition;
    }

    /** `Gtk.Paned:wide-handle` — the stronger visual separation. */
    get wideHandle(): boolean {
        return this.hasAttribute('wide-handle');
    }

    set wideHandle(value: boolean) {
        this.toggleAttribute('wide-handle', !!value);
    }

    /** `Gtk.Paned:start-child` — the light-DOM node in the leading pane. */
    get startChild(): Element | null {
        return this._startEl?.firstElementChild ?? null;
    }

    /** `Gtk.Paned:end-child` — the light-DOM node in the trailing pane. */
    get endChild(): Element | null {
        return this._endEl?.firstElementChild ?? null;
    }

    connectedCallback() {
        if (this._initialized) {
            // The teardown below dropped the observer, so a re-parent has to re-arm it —
            // see `scripts/check-adwaita-connect-rebind.mjs`.
            this._observe();
            return;
        }
        this._initialized = true;

        this.setAttribute('role', 'group');

        this._startEl = document.createElement('div');
        this._startEl.className = 'adw-paned-child';

        this._handleEl = document.createElement('div');
        this._handleEl.className = 'adw-paned-handle separator';
        // `separator` is the CSS NAME GtkPanedHandle carries (gtkpanedhandle.c:88), and a
        // window splitter is the ARIA reading of that node. The value moves here from the
        // paned — see the header.
        this._handleEl.setAttribute('role', 'separator');
        this._handleEl.tabIndex = 0;

        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-paned-child';

        // `<child type="start">` and `<child type="end">` are GtkBuildable's spellings, so
        // the slot names are `start` and `end`; the bare child is the start pane, which is
        // where `gtk_paned_buildable_add_child` puts an untyped one while it is free
        // (gtkpaned.c:816-826).
        bindSlottedChildren(
            this,
            [{ into: this._startEl }, { name: 'start', into: this._startEl }, { name: 'end', into: this._endEl }],
            () => this._observe(),
        ).install(this._startEl, this._handleEl, this._endEl);

        this._handleEl.addEventListener('pointerdown', this._onPointerDown);
        this._handleEl.addEventListener('keydown', this._onKeyDown);

        // A GtkBuilder `<property name="position">` reaches `set_position` at construction,
        // so an authored one has to land before the first allocation — and it raises
        // `position-set` exactly as a setter would.
        const authored = Number.parseFloat(this.getAttribute('position') ?? '');
        if (Number.isFinite(authored)) this.setPosition(authored);

        this._observe();
        this._layout();
    }

    disconnectedCallback() {
        this._dragging = false;
        this._resize?.disconnect();
        this._resize = null;
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'position') {
            // GTK's pspec is EXPLICIT_NOTIFY, so the attribute write IS a `set_position` and
            // the notifications come from there — never a second time from here.
            const value = Number.parseFloat(this.getAttribute('position') ?? '');
            if (Number.isFinite(value)) this.setPosition(value);
            return;
        }
        // `position-set` is GTK's read-only flag: markup may DECLARE it (the connectedCallback
        // reads it), but moving it from the outside would let an attribute contradict a
        // position the element has computed since.
        if (name === 'position-set') return;
        this._layout();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    private _property(name: string): unknown {
        switch (name) {
            case 'orientation':
                return this.orientation;
            case 'resize-start-child':
                return this.getAttribute('resize-start-child') !== 'false';
            case 'resize-end-child':
                return this.getAttribute('resize-end-child') !== 'false';
            case 'shrink-start-child':
                return this.getAttribute('shrink-start-child') !== 'false';
            case 'shrink-end-child':
                return this.getAttribute('shrink-end-child') !== 'false';
            case 'wide-handle':
                return this.wideHandle;
            default:
                return this.getAttribute(name);
        }
    }

    private _observe(): void {
        if (!this._resize) {
            this._resize = new ResizeObserver(() => this._layout());
            this._resize.observe(this);
        }
        for (const pane of [this._startEl, this._endEl]) {
            const adopted = pane.firstElementChild;
            if (adopted) this._resize.observe(adopted);
        }
    }

    /** `gtk_paned_set_position` (gtkpaned.c:1874-1910), with its two notifications. */
    private setPosition(value: number): void {
        if (!Number.isFinite(value)) return;
        if (value < 0) {
            // "a negative value means that the position is unset"
            if (this._positionSet) {
                this._positionSet = false;
                this._notify('position-set', { positionSet: false });
            }
            this._position = -1;
            this._layout();
            return;
        }
        if (!this._positionSet) {
            this._positionSet = true;
            this._notify('position-set', { positionSet: true });
        }
        if (this._position === value) return;
        this._position = value;
        this._notify('position', { position: value });
        this._layout();
    }

    /** `gtk_paned_calc_position` (gtkpaned.c:1021-1053): compute, place, notify, remember. */
    private _layout(): void {
        if (!this._startEl) return;
        const horizontal = this.orientation === 'horizontal';
        const handleRect = this._handleEl.getBoundingClientRect();
        // The handle is part of the paned's allocation, and the C subtracts it BEFORE
        // computing (gtkpaned.c:1336-1342).
        const handleSize = horizontal ? handleRect.width : handleRect.height;
        const allocation = Math.max(1, (horizontal ? this.clientWidth : this.clientHeight) - handleSize);

        const computed = computePanedPosition({
            allocation,
            startRequest: this._sizeRequest(this._startEl, horizontal),
            endRequest: this._sizeRequest(this._endEl, horizontal),
            resizeStart: this.getAttribute('resize-start-child') !== 'false',
            resizeEnd: this.getAttribute('resize-end-child') !== 'false',
            shrinkStart: this.getAttribute('shrink-start-child') !== 'false',
            shrinkEnd: this.getAttribute('shrink-end-child') !== 'false',
            positionSet: this._positionSet,
            startChildSize: this._position < 0 ? 0 : this._position,
            lastAllocation: this._lastAllocation,
        });

        const position = Math.floor(computed.position);
        if (position !== this._position) {
            this._position = position;
            this._notify('position', { position });
        }
        if (computed.min !== this._minPosition) {
            this._minPosition = computed.min;
            this._notify('min-position', { minPosition: computed.min });
        }
        if (computed.max !== this._maxPosition) {
            this._maxPosition = computed.max;
            this._notify('max-position', { maxPosition: computed.max });
        }
        this._lastAllocation = allocation;

        // `start_child_allocation.width = MAX (1, start_child_size)` — an explicit basis and
        // no growth, which IS the C's allocation rather than a flexbox approximation of it.
        this._startEl.style.flexBasis = `${Math.max(1, position)}px`;
        this._startEl.style.flexGrow = '0';
        this._endEl.style.flexGrow = this.getAttribute('resize-end-child') === 'false' ? '0' : '1';
        this._applyMinimum(this._startEl, 'shrink-start-child', horizontal);
        this._applyMinimum(this._endEl, 'shrink-end-child', horizontal);

        // `gtk_widget_set_child_visible (start_child, start_child_size != 0)`, and the end
        // child against the whole allocation (gtkpaned.c:1940-1941).
        const startVisible = position !== 0;
        const endVisible = position !== allocation;
        this._startEl.hidden = !startVisible;
        this._endEl.hidden = !endVisible;
        // "No separator is drawn if one of the children is missing."
        this._handleEl.hidden = !startVisible || !endVisible;

        this.classList.toggle('horizontal', horizontal);
        this.classList.toggle('vertical', !horizontal);
        this._handleEl.classList.toggle('wide', this.wideHandle);
        this._handleEl.setAttribute('aria-orientation', this.orientation);
        this._handleEl.setAttribute('aria-valuemin', String(DEFAULT_MIN_POSITION));
        // GTK's VALUE_MAX is the paned's own width or height, handle included.
        this._handleEl.setAttribute('aria-valuemax', String(horizontal ? this.clientWidth : this.clientHeight));
        this._handleEl.setAttribute('aria-valuenow', String(position));
    }

    /**
     * A child's SIZE REQUEST — what `gtk_widget_measure` answers with.
     *
     * `flex: none` pins the item to its content size, which is exactly a GTK size request,
     * and the read is one forced reflow. It has to be a separate pass: the laid-out size of a
     * pane that is currently `flex-grow: 1` is its ALLOCATION, and feeding that back as a
     * request is how a paned ends up re-deriving its own divisor.
     */
    private _sizeRequest(pane: HTMLElement, horizontal: boolean): number {
        // The shorthand resets all three longhands, so restoring them is what puts the pane
        // back — `flex = ''` would restore the INITIAL values and drop the basis below.
        const grow = pane.style.flexGrow;
        const shrink = pane.style.flexShrink;
        const basis = pane.style.flexBasis;
        pane.style.flex = 'none';
        const size = horizontal ? pane.offsetWidth : pane.offsetHeight;
        pane.style.flexGrow = grow;
        pane.style.flexShrink = shrink;
        pane.style.flexBasis = basis;
        return size;
    }

    /**
     * `shrink-*` is "can this child be made smaller than its requisition", which in CSS is
     * whether the AUTOMATIC minimum applies — `min-width: auto` is the flex automatic
     * minimum, so `min-width: 0` is the permission and leaving the longhand alone is the
     * prohibition.
     */
    private _applyMinimum(pane: HTMLElement, attribute: string, horizontal: boolean): void {
        const shrinkable = this.getAttribute(attribute) !== 'false';
        pane.style.minWidth = horizontal ? (shrinkable ? '0' : '') : '';
        pane.style.minHeight = horizontal ? '' : shrinkable ? '0' : '';
    }

    /**
     * `notify::<property>`, with the DETAIL keyed by the JS property name — the spelling
     * `<adw-expander-row>`, `<adw-entry-row>` and `<gtk-switch>` use, and the one a caller
     * destructures. `notify::position-set` therefore carries `{ positionSet }`.
     */
    private _notify(name: string, detail: Record<string, unknown>): void {
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail }));
    }

    /** `is_rtl` (gtkpaned.c:1533-1536): only a horizontal paned mirrors. */
    private get _isRtl(): boolean {
        return this.orientation === 'horizontal' && this.matches(':dir(rtl)');
    }

    /** `gesture_drag_begin_cb` (gtkpaned.c:915-955) — the capture and `drag_pos`. */
    private readonly _onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 || this._handleEl.hidden) return;
        this._dragging = true;
        // Pointer CAPTURE rather than a `window` listener pair: the move and the release then
        // arrive at the handle however far the pointer leaves it, and there is nothing to
        // unbind — the binding is inside this element, so `check-adwaita-connect-rebind.mjs`
        // has nothing to police.
        this._handleEl.setPointerCapture(event.pointerId);
        const horizontal = this.orientation === 'horizontal';
        const rect = this._handleEl.getBoundingClientRect();
        const point = horizontal ? event.clientX : event.clientY;
        const origin = horizontal ? rect.left : rect.top;
        this._dragPos = point - origin - (this.wideHandle ? 0 : HANDLE_EXTRA_SIZE);
        this._handleEl.addEventListener('pointermove', this._onPointerMove);
        this._handleEl.addEventListener('pointerup', this._onPointerUp);
        this._handleEl.addEventListener('pointercancel', this._onPointerUp);
    };

    /** `update_drag` (gtkpaned.c:1538-1573), from the capture phase. */
    private readonly _onPointerMove = (event: PointerEvent): void => {
        if (!this._dragging) return;
        const horizontal = this.orientation === 'horizontal';
        const point = horizontal ? event.clientX : event.clientY;
        const pos = point - this._dragPos;
        // `size = gtk_widget_get_width (paned) - pos - handle_size` under RTL, `pos`
        // otherwise; then CLAMP (size, min_position, max_position).
        const handleSize = horizontal ? this._handleEl.offsetWidth : this._handleEl.offsetHeight;
        const size = this._isRtl ? (horizontal ? this.clientWidth : this.clientHeight) - pos - handleSize : pos;
        this.setPosition(glibClamp(Math.round(size), this._minPosition, this._maxPosition));
    };

    private readonly _onPointerUp = (event: PointerEvent): void => {
        if (!this._dragging) return;
        this._dragging = false;
        if (this._handleEl.hasPointerCapture(event.pointerId)) {
            this._handleEl.releasePointerCapture(event.pointerId);
        }
        this._handleEl.removeEventListener('pointermove', this._onPointerMove);
        this._handleEl.removeEventListener('pointerup', this._onPointerUp);
        this._handleEl.removeEventListener('pointercancel', this._onPointerUp);
    };

    /**
     * `gtk_paned_move_handle` (gtkpaned.c:2286-2353) over `add_move_binding`'s key list
     * (gtkpaned.c:768-785). `Escape` and `Return`/Space are `cancel-position` /
     * `accept-position`, which GTK binds to no handler of its own — they are the signals an
     * embedding application listens for — so they are dispatched as events and left to
     * bubble rather than swallowed here.
     */
    private readonly _onKeyDown = (event: KeyboardEvent): void => {
        if (event.altKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'Escape') {
            this.dispatchEvent(new CustomEvent('cancel-position', { bubbles: true, detail: {} }));
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            this.dispatchEvent(new CustomEvent('accept-position', { bubbles: true, detail: {} }));
            return;
        }

        let increment = 0;
        let jump: 'start' | 'end' | null = null;
        switch (event.key) {
            case 'ArrowLeft':
                increment = event.ctrlKey ? -PAGE_STEP_SIZE : -SINGLE_STEP_SIZE;
                break;
            case 'ArrowRight':
                increment = event.ctrlKey ? PAGE_STEP_SIZE : SINGLE_STEP_SIZE;
                break;
            case 'ArrowUp':
                increment = event.ctrlKey ? -PAGE_STEP_SIZE : -SINGLE_STEP_SIZE;
                break;
            case 'ArrowDown':
                increment = event.ctrlKey ? PAGE_STEP_SIZE : SINGLE_STEP_SIZE;
                break;
            case 'PageUp':
                increment = -PAGE_STEP_SIZE;
                break;
            case 'PageDown':
                increment = PAGE_STEP_SIZE;
                break;
            case 'Home':
                jump = 'start';
                break;
            case 'End':
                jump = 'end';
                break;
            default:
                return;
        }
        event.preventDefault();

        let next: number;
        if (jump === 'start') {
            next = this._minPosition;
        } else if (jump === 'end') {
            next = this._maxPosition;
        } else {
            // `if (is_rtl (paned)) increment = -increment;` — an RTL horizontal paned's
            // ArrowRight moves the divider towards a SMALLER position.
            if (this._isRtl) increment = -increment;
            next = this._position + increment;
        }
        this.setPosition(glibClamp(next, this._minPosition, this._maxPosition));
    };
}

customElements.define('gtk-paned', GtkPaned);
