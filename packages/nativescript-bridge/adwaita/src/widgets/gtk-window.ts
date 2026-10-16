// GtkWindow — the top-level window, for NativeScript.
//
// There is one screen on this platform (`window-state.ts`), so a window is the full-size
// container a shared tree builds into, and `Adw.Window` / `Adw.ApplicationWindow` descend from
// it as they do in libadwaita. That chain is the point: `widget.get_root() instanceof
// Gtk.Window` holds for the application root, which is how an application finds the window to
// hand `Gtk.show_uri`.
//
// A TRUE SUBSET: `title`, `default-width` and `default-height` are held and read back, and the
// state members below are mapped where the platform can say the fact. What it cannot say is
// refused by name, never faked:
//
//   is-active      the application is in the foreground: `resume` / `suspend`, from load to unload.
//   close-request  emitted by `close()` with GTK's handled accumulator (adwaita-core). A handler
//                  returning true keeps the window. On Android the back button / gesture of the
//                  TOPLEVEL window asks the same question, after nested things had their turn:
//                  1 the topmost presented dialog closes (`can-close` false keeps it, still
//                  consumed), 2 the innermost `Adw.NavigationView` pops (`popFromShortcut`), 3
//                  `close-request` — a handler returning true keeps the window, else `finish()`.
//                  iOS has no back button: nothing is watched there.
//   close()        Android `finish()` of the foreground activity. iOS has no public API to close the
//                  root: `close()` throws there, BEFORE `close-request` is emitted.
//   focus-widget   `get_focus()` / `set_focus()` (or `focus_widget`) read and move native focus. `connect
//                  ('notify::focus-widget')` is refused: focus the user moves is unobservable here.
//   maximized      constant true — the window is the screen. `maximize()` is a no-op; `unmaximize()`
//                  and `maximized = false` throw. Split-screen or multi-window is not detected.
//   application    `application` / `get_application()` / `set_application()`: the window joins the
//                  application's windows, as `gtk_window_set_application` does (`notify::application`).
//   present()      a no-op: the window the application's `activate` returns is already the root.
//   hide-on-close  absent; a window here is never hidden, only ended.
//
// Reference: refs/gtk/gtk/gtkwindow.c (GtkWindow)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { CloseRequestState, HandledAccumulator, WindowMemberState } from '@gjsify/adwaita-core';
import type { EventData, View } from '@nativescript/core';

import { windowHost } from '../window-host.js';
import { defineWindowApplication, type GtkApplication } from './application.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwSingleChildBase } from './single-child-base.js';
import { surfaceSize } from './window-state.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

export const NOTIFY_IS_ACTIVE = 'notify::is-active';
export const NOTIFY_MAXIMIZED = 'notify::maximized';
export const NOTIFY_FOCUS_WIDGET = 'notify::focus-widget';
export const CLOSE_REQUEST = 'close-request';

export class GtkWindow extends AdwSingleChildBase {
    static readonly GTypeName: string = 'GtkWindow';

    private _title = '';
    private _defaultWidth = 0;
    private _defaultHeight = 0;
    private readonly _members = new WindowMemberState<View>(
        (property) => {
            const eventName = property === 'is-active' ? NOTIFY_IS_ACTIVE : NOTIFY_MAXIMIZED;
            this.notify({ eventName, object: this, value: property === 'is-active' ? this.isActive : this.maximized });
        },
        { maximized: true },
    );
    private readonly _closeRequest = new CloseRequestState();
    private _unwatchForeground: (() => void) | null = null;
    private _unwatchBack: (() => void) | null = null;

    /** `Gtk.Window:application`: setting it is `add_window` (ADR 0098), set by `defineWindowApplication`. */
    declare application: GtkApplication | null;
    declare get_application: () => GtkApplication | null;
    declare set_application: (application: GtkApplication | null) => void;

    constructor(props?: ConstructProps<GtkWindow>) {
        super();
        applyConstructProps(this, props);
    }

    onLoaded(): void {
        super.onLoaded();
        const host = windowHost();
        this._unwatchForeground?.();
        this._unwatchForeground = host.watchForeground((foreground) => this._members.reportActive(foreground));
        this._members.reportActive(host.isForeground());
        this._unwatchBack?.();
        this._unwatchBack = this._isToplevel() ? host.watchBack(() => this._handleBack()) : null;
    }

    onUnloaded(): void {
        this._unwatchForeground?.();
        this._unwatchForeground = null;
        this._unwatchBack?.();
        this._unwatchBack = null;
        this._members.reportActive(false);
        super.onUnloaded();
    }

    /** `GtkWindow:is-active` (read-only): the application is in the foreground. */
    get isActive(): boolean {
        return this._members.active;
    }

    /** The GJS spelling of {@link isActive}: a property, as in `@girs/gtk-4.0` (ADR 0098 Amendment 4). */
    get is_active(): boolean {
        return this._members.active;
    }

    /** `GtkWindow:maximized`: always true here. Writing false throws; writing true is a no-op. */
    get maximized(): boolean {
        return this._members.maximized;
    }

    set maximized(value: boolean | string) {
        if (xmlBoolean(value, true)) this.maximize();
        else this.unmaximize();
    }

    is_maximized(): boolean {
        return this.maximized;
    }

    /** The window is the screen already: nothing to do, nothing to notify. */
    maximize(): void {}

