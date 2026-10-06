// `Adw.Bin`, `Gtk.Revealer`, `Gtk.Overlay`, `Gtk.ScrolledWindow` — the pass-through containers,
// built as the REAL classes against the platform double and, where a `.blp` reaches them,
// through the shared-tree builder.
//
// This lives on the TREES entry (`src/test.trees.mts`), not the pure one, for the reason
// `clamp-child.spec.ts` gives: the widget classes evaluate `@nativescript/core` at module
// scope. What it can measure is the port's tree — which child lands where, in which order,
// what a string from an XML attribute does to a setter. It cannot measure a layout pass, so
// "the overlay is stacked on top" is asserted as paint ORDER (child index) and cell, which is
// all this platform's grid uses to stack.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { GridLayout, Label, type LayoutBase, ScrollView, View } from './testing/ns-core.mjs';

const label = (): Label => new Label();

/** The children of a layout, in paint order. */
function childrenOf(layout: object): object[] {
    const base = layout as LayoutBase;
    return Array.from({ length: base.getChildrenCount() }, (_unused, index) => base.getChildAt(index));
}

export const AdwContainersNsTest = async () => {
    await describe('Adw.Bin', async () => {
        await it('holds one child in its one cell', () => {
            const bin = new Adw.Bin();
            const child = label();
            bin.set_child(child as unknown as never);
            expect(bin.child === (child as unknown)).toBe(true);
            expect(bin.get_child() === (child as unknown)).toBe(true);
            expect(childrenOf(bin)).toStrictEqual([child]);
            expect(GridLayout.placementOf(child)).toStrictEqual({ row: 0, column: 0, rowSpan: 1, columnSpan: 1 });
        });

        await it('a second child REPLACES the first, and null empties it', () => {
            const bin = new Adw.Bin();
            const first = label();
            const second = label();
            bin.child = first as unknown as never;
            bin.child = second as unknown as never;
            expect(childrenOf(bin)).toStrictEqual([second]);
            bin.child = null;
            expect(bin.child).toBe(null);
            expect(childrenOf(bin).length).toBe(0);
        });

        await it('the construct bag takes `child`', () => {
            const child = label();
            const bin = new Adw.Bin({ child: child as unknown as never });
            expect(childrenOf(bin)).toStrictEqual([child]);
        });

        await it('a bare child and `child:` both reach the child door', () => {
            const viaBuilder = build({ tag: 'AdwBin', children: [{ tag: 'GtkLabel' }] }) as unknown as Adw.Bin;
            const viaSlot = build({
                tag: 'AdwBin',
                children: [{ tag: 'GtkLabel', slot: 'child' }],
            }) as unknown as Adw.Bin;
            expect(viaBuilder.child instanceof Label).toBe(true);
            expect(viaSlot.child instanceof Label).toBe(true);
        });

        await it('an unknown slot is refused by name rather than placed somewhere close', () => {
            expect(() => build({ tag: 'AdwBin', children: [{ tag: 'GtkLabel', slot: 'top' }] })).toThrow(
                'declares no such builder slot',
            );
        });

        await it('is transparent: writes no className until a style class is given', () => {
            const bin = new Adw.Bin();
            expect(bin.className).toBe(undefined);
            bin.add_css_class('card');
            expect(bin.className).toBe('card');
        });

        await it('styleClasses is the string door and the five verbs agree with it', () => {
            const bin = new Adw.Bin();
            bin.styleClasses = 'card boxed-list';
            expect(bin.className).toBe('card boxed-list');
            expect(bin.has_css_class('card')).toBe(true);
            bin.remove_css_class('card');
            expect(bin.get_css_classes()).toStrictEqual(['boxed-list']);
            bin.set_css_classes(['a', 'b']);
            expect(bin.styleClasses).toStrictEqual(['a', 'b']);
        });

        await it('a `css-classes`-style list from a tree reaches styleClasses', () => {
            const bin = build({ tag: 'AdwBin', styleClasses: ['theme-mode-selector'] }) as unknown as Adw.Bin;
            expect(bin.styleClasses).toStrictEqual(['theme-mode-selector']);
        });

        await it('takes GTK layout properties and signals like every widget', () => {
            const bin = build({ tag: 'AdwBin', props: { halign: 'center', valign: 'start' } }) as unknown as Adw.Bin;
            expect(bin.halign).toBe('center');
            expect(bin.valign).toBe('start');
            expect(typeof bin.connect).toBe('function');
        });
    });

    await describe('single-child containers: alignment sizes the column', async () => {
        const columns = (view: object): string[] =>
            ((view as unknown as Record<string, { gridUnitType: string }[]>)._columns ?? []).map((s) => s.gridUnitType);

        // The platform double has no `onLoaded` lifecycle to drive, so the load step is called directly.
        const load = (bin: object): void =>
            (bin as unknown as { _syncColumnToAlignment(): void })._syncColumnToAlignment();

        await it('a stretched Bin keeps its star column', () => {
            const bin = new Adw.Bin();
            load(bin);
            expect(columns(bin)).toStrictEqual(['star']);
        });

        await it('a Bin aligned end wraps its child: auto column, star again when stretched back', () => {
            const bin = new Adw.Bin();
            bin.horizontalAlignment = 'right';
            load(bin);
            expect(columns(bin)).toStrictEqual(['auto']);
            bin.horizontalAlignment = 'stretch';
            load(bin);
            expect(columns(bin)).toStrictEqual(['star']);
        });
    });

    await describe('Gtk.Revealer', async () => {
        await it('does not reveal by default, as in C — the child is collapsed', () => {
            const revealer = new Gtk.Revealer();
            const child = label();
            revealer.child = child as unknown as never;
            expect(revealer.revealChild).toBe(false);
            expect(child.visibility).toBe('collapse');
        });

        await it('reveal-child toggles the child visibility and notifies', () => {
            const revealer = new Gtk.Revealer();
            const child = label();
            revealer.child = child as unknown as never;
            const seen: string[] = [];
            revealer.connect('notify::reveal-child', () => seen.push('notified'));

            revealer.revealChild = true;
            expect(child.visibility).toBe('visible');
            expect(revealer.childRevealed).toBe(true);
            revealer.revealChild = false;
            expect(child.visibility).toBe('collapse');
            expect(seen.length).toBe(2);
        });

        await it('writing the same value again notifies nothing', () => {
            const revealer = new Gtk.Revealer({ revealChild: true });
            const seen: string[] = [];
            revealer.connect('notify::reveal-child', () => seen.push('x'));
            revealer.revealChild = true;
            expect(seen.length).toBe(0);
        });

        await it('a child set AFTER reveal-child takes the current state', () => {
            const revealer = new Gtk.Revealer({ revealChild: true });
            const child = label();
            revealer.child = child as unknown as never;
            expect(child.visibility).toBe('visible');
        });

        await it('reads the string an XML attribute hands the setter — `"false"` is not truthy', () => {
            const revealer = new Gtk.Revealer();
            (revealer as unknown as { revealChild: string }).revealChild = 'true';
            expect(revealer.revealChild).toBe(true);
            (revealer as unknown as { revealChild: string }).revealChild = 'false';
            expect(revealer.revealChild).toBe(false);
        });

        await it('accepts transition-type in both spellings, holds it, and refuses a stranger', () => {
            const revealer = build({
                tag: 'GtkRevealer',
                props: { 'transition-type': 'slide_up', 'reveal-child': true },
                children: [{ tag: 'GtkLabel', slot: 'child' }],
            }) as unknown as Gtk.Revealer;
            expect(revealer.transitionType).toBe('slide-up');
            expect(revealer.revealChild).toBe(true);
            expect(() => (revealer.transitionType = 'wobble' as never)).toThrow('Gtk.RevealerTransitionType');
        });

        await it('transition-duration is held in ms, defaulting to 250', () => {
            const revealer = new Gtk.Revealer();
            expect(revealer.transitionDuration).toBe(250);
            (revealer as unknown as { transitionDuration: string }).transitionDuration = '400';
            expect(revealer.transitionDuration).toBe(400);
        });
    });

    await describe('Gtk.Overlay', async () => {
        await it('stacks overlays above the main child, in add order, all in cell 0,0', () => {
            const overlay = new Gtk.Overlay();
            const main = label();
            const first = label();
            const second = label();
            overlay.add_overlay(first as unknown as never);
            overlay.add_overlay(second as unknown as never);
            overlay.child = main as unknown as never;

            // The main child was written LAST and still paints at the bottom.
            expect(childrenOf(overlay)).toStrictEqual([main, first, second]);
            for (const view of [main, first, second]) {
                expect(GridLayout.placementOf(view)).toStrictEqual({ row: 0, column: 0, rowSpan: 1, columnSpan: 1 });
            }
        });

        await it('overlays keep their own halign/valign — the cell does the placing', () => {
            const overlay = new Gtk.Overlay();
            const badge = build({
                tag: 'GtkLabel',
                props: { halign: 'end', valign: 'start' },
            }) as unknown as Gtk.Label;
            overlay.add_overlay(badge as unknown as never);
            expect(badge.halign).toBe('end');
            expect(badge.valign).toBe('start');
            expect(childrenOf(overlay)).toStrictEqual([badge]);
        });

        await it('remove_overlay takes one out and leaves a stranger alone', () => {
            const overlay = new Gtk.Overlay();
            const kept = label();
            const gone = label();
            overlay.add_overlay(kept as unknown as never);
            overlay.add_overlay(gone as unknown as never);
            overlay.remove_overlay(gone as unknown as never);
            overlay.remove_overlay(label() as unknown as never);
            expect(overlay.overlays).toStrictEqual([kept]);
            expect(childrenOf(overlay)).toStrictEqual([kept]);
        });

        await it('adding the same overlay twice stacks it once', () => {
            const overlay = new Gtk.Overlay();
            const view = label();
            overlay.add_overlay(view as unknown as never);
            overlay.add_overlay(view as unknown as never);
            expect(childrenOf(overlay).length).toBe(1);
        });

        await it('a .blp `child:` and `[overlay]` reach their own destinations; a bare child is the main one', () => {
            const overlay = build({
                tag: 'GtkOverlay',
                children: [
                    { tag: 'GtkLabel', slot: 'overlay', props: { label: 'badge' } },
                    { tag: 'GtkBox', slot: 'child' },
                ],
            }) as unknown as Gtk.Overlay;
            expect(overlay.child instanceof Gtk.Box).toBe(true);
            expect(overlay.overlays.length).toBe(1);
            expect(childrenOf(overlay)[0] instanceof Gtk.Box).toBe(true);

            const bare = build({ tag: 'GtkOverlay', children: [{ tag: 'GtkBox' }] }) as unknown as Gtk.Overlay;
            expect(bare.child instanceof Gtk.Box).toBe(true);
            expect(bare.overlays.length).toBe(0);
        });

        await it('replacing the main child leaves the overlays in place', () => {
            const overlay = new Gtk.Overlay();
            const badge = label();
            overlay.add_overlay(badge as unknown as never);
            overlay.child = label() as unknown as never;
            const replacement = label();
            overlay.child = replacement as unknown as never;
            expect(childrenOf(overlay)).toStrictEqual([replacement, badge]);
        });
    });

    await describe('Gtk.ScrolledWindow', async () => {
        const scrollOf = (window: object): ScrollView =>
            childrenOf(window).find((view) => view instanceof ScrollView) as ScrollView;

        await it('wraps a real ScrollView and the child is its content', () => {
            const window = new Gtk.ScrolledWindow();
            const child = label();
            window.child = child as unknown as never;
            expect(childrenOf(window).length).toBe(1);
            expect(scrollOf(window).content).toBe(child);
            expect(window.child === (child as unknown)).toBe(true);
        });

        await it('removing the child empties the ScrollView', () => {
            const window = new Gtk.ScrolledWindow();
            window.child = label() as unknown as never;
            window.child = null;
            expect(scrollOf(window).content).toBe(null);
        });

        await it('scrolls vertically by default and for `hscrollbar-policy: never`', () => {
            const window = new Gtk.ScrolledWindow();
            expect(scrollOf(window).orientation).toBe('vertical');
            window.hscrollbarPolicy = 'never';
            expect(scrollOf(window).orientation).toBe('vertical');
        });

        await it('scrolls horizontally when only the horizontal axis may', () => {
            const window = build({
                tag: 'GtkScrolledWindow',
                props: { 'vscrollbar-policy': 'never' },
            }) as unknown as Gtk.ScrolledWindow;
            expect(window.vscrollbarPolicy).toBe('never');
            expect(window.hscrollbarPolicy).toBe('automatic');
            expect(scrollOf(window).orientation).toBe('horizontal');
        });

        await it('refuses a policy that is not a Gtk.PolicyType', () => {
            const window = new Gtk.ScrolledWindow();
            expect(() => (window.hscrollbarPolicy = 'sometimes' as never)).toThrow('Gtk.PolicyType');
        });

        await it('has-frame is read from the string an attribute hands the setter', () => {
            const window = build({
                tag: 'GtkScrolledWindow',
                props: { 'has-frame': false },
            }) as unknown as Gtk.ScrolledWindow;
            expect(window.hasFrame).toBe(false);
            (window as unknown as { hasFrame: string }).hasFrame = 'true';
            expect(window.hasFrame).toBe(true);
        });

        await it('a bare child in a tree is THE child, and it lands inside the ScrollView', () => {
            const window = build({
                tag: 'GtkScrolledWindow',
                children: [{ tag: 'AdwClamp', props: { 'maximum-size': 600 } }],
            }) as unknown as Gtk.ScrolledWindow;
            expect(window.child instanceof View).toBe(true);
            expect(scrollOf(window).content instanceof Adw.Clamp).toBe(true);
        });
    });
};

export default AdwContainersNsTest;
