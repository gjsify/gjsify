// @gjsify/adwaita-app — view-switcher shell.
// The phone-friendly sibling of createNavShell: an Adw.ToolbarView whose header
// bar holds an Adw.ViewSwitcher, with an Adw.ViewSwitcherBar at the bottom that
// an Adw.Breakpoint reveals on narrow windows, over an Adw.ViewStack. Apps with
// two to five top-level views (calendar / tasks / board) build exactly this.

import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

/** One top-level page of the switcher. */
export interface SwitcherPage {
    /** Stack child name — what `visible-child-name` reports. */
    name: string;
    /** Title shown in the switcher. */
    title: string;
    /** Symbolic icon name shown in the switcher. */
    icon: string;
    /** The page content. */
    widget: Gtk.Widget;
}

/** Options for {@link createSwitcherShell}. */
export interface SwitcherShellOptions {
    /** Pages in switcher order. */
    pages: readonly SwitcherPage[];
    /** Below this width (in sp) the bottom bar replaces the header switcher. Default `600`. */
    narrowWidth?: number;
}

/** The pieces a consumer fills in. */
export interface SwitcherShell {
    /** Top-level widget — set as the window content. */
    widget: Adw.ToolbarView;
    /** The page stack; select with `set_visible_child_name`. */
    stack: Adw.ViewStack;
    /** Header bar — pack buttons / menus into it. */
    headerBar: Adw.HeaderBar;
    /** The toolbar view, for extra top or bottom bars. */
    toolbarView: Adw.ToolbarView;
    /** The wide switcher in the header title. */
    switcher: Adw.ViewSwitcher;
    /** The narrow-window bottom bar. */
    switcherBar: Adw.ViewSwitcherBar;
    /** The narrow breakpoint, already added to the window; add your own setters to it. */
    breakpoint: Adw.Breakpoint;
}

/**
 * Build the switcher shell into `window` (which owns the narrow breakpoint).
 * Below `narrowWidth` the header switcher hides and the bottom bar reveals —
 * one navigation at a time, never both.
 */
export function createSwitcherShell(window: Adw.ApplicationWindow, options: SwitcherShellOptions): SwitcherShell {
    const stack = new Adw.ViewStack();
    for (const page of options.pages) {
        stack.add_titled_with_icon(page.widget, page.name, page.title, page.icon);
    }

    const switcher = new Adw.ViewSwitcher({ stack, policy: Adw.ViewSwitcherPolicy.WIDE });
    const headerBar = new Adw.HeaderBar();
    headerBar.set_title_widget(switcher);

    const switcherBar = new Adw.ViewSwitcherBar({ stack });

    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.add_bottom_bar(switcherBar);
    toolbarView.set_content(stack);

    const breakpoint = Adw.Breakpoint.new(
        Adw.BreakpointCondition.parse(`max-width: ${(options.narrowWidth ?? 600) - 1}sp`),
    );
    breakpoint.add_setter(switcherBar, 'reveal', true);
    breakpoint.add_setter(switcher, 'visible', false);
    window.add_breakpoint(breakpoint);

    return { widget: toolbarView, stack, headerBar, toolbarView, switcher, switcherBar, breakpoint };
}
