// <gtk-drag-icon> — the thing that follows the pointer while a drag is in flight.
//
// THIS WIDGET IS NOT ONE AN APPLICATION BUILDS, and the C says so in its own docs
// (gtkdragicon.c:42-58): a `GtkDragIcon` is a `GtkRoot` created FOR A DRAG, cached on that
// drag and destroyed when the drag ends. `gtk_drag_icon_get_for_drag (drag)` returns the
// one in use, creating it if there is none. Everything else on the class is about the ONE
// thing it holds: `set_child` (:461-490) unparents the previous child, parents the new one
// and notifies; `gtk_drag_icon_move_resize` (:138-150) is the whole of "follows the
// pointer"; `surface_compute_size` (:180-188) sizes the drag surface to the child's
// PREFERRED size, which is why an icon is exactly as big as what it carries; and
// `gtk_drag_icon_init` sets `can_target` FALSE (:386-390), because a drag icon takes no
// input — GTK's own note is "drag icons do not allow user input" (:56-57).
//
// WHAT A BROWSER CAN AND CANNOT DO HERE, ALL OF IT WRITTEN DOWN:
//
//   · the PLATFORM PAINTS ITS OWN DRAG IMAGE and offers no way to hand a live widget to
//     it. So the element does the next best thing and is explicit about it: it asks the
//     browser for a transparent drag image (`setDragImage`), which is why the browser's
//     ghost is invisible, and mirrors the icon as a fixed-position element that follows
//     the pointer for the length of the drag. Where a browser refuses the transparent
//     image the platform ghost shows as well, and the element says so rather than
//     pretending the mirror is the drag surface.
//   · the ICON IS PER DRAG and cannot be a custom element that comes and goes, so
//     `getForDrag` keys the icon on the drag's `dataTransfer` — the one object a browser
//     gives per drag operation — in the same spirit as GTK's `g_object_get_qdata` on the
//     `GdkDrag`, and it REUSES a `<gtk-drag-icon>` the page already declared rather than
//     creating a node for the one drag that markup is obviously for. A declared icon
//     already following a pointer belongs to that drag, so a second drag gets its own.
//     `dragend` hides the icon rather than destroying it, which is the same end state
//     through an API that cannot destroy itself.
//   · the HOTSPOT is at the cursor. `gtk_drag_icon_set_from_paintable` calls
//     `gdk_drag_set_hotspot (drag, hot_x, hot_y)` (:452) and `move_resize` aligns the
//     icon's top-left to it; a browser drag image is positioned by an OFFSET passed once
//     at `dragstart`, so the mirror puts the icon's top-left AT the pointer — the hotspot
//     `(0, 0)` — and the header of `setFromPaintable` says what that costs.
//
// THE CSS NODE IS `dnd`, which libadwaita styles ONCE for the whole widget
// (`refs/libadwaita/src/stylesheet/_common.scss:30-32`) and twice more for a `dnd tab`
// (`_tab-view.scss:138-155`, the drag of a tab out of a tab view). The first is transcribed
// in `_drag_icon.scss`; the tab half selects a `tab` node, which is a `GtkTabView`'s tab
// rather than a property of this widget, so it belongs to the tab view's own element and
// is cited here instead of being guessed at.
//
// A11Y: nothing focusable and no role, which is `can_target = FALSE` in CSS. A drag icon is
// pointed at, not reached; it takes no focus, no pointer events and announces nothing.
//
// Events: `notify::child` (CustomEvent, bubbles, detail `{ child }`) on a real change — the
// one notify the class has (:489). There is no signal of its own.
//
// Reference: refs/gtk/gtk/gtkdragicon.c
// Reference: refs/libadwaita/src/stylesheet/_common.scss:30-32, widgets/_tab-view.scss:138-155
// Copyright (c) The GTK Team. LGPLv2.1+.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** The `rgba()` string a `GdkRGBA` value paints, as the colour swatch shows it. */
interface Rgba {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha?: number;
}

/** One icon per drag operation, keyed on the `dataTransfer` a browser gives per drag. */
const ICON_BY_DRAG = new WeakMap<DataTransfer, GtkDragIcon>();

