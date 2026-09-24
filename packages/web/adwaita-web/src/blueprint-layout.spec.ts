// A REAL `.blp` OF GtkWidget LAYOUT PROPERTIES, MOUNTED AND MEASURED.
//
// `bottom-sheet-layout.blp` (`@gjsify/adwaita-core/src/conformance/blueprints/`) is the shape
// the gallery's `Adw.BottomSheet` block writes: a button placed with `halign`/`valign`, a box
// inset by four `margin-*` lines, a title at the start edge, and one expanding child. The
// NativeScript port builds the same file (`adwaita-nativescript`'s `blueprint-trees.spec.ts`).
//
// Before `_widget.scss` and the builder's margin table, this renderer wrote every one of these
// as an attribute nothing read — no refusal, since the web builder refuses nothing it writes as
// an attribute, and no effect: the centred button stretched across the sheet's content. So the
// assertions here are about GEOMETRY, read off the laid-out page, never about the attribute
// being present.

import { describe, expect, it } from '@gjsify/unit';

import { mountSharedTree } from './shared-tree-builder.js';

import sheetTree from '../../adwaita-core/src/conformance/blueprints/bottom-sheet-layout.blp?shared-tree';
import carouselTree from '../../adwaita-core/src/conformance/blueprints/carousel-indicators.blp?shared-tree';

import { GALLERY_BLUEPRINTS } from './blueprint-markup.spec.js';

/** Mount the fixture at a size a layout can be measured in; the caller unmounts. */
function mountSheet() {
    const mounted = mountSharedTree(sheetTree);
    mounted.root.style.width = '400px';
    mounted.root.style.height = '340px';
    const byId = (id: string): HTMLElement => {
        const el = mounted.root.querySelector<HTMLElement>(`#${id}`);
        if (el === null) throw new Error(`the mounted tree has no element with the id '${id}'`);
        return el;
    };
    return { ...mounted, byId };
}

