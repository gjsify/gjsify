// @gjsify/adwaita-app — data-driven NavigationSplitView nav shell.
// Both studio apps hand-build the same thing: an Adw.NavigationSplitView with a
// sidebar Gtk.ListBox (.navigation-sidebar) + a content Gtk.Stack, collapsed
// under a max-width breakpoint, switched by name from a NavItem[]. This builds
// it once; the consumer only fills the returned `stack` with view widgets.
// A sidebar whose items arrive asynchronously replaces them through
// `NavShell.setItems`; the selection and the header sections follow.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import type { NavItem } from './types.js';

/**
 * Per-row section header, wired straight into `Gtk.ListBox.set_header_func`.
 *
 * `before` is the item of the row ABOVE `row`, or `null` for the first row — the
 * consumer's decision input, since a header is a comparison against the previous
 * section. Return `null` to draw no header.
 */
export type NavShellHeaderFunc = (row: Gtk.ListBoxRow, before: NavItem | null) => Gtk.Widget | null;

/** Options for {@link createNavShell}. */
export interface NavShellOptions {
    /** Sidebar rows + stack child ids, in order. */
    items: readonly NavItem[];
    /** Fired when the selected item changes (row-selected). */
    onSelect: (item: NavItem, index: number) => void;
    /** Sidebar header title. */
    sidebarTitle?: string;
    /** Widget packed at the start of the sidebar header (e.g. an open button). */
    sidebarHeaderStart?: Gtk.Widget;
    /** Widget packed at the end of the sidebar header (e.g. a menu button). */
    sidebarHeaderEnd?: Gtk.Widget;
    /** Collapse the split view below this width (px). Default `720`. */
    collapseWidth?: number;
    /** Per-row group header, mapped onto `Gtk.ListBox.set_header_func`. */
    headerFunc?: NavShellHeaderFunc;
    /** Widget below the sidebar list (e.g. an account row). */
    sidebarBottomBar?: Gtk.Widget;
    /** Widget below the content stack, under the conversation rather than in it. */
    contentBottomBar?: Gtk.Widget;
}

/** The pieces a consumer wires into its window + views. */
export interface NavShell {
    /** Top-level widget — set as the window content. */
    widget: Adw.NavigationSplitView;
    /** Content stack — add view widgets via `add_named(view, item.id)`. */
    stack: Gtk.Stack;
    /** Content header bar — add title widgets / buttons. */
    contentHeader: Adw.HeaderBar;
    /**
     * Replace the sidebar rows, in place. The `Gtk.Stack` is left alone: its pages
     * belong to the consumer (`add_named(view, item.id)`), so a page outliving its
     * item is theirs to keep or drop.
     *
     * The selected id survives if the new items still carry it, and `onSelect` does
     * NOT fire either way — a rebuild is not a user selection, and re-announcing
     * the same item would make `onSelect` fire on every list update. An item that
     * is gone leaves nothing selected; `selectById` is how a consumer picks the
     * replacement deliberately.
     */
    setItems(items: readonly NavItem[]): void;
    /** Select a nav item by its id (falls back to the first item). */
    selectById(id: string): void;
    /** Select a nav item by index. */
    selectByIndex(index: number): void;
}

function buildNavRow(item: NavItem): Gtk.ListBoxRow {
    const row = new Gtk.ListBoxRow();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        marginTop: 8,
        marginBottom: 8,
        marginStart: 12,
        marginEnd: 12,
    });
    if (item.icon) box.append(new Gtk.Image({ iconName: item.icon }));
    const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true });
    text.append(new Gtk.Label({ label: item.label, xalign: 0 }));
    if (item.subtitle) {
        text.append(new Gtk.Label({ label: item.subtitle, xalign: 0, cssClasses: ['dim-label', 'caption'] }));
    }
    box.append(text);
    row.set_child(box);
    return row;
}

/**
 * Build the nav shell into `window` (which owns the responsive breakpoint).
 * Returns the split view to set as content plus the stack + content header to
 * fill. Row selection drives `onSelect`; a collapsed shell reveals the content
 * pane on selection. Items may be replaced afterwards — see {@link NavShell.setItems}.
 */