    unmaximize(): void {
        throw new Error(
            'GtkWindow.unmaximize is not supported on NativeScript: the window is the whole screen and ' +
                'the platform has no un-maximized state to go back to.',
        );
    }

    /** The application's `activate` returns the root window, so it is presented already. */
    present(): void {}

    /** `GtkWindow:focus-widget`: the view holding native focus, found live. */
    get focusWidget(): View | null {
        return this.get_focus();
    }

    /** `GtkWindow:focus-widget` under its GJS spelling; writing it is `set_focus`. */
    get focus_widget(): View | null {
        return this.get_focus();
    }

    set focus_widget(widget: View | null) {
        this.set_focus(widget);
    }

    get_focus(): View | null {
        const host = windowHost();
        return findView(this, (view) => host.isFocused(view));
    }

    /** Move native focus to a descendant, or clear it with `null`. */
    set_focus(widget: View | null): void {
        const host = windowHost();
        if (widget === null) {
            const current = this.get_focus();
            if (current !== null) host.clearFocus(current);
            return;
        }
        if (findView(this, (view) => view === widget) === null) {
            throw new Error('GtkWindow.set_focus: the widget is not a descendant of this window.');
        }
        host.requestFocus(widget);
    }

    /**
     * `gtk_window_close`: emit `close-request`; a handler returning true keeps the window, else
     * it ends. Throws on iOS (no public API to end the root) before any handler runs.
     */
    close(): void {
        const host = windowHost();
        if (this.isLoaded && !host.canFinish) {
            throw new Error(
                'GtkWindow.close is not supported on this platform: iOS has no public API to close the ' +
                    'root window. Android finishes the foreground activity.',
            );
        }
        this._requestClose();
    }

    private _requestClose(): void {
        const host = windowHost();
        this._closeRequest.close({
            realized: this.isLoaded,
            hideOnClose: false,
            emit: () => {
                const accumulator = new HandledAccumulator();
                this.notify({ eventName: CLOSE_REQUEST, object: this, accumulator });
                return accumulator.stopped;
            },
            hide: () => {},
            destroy: () => host.finish(),
        });
    }

    /**
     * What the back button does, in order: the topmost dialog, the innermost navigation view, then
     * `close-request`. Always consumes the press — the system's own back would `finish()` too, but
     * without asking the handlers.
     */
    private _handleBack(): boolean {
        if (this._consumeBack()) return true;
        if (popInnermostNavigation(this)) return true;
        this._requestClose();
        return true;
    }

    /** A subclass that shows things over the window (dialogs) takes the press first; true = taken. */
    protected _consumeBack(): boolean {
        return false;
    }

    /** Only a window with no window above it owns the back button. */
    private _isToplevel(): boolean {
        for (
            let ancestor = this.parent as View | null | undefined;
            ancestor;
            ancestor = ancestor.parent as View | null | undefined
        ) {
            if (ancestor instanceof GtkWindow) return false;
        }
        return true;
    }

    connect(eventName: string, callback: (self: this, data: EventData) => unknown): number {
        if (eventName === NOTIFY_FOCUS_WIDGET) {
            throw new Error(
                'GtkWindow notify::focus-widget is not supported on NativeScript: focus the user moves ' +
                    'is not observable here. Read get_focus() when you need it.',
            );
        }
        return super.connect(eventName, callback);
    }

    /** `GtkWindow:title`. Held: a `Page` has no title bar of this window's to put it in. */
    get title(): string {
        return this._title;
    }

    set title(value: string | null) {
        this._title = value ?? '';
    }

    /** `GtkWindow:default-width` — held and read back; the screen is the width. */
    get defaultWidth(): number {
        return this._defaultWidth;
    }

    set defaultWidth(value: number | string) {
        this._defaultWidth = surfaceSize(xmlNumber(value, Number.NaN), value, this._defaultWidth, 'defaultWidth');
    }

    /** `GtkWindow:default-height` — held and read back; the screen is the height. */
    get defaultHeight(): number {
        return this._defaultHeight;
    }

    set defaultHeight(value: number | string) {
        this._defaultHeight = surfaceSize(xmlNumber(value, Number.NaN), value, this._defaultHeight, 'defaultHeight');
    }
}

/** The first view under `root`, depth first, that satisfies `match`. */
function findView(root: View, match: (view: View) => boolean): View | null {
    let found: View | null = null;
    root.eachChildView((child) => {
        if (match(child)) {
            found = child;
            return false;
        }
        found = findView(child, match);
        return found === null;
    });
    return found;
}

interface PopsOnBack {
    popFromShortcut(): 'stop' | 'propagate';
}

const popsOnBack = (view: View): view is View & PopsOnBack =>
    typeof (view as Partial<PopsOnBack>).popFromShortcut === 'function';

/**
 * Pop the innermost visible navigation view that takes the press: `'stop'` means it did (or its page has
 * `can-pop` false), `'propagate'` hands the press outward, as the shortcut does in libadwaita.
 */
function popInnermostNavigation(root: View): boolean {
    let taken = false;
    root.eachChildView((child) => {
        // A page the navigation view has hidden is still a loaded child; it is not what back acts on.
        if (child.visibility !== 'visible') return true;
        if (popInnermostNavigation(child)) {
            taken = true;
            return false;
        }
        if (popsOnBack(child) && child.isLoaded && child.popFromShortcut() === 'stop') {
            taken = true;
            return false;
        }
        return true;
    });
    return taken;
}

defineWindowApplication(GtkWindow.prototype);
