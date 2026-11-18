// @gjsify/adwaita-app — view-switcher shell.
// The phone-friendly sibling of createNavShell: an Adw.ToolbarView whose header
// bar holds an Adw.ViewSwitcher, with an Adw.ViewSwitcherBar at the bottom that
// an Adw.Breakpoint reveals on narrow windows, over an Adw.ViewStack. Apps with
// two to five top-level views (calendar / tasks / board) build exactly this.
// The widget tree is `switcher-shell.blp`; this file holds the logic.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';

import Template, { type Children, GTypeName, InternalChildren } from './switcher-shell.blp';

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

// `extends Children` on a merged interface, never fields: GJS installs the internal
// children in `registerClass`, and a field would shadow them with `undefined`.
// oxlint-disable-next-line no-unsafe-declaration-merging -- intentional: GJS installs the internal children
export interface SwitcherShellWidget extends Children {}

/**
 * The switcher shell widget: header bar + switcher, bottom switcher bar, page stack.
 * Set it as window content; {@link createSwitcherShell} also attaches the breakpoint.
 */
export class SwitcherShellWidget extends Adw.Bin {
    static {
        // GJS resolves Adw types lazily; GtkBuilder only sees types already registered, so a
        // type the template names but the code never touched fails as "Invalid object type".
        for (const type of [Adw.ToolbarView, Adw.HeaderBar, Adw.ViewSwitcher, Adw.ViewSwitcherBar, Adw.ViewStack]) {
            GObject.type_ensure(type.$gtype);
        }
        GObject.registerClass({ GTypeName, Template, InternalChildren }, this);
    }

    /** The page stack; select with `set_visible_child_name`. */
    get stack(): Adw.ViewStack {
        return this._stack;
    }

    /** Header bar — pack buttons / menus into it. */
    get headerBar(): Adw.HeaderBar {
        return this._header_bar;
    }

    /** The toolbar view, for extra top or bottom bars. */
    get toolbarView(): Adw.ToolbarView {
        return this._toolbar_view;
    }

    /** The wide switcher in the header title. */
    get switcher(): Adw.ViewSwitcher {
        return this._switcher;
    }

    /** The narrow-window bottom bar. */
    get switcherBar(): Adw.ViewSwitcherBar {
        return this._switcher_bar;
    }

    /** Add the pages, in switcher order. */
    setPages(pages: readonly SwitcherPage[]): void {
        for (const page of pages) {
            this._stack.add_titled_with_icon(page.widget, page.name, page.title, page.icon);
        }
    }
}

/** The pieces a consumer fills in. */
export interface SwitcherShell {
    /** Top-level widget — set as the window content. */
    widget: SwitcherShellWidget;
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
 * Build the switcher shell and attach its narrow breakpoint to `window`.
 * Below `narrowWidth` the header switcher hides and the bottom bar reveals —
 * one navigation at a time, never both.
 */
export function createSwitcherShell(window: Adw.ApplicationWindow, options: SwitcherShellOptions): SwitcherShell {
    const widget = new SwitcherShellWidget();
    widget.setPages(options.pages);

    const breakpoint = Adw.Breakpoint.new(
        Adw.BreakpointCondition.parse(`max-width: ${(options.narrowWidth ?? 600) - 1}sp`),
    );
    breakpoint.add_setter(widget.switcherBar, 'reveal', true);
    breakpoint.add_setter(widget.switcher, 'visible', false);
    window.add_breakpoint(breakpoint);

    return {
        widget,
        stack: widget.stack,
        headerBar: widget.headerBar,
        toolbarView: widget.toolbarView,
        switcher: widget.switcher,
        switcherBar: widget.switcherBar,
        breakpoint,
    };
}
