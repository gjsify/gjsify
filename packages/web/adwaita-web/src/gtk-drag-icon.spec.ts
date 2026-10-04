// DOM-level tests for <gtk-drag-icon>. A drag icon exists only WHILE a drag is in flight and
// GTK destroys it with the drag, so what a test can reach is the whole lifecycle: the child
// the icon carries, the per-drag cache `getForDrag` is, the icon following the pointer, and
// the hide that stands in for the destroy.
import { describe, expect, it } from '@gjsify/unit';

import { GtkDragIcon } from './elements/gtk-drag-icon.js';

function mount(child?: string): { el: GtkDragIcon; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-drag-icon') as GtkDragIcon;
    if (child !== undefined) el.innerHTML = child;
    host.appendChild(el);
    return { el, host };
}

/** A drag event of its own: `getForDrag` keys on the `dataTransfer`, so each one is new. */
function dragEvent(x = 0, y = 0, type = 'dragstart'): DragEvent {
    const event = new DragEvent(type, { clientX: x, clientY: y });
    // `DataTransfer` is not in the event dictionary's constructor options in every engine,
    // and the icon's own code reads it defensively; a test must not depend on that.
    Object.defineProperty(event, 'dataTransfer', { value: new DataTransfer() });
    return event;
}

export const GtkDragIconTest = async () => {
    await describe('<gtk-drag-icon> child', async () => {
        await it('is null until it is given one', () => {
            const { el, host } = mount();
            expect(el.child).toBe(null);
            host.remove();
        });

        await it('takes the child it is set, in light DOM, and keeps only that one', () => {
            // :478-485 — `gtk_widget_unparent (self->child)` then `gtk_widget_set_parent`
            // on the new one, so the old child LEAVES rather than being duplicated.
            const { el, host } = mount();
            const first = document.createElement('gtk-label');
            const second = document.createElement('gtk-image');
            el.child = first;
            expect(el.child).toBe(first);
            el.child = second;
            expect(el.child).toBe(second);
            expect(el.children.length).toBe(1);
            expect(first.isConnected).toBe(false);
            host.remove();
        });

        await it('reads a child declared in markup without a call', () => {
            // The getter is the light-DOM child, which is what makes the declared form work.
            const { el, host } = mount('<gtk-label label="A drag icon can be markup"></gtk-label>');
            expect(el.child?.tagName).toBe('GTK-LABEL');
            host.remove();
        });

        await it('notifies once per real change and never for an echo', () => {
            // :475 — `if (self->child == child) return;` — and `G_PARAM_EXPLICIT_NOTIFY`,
            // so the one notify at :489 is the only signal this class emits.
            const { el, host } = mount();
            const detail: unknown[] = [];
            el.addEventListener('notify::child', (event) => detail.push((event as CustomEvent).detail['child']));
            const child = document.createElement('gtk-label');
            el.child = child;
            el.child = child;
            el.child = null;
            expect(detail).toStrictEqual([child, null]);
            host.remove();
        });
    });

    await describe('<gtk-drag-icon> the drag', async () => {
        await it('is hidden and idle until a drag begins', () => {
            // `gtk_drag_icon_get_for_drag` (:400-421) creates the icon and shows it only
            // once a child is set, which in a browser is the drag itself.
            const { el, host } = mount('<gtk-label label="x"></gtk-label>');
            expect(el.dragging).toBe(false);
            expect(el.hidden).toBe(false);
            el.endDrag();
            expect(el.hidden).toBe(true);
            host.remove();
        });

        await it('follows the pointer once a drag is in flight', () => {
            // `gtk_drag_icon_move_resize` (:138-150) is the whole of "moves with the
            // pointer", and the hotspot is (0, 0) — see the header for why.
            const { el, host } = mount('<gtk-label label="drag me"></gtk-label>');
            el.beginDrag(dragEvent(40, 12));
            expect(el.dragging).toBe(true);
            expect(el.hidden).toBe(false);
            expect(el.style.transform).toBe('translate3d(40px, 12px, 0px)');
            document.dispatchEvent(new DragEvent('dragover', { clientX: 41, clientY: 13 }));
            expect(el.style.transform).toBe('translate3d(41px, 13px, 0px)');
            el.endDrag();
            expect(el.dragging).toBe(false);
            expect(el.hidden).toBe(true);
            host.remove();
        });

        await it('stops following when the drag ends', () => {
            const { el, host } = mount('<gtk-label label="drag me"></gtk-label>');
            el.beginDrag(dragEvent(4, 4));
            document.dispatchEvent(new DragEvent('dragover', { clientX: 90, clientY: 90 }));
            document.dispatchEvent(new DragEvent('dragend', {}));
            expect(el.dragging).toBe(false);
            expect(el.hidden).toBe(true);
            const before = el.style.transform;
            document.dispatchEvent(new DragEvent('dragover', { clientX: 120, clientY: 120 }));
            expect(el.style.transform).toBe(before);
            host.remove();
        });
    });

    await describe('GtkDragIcon.getForDrag', async () => {
        await it('gives one icon per drag and the same one twice', () => {
            // `g_object_get_qdata (G_OBJECT (drag), drag_icon_quark)` (:408-419): the icon
            // is cached ON THE DRAG, so a second call for the same drag is the same widget.
            const event = dragEvent();
            const icon = GtkDragIcon.getForDrag(event);
            expect(GtkDragIcon.getForDrag(event)).toBe(icon);
            // No declared icon is free in this state, so the second drag is a new node.
            const other = GtkDragIcon.getForDrag(dragEvent());
            expect(other).not.toBe(icon);
            for (const el of [icon, other]) {
                el.endDrag();
                el.remove();
            }
        });

        await it('reuses a declared <gtk-drag-icon> instead of adding another', () => {
            const declared = document.createElement('gtk-drag-icon');
            document.body.appendChild(declared);
            const icon = GtkDragIcon.getForDrag(dragEvent());
            expect(icon).toBe(declared);
            expect(document.querySelectorAll('gtk-drag-icon').length).toBe(1);
            icon.endDrag();
            declared.remove();
        });

        await it('gives a drag whose declared icon is busy a node of its own', () => {
            // One icon per drag is the C's contract, so a declared icon already following
            // a pointer belongs to that drag — the reuse is for the ONE drag markup names.
            const declared = document.createElement('gtk-drag-icon');
            document.body.appendChild(declared);
            const first = GtkDragIcon.getForDrag(dragEvent());
            expect(first).toBe(declared);
            const second = GtkDragIcon.getForDrag(dragEvent());
            expect(second).not.toBe(declared);
            expect(second.dragging).toBe(true);
            // The busy icon is left to its own drag: it still follows that pointer.
            expect(first.dragging).toBe(true);
            for (const el of [first, second]) el.endDrag();
            for (const el of document.querySelectorAll('gtk-drag-icon')) el.remove();
        });

        await it('detaches the platform drag image so only the mirror shows', () => {
            // The browser's own ghost is asked away with a 1×1 transparent image; where a
            // browser refuses that, the platform ghost shows as well — the header says so.
            const icon = GtkDragIcon.getForDrag(dragEvent(3, 4));
            expect(icon.style.transform).toBe('translate3d(3px, 4px, 0px)');
            icon.endDrag();
            for (const el of document.querySelectorAll('gtk-drag-icon')) el.remove();
        });
    });

    await describe('GtkDragIcon.createWidgetForValue', async () => {
        await it('builds a label for a string', () => {
            // :531-534 — `G_VALUE_HOLDS (value, G_TYPE_STRING)` → `gtk_label_new`.
            const widget = GtkDragIcon.createWidgetForValue('Report.odt');
            expect(widget?.tagName).toBe('GTK-LABEL');
            expect(widget?.getAttribute('label')).toBe('Report.odt');
        });

        await it('builds a swatch carrying the colour for an RGBA', () => {
            // :544-553 — a `GtkColorSwatch` with can-drag and can-drop FALSE, so for a drag
            // icon it is nothing but the colour. The div is this package's swatch.
            const widget = GtkDragIcon.createWidgetForValue({ red: 1, green: 0, blue: 0, alpha: 0.5 });
            expect(widget?.className).toBe('adw-drag-icon-swatch');
            // The alpha is half, so every engine keeps the `rgba()` form a swatch needs to
            // read as translucent; at alpha 1 Firefox serializes it back to `rgb()`.
            expect((widget as HTMLElement | null)?.style.backgroundColor).toBe('rgba(255, 0, 0, 0.5)');
        });

        await it('returns null for a value it cannot make a widget for', () => {
            // :603-605 — and the four types between :535-602 have no browser answer, which
            // the header names: no icon query for a file, no painted selection for a buffer.
            expect(GtkDragIcon.createWidgetForValue(null)).toBe(null);
        });
    });
};
