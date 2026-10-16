// The `Gtk.Window` members a renderer can share — `is-active`, `maximized`, `focus-widget` and the
// `close-request` → `close()` sequence — decided once, so the browser frame and the NativeScript
// root cannot drift on WHEN a property notifies or WHAT a handler's return value means.
//
// WHAT IS NOT HERE: where the facts come from. Whether the window is active, which widget holds
// focus and how a window ends are the platform's to say; a port reports them (`reportActive`,
// `reportFocus`, `reportMaximized`) and supplies the two effects of a close (`hide`, `destroy`).
//
// Reference: GTK gtk/gtkwindow.c — `_gtk_window_set_is_active`, `gtk_window_set_focus`,
// `gtk_window_maximize`, `gtk_window_close`, `gtk_window_emit_close_request`,
// `gtk_window_close_request` (the class handler)

import type { GtkApplicationMembers } from './application.js';

/** The `Gtk.Window` properties this module notifies for. `is-active` is read-only in GTK. */
export type WindowMemberProperty = 'is-active' | 'maximized' | 'focus-widget';

/** What a window starts with. GTK's defaults are all "no"/"none". */
export interface WindowMemberInit {
    readonly maximized?: boolean;
}

/**
 * The three properties as GTK holds them: a value, and a notification only when the value MOVED.
 * `_gtk_window_set_is_active` returns early on an equal write (gtkwindow.c:6162), and so do
 * `gtk_window_set_focus` (:5361) and the maximize pair (:5660, :5703) — a boolean that did not
 * change must not wake a `notify::` handler.
 */
export class WindowMemberState<TWidget> {
    private _active = false;
    private _maximized: boolean;
    private _focus: TWidget | null = null;
    private readonly _notify: (property: WindowMemberProperty) => void;

    constructor(notify: (property: WindowMemberProperty) => void, init: WindowMemberInit = {}) {
        this._notify = notify;
        this._maximized = init.maximized ?? false;
    }

    /** `Gtk.Window:is-active`. */
    get active(): boolean {
        return this._active;
    }

    /** `Gtk.Window:maximized`. */
    get maximized(): boolean {
        return this._maximized;
    }

    /** `Gtk.Window:focus-widget`. */
    get focus(): TWidget | null {
        return this._focus;
    }

    /** The platform says whether this window is the active one. Returns whether that was news. */
    reportActive(next: boolean): boolean {
        if (this._active === next) return false;
        this._active = next;
        this._notify('is-active');
        return true;
    }

    /** The platform says whether the window is maximized. Returns whether that was news. */
    reportMaximized(next: boolean): boolean {
        if (this._maximized === next) return false;
        this._maximized = next;
        this._notify('maximized');
        return true;
    }

    /** The platform says which widget holds focus. Returns whether that was news. */
    reportFocus(next: TWidget | null): boolean {
        if (this._focus === next) return false;
        this._focus = next;
        this._notify('focus-widget');
        return true;
    }
}

/**
 * `_gtk_boolean_handled_accumulator` for `close-request`: the first handler to return something
 * truthy has handled the signal and STOPS the emission — the remaining handlers and the class
 * handler never run. GJS marshals a JS return value to `gboolean` by truthiness, so `undefined`
 * (a handler that returns nothing) is "not handled".
 *
 * A handler that throws is not caught here: GJS logs it and carries on as if it returned false,
 * and a port that wants that wraps its own call. Letting it escape is the safe default for a
 * close — the window stays open.
 */
export class HandledAccumulator {
    private _handled = false;

    /** Whether a handler has taken the signal over, which is also when the emission is over. */
    get stopped(): boolean {
        return this._handled;
    }

    /** Fold in what one handler returned. */
    collect(returned: unknown): void {
        if (returned) this._handled = true;
    }
}

