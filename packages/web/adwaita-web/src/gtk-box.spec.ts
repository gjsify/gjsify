// DOM-level tests for <gtk-box>, read off LAYOUT rather than the element's own state: an
// element asserting its bookkeeping agrees with itself while the page is wrong.
//
// The last case is the reason the element exists — an authored tree with a `Gtk.Box` of
// `Gtk.Label`s, mounted through the shipped `mountSharedTree`, was an unknown inline element
// holding two unknown empty ones. It is a `SharedTreeNode` literal, the shape a `.blp`'s
// `?shared-tree` projection hands over, so the case holds without the build seam.

import { describe, expect, it } from '@gjsify/unit';

import { BOX_ORIENTATION_VECTORS, BOX_SPACING_VECTORS, type SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { Gtk } from '@gjsify/adwaita-web';
import { mountSharedTree } from './shared-tree-builder.js';

import type { GtkBox } from './elements/gtk-box.js';

/** A box with `count` fixed-size children, in a 400px-wide host. */
function mount(count = 3): { box: GtkBox; kids: HTMLElement[]; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = '400px';
    document.body.appendChild(host);
    const box = document.createElement('gtk-box') as GtkBox;
    const kids: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
        const kid = document.createElement('div');
        kid.style.width = `${20 + i * 10}px`;
        kid.style.height = '10px';
        box.appendChild(kid);
        kids.push(kid);
    }
    host.appendChild(box);
    return { box, kids, host };
}

const rect = (el: Element) => el.getBoundingClientRect();

/** Author `value` the way markup does: absent is no attribute at all. */
function author(el: HTMLElement, name: string, value: string | number | null): void {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, String(value));
}

export const GtkBoxTest = async () => {
    await describe('<gtk-box> against BOX_SPACING_VECTORS', async () => {
        for (const vector of BOX_SPACING_VECTORS) {
            await it(vector.rule, () => {
                const { box, host } = mount(0);
                author(box, 'spacing', vector.value);
                expect(box.spacing).toBe(vector.spacing);
                expect(getComputedStyle(box).columnGap).toBe(`${vector.spacing}px`);
                host.remove();
            });
        }
    });

    await describe('<gtk-box> against BOX_ORIENTATION_VECTORS', async () => {
        for (const vector of BOX_ORIENTATION_VECTORS) {
            await it(vector.rule, () => {
                const { box, host } = mount(0);
                author(box, 'orientation', vector.value);
                expect(box.orientation).toBe(vector.orientation);
                expect(getComputedStyle(box).flexDirection).toBe(vector.orientation === 'vertical' ? 'column' : 'row');
                host.remove();
            });
        }
    });

    await describe('<gtk-box> orientation', async () => {
        await it('lays children out in a row by default, as GtkOrientable does', () => {
            const { box, kids, host } = mount();
            expect(box.orientation).toBe('horizontal');
            expect(rect(kids[1]).left).toBe(rect(kids[0]).right);
            expect(rect(kids[1]).top).toBe(rect(kids[0]).top);
            host.remove();
        });

        await it('stacks them in a column when vertical, each child taking the full width', () => {
            const { box, kids, host } = mount();
            box.orientation = 'vertical';
            expect(rect(kids[1]).top).toBe(rect(kids[0]).bottom);
            expect(rect(kids[0]).left).toBe(rect(kids[1]).left);
            host.remove();
        });
    });

    await describe('<gtk-box> spacing', async () => {
        await it('puts the gap BETWEEN children only, never at the edges', () => {
            const { box, kids, host } = mount();
            box.spacing = 12;
            expect(rect(kids[0]).left).toBe(rect(box).left);
            expect(rect(kids[1]).left - rect(kids[0]).right).toBe(12);
            expect(rect(kids[2]).left - rect(kids[1]).right).toBe(12);
            host.remove();
        });

        await it('runs along the column when vertical', () => {
            const { box, kids, host } = mount();
            box.orientation = 'vertical';
            box.setAttribute('spacing', '6');
            expect(rect(kids[1]).top - rect(kids[0]).bottom).toBe(6);
            host.remove();
        });
    });

    await describe('<gtk-box> homogeneous', async () => {
        await it('gives every child the same share of the axis', () => {
            const { box, kids, host } = mount();
            box.homogeneous = true;
            const widths = kids.map((kid) => Math.round(rect(kid).width));
            expect(widths[0]).toBe(widths[1]);
            expect(widths[1]).toBe(widths[2]);
            expect(widths[0]).toBeGreaterThan(100);
            host.remove();
        });
    });

    await describe('<gtk-box> notify', async () => {
        await it('fires notify:: on a REAL change only, with the normalised value', () => {
            const { box, host } = mount(0);
            const seen: unknown[] = [];
            box.addEventListener('notify::spacing', (event) => seen.push((event as CustomEvent).detail.spacing));
            box.spacing = 4;
            box.setAttribute('spacing', '4.0');
            box.spacing = -1;
            expect(seen.join(',')).toBe('4,0');
            host.remove();
        });
    });

    await describe('<gtk-box> as the Gtk.Box of an authored tree', async () => {
        const tree: SharedTreeNode = {
            tag: 'GtkBox',
            props: { orientation: 'vertical', spacing: 18 },
            children: [
                { tag: 'GtkLabel', props: { label: 'Effect services' }, styleClasses: ['title-1'] },
                { tag: 'GtkLabel', props: { label: 'effect/FileSystem over Gio.File', xalign: 0 } },
            ],
        };

        await it('mounts upgraded elements, stacked by the authored orientation and spacing', () => {
            const { root, unmount } = mountSharedTree(tree);
            try {
                expect(root instanceof Gtk.Box).toBe(true);
                const labels = [...root.children];
                expect(labels.every((label) => label instanceof Gtk.Label)).toBe(true);
                expect(getComputedStyle(root).flexDirection).toBe('column');
                expect(Math.round(rect(labels[1]).top - rect(labels[0]).bottom)).toBe(18);
            } finally {
                unmount();
            }
        });

        await it('renders the authored text on screen, and the style class it carries', () => {
            const { root, unmount } = mountSharedTree(tree);
            try {
                const [title, subtitle] = [...root.children] as HTMLElement[];
                expect(title.textContent).toBe('Effect services');
                expect(subtitle.textContent).toBe('effect/FileSystem over Gio.File');
                expect(rect(title).height).toBeGreaterThan(0);
                expect(title.classList.contains('title-1')).toBe(true);
                expect(getComputedStyle(title).fontWeight).toBe('800');
            } finally {
                unmount();
            }
        });
    });
};
