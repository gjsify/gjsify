// @gjsify/adwaita-app — nav shell: the live sidebar list, group headers, bottom bars.
//
// GJS + a GTK runtime, no display. `createNavShell` builds a real `Adw.NavigationSplitView`
// and needs only an `Adw.ApplicationWindow` to own the breakpoint, and both construct
// without one; every assertion reads a widget property, never a rendered pixel.
//
// THE CLAIM UNDER TEST IS A MAPPING, so the tests read the shell the way a consumer cannot:
// there is no `navList` on the returned `NavShell` and `buildNavRow` is module-private. Each
// test therefore walks `shell.widget` → `Adw.NavigationPage` → `Adw.ToolbarView` and asserts
// against the rows and labels GTK really holds — a test that reached into the module's closure
// would keep passing if the rows stopped being in the sidebar at all.

import { afterEach, describe, expect, it } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { createNavShell } from './nav-shell.js';
import type { NavShell, NavShellHeaderFunc, NavShellOptions } from './nav-shell.js';
import type { NavItem } from './types.js';

// GTK has to be initialised before a widget type exists; `init_check` is the form that
// survives having no display, where `init()` would abort.
Gtk.init_check();

/** One `onSelect` delivery: the item the shell resolved, and the index it reported. */
interface Selection {
    id: string;
    index: number;
    item: NavItem;
}

/** Every widget below `widget`, depth first — GTK puts a ToolbarView's bars under revealers. */
function descendants(widget: Gtk.Widget): Gtk.Widget[] {
    const found: Gtk.Widget[] = [];
    const walk = (node: Gtk.Widget): void => {
        for (let child = node.get_first_child(); child; child = child.get_next_sibling()) {
            found.push(child);
            walk(child);
        }
    };
    walk(widget);
    return found;
}

/** The `Adw.ToolbarView` of one pane, reached the way a consumer's own view hierarchy is. */
function paneToolbar(shell: NavShell, pane: 'sidebar' | 'content'): Gtk.Widget {
    const page = pane === 'sidebar' ? shell.widget.get_sidebar() : shell.widget.get_content();
    const toolbar = page?.get_child();
    if (!toolbar) throw new Error(`the ${pane} pane holds no toolbar`);
    return toolbar;
}

/** The sidebar list, found by its own style class rather than by position in the tree. */
function sidebarList(shell: NavShell): Gtk.ListBox {
    for (const widget of descendants(paneToolbar(shell, 'sidebar'))) {
        if (widget instanceof Gtk.ListBox && widget.get_css_classes().includes('navigation-sidebar')) {
            return widget;
        }
    }
    throw new Error('the sidebar pane holds no .navigation-sidebar list');
}

/** The list's rows, in order. Header widgets are not children of a `Gtk.ListBox`. */
function listRows(list: Gtk.ListBox): Gtk.ListBoxRow[] {
    const rows: Gtk.ListBoxRow[] = [];
    for (let child = list.get_first_child(); child; child = child.get_next_sibling()) {
        if (child instanceof Gtk.ListBoxRow) rows.push(child);
    }
    return rows;
}

/** The text a row shows — its label, plus the subtitle when the item has one. */
function rowText(row: Gtk.ListBoxRow): string {
    return descendants(row)
        .filter((widget): widget is Gtk.Label => widget instanceof Gtk.Label)
        .map((label) => label.get_label() ?? '')
        .join(' / ');
}

/** The row labels in order, which is the sidebar as the user reads it. */
function rowTexts(list: Gtk.ListBox): string[] {
    return listRows(list).map(rowText);
}

/** The selected row's label, or `null` when nothing is selected. */
function selectedText(list: Gtk.ListBox): string | null {
    const row = list.get_selected_row();
    return row === null ? null : rowText(row);
}