/** How a close request ended. */
export type CloseOutcome =
    /** Nothing happened: the window is not realized, or a close was already being emitted. */
    | 'ignored'
    /** A `close-request` handler returned true; the window stays as it was. */
    | 'handled'
    /** No handler took it and `hide-on-close` is set: the window was hidden. */
    | 'hidden'
    /** No handler took it: the window was destroyed. */
    | 'destroyed';

/** What a port supplies to one close request. */
export interface CloseRequestSteps {
    /** `GtkWidget::realized`. An unrealized window has nothing to close (gtkwindow.c:1469). */
    readonly realized: boolean;
    /** `Gtk.Window:hide-on-close`. */
    readonly hideOnClose: boolean;
    /** Emit `close-request` to the USER's handlers and answer whether one handled it. */
    emit(): boolean;
    /** `gtk_widget_set_visible (window, FALSE)`. */
    hide(): void;
    /** `gtk_window_destroy`. */
    destroy(): void;
}

/**
 * `gtk_window_close`. `close-request` is RUN_LAST with a handled accumulator, so the order is:
 * the user's handlers, then — only if none handled it — the class handler, which hides the window
 * when `hide-on-close` is set and counts that as handled; a window nobody stopped is destroyed.
 * A handler that calls `close()` again is ignored (the `in_emit_close_request` guard, :1473, :3855).
 */
export class CloseRequestState {
    private _emitting = false;

    /** Whether a `close-request` emission is in progress. */
    get emitting(): boolean {
        return this._emitting;
    }

    /** Run one close request through GTK's sequence. */
    close(steps: CloseRequestSteps): CloseOutcome {
        if (!steps.realized || this._emitting) return 'ignored';
        let outcome: CloseOutcome;
        this._emitting = true;
        try {
            if (steps.emit()) {
                outcome = 'handled';
            } else if (steps.hideOnClose) {
                steps.hide();
                outcome = 'hidden';
            } else {
                outcome = 'destroyed';
            }
        } finally {
            this._emitting = false;
        }
        if (outcome === 'destroyed') steps.destroy();
        return outcome;
    }
}

/**
 * `Gtk.WindowCommon` (ADR 0098 Amendment 4): the part of `Gtk.Window` that GJS, `<gtk-window>` and the
 * NativeScript window all have, so code shared between them types a window without a cast. A TRUE
 * subset: `Gtk.Window` from `@girs/gtk-4.0` is assignable to it, and so is every window class of
 * both ports. `TWidget` is what focus holds — `Gtk.Widget`, `Element` or a NativeScript `View`.
 *
 * Handlers are typed by the emitter alone: what follows it differs (a `GParamSpec` in GJS, an event
 * payload on NativeScript), so shared code reads the window, not the extra arguments.
 * `notify::focus-widget` is left out: NativeScript cannot observe focus the user moves.
 */
export interface WindowCommon<TWidget = unknown> {
    /** `Gtk.Window:is-active`, read-only. */
    readonly is_active: boolean;
    readonly isActive: boolean;
    /** `Gtk.Window:focus-widget`; writing it is `set_focus`. */
    focus_widget: TWidget | null;
    get_focus(): TWidget | null;
    set_focus(focus: TWidget | null): void;
    /** `Gtk.Window:maximized`. */
    maximized: boolean;
    is_maximized(): boolean;
    maximize(): void;
    unmaximize(): void;
    present(): void;
    /**
     * `Gtk.Window:application`; writing it is `set_application`, which adds the window to the
     * application's windows (and removes it from the previous one's), so `inhibit` and
     * `set_accels_for_action` are reachable from the window.
     */
    application: GtkApplicationMembers | null;
    get_application(): GtkApplicationMembers | null;
    set_application(application: GtkApplicationMembers | null): void;
    /** `gtk_window_close`: emits `close-request`, whose first handler to return true keeps the window. */
    close(): void;
    connect(signal: 'close-request', callback: (self: this) => boolean | void): number;
    connect(
        signal: 'notify::is-active' | 'notify::maximized' | 'notify::application',
        callback: (self: this) => void,
    ): number;
    disconnect(id: number): void;
}
