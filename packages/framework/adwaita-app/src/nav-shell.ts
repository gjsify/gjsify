// @gjsify/adwaita-app — data-driven NavigationSplitView nav shell.
// Both studio apps hand-build the same thing: an Adw.NavigationSplitView with a
// sidebar Gtk.ListBox (.navigation-sidebar) + a content Gtk.Stack, collapsed
// under a max-width breakpoint, switched by name from a NavItem[]. This builds
// it once; the consumer only fills the returned `stack` with view widgets.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import type { NavItem } from './types.js';

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
}

/** The pieces a consumer wires into its window + views. */
export interface NavShell {
    /** Top-level widget — set as the window content. */
    widget: Adw.NavigationSplitView;
    /** Content stack — add view widgets via `add_named(view, item.id)`. */
    stack: Gtk.Stack;
    /** Content header bar — add title widgets / buttons. */
    contentHeader: Adw.HeaderBar;
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
 * pane on selection.
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

    // Sidebar pane
    const sidebarHeader = new Adw.HeaderBar();
    if (options.sidebarTitle) {
        sidebarHeader.set_title_widget(new Adw.WindowTitle({ title: options.sidebarTitle, subtitle: '' }));
    }
    if (options.sidebarHeaderStart) sidebarHeader.pack_start(options.sidebarHeaderStart);
    if (options.sidebarHeaderEnd) sidebarHeader.pack_end(options.sidebarHeaderEnd);
    const sidebarToolbar = new Adw.ToolbarView();
    sidebarToolbar.add_top_bar(sidebarHeader);
    sidebarToolbar.set_content(navList);
    splitView.set_sidebar(new Adw.NavigationPage({ title: options.sidebarTitle ?? 'Menu', child: sidebarToolbar }));

    // Content pane
    const contentToolbar = new Adw.ToolbarView();
    contentToolbar.add_top_bar(contentHeader);
    contentToolbar.set_content(stack);
    splitView.set_content(new Adw.NavigationPage({ title: options.sidebarTitle ?? '', child: contentToolbar }));

    for (const item of options.items) navList.append(buildNavRow(item));

    navList.connect('row-selected', (_list, row) => {
        if (!row) return;
        const index = row.get_index();
        const item = options.items[index];
        if (!item) return;
        options.onSelect(item, index);
        if (splitView.get_collapsed()) splitView.set_show_content(true);
    });

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
        selectByIndex,
        selectById(id: string): void {
            const index = options.items.findIndex((item) => item.id === id);
            selectByIndex(index >= 0 ? index : 0);
        },
    };
}
