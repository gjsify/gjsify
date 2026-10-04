// What `<gtk-list-view>`, `<gtk-grid-view>` and `<gtk-column-view>` share in the DOM —
// the default factory and the rubber band (ADR 0089).
//
// The three views derive from `GtkListBase` upstream and share its item manager, its
// selection function and its rubberband gesture. The SELECTION half of that is portable
// and lives in `@gjsify/adwaita-core`'s `ListViewState` (ADR 0004); what is left here is
// genuinely a DOM job — a pointer drag, a rectangle, and the node a factory builds — and
// is shared for the reason the second copy always is: three elements writing the same
// hit test is three places for it to be subtly different.
//
// Reference: refs/gtk/gtk/gtklistbase.c (the rubberband gesture and its `rubberband` node)
// Reference: refs/libadwaita/src/stylesheet/widgets/_views.scss:47-50 (`rubberband`)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.

import type { AdwListItemContext, AdwListItemFactory } from '@gjsify/adwaita-core';

/** The class every row/cell label carries, so one stylesheet rule reaches all three views. */
export const LIST_ITEM_LABEL_CLASS = 'adw-list-item-label';

/**
 * What a view draws for an item when no `factory` was set.
 *
 * GTK HAS NO DEFAULT FACTORY — `gtk_list_view_new (model, NULL)` is legal and draws empty
 * rows, which on a documentation surface is indistinguishable from a broken widget. So
 * the port's default is the factory every upstream example writes by hand: a label bound
 * to the item. Setting `factory` replaces it, and that is the only way to get GTK's own
 * answer back.
 */
export const defaultListItemFactory: AdwListItemFactory<Node> = (context: AdwListItemContext) => {
    const label = document.createElement('span');
    label.className = LIST_ITEM_LABEL_CLASS;
    label.textContent = context.item.label;
    return label;
};

/** What {@link attachRubberBand} needs to know about the view it bands. */
export interface AdwRubberBandInit {
    /** The element the pointer listeners sit on. */
    host: HTMLElement;
    /** The positioned box the band is drawn inside — the row container. */
    surface: HTMLElement;
    /** Whether a drag may start right now: `enable-rubberband` AND a multiple selection. */
    enabled: () => boolean;
    /** The row elements, in model order. */
    rows: () => readonly HTMLElement[];
    /** Select every position the band covers, replacing the selection. */
    selectPositions: (positions: readonly number[]) => void;
}

/**
 * Rubberband selection — drag on the view's background to select what the rectangle
 * covers.
 *
 * GTK runs this as a drag gesture on `GtkListBase` and draws a `rubberband` CSS node,
 * which libadwaita styles as an accent border over a 20% accent fill
 * (`_views.scss:47-50`); this builds the same node and lets that rule reach it.
 *
 * THE DRAG MUST START ON THE BACKGROUND. A press that lands on a row is that row's click
 * — GTK's row gesture claims the sequence — so starting a band there would make every
 * click a one-pixel drag and swallow the row's own selection step.
 *
 * The hit test is `getBoundingClientRect` per row against the band, which is the same
 * question GTK answers against its tile areas. It is recomputed per pointermove rather
 * than cached: a row's box can change mid-drag (a scroll, a factory that lays out late),
 * and a cached rectangle would select the wrong rows without anything looking wrong.
 */
export function attachRubberBand(init: AdwRubberBandInit): void {
    let band: HTMLElement | null = null;
    let origin: { x: number; y: number } | null = null;
    let pointerId: number | null = null;

    const stop = () => {
        band?.remove();
        band = null;
        origin = null;
        if (pointerId !== null && init.host.hasPointerCapture(pointerId)) {
            init.host.releasePointerCapture(pointerId);
        }
        pointerId = null;
    };

    init.host.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !init.enabled()) return;
        const target = event.target as Node | null;
        if (target !== null && init.rows().some((row) => row === target || row.contains(target))) return;

        origin = { x: event.clientX, y: event.clientY };
        pointerId = event.pointerId;
        init.host.setPointerCapture(event.pointerId);
        band = document.createElement('div');
        band.className = 'adw-rubberband';
        band.setAttribute('aria-hidden', 'true');
        init.surface.appendChild(band);
    });

    init.host.addEventListener('pointermove', (event) => {
        if (origin === null || band === null) return;
        const box = init.surface.getBoundingClientRect();
        const left = Math.min(origin.x, event.clientX);
        const top = Math.min(origin.y, event.clientY);
        const width = Math.abs(event.clientX - origin.x);
        const height = Math.abs(event.clientY - origin.y);
        band.style.left = `${left - box.left}px`;
        band.style.top = `${top - box.top}px`;
        band.style.width = `${width}px`;
        band.style.height = `${height}px`;

        const covered: number[] = [];
        init.rows().forEach((row, position) => {
            const rect = row.getBoundingClientRect();
            const hit =
                rect.right >= left && rect.left <= left + width && rect.bottom >= top && rect.top <= top + height;
            if (hit) covered.push(position);
        });
        init.selectPositions(covered);
    });

    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        init.host.addEventListener(name, stop);
    }
}