export const AdwBlueprintLayoutTest = async () => {
    await describe('adwaita-web: bottom-sheet-layout.blp, laid out', async () => {
        await it('halign/valign center place the button in the middle of the content at its own size', async () => {
            const { root, unmount, byId } = mountSheet();
            try {
                const content = root.querySelector('.adw-bottom-sheet-content') as HTMLElement;
                const area = content.getBoundingClientRect();
                const button = byId('toggle').getBoundingClientRect();

                expect(button.width < area.width).toBe(true);
                expect(button.height < area.height).toBe(true);
                expect(Math.abs(button.left - area.left - (area.right - button.right)) <= 1).toBe(true);
                expect(Math.abs(button.top - area.top - (area.bottom - button.bottom)) <= 1).toBe(true);
            } finally {
                unmount();
            }
        });

        await it('the four margins inset the box, start and end on the logical edges', async () => {
            const { unmount, byId } = mountSheet();
            try {
                const style = getComputedStyle(byId('box'));

                expect(style.marginLeft).toBe('18px');
                expect(style.marginRight).toBe('12px');
                expect(style.marginTop).toBe('18px');
                expect(style.marginBottom).toBe('24px');
            } finally {
                unmount();
            }
        });

        await it('halign start keeps the title at the start edge of the box at its own width', async () => {
            const { unmount, byId } = mountSheet();
            try {
                const box = byId('box').getBoundingClientRect();
                const title = byId('title').getBoundingClientRect();

                expect(Math.abs(title.left - box.left) <= 1).toBe(true);
                expect(title.width < box.width).toBe(true);
            } finally {
                unmount();
            }
        });

        await it('expand grows along the box axis only', async () => {
            const { unmount, byId } = mountSheet();
            try {
                // The box is vertical: `vexpand` is its own axis and takes the spare height,
                // `hexpand` is the cross axis, which `align-items: stretch` already fills.
                expect(getComputedStyle(byId('body')).flexGrow).toBe('1');
                expect(getComputedStyle(byId('caption')).flexGrow).toBe('0');
            } finally {
                unmount();
            }
        });

        await it('the open modal sheet shows its dimming, and the non-modal one would not', async () => {
            const { root, unmount } = mountSheet();
            try {
                const sheet = root as HTMLElement & { modal: boolean };
                const dimming = root.querySelector('.adw-bottom-sheet-dimming') as HTMLElement;

                expect(dimming.classList.contains('visible')).toBe(true);
                sheet.modal = false;
                expect(dimming.classList.contains('visible')).toBe(false);
            } finally {
                unmount();
            }
        });
    });

    // `carousel: carousel` projects as the attribute `carousel="carousel"`: GTK's property
    // name, which the indicators now read beside the `for` they had first.
    await describe('adwaita-web: carousel-indicators.blp, mounted', async () => {
        await it('both indicators bind to the carousel by id and mark its first page', async () => {
            const { root, unmount } = mountSharedTree(carouselTree);
            try {
                const dots = [...root.querySelectorAll('#dots .adw-carousel-dot')];
                const lines = [...root.querySelectorAll('#lines .adw-carousel-line')];

                expect(dots.length).toBe(3);
                expect(lines.length).toBe(3);
                expect(dots.map((dot) => dot.classList.contains('active'))).toStrictEqual([true, false, false]);
                expect(lines[0]?.classList.contains('active')).toBe(true);
            } finally {
                unmount();
            }
        });
    });

    // The gallery's third batch of `.blp` files, mounted at the size of the gallery's stage
    // and held to a GTK render of the same file (GJS, `Gtk.Builder`, an `Adw.ApplicationWindow`
    // of that size, libadwaita 1.9). The GTK numbers are written beside each assertion; the
    // tolerance is the 1-2px a header bar and text metrics differ by.
    await describe('adwaita-web: the gallery Blueprints, laid out beside GTK', async () => {
        /** The tree mounted in a grid of `width` x `height`, as the gallery stage holds it. */
        const mountAt = (file: string, width: number, height: number) => {
            const tree = GALLERY_BLUEPRINTS[file];
            if (tree === undefined) throw new Error(`no gallery Blueprint ${file}`);
            const mounted = mountSharedTree(tree);
            const host = mounted.root.parentElement as HTMLElement;
            host.style.cssText = `display: grid; width: ${width}px; height: ${height}px;`;
            const box = (el: Element) => {
                const r = el.getBoundingClientRect();
                const h = host.getBoundingClientRect();
                return { x: r.left - h.left, y: r.top - h.top, width: r.width, height: r.height };
            };
            const byId = (id: string): HTMLElement => {
                const el = host.querySelector<HTMLElement>(`#${id}`);
                if (el === null) throw new Error(`${file} mounted no element with the id '${id}'`);
                return el;
            };
            return { ...mounted, host, box, byId };
        };
        const near = (actual: number, gtk: number, tolerance = 2) => Math.abs(actual - gtk) <= tolerance;

        await it('a split view page fills its pane, and its header bar shows the page title', async () => {
            const { unmount, box, byId, host } = mountAt('adwaita/navigation-split-view.blp', 652, 340);
            try {
                // GTK: sidebar 0,46 180x294 — the list fills the pane under the header bar.
                expect(near(box(byId('sidebar')).height, 294)).toBe(true);
                const titles = [...host.querySelectorAll('adw-header-bar')].map(
                    (bar) => bar.querySelector('adw-window-title')?.getAttribute('title') ?? null,
                );
                expect(titles).toStrictEqual(['Mailboxes', 'All Mail']);
            } finally {
                unmount();
            }
        });

        await it('an overlay split view sidebar fills its pane', async () => {
            const { unmount, box, byId } = mountAt('adwaita/overlay-split-view.blp', 652, 340);
            try {
                // GTK: sidebar 0,46 180x294.
                expect(near(box(byId('sidebar')).height, 294)).toBe(true);
            } finally {
                unmount();
            }
        });

        await it('a centred toolbar-view content widget keeps its own height', async () => {
            const { unmount, box, byId } = mountAt('adwaita/navigation-view.blp', 652, 340);
            try {
                // GTK: open_button 245,171 161x44.
                const button = box(byId('open_button'));
                expect(near(button.height, 44)).toBe(true);
                expect(near(button.y, 171)).toBe(true);
            } finally {
                unmount();
            }
        });

        await it("a status page has upstream's metrics: a 128px icon, the child where GTK puts it", async () => {
            const { unmount, box, byId, host } = mountAt('adwaita/status-page.blp', 652, 400);
            try {
                const icon = host.querySelector('.adw-status-page-icon') as HTMLElement;
                expect(box(icon).width).toBe(128);
                expect(box(icon).height).toBe(128);
                // GTK: new_button 239,311 174x44.
                expect(near(box(byId('new_button')).y, 311, 3)).toBe(true);
            } finally {
                unmount();
            }
        });

        await it('a carousel does not widen the box it fills to the sum of its pages', async () => {
            const { unmount, box, root } = mountAt('adwaita/carousel.blp', 652, 260);
            try {
                // GTK: the box is 652 wide, the window's width.
                expect(box(root).width).toBe(652);
            } finally {
                unmount();
            }
        });

        await it('tooltip-text becomes the icon button tooltip and accessible name', async () => {
            const { unmount, byId } = mountAt('adwaita/toolbar-view.blp', 652, 300);
            try {
                const inner = byId('add_button').querySelector('button') as HTMLButtonElement;
                expect(inner.title).toBe('Add');
                expect(inner.getAttribute('aria-label')).toBe('Add');
            } finally {
                unmount();
            }
        });
    });
};
