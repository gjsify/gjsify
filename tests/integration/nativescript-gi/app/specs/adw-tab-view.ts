// `Adw.TabView` ON A DEVICE (ADR 0105 § 2, route D) — `selected-page` declared with
// `withSignals(GridLayout, …)`. The vectors are libadwaita 1.9.4's, measured on real Adw;
// `adw-tab-view-route-d.node-gi.spec.ts` runs them off-device on the real-GI engine.
//
// `selected-page` is object-kind: the page is a headless record, never a real GObject slot.
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';

import { describe, expect, info, it } from '../reporter.js';

const SELECTED = 'notify::selected-page';

const watch = (view: Adw.TabView): string[] => {
    const seen: string[] = [];
    view.connect(SELECTED, () => seen.push(SELECTED));
    return seen;
};

export const adwTabViewSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Adw.TabView on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('starts empty, having emitted nothing', () => {
            const view = new Adw.TabView();
            const seen = watch(view);
            expect(view.selectedPage).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('appending the first page selects it and emits once; a later page emits nothing', () => {
            const view = new Adw.TabView();
            const seen = watch(view);
            view.append({ id: 'one', content: new Gtk.Label() });
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe(SELECTED);
            expect(view.selectedPage?.id).toBe('one');
            view.append({ id: 'two', content: new Gtk.Label() });
            expect(seen.length).toBe(1);
        });

        await it('selected-page selects by page and emits once', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            const seen = watch(view);
            view.selectedPage = view.pages[1]!;
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe(SELECTED);
            expect(view.selectedPage?.id).toBe('two');
        });

        await it('selected-page also takes the page id, the one spelling an XML attribute carries', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            const seen = watch(view);
            (view as unknown as { selectedPage: unknown }).selectedPage = 'two';
            expect(seen.join()).toBe(SELECTED);
            expect(view.selectedPage?.id).toBe('two');
        });

        await it('repeated writes emit nothing', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            view.selectedPage = view.pages[1]!;
            const seen = watch(view);
            view.selectedPage = view.pages[1]!;
            view.set_selected_page('two');
            info(`seen=${seen.join('|')}`);
            expect(seen.length).toBe(0);
        });

        await it('closing the selected page emits once for the successor, and once more for the last page', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            view.selectedPage = view.pages[0]!;
            const seen = watch(view);
            view.close_page('one');
            expect(seen.length).toBe(1);
            expect(view.selectedPage?.id).toBe('two');
            view.close_page('two');
            info(`seen=${seen.join('|')}`);
            expect(seen.length).toBe(2);
            expect(view.selectedPage).toBe(null);
        });

        await it('select_next_page / select_previous_page move the property and notify through it', () => {
            const view = new Adw.TabView();
            view.append({ id: 'one', content: new Gtk.Label() });
            view.append({ id: 'two', content: new Gtk.Label() });
            const seen = watch(view);
            view.select_next_page();
            expect(view.selectedPage?.id).toBe('two');
            view.select_previous_page();
            expect(view.selectedPage?.id).toBe('one');
            expect(seen.length).toBe(2);
        });
    });
};

export default adwTabViewSpec;
