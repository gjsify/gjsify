// REAL `.blp` FILES, BUILT BY THIS RENDERER — the GtkWidget layout properties, a modal bottom
// sheet, a stack authored with page records whose switchers name it by id, and a carousel
// with the two indicators that bind to it.
//
// `./shared-trees.spec.ts` drives hand-written `SharedTreeNode` literals. These trees come out
// of `@gjsify/vite-plugin-blueprint`'s `?shared-tree` exit at build time, so what is under test
// is what a gallery block written in Blueprint hands `build()`: kebab-case property names, enum
// NICKS as strings, numbers as numbers, an object reference as the id STRING it names, and a
// `child:` placement as a slot. Every one of those reached a refusal in `build()` before this
// change — `halign`, `margin-start`, `xalign`, `modal`, `Adw.ViewStackPage` and `stack: stack`
// had nothing to land on.
//
// The fixtures live in `@gjsify/adwaita-core/src/conformance/blueprints/`, beside the vectors
// both renderers are held to, and `adwaita-web`'s `blueprint-layout.spec.ts` mounts the ones
// its elements can take. They are Blueprint corpus reality probes, so the reference compiler holds each one
// too.
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, reachable only under that entry's `--alias @nativescript/core`.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import { ViewStackPage } from './namespace/adw.js';
import { Label, LayoutBase } from './testing/ns-core.mjs';

import sheetTree from '../../../web/adwaita-core/src/conformance/blueprints/bottom-sheet-layout.blp?shared-tree';
import stackTree from '../../../web/adwaita-core/src/conformance/blueprints/view-stack-pages.blp?shared-tree';
import carouselTree from '../../../web/adwaita-core/src/conformance/blueprints/carousel-indicators.blp?shared-tree';

/** A built view, read through the members a test asks about. */
type Built = Record<string, unknown> & {
    getViewById(id: string): Built | undefined;
    notify(data: { eventName: string; object: unknown }): void;
    addEventListener(eventName: string, callback: () => void): void;
};

const built = (tree: Parameters<typeof build>[0]): Built => build(tree) as unknown as Built;

/** The view with `id`, or a failure naming the id — never an `undefined` read as a value. */
function byId(root: Built, id: string): Built {
    const view = root.getViewById(id);
    if (view === undefined) throw new Error(`the built tree has no view with the id '${id}'`);
    return view;
}

/** Every view under `root` whose `className` carries `name`, depth-first. */
function withClass(root: object, name: string, into: Built[] = []): Built[] {
    const className = (root as { className?: string }).className ?? '';
    if (className.split(' ').includes(name)) into.push(root as Built);
    if (root instanceof LayoutBase) {
        for (let index = 0; index < root.getChildrenCount(); index++) withClass(root.getChildAt(index), name, into);
    }
    return into;
}