export function createNavShell(window: Adw.ApplicationWindow, options: NavShellOptions): NavShell {
    const splitView = new Adw.NavigationSplitView();
    const stack = new Gtk.Stack({
        transitionType: Gtk.StackTransitionType.CROSSFADE,
        hexpand: true,
        vexpand: true,
    });
    const navList = new Gtk.ListBox({ cssClasses: ['navigation-sidebar'] });
    const contentHeader = new Adw.HeaderBar();

    // Row → the item it was built from. `row-selected` and the header func both
    // receive ROWS from GTK, and `setItems` replaces the rows and the array in one
    // step: resolving either through an index into the array hands out the wrong
    // item for every row the rebuild moved, with no error anywhere.
    const rowItems = new WeakMap<Gtk.ListBoxRow, NavItem>();
    let items: readonly NavItem[] = [];
    let rows: Gtk.ListBoxRow[] = [];
    let selectedId: string | null = null;
    let rebuilding = false;

    // Sidebar pane
    const sidebarHeader = new Adw.HeaderBar();
    if (options.sidebarTitle) {
        sidebarHeader.set_title_widget(new Adw.WindowTitle({ title: options.sidebarTitle, subtitle: '' }));
    }
    if (options.sidebarHeaderStart) sidebarHeader.pack_start(options.sidebarHeaderStart);
    if (options.sidebarHeaderEnd) sidebarHeader.pack_end(options.sidebarHeaderEnd);
    const sidebarToolbar = new Adw.ToolbarView();
    sidebarToolbar.add_top_bar(sidebarHeader);
    if (options.sidebarBottomBar) sidebarToolbar.add_bottom_bar(options.sidebarBottomBar);
    sidebarToolbar.set_content(navList);
    splitView.set_sidebar(new Adw.NavigationPage({ title: options.sidebarTitle ?? 'Menu', child: sidebarToolbar }));

    // Content pane
    const contentToolbar = new Adw.ToolbarView();
    contentToolbar.add_top_bar(contentHeader);
    if (options.contentBottomBar) contentToolbar.add_bottom_bar(options.contentBottomBar);
    contentToolbar.set_content(stack);
    splitView.set_content(new Adw.NavigationPage({ title: options.sidebarTitle ?? '', child: contentToolbar }));

    navList.connect('row-selected', (_list, row) => {
        // A rebuild emits this for the null row and again for the re-selected one.
        // The id is carried across by setItems, not by the signal.
        if (!row) {
            if (!rebuilding) selectedId = null;
            return;
        }
        const item = rowItems.get(row);
        if (!item) return;
        const index = row.get_index();
        if (index < 0) return;
        selectedId = item.id;
        if (rebuilding) return;
        options.onSelect(item, index);
        if (splitView.get_collapsed()) splitView.set_show_content(true);
    });

    if (options.headerFunc) {
        const headerFunc = options.headerFunc;
        // GTK speaks rows, the consumer's contract is items: `before` is mapped here,
        // which is the one place a row and the item it was built from both exist.
        navList.set_header_func((row, before) => headerFunc(row, before ? (rowItems.get(before) ?? null) : null));
    }

    const setItems = (next: readonly NavItem[]): void => {
        const keepId = selectedId;
        items = next;
        rebuilding = true;
        for (const row of rows) navList.remove(row);
        rows = items.map((item) => {
            const row = buildNavRow(item);
            rowItems.set(row, item);
            navList.append(row);
            return row;
        });
        const index = keepId === null ? -1 : items.findIndex((item) => item.id === keepId);
        if (index >= 0) navList.select_row(rows[index]);
        rebuilding = false;
    };

    // The initial items go through `setItems` too, so a static list and one that arrives
    // later build their rows by the same code, once each.
    setItems(options.items);

    // Responsive collapse — the breakpoint belongs to the window, not the shell.
    const collapseWidth = options.collapseWidth ?? 720;
    const condition = Adw.BreakpointCondition.parse(`max-width: ${collapseWidth}px`);
    if (condition) {
        const breakpoint = new Adw.Breakpoint({ condition });
        breakpoint.add_setter(splitView, 'collapsed', true);
        window.add_breakpoint(breakpoint);
    }

    const selectByIndex = (index: number): void => {
        const row = navList.get_row_at_index(index);
        if (row) navList.select_row(row);
    };

    return {
        widget: splitView,
        stack,
        contentHeader,
        setItems,
        selectByIndex,
        selectById(id: string): void {
            const index = items.findIndex((item) => item.id === id);
            selectByIndex(index >= 0 ? index : 0);
        },
    };
}
