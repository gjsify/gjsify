// The window's own header bar, and the one hand-over that lets the tree take it.
//
// WHY A HAND-OVER AND NOT A FLAG. `AppRegistry` builds the window before any React
// has run, and it has to put a header bar in it: an `Adw.ApplicationWindow` carries
// no titlebar of its own, so a window without one cannot be closed or moved on a CSD
// compositor. But some trees own the window's chrome themselves — a routed
// application's outermost navigator does, because `Adw.NavigationView` grows the back
// button and the page title inside the PAGE's header bar and a bar above the view gets
// neither (measured: its `AdwBackButton` stays hidden). Two bars then draw two sets of
// window controls, and only one of the two close buttons closes the window.
//
// So the window's bar is a DEFAULT that can be claimed, not a fixture and not an
// option the application author has to remember. Nothing claims it → the window keeps
// it, which is what a plain React Native root needs. The claim is refused a second
// time BY NAME: two claimants both believing they are outermost is a composition
// defect, and silently letting the second win would hide it.
//
// `@gjsify/gtk-host/conformance`'s `windowChromeProblems()` is the check that holds
// the whole class from outside — it counts the window controls that actually DRAW.

// VALUES through `gi://`, types through `@girs/*` — the machine-checked constraint
// `app-registry.ts` states: a value import from `@girs/*` flips the runtime signal
// and makes the declared table drift from the suggested one.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { createContext, createElement, useContext, type ReactElement, type ReactNode } from 'react';

/** The window's header bar, as something a tree can take over. */
export interface WindowChrome {
    /**
     * Take the window's header bar out, and get the undo.
     *
     * `claimant` is only for the refusal message — it is what a reader needs to find
     * the second navigator.
     */
    claim(claimant: string): () => void;
}

/** The widgets `AppRegistry` puts in a window, and the chrome hand-over for them. */
export interface WindowShell {
    /** What goes into `Gtk.Window.set_content`. */
    readonly root: Gtk.Widget;
    /** What React renders into. */
    readonly content: Gtk.Widget;
    /** The hand-over for the header bar in `root`. */
    readonly chrome: WindowChrome;
}

/**
 * The ordinary Adwaita shell: a toolbar view, a header bar, and a box to render into.
 *
 * A function rather than four lines inside `buildWindow`, because the router's own
 * vectors have to measure THIS composition — a spec that rebuilt it by hand would
 * pass while the shipping shell drifted.
 */
export function buildWindowShell(): WindowShell {
    const toolbar = new Adw.ToolbarView();
    const bar = new Adw.HeaderBar();
    toolbar.add_top_bar(bar);
    // React renders into the toolbar view's CONTENT, so the window's own chrome
    // survives the first commit (`clearContainer` clears the host's shadow children,
    // never the adopted ones).
    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    toolbar.set_content(content);

    let claimedBy: string | null = null;
    const chrome: WindowChrome = {
        claim(claimant: string): () => void {
            if (claimedBy !== null) {
                throw new Error(
                    `@gjsify/react-native: ${claimant} claimed the window's header bar, which ${claimedBy} already ` +
                        'holds. A window has one set of window controls, so exactly one level may own its chrome — ' +
                        'two navigators at the top level is the shape that produces this',
                );
            }
            claimedBy = claimant;
            toolbar.remove(bar);
            return () => {
                claimedBy = null;
                toolbar.add_top_bar(bar);
            };
        },
    };
    return { root: toolbar, content, chrome };
}

const WindowChromeContext = createContext<WindowChrome | null>(null);

/** Publish the window's chrome to the tree rendered into it. */
export const provideWindowChrome = (chrome: WindowChrome, children: ReactNode): ReactElement =>
    createElement(WindowChromeContext.Provider, { value: chrome }, children);

/**
 * The window's chrome, or `null` when nobody published one.
 *
 * `null` is an ORDINARY answer, not a fault: a consumer who builds their own window
 * and renders a React root into it publishes nothing, and then there is no default
 * bar to step aside for — their window, their chrome.
 */
export const useWindowChrome = (): WindowChrome | null => useContext(WindowChromeContext);