export const AdwBlueprintTreesNsTest = async () => {
    await describe('bottom-sheet-layout.blp: GtkWidget layout properties', async () => {
        await it('the centred button reaches the platform alignments and reads back as GTK nicks', () => {
            const toggle = byId(built(sheetTree), 'toggle');

            expect(toggle.horizontalAlignment).toBe('center');
            // NativeScript's vertical vocabulary has no `center`: `middle` is the translation,
            // and writing `center` itself would stretch (construct-props.ts).
            expect(toggle.verticalAlignment).toBe('middle');
            expect(toggle.halign).toBe('center');
            expect(toggle.valign).toBe('center');
            expect(toggle.vexpand).toBe(true);
            expect(toggle.hexpand).toBe(false);
        });

        await it('the four margins land on the four physical edges, start and end as LTR places them', () => {
            const box = byId(built(sheetTree), 'box');

            expect(box.marginLeft).toBe(18);
            expect(box.marginRight).toBe(12);
            expect(box.marginStart).toBe(18);
            expect(box.marginEnd).toBe(12);
            // `margin-top`/`margin-bottom` are NativeScript's own names; the case rule is all
            // they need, and the platform takes the length as the string an attribute is.
            expect(Number(box.marginTop)).toBe(18);
            expect(Number(box.marginBottom)).toBe(24);
        });

        await it('an xalign of 0 puts the title at the start edge', () => {
            const title = byId(built(sheetTree), 'title');

            expect(title.xalign).toBe(0);
            expect(title.textAlignment).toBe('left');
            expect(title.halign).toBe('start');
        });

        await it('the caption holds its hexpand', () => {
            expect(byId(built(sheetTree), 'caption').hexpand).toBe(true);
        });

        await it('the open modal sheet lays its scrim over the content, and a tap on it closes', () => {
            const sheet = built(sheetTree);
            const scrims = withClass(sheet, 'adw-bottom-sheet-dimming');

            expect(sheet.modal).toBe(true);
            expect(sheet.open).toBe(true);
            expect(scrims.length).toBe(1);
            expect(scrims[0]?.visibility).toBe('visible');

            scrims[0]?.notify({ eventName: 'tap', object: scrims[0] });

            expect(sheet.open).toBe(false);
            expect(scrims[0]?.visibility).toBe('collapse');
        });

        await it('a sheet that is not modal opens with no scrim', () => {
            const sheet = built({ tag: 'AdwBottomSheet', props: { modal: false, open: true } });

            expect(sheet.modal).toBe(false);
            expect(withClass(sheet, 'adw-bottom-sheet-dimming')[0]?.visibility).toBe('collapse');
        });
    });

    await describe('the GtkWidget layout accessors refuse what GTK would not hold', async () => {
        await it('a baseline alignment names the reason it has no NativeScript counterpart', () => {
            expect(() => built({ tag: 'GtkButton', props: { valign: 'baseline-fill' } })).toThrow('baseline');
        });

        await it("NativeScript's own alignment words are not a Gtk.Align", () => {
            expect(() => built({ tag: 'GtkButton', props: { halign: 'left' } })).toThrow('is not a Gtk.Align');
        });

        await it('a margin outside 0 … G_MAXINT16 is refused, not kept silently', () => {
            expect(() => built({ tag: 'GtkBox', props: { 'margin-start': -4 } })).toThrow('is not a margin');
        });

        await it('an xalign between the three exact points is refused rather than snapped', () => {
            expect(() => built({ tag: 'GtkLabel', props: { xalign: 0.25 } })).toThrow(
                'has no NativeScript counterpart',
            );
        });

        await it('xalign clamps as gtk_label_set_xalign does, and 1 is the end edge', () => {
            const label = built({ tag: 'GtkLabel', props: { xalign: 3 } });

            expect(label.xalign).toBe(1);
            expect(label.textAlignment).toBe('right');
        });

        await it('in RTL the start edge is on the right, for margins and for xalign', () => {
            const label = built({ tag: 'GtkLabel' });
            (label.style as { direction: string | null }).direction = 'rtl';

            label.marginStart = 6;
            label.xalign = 0;

            expect(label.marginRight).toBe(6);
            expect(label.marginLeft).toBe(0);
            expect(label.textAlignment).toBe('right');
            expect(label.halign).toBe('fill');
        });

        await it('the constant spelling a GJS snippet carries is read too', () => {
            // `Gtk.Align.END` is 2; the construct-props bag hands it to the same setter.
            const button = built({ tag: 'GtkButton' });
            button.halign = 2;

            expect(button.horizontalAlignment).toBe('end');
        });
    });

    await describe('view-stack-pages.blp: a stack authored with page records', async () => {
        await it('each record becomes a page with its name, title, icon and badge', () => {
            const stack = byId(built(stackTree), 'stack');
            const pages = stack.pages as ReadonlyArray<{
                name: string;
                title: string;
                icon: string;
                badgeNumber: number;
            }>;

            expect(pages.map((page) => page.name)).toStrictEqual(['inbox', 'starred']);
            expect(pages.map((page) => page.title)).toStrictEqual(['Inbox', 'Starred']);
            expect(pages[0]?.icon).toBe('mail-unread');
            expect(pages[1]?.badgeNumber).toBe(3);
            expect(stack.visibleChildName).toBe('inbox');
        });

        await it('both switchers bind to the stack by id, the one above it included', () => {
            const root = built(stackTree);
            const stack = byId(root, 'stack');
            const inline = byId(root, 'inline');
            const bar = byId(root, 'bar');

            expect(inline.stack).toBe(stack);
            expect(bar.stack).toBe(stack);
            expect((inline.views as unknown[]).length).toBe(2);
            expect(inline.halign).toBe('center');
        });

        await it('a record is read at adoption, so a later title write is refused by name', () => {
            const stack = byId(built(stackTree), 'stack');
            // Constructed directly: a page record is a value object, and a tree may not root at
            // one (`build` refuses it), so the record the stack adopts comes from its own class.
            const record = new ViewStackPage({ name: 'late' }) as unknown as Built;
            (record._addChildFromBuilder as (name: string, view: unknown) => void).call(record, 'child', new Label());
            (stack._addChildFromBuilder as (name: string, view: unknown) => void).call(
                stack,
                'adw:ViewStackPage',
                record,
            );

            expect(() => {
                record.title = 'Renamed';
            }).toThrow('was read when its stack adopted it');
        });

        // `add_page` refuses a record with no child (`g_return_val_if_fail`), so no page comes
        // of it. The record WAITS for one rather than throwing, because NativeScript's XML
        // builder hands it over before reading its `<adw:ViewStackPage.child>`; one that never
        // gets a child therefore stays out of the stack, as in C.
        await it('a record with no child never becomes a page, as add_page refuses one', () => {
            const stack = built({ tag: 'AdwViewStack', children: [{ tag: 'AdwViewStackPage' }] });

            expect((stack.pages as readonly unknown[]).length).toBe(0);
        });

        await it('a record handed over before its child becomes a page when the child arrives', () => {
            const stack = built({ tag: 'AdwViewStack' }) as unknown as {
                pages: ReadonlyArray<{ name: string }>;
                _addChildFromBuilder(name: string, view: object): void;
            };
            const record = new ViewStackPage({ name: 'inbox' });
            stack._addChildFromBuilder('', record);
            expect(stack.pages.length).toBe(0);

            // The XML door's own call: the record's child arrives through its child door.
            (record._addChildFromBuilder as (name: string, view: unknown) => void).call(record, 'child', new Label());
            expect(stack.pages.map((page) => page.name)).toStrictEqual(['inbox']);
        });

        await it('a bare child of the stack is a page with no name', () => {
            const stack = built({ tag: 'AdwViewStack', children: [{ tag: 'GtkLabel' }] });

            expect((stack.pages as ReadonlyArray<{ name: string }>).map((page) => page.name)).toStrictEqual(['']);
        });
    });

    await describe('an object reference is resolved by id, and only where the widget says so', async () => {
        await it('an id nothing in the tree carries is refused', () => {
            expect(() => built({ tag: 'AdwViewSwitcherBar', props: { stack: 'nowhere' } })).toThrow('names no object');
        });

        await it('two nodes with one id are refused', () => {
            expect(() =>
                built({
                    tag: 'GtkBox',
                    children: [
                        { tag: 'GtkLabel', id: 'twice' },
                        { tag: 'GtkLabel', id: 'twice' },
                    ],
                }),
            ).toThrow('duplicate id');
        });

        await it('a string that happens to equal an id stays a string where the property is not a reference', () => {
            const stack = built({
                tag: 'AdwViewStack',
                id: 'same',
                children: [{ tag: 'AdwViewStackPage', props: { name: 'same' }, children: [{ tag: 'GtkLabel' }] }],
            });

            expect((stack.pages as ReadonlyArray<{ name: string }>)[0]?.name).toBe('same');
        });
    });

    await describe('carousel-indicators.blp: a carousel and the indicators bound to it', async () => {
        /** The marker classes an indicator shows, in page order. */
        const markers = (indicator: Built): string[] =>
            withClass(indicator, 'adw-carousel-dot')
                .concat(withClass(indicator, 'adw-carousel-line'))
                .map((marker) => String(marker.className));

        await it('the carousel draws no indicator of its own', () => {
            const carousel = byId(built(carouselTree), 'carousel');

            expect(carousel.nPages).toBe(3);
            expect(withClass(carousel, 'adw-carousel-dot').length).toBe(0);
        });

        await it('both indicators bind to it by id and mark its current page', () => {
            const root = built(carouselTree);
            const carousel = byId(root, 'carousel');
            const dots = byId(root, 'dots');
            const lines = byId(root, 'lines');

            expect(dots.carousel).toBe(carousel);
            expect(lines.carousel).toBe(carousel);
            expect(markers(dots)).toStrictEqual(['adw-carousel-dot active', 'adw-carousel-dot', 'adw-carousel-dot']);
            expect(markers(lines)).toStrictEqual([
                'adw-carousel-line active',
                'adw-carousel-line',
                'adw-carousel-line',
            ]);
        });

        await it('a tap on a marker scrolls the carousel, and every bound indicator follows', () => {
            const root = built(carouselTree);
            const carousel = byId(root, 'carousel');
            const third = withClass(byId(root, 'dots'), 'adw-carousel-dot')[2];

            third?.notify({ eventName: 'tap', object: third });

            expect(carousel.currentPage).toBe(2);
            expect(markers(byId(root, 'lines'))).toStrictEqual([
                'adw-carousel-line',
                'adw-carousel-line',
                'adw-carousel-line active',
            ]);
        });

        await it('a page added after binding gets a marker', () => {
            const root = built(carouselTree);
            const carousel = byId(root, 'carousel');
            (carousel.append as (view: unknown) => void).call(carousel, built({ tag: 'GtkLabel' }));

            expect(markers(byId(root, 'dots')).length).toBe(4);
        });

        // The XML door. `Builder.load` writes `carousel="pager"` as the raw string before the
        // indicator is in any tree, so the id waits for `loaded` — the point where the platform
        // has attached the whole file (`id-reference.ts`). Nothing here loads a tree, so the
        // spec emits the event where the platform would.
        const xmlTree = () =>
            built({
                tag: 'GtkBox',
                children: [
                    { tag: 'AdwCarousel', id: 'pager', children: [{ tag: 'GtkLabel' }, { tag: 'GtkLabel' }] },
                    { tag: 'AdwCarouselIndicatorDots', id: 'dots' },
                ],
            });

        await it('a carousel id written as a string binds once the tree is loaded', () => {
            const root = xmlTree();
            const dots = byId(root, 'dots');
            dots.carousel = 'pager';

            expect(dots.carousel).toBe(null);
            dots.notify({ eventName: 'loaded', object: dots });

            expect(dots.carousel).toBe(byId(root, 'pager'));
            expect(markers(dots)).toStrictEqual(['adw-carousel-dot active', 'adw-carousel-dot']);
        });

        await it('an id nothing in the loaded tree carries is refused', () => {
            const dots = byId(xmlTree(), 'dots');
            dots.carousel = 'nowhere';

            expect(() => dots.notify({ eventName: 'loaded', object: dots })).toThrow('names no AdwCarousel');
        });

        await it('the markers run along a Gtk.Orientation, and nothing else', () => {
            const dots = built({ tag: 'AdwCarouselIndicatorDots', props: { orientation: 'vertical' } });

            expect(dots.orientation).toBe('vertical');
            expect(() => built({ tag: 'AdwCarouselIndicatorLines', props: { orientation: 'diagonal' } })).toThrow(
                'is not a Gtk.Orientation',
            );
        });
    });
};