export default async (): Promise<void> => {
    /** The lists whose JS header func has to be released after the test. */
    let headerLists: Gtk.ListBox[] = [];

    afterEach(() => {
        // A `Gtk.ListBox` still holding a JS header func is asked for it once more while GJS
        // tears the process down, and GJS BLOCKS it ("Attempting to run a JS callback during
        // shutdown") — noise this suite would be blamed for, and that every app with a header
        // func prints. Releasing the func here is the whole fix.
        for (const list of headerLists) list.set_header_func(null);
        headerLists = [];
    });

    const build = (
        extra: Partial<NavShellOptions> = {},
    ): { shell: NavShell; list: Gtk.ListBox; selections: Selection[] } => {
        const selections: Selection[] = [];
        const options: NavShellOptions = {
            items: extra.items ?? [],
            onSelect: (navItem, index) => selections.push({ id: navItem.id, index, item: navItem }),
        };
        if (extra.headerFunc) options.headerFunc = extra.headerFunc;
        if (extra.sidebarBottomBar) options.sidebarBottomBar = extra.sidebarBottomBar;
        if (extra.contentBottomBar) options.contentBottomBar = extra.contentBottomBar;
        const shell = createNavShell(new Adw.ApplicationWindow(), options);
        const list = sidebarList(shell);
        if (extra.headerFunc) headerLists.push(list);
        return { shell, list, selections };
    };

    const item = (id: string, label = id): NavItem => ({ id, label });

    await describe('createNavShell — a static item list', async () => {
        await it('builds one row per item, in order', async () => {
            const { list } = build({ items: [item('overview', 'Overview'), item('reports', 'Reports')] });
            expect(rowTexts(list)).toStrictEqual(['Overview', 'Reports']);
        });

        await it('selects by id and reports the item and its index', async () => {
            const { shell, list, selections } = build({ items: [item('a'), item('b'), item('c')] });
            shell.selectById('b');
            expect(selectedText(list)).toBe('b');
            expect(selections).toStrictEqual([{ id: 'b', index: 1, item: { id: 'b', label: 'b' } }]);
        });

        await it('falls back to the first item for an unknown id', async () => {
            const { shell, list } = build({ items: [item('a'), item('b')] });
            shell.selectById('nope');
            expect(selectedText(list)).toBe('a');
        });
    });

    await describe('createNavShell — setItems', async () => {
        await it('shows an item inserted in the middle, and one appended', async () => {
            const { shell, list } = build({ items: [item('a'), item('b')] });
            shell.setItems([item('a'), item('x'), item('b'), item('c')]);
            expect(rowTexts(list)).toStrictEqual(['a', 'x', 'b', 'c']);
        });

        await it('drops the rows of a removed item', async () => {
            const { shell, list } = build({ items: [item('a'), item('b'), item('c')] });
            shell.setItems([item('a'), item('c')]);
            expect(rowTexts(list)).toStrictEqual(['a', 'c']);
        });

        await it('empties the sidebar, the state an async list starts in', async () => {
            const { shell, list } = build({ items: [item('a')] });
            shell.setItems([]);
            expect(rowTexts(list)).toStrictEqual([]);
            expect(selectedText(list)).toBeNull();
        });

        // THE REGRESSION AN INDEX RESOLUTION PRODUCES: rows 1..n shift down when an item is
        // inserted at 0, and `options.items[index]` — the frozen array the shell was built
        // with — hands `onSelect` the PREVIOUS item at every row after the insertion point.
        // A rebuild that keeps the row→item binding and the array together cannot.
        await it('resolves a selection against the items it was given, not the first ones', async () => {
            const { shell, list, selections } = build({ items: [item('a'), item('b'), item('c')] });
            const inserted = item('x');
            shell.setItems([inserted, item('a'), item('b'), item('c')]);
            shell.selectByIndex(2);
            expect(selectedText(list)).toBe('b');
            expect(selections).toHaveLength(1);
            expect(selections[0].item.id).toBe('b');
            expect(selections[0].index).toBe(2);
        });

        await it('gives back the NEW item object for a refetched list with the same ids', async () => {
            const { shell, selections } = build({ items: [item('a'), item('b')] });
            const refetched = { id: 'b', label: 'B renamed' };
            shell.setItems([item('a'), refetched]);
            shell.selectById('b');
            expect(selections[0].item).toBe(refetched);
        });

        await it('keeps the selected item selected when a rebuild keeps its id', async () => {
            const { shell, list, selections } = build({ items: [item('a'), item('b'), item('c')] });
            shell.selectById('b');
            expect(selections).toHaveLength(1);
            shell.setItems([item('a'), item('b'), item('c'), item('d')]);
            expect(selectedText(list)).toBe('b');
            // A rebuild is not a selection: re-announcing it would make `onSelect` fire on
            // every list update, indistinguishable from the user re-clicking that row.
            expect(selections).toHaveLength(1);
        });

        await it('selects nothing when the selected item is gone, and announces nothing', async () => {
            const { shell, list, selections } = build({ items: [item('a'), item('b'), item('c')] });
            shell.selectById('b');
            shell.setItems([item('a'), item('c')]);
            expect(selectedText(list)).toBeNull();
            expect(selections).toHaveLength(1);
        });

        await it('leaves the content stack to the consumer', async () => {
            const { shell } = build({ items: [item('a')] });
            const view = new Adw.StatusPage({ title: 'A' });
            shell.stack.add_named(view, 'a');
            shell.setItems([item('a'), item('b')]);
            expect(shell.stack.get_child_by_name('a')).toBe(view);
        });
    });

    await describe('createNavShell — headerFunc', async () => {
        // `before` is the only thing a section header is computed from, so the mapping the
        // shell does here is the whole feature: a row index would label every group by the
        // item that used to sit above it after the first insert.
        interface HeaderCall {
            row: Gtk.ListBoxRow;
            before: string | null;
        }
        const recorder = (): { headerFunc: NavShellHeaderFunc; calls: HeaderCall[] } => {
            const calls: HeaderCall[] = [];
            return {
                calls,
                headerFunc: (row, before) => {
                    calls.push({ row, before: before === null ? null : before.id });
                    return new Gtk.Label({ label: 'header' });
                },
            };
        };

        /**
         * The header decision for each row the list holds NOW, in order.
         *
         * Filtered by row identity because GTK asks more than once per mutation: removing a
         * row also re-asks for its successor's header, while that successor is momentarily
         * first (MEASURED: removing 'a' from `[a, b]` calls back for 'b' with `before=null`).
         * The claim worth holding is one correct decision per row on screen.
         */
        const headersOf = (list: Gtk.ListBox, calls: HeaderCall[]): [string, string | null][] => {
            const live = new Set<Gtk.ListBoxRow>(listRows(list));
            return calls.filter((call) => live.has(call.row)).map((call) => [rowText(call.row), call.before]);
        };

        await it('passes the item above each row, and null above the first', async () => {
            const { headerFunc, calls } = recorder();
            const { list } = build({ items: [item('a'), item('b'), item('c')], headerFunc });
            expect(headersOf(list, calls)).toStrictEqual([
                ['a', null],
                ['b', 'a'],
                ['c', 'b'],
            ]);
            expect(rowTexts(list)).toStrictEqual(['a', 'b', 'c']);
        });

        await it('re-resolves before against the new items after setItems', async () => {
            const { headerFunc, calls } = recorder();
            const { shell, list } = build({ items: [item('a'), item('b')], headerFunc });
            expect(headersOf(list, calls)).toStrictEqual([
                ['a', null],
                ['b', 'a'],
            ]);
            shell.setItems([item('x'), item('a'), item('b')]);
            expect(headersOf(list, calls)).toStrictEqual([
                ['x', null],
                ['a', 'x'],
                ['b', 'a'],
            ]);
        });
    });

    await describe('createNavShell — bottom bars', async () => {
        await it('puts the sidebar bar in the sidebar pane and the content bar in the content pane', async () => {
            const sidebarBar = new Gtk.Label({ label: 'sidebar' });
            const contentBar = new Gtk.Label({ label: 'content' });
            const { shell } = build({ sidebarBottomBar: sidebarBar, contentBottomBar: contentBar });
            const sidebar = descendants(paneToolbar(shell, 'sidebar'));
            const content = descendants(paneToolbar(shell, 'content'));
            expect(sidebar.includes(sidebarBar)).toBe(true);
            expect(content.includes(contentBar)).toBe(true);
            // The two are separate widgets, so a crossed pane is a real defect, not a
            // "found somewhere in the shell" match.
            expect(sidebar.includes(contentBar)).toBe(false);
            expect(content.includes(sidebarBar)).toBe(false);
        });

        await it('keeps the sidebar list the pane content — a bottom bar is not the content', async () => {
            const { shell, list } = build({ sidebarBottomBar: new Gtk.Label({ label: 'sidebar' }) });
            const toolbar = paneToolbar(shell, 'sidebar') as Adw.ToolbarView;
            expect(toolbar.get_content()).toBe(list);
        });
    });
};
