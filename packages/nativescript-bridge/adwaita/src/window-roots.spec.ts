// `Adw.Window`, `Adw.ApplicationWindow` and `Adw.Dialog`, built as the REAL classes against the
// platform double and through the shared-tree builder.
//
// On the TREES entry for the reason `containers.spec.ts` gives. What it measures is the port's
// tree: where `content` and a presented dialog land and in which paint order, what the host
// walk finds, and what `can-close` does to `close()`. It cannot measure a layout pass or a
// scrim, so "above the content" is asserted as paint ORDER (child index).

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { GridLayout, type LayoutBase, View } from './testing/ns-core.mjs';

/** The children of a layout, in paint order. */
function childrenOf(layout: object): object[] {
    const base = layout as LayoutBase;
    return Array.from({ length: base.getChildrenCount() }, (_unused, index) => base.getChildAt(index));
}

const asView = (value: unknown): View => value as View;

/** Whether `actual` holds exactly `expected`, by identity — a dialog and its host point at each other. */
const sameViews = (actual: readonly object[], expected: readonly object[]): boolean =>
    actual.length === expected.length && actual.every((view, index) => view === expected[index]);

export const AdwWindowRootsNsTest = async () => {
    for (const [name, Window] of [
        ['Adw.Window', Adw.Window],
        ['Adw.ApplicationWindow', Adw.ApplicationWindow],
    ] as const) {
        await describe(name, async () => {
            await it('is a one-cell grid that holds its `content`', () => {
                const window = new Window();
                const content = new Gtk.Label();
                window.content = content as unknown as never;
                expect(window instanceof GridLayout).toBe(true);
                expect(window.content === (content as unknown)).toBe(true);
                expect(window.get_content() === (content as unknown)).toBe(true);
                expect(childrenOf(window)).toStrictEqual([content]);
            });

            await it('replaces the content, and null empties it', () => {
                const window = new Window();
                const first = new Gtk.Label();
                const second = new Gtk.Label();
                window.set_content(first as unknown as never);
                window.set_content(second as unknown as never);
                expect(sameViews(childrenOf(window), [second])).toBe(true);
                window.content = null;
                expect(window.content).toBe(null);
                expect(childrenOf(window).length).toBe(0);
            });

            await it('wears the page class, so a window built into a bare layout has the window fill', () => {
                expect(new Window().className).toBe('adw-window');
                const styled = new Window();
                styled.add_css_class('narrow');
                expect(styled.className).toBe('adw-window narrow');
                expect(styled.styleClasses).toStrictEqual(['narrow']);
            });

            await it('holds title, default-width and default-height, as the strings XML hands over', () => {
                const window = new Window();
                expect(window.title).toBe('');
                expect(window.defaultWidth).toBe(0);
                expect(window.defaultHeight).toBe(0);
                window.title = 'Help';
                (window as unknown as Record<string, unknown>).defaultWidth = '800';
                window.defaultHeight = 600;
                expect(window.title).toBe('Help');
                expect(window.defaultWidth).toBe(800);
                expect(window.defaultHeight).toBe(600);
                expect(() => (window.defaultWidth = -5)).toThrow('is not a size');
            });

            await it('takes the construct bag', () => {
                const content = new Gtk.Label();
                const window = new Window({
                    title: 'Learn6502',
                    defaultWidth: 360,
                    content: content as unknown as never,
                });
                expect(window.title).toBe('Learn6502');
                expect(window.defaultWidth).toBe(360);
                expect(childrenOf(window)).toStrictEqual([content]);
            });
        });
    }

    await describe('a window through the shared-tree builder', async () => {
        await it('builds the projected spelling of a window template: kebab names, a bare child, base props', () => {
            const window = build({
                tag: 'AdwApplicationWindow',
                props: {
                    name: 'application-window',
                    'default-width': 360,
                    'default-height': 670,
                    'width-request': 360,
                },
                children: [{ tag: 'GtkLabel' }],
            }) as unknown as Adw.ApplicationWindow;
            expect(window.defaultWidth).toBe(360);
            expect(window.defaultHeight).toBe(670);
            expect(window.widthRequest).toBe(360);
            expect(window.name).toBe('application-window');
            expect(window.content instanceof View).toBe(true);
        });

        await it('`content:` is the one slot; any other is refused by name', () => {
            const window = build({
                tag: 'AdwWindow',
                children: [{ tag: 'GtkLabel', slot: 'content' }],
            }) as unknown as Adw.Window;
            expect(window.content instanceof View).toBe(true);
            expect(() => build({ tag: 'AdwWindow', children: [{ tag: 'GtkLabel', slot: 'breakpoint' }] })).toThrow(
                'declares no such builder slot',
            );
        });
    });

    await describe('Adw.Dialog', async () => {
        await it('is a collapsed scrim over a card, and the child lives in the card', () => {
            const dialog = new Adw.Dialog();
            const child = new Gtk.Label();
            dialog.child = child as unknown as never;
            expect(dialog.visibility).toBe('collapse');
            expect(dialog.open).toBe(false);
            expect(dialog.className).toBe('adw-dialog');
            const [card] = childrenOf(dialog);
            expect((card as View).className).toBe('adw-dialog-card');
            expect(childrenOf(card!)).toStrictEqual([child]);
            dialog.child = null;
            expect(childrenOf(card!).length).toBe(0);
        });

        await it('accepts title, content-width/height, follows-content-size and presentation-mode', () => {
            const dialog = new Adw.Dialog({ title: 'Share Example', contentWidth: 600, contentHeight: 700 });
            expect(dialog.title).toBe('Share Example');
            expect(dialog.contentWidth).toBe(600);
            expect(dialog.contentHeight).toBe(700);
            const [card] = childrenOf(dialog) as View[];
            expect(card!.width).toBe(600);
            expect(card!.height).toBe(700);
            expect(card!.accessibilityLabel).toBe('Share Example');
            (dialog as unknown as Record<string, unknown>).followsContentSize = 'false';
            expect(dialog.followsContentSize).toBe(false);
            expect(dialog.presentationMode).toBe('auto');
        });

        await it('-1 and 0 content sizes follow the content', () => {
            const dialog = new Adw.Dialog({ contentWidth: 600 });
            dialog.contentWidth = -1;
            expect((childrenOf(dialog)[0] as View).width).toBe('auto');
        });

        await it('bottom-sheet pins the card to the bottom edge at full width; floating centres it', () => {
            const dialog = new Adw.Dialog({ contentWidth: 400 });
            const [card] = childrenOf(dialog) as View[];
            expect(card!.verticalAlignment).toBe('middle');
            dialog.presentationMode = 'bottom-sheet';
            expect(card!.verticalAlignment).toBe('bottom');
            expect(card!.horizontalAlignment).toBe('stretch');
            expect(card!.width).toBe('auto');
            dialog.presentationMode = 'floating';
            expect(card!.verticalAlignment).toBe('middle');
            expect(() => ((dialog as unknown as Record<string, unknown>).presentationMode = 'window')).toThrow(
                'is not a Adw.DialogPresentationMode',
            );
        });

        await it('present(parent) mounts it ABOVE the window content and reveals it', () => {
            const window = new Adw.ApplicationWindow();
            const content = new Gtk.Box();
            const inner = new Gtk.Label();
            content.append(inner as unknown as never);
            window.content = content as unknown as never;
            const dialog = new Adw.Dialog();
            dialog.present(inner as unknown as never);
            expect(dialog.open).toBe(true);
            expect(sameViews(childrenOf(window), [content, dialog])).toBe(true);
            expect(sameViews(window.dialogs, [dialog])).toBe(true);
            expect(GridLayout.placementOf(asView(dialog))).toStrictEqual({
                row: 0,
                column: 0,
                rowSpan: 1,
                columnSpan: 1,
            });
        });

        await it('close() hides it, takes it out of the window and emits `closed`', () => {
            const window = new Adw.Window();
            const dialog = new Adw.Dialog();
            let closed = 0;
            dialog.connect('closed', () => closed++);
            dialog.present(window as unknown as never);
            dialog.close();
            expect(dialog.open).toBe(false);
            expect(childrenOf(window).length).toBe(0);
            expect(window.dialogs.length).toBe(0);
            expect(closed).toBe(1);
            // GTK lets a closed dialog be presented again.
            dialog.present(window as unknown as never);
            expect(sameViews(childrenOf(window), [dialog])).toBe(true);
        });

        await it('a second close() is a no-op: `closed` fires once', () => {
            const window = new Adw.Window();
            const dialog = new Adw.Dialog();
            let closed = 0;
            dialog.connect('closed', () => closed++);
            dialog.present(window as unknown as never);
            dialog.close();
            dialog.close();
            expect(closed).toBe(1);
        });

        await it('can-close=false makes close() emit `close-attempt` and stay; force_close() closes', () => {
            const window = new Adw.Window();
            const dialog = new Adw.Dialog({ canClose: false });
            const events: string[] = [];
            dialog.connect('close-attempt', () => events.push('attempt'));
            dialog.connect('closed', () => events.push('closed'));
            dialog.present(window as unknown as never);
            dialog.close();
            expect(dialog.open).toBe(true);
            expect(events).toStrictEqual(['attempt']);
            dialog.force_close();
            expect(dialog.open).toBe(false);
            expect(events).toStrictEqual(['attempt', 'closed']);
        });

        await it('stacks two dialogs, the later one on top', () => {
            const window = new Adw.Window();
            const first = new Adw.Dialog();
            const second = new Adw.Dialog();
            first.present(window as unknown as never);
            second.present(window as unknown as never);
            expect(sameViews(childrenOf(window), [first, second])).toBe(true);
            first.close();
            expect(sameViews(childrenOf(window), [second])).toBe(true);
        });

        await it('reveals in place a dialog the caller mounted itself, and leaves it mounted on close', () => {
            const layout = new Gtk.Grid();
            const dialog = new Adw.Dialog();
            layout.addChild(dialog as unknown as never);
            dialog.present();
            expect(dialog.open).toBe(true);
            dialog.close();
            expect(dialog.open).toBe(false);
            expect(sameViews(childrenOf(layout), [dialog])).toBe(true);
        });

        await it('refuses to present with no window and no mount, naming what to pass', () => {
            const dialog = new Adw.Dialog();
            expect(() => dialog.present()).toThrow('has no window to appear in');
            expect(() => dialog.present(new Gtk.Label() as unknown as never)).toThrow('has no window to appear in');
            expect(dialog.open).toBe(false);
        });

        await it('is built from a template: `child:`, bare, the slot refusal, and the dialog props', () => {
            const dialog = build({
                tag: 'AdwDialog',
                props: {
                    title: 'Share Example',
                    'content-width': 600,
                    'content-height': 700,
                    'follows-content-size': false,
                },
                children: [{ tag: 'GtkLabel' }],
            }) as unknown as Adw.Dialog;
            expect(dialog.title).toBe('Share Example');
            expect(dialog.contentWidth).toBe(600);
            expect(dialog.followsContentSize).toBe(false);
            expect(dialog.child instanceof View).toBe(true);
            expect(() => build({ tag: 'AdwDialog', children: [{ tag: 'GtkLabel', slot: 'content' }] })).toThrow(
                'declares no such builder slot',
            );
        });
    });
};