export class GtkDragIcon extends HTMLElement {
    private _pointerX = 0;
    private _pointerY = 0;
    private _dragging = false;
    /** The document listeners, released the moment the drag ends (see `_begin`). */
    private _onDragOver: ((event: DragEvent) => void) | null = null;
    private _onDragEnd: ((event: DragEvent) => void) | null = null;
    /** The drag this icon is for: GTK destroys the icon when THAT drag ends (:57-58). */
    private _transfer: DataTransfer | null = null;

    static get observedAttributes() {
        return [];
    }

    /**
     * `gtk_drag_icon_get_for_drag` (:392-421), for a browser drag: the icon in use, or a
     * new one. A declared `<gtk-drag-icon>` this drag can have is that one — see the header
     * for when it cannot.
     */
    static getForDrag(event: DragEvent): GtkDragIcon {
        const transfer = event.dataTransfer;
        const cached = transfer === null ? undefined : ICON_BY_DRAG.get(transfer);
        if (cached !== undefined) return cached;

        // A DECLARED icon is this drag's only if no other drag is using it: the C gives
        // every drag an icon of its own, so a declared icon already following a pointer is
        // left to that drag and a second one gets a node of its own.
        const declared = document.querySelector('gtk-drag-icon');
        const free = declared instanceof GtkDragIcon && !declared.dragging ? declared : null;
        const icon = free ?? (document.createElement('gtk-drag-icon') as GtkDragIcon);
        if (free === null) document.body.appendChild(icon);
        if (transfer !== null) ICON_BY_DRAG.set(transfer, icon);
        icon.beginDrag(event);
        return icon;
    }

    /**
     * `gtk_drag_icon_create_widget_for_value` (:529-556): the widget a drag shows for a
     * value. The C answers for SIX types — a string is a `GtkLabel` (:531-534), a
     * `GDK_TYPE_PAINTABLE` and a `G_TYPE_FILE` are `GtkImage`s with the `large-icons`
     * class (:535-543, :554-573), a `GdkRGBA` is a `GtkColorSwatch` (:544-553), a
     * `GtkTextBuffer` is a `GtkPicture` of its selection and a `GSK_TYPE_RENDER_NODE` an
     * image of its bounds (:574-602) — and returns `NULL` for anything else (:603-605).
     *
     * TWO OF THE SIX HAVE AN ANSWER HERE, and the other four are NAMED rather than
     * quietly folded into the `null`: a paintable and a file are a picture an icon theme
     * picks, which a browser has no query for (`g_file_query_info (… "standard::icon")`
     * is a file-system answer), and a text buffer's drag icon is a PAINTED selection
     * (`gtk_text_util_create_rich_drag_icon`) that this package has no text view to take
     * one from. `null` for those is the C's own answer for a value it cannot make a
     * widget for, so the return type still means what it means in the C.
     *
     * The swatch is a painted div rather than a `<gtk-color-swatch>`: this package ships no
     * colour-swatch element, and for a drag icon the swatch is nothing but the colour it
     * carries — `set_can_drag`/`set_can_drop` FALSE (:546-547), so it takes no input and
     * accepts none.
     */
    static createWidgetForValue(value: string | Rgba | null): Element | null {
        if (typeof value === 'string') {
            const label = document.createElement('gtk-label');
            label.setAttribute('label', value);
            return label;
        }
        if (value === null) return null;
        const swatch = document.createElement('div');
        swatch.className = 'adw-drag-icon-swatch';
        const alpha = value.alpha ?? 1;
        swatch.style.backgroundColor = `rgba(${Math.round(value.red * 255)}, ${Math.round(value.green * 255)}, ${Math.round(
            value.blue * 255,
        )}, ${alpha})`;
        return swatch;
    }

    /**
     * `GtkDragIcon:child` — the widget displayed as the drag icon, `null` until set. GTK's
     * setter unparents the old child, parents the new one and notifies (:468-490); the
     * getter here is the light-DOM child, so an icon declared in markup with content needs
     * no imperative call at all.
     */
    get child(): Element | null {
        return this.firstElementChild;
    }

    set child(node: Element | null) {
        if (this.child === node) return;
        // `gtk_widget_unparent (self->child)` — the old child leaves rather than being
        // duplicated, and `gtk_widget_set_visible` in the C is the icon showing itself.
        this.replaceChildren();
        if (node !== null) this.appendChild(node);
        this.dispatchEvent(new CustomEvent('notify::child', { bubbles: true, detail: { child: node } }));
    }

    /** `set_child` + `show` — the shape a drag source actually uses. */
    setChild(node: Element | null): void {
        this.child = node;
        if (node !== null) this._render();
    }

    connectedCallback() {
        // `gtk_widget_set_can_target (self, FALSE)` (:386-390), in CSS: the icon is pointed
        // at, and takes no pointer event of any kind.
        this.style.pointerEvents = 'none';
        if (this._dragging) this._observe();
    }

    disconnectedCallback() {
        this._unobserve();
    }

    /**
     * The drag has begun. The platform's own ghost is asked away with a transparent image,
     * and from here the icon follows the pointer — `gtk_drag_icon_move_resize` (:138-150)
     * on every `dragover`, which is the one event a browser delivers continuously while a
     * drag is in flight.
     */
    beginDrag(event: DragEvent): void {
        const transfer = event.dataTransfer;
        if (transfer !== null) {
            // A 1×1 transparent canvas is the smallest drag image a browser accepts; where
            // `setDragImage` is refused the platform ghost shows as well, which is the one
            // thing about this widget a page cannot fully own.
            try {
                const blank = document.createElement('canvas');
                blank.width = 1;
                blank.height = 1;
                transfer.setDragImage(blank, 0, 0);
            } catch {
                // Nothing to do: the mirror still follows the pointer.
            }
        }
        this._pointerX = event.clientX;
        this._pointerY = event.clientY;
        this._transfer = transfer;
        this._dragging = true;
        this._observe();
        this._render();
    }

    /** The drag ended: GTK destroys the icon, and this hides it instead. */
    endDrag(): void {
        this._dragging = false;
        this._transfer = null;
        this._unobserve();
        this.hidden = true;
    }

    /** Whether a drag is in flight — the C's mapped flag, and what `hidden` answers to. */
    get dragging(): boolean {
        return this._dragging;
    }

    private _observe(): void {
        if (this._onDragOver !== null) return;
        this._onDragOver = (event: DragEvent) => {
            // `dragover` is the only event a browser delivers continuously during a drag,
            // and it reaches the document from whatever is under the pointer.
            this._pointerX = event.clientX;
            this._pointerY = event.clientY;
            this._render();
        };
        this._onDragEnd = (event: DragEvent) => {
            // Another drag ending is not this icon's drag ending, and the C is per-drag:
            // `gdk_drag_begin`/`gdk_drag_end` on one `GdkDrag`, one icon with it.
            if (event.dataTransfer === null || event.dataTransfer === this._transfer) this.endDrag();
        };
        document.addEventListener('dragover', this._onDragOver);
        document.addEventListener('dragend', this._onDragEnd);
    }

    private _unobserve(): void {
        if (this._onDragOver !== null) document.removeEventListener('dragover', this._onDragOver);
        if (this._onDragEnd !== null) document.removeEventListener('dragend', this._onDragEnd);
        this._onDragOver = null;
        this._onDragEnd = null;
    }

    /**
     * `gtk_drag_icon_move_resize` (:138-150): the icon is moved to the pointer. Fixed
     * positioning plus a transform is the one CSS door into the top layer a page has, and
     * the hotspot is `(0, 0)` — see the header for why.
     */
    private _render(): void {
        this.hidden = !this._dragging;
        if (!this._dragging) return;
        this.style.left = '0px';
        this.style.top = '0px';
        this.style.transform = `translate3d(${Math.round(this._pointerX)}px, ${Math.round(this._pointerY)}px, 0)`;
    }
}

customElements.define('gtk-drag-icon', GtkDragIcon);
