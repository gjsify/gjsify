// <gtk-window-handle> — the titlebar strip: a widget that lets the window manager move the
// window when it is dragged, and turns the right-click, double-click and middle-click a
// titlebar is expected to turn into.
//
// WHAT IS LEFT OF IT IN GTK 4.24. The widget has ONE property (`child`), a `GtkBinLayout`, a
// `windowhandle` CSS node and the generic a11y role (gtkwindowhandle.c:527-554); everything
// else it once was is gone. The titlebar behaviour is three cases in
// `perform_titlebar_action` (gtkwindowhandle.c:335-372):
//
//   · a PRIMARY double-click, a MIDDLE click or a SECONDARY click asks the COMPOSITOR first
//     (`gdk_toplevel_titlebar_gesture`), and where there is no answer the settings
//     `gtk-titlebar-double-click`, `-middle-click` and `-right-click` decide — their
//     documented values are `toggle-maximize`, `lower`, `minimize`, `menu` and `none`
//     (`perform_titlebar_action_fallback`, gtkwindowhandle.c:305-333);
//   · a drag past the threshold begins a window MOVE (`gdk_toplevel_begin_move`,
//     gtkwindowhandle.c:429-455);
//   · `menu` opens the window menu, falling back to GTK's OWN Restore / Minimize / Maximize /
//     Close popover (`do_popup_fallback`, gtkwindowhandle.c:161-264).
//
// WHAT A PAGE CANNOT DO, AND WHAT IT DOES INSTEAD. `gdk_toplevel_begin_move` and
// `gdk_toplevel_show_window_menu` are OPERATIONS ON THE COMPOSITOR'S SURFACE: a document is
// not allowed to move or unmaximize the window it is rendered in, and no web API asks it to.
// So the port emits the SAME action names GTK's fallback activates — `window.toggle-maximized`,
// `window.minimize`, `window.lower`, `window.menu` are the strings `gtk_widget_activate_action`
// is handed (gtkwindowhandle.c:319-329) — as a `titlebar-action` CustomEvent (bubbles, detail
// `{ action, gesture, windowAction, x, y }`), and a second event NAMED for the action, which is
// what the C's `gdk_surface_...` call amounts to from a consumer's side. The settings that
// choose the action are attributes of the same three names minus the `gtk-` prefix, so a
// consumer writes `double-click-action="toggle-maximize"` and gets GTK's precedence without a
// settings object it cannot have.
//
// `child` is a SLOT, as everywhere in this package: an attribute cannot carry a widget, and a
// handle needs no routing of its own because it contributes no box — `display: contents` IS
// `GtkBinLayout`'s "the child takes the whole allocation", so the strip can go anywhere a
// header bar goes without moving the layout around it.
//
// A11y: `role="generic"`, which GTK 4.12 gave the widget in place of the `group` it used to
// report (gtkwindowhandle.c:61-64). The gestures are POINTER ones on the child's own box, so
// everything inside the titlebar — its buttons, its title — stays operable by keyboard.
//
// Reference: refs/gtk/gtk/gtkwindowhandle.c (class_init, click_gesture_pressed_cb,
//   perform_titlebar_action, perform_titlebar_action_fallback, drag_gesture_update_cb,
//   do_popup_fallback)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** `GtkTitlebarGesture`'s three gestures, as `perform_titlebar_action` decides them. */
export type GtkTitlebarGesture = 'double-click' | 'middle-click' | 'right-click';

/** The settings' own vocabulary, `none` included: "the compositor declined" is one. */
export type GtkTitlebarAction = 'toggle-maximize' | 'lower' | 'minimize' | 'menu' | 'none';

/**
 * Each gesture, the ATTRIBUTE its setting is authored under, and the value read when the
 * attribute is absent.
 *
 * `gtk-titlebar-double-click` is `toggle-maximize` and the other two are `menu` — the values
 * the C reads and the ones `perform_titlebar_action_fallback` names (gtkwindowhandle.c:305-317).
 */
const GESTURES = {
    'double-click': { attribute: 'double-click-action', fallback: 'toggle-maximize' },
    'middle-click': { attribute: 'middle-click-action', fallback: 'menu' },
    'right-click': { attribute: 'right-click-action', fallback: 'menu' },
} as const satisfies Record<GtkTitlebarGesture, { attribute: string; fallback: GtkTitlebarAction }>;

/** The GObject action names `gtk_widget_activate_action` is handed (gtkwindowhandle.c:319-329). */
const WINDOW_ACTIONS: Readonly<Record<Exclude<GtkTitlebarAction, 'none'>, string>> = {
    'toggle-maximize': 'window.toggle-maximized',
    lower: 'window.lower',
    minimize: 'window.minimize',
    menu: 'window.menu',
};

/** Every action the settings document, which is also the set a typo has to be refused against. */
const ACTIONS = new Set<string>(['none', 'toggle-maximize', 'lower', 'minimize', 'menu']);

/** `gestureOf`'s switch — which button and press count is which gesture. */
function gestureOf(button: number, presses: number): GtkTitlebarGesture | null {
    switch (button) {
        case 0:
            return presses > 1 ? 'double-click' : null;
        case 1:
            return 'middle-click';
        case 2:
            return 'right-click';
        default:
            return null;
    }
}

/**
 * The distance a pointer travels before a drag counts.
 *
 * `drag_gesture_update_cb` asks `gtk_drag_check_threshold_double (self, 0, 0, dx, dy)`,
 * which is the theme's drag threshold or `gdk_drag_get_threshold ()` where the toolkit has
 * none (gtkwindowhandle.c:433-437). A titlebar has to tell a tap from a drag on a
 * touchscreen as much as on a mouse, so it is one device pixel.
 */
const DRAG_THRESHOLD = 1;

export class GtkWindowHandle extends HTMLElement {
    /** The gesture in progress, as `priv->drag_start_x` / `_y` are in the C. */
    private _drag: { pointerId: number; x: number; y: number } | null = null;

    /**
     * The three gesture SETTINGS, spelled out.
     *
     * `GESTURES` above names the same three, and the list is written rather than computed
     * from it because `scripts/adwaita-elements.mjs` reads `observedAttributes` as an array
     * LITERAL: a `.map()` over a table reads as an unreadable element there, which is
     * reported as "this reader cannot tell" rather than as the three attributes it is.
     */
    static get observedAttributes() {
        return ['double-click-action', 'middle-click-action', 'right-click-action'];
    }

    /** The action one gesture is set to, as the settings are read in C. */
    actionFor(gesture: GtkTitlebarGesture): GtkTitlebarAction {
        const { attribute, fallback } = GESTURES[gesture];
        const written = this.getAttribute(attribute);
        // An absent attribute is the setting's own value; an unrecognised one is `none`,
        // which is the branch the C uses when a compositor claims the gesture and the
        // setting says nothing useful — a typo must not minimize a window.
        if (written === null) return fallback;
        return ACTIONS.has(written) ? (written as GtkTitlebarAction) : 'none';
    }

    connectedCallback() {
        this.setAttribute('role', 'generic');
        this.addEventListener('click', this._onClick);
        this.addEventListener('pointerdown', this._onPointerDown);
        this.addEventListener('pointermove', this._onPointerMove);
    }

    disconnectedCallback() {
        this.removeEventListener('click', this._onClick);
        this.removeEventListener('pointerdown', this._onPointerDown);
        this.removeEventListener('pointermove', this._onPointerMove);
        this._drag = null;
    }

    /**
     * `perform_titlebar_action_fallback`: raise the action GTK would have activated, and
     * then the event NAMED for it.
     *
     * Both fire for every gesture, `none` included: the first is what a consumer reads to
     * know a titlebar was clicked at all — the C's `retval = FALSE`, where the compositor
     * declined, is a fact worth reporting — and the second is what a window host binds to.
     */
    private _perform(gesture: GtkTitlebarGesture, x: number, y: number): void {
        const action = this.actionFor(gesture);
        const windowAction = action === 'none' ? null : WINDOW_ACTIONS[action];
        const detail = { action, gesture, windowAction, x, y };
        this.dispatchEvent(new CustomEvent('titlebar-action', { bubbles: true, detail }));
        if (windowAction === null) return;
        this.dispatchEvent(new CustomEvent(windowAction, { bubbles: true, detail }));
    }

    private _onClick = (event: MouseEvent): void => {
        // The click gesture CLAIMED the sequence, which is what `gtk_event_controller_reset`
        // on both gestures does upstream for every click it acts on — including the second
        // press of a double click, whose drag was denied at press time
        // (gtkwindowhandle.c:400-406). A press count the browser knows and a pointerdown does
        // not is why the reset happens HERE.
        this._drag = null;
        const gesture = gestureOf(event.button, event.detail);
        if (gesture === null) return;
        // `do_popup_fallback` places the menu with `gtk_popover_set_pointing_to` at the event's
        // own position, which is the click's.
        this._perform(gesture, event.clientX, event.clientY);
    };

    private _onPointerDown = (event: PointerEvent): void => {
        // A second press of a multi-click sequence DENIES the drag, which is what
        // `click_gesture_pressed_cb` does with `n_press > 1` (gtkwindowhandle.c:381-385):
        // a double-click is a click, and a drag that began on its second press is not one.
        if (event.detail > 1) return;
        this._drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };

    /**
     * `drag_gesture_update_cb`: past the threshold the WINDOW moves, and the sequence is
     * reset so the gesture does not repeat. The move is a compositor operation, so what is
     * emitted is the INTENT, with the pointer's position where GTK hands `begin_move` its
     * own surface coordinates.
     */
    private _onPointerMove = (event: PointerEvent): void => {
        const drag = this._drag;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        const travelled = Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
        // STRICTLY past the threshold, which is what `gtk_drag_check_threshold_double` asks:
        // movement up to it is not a drag.
        if (travelled <= DRAG_THRESHOLD) return;
        this._drag = null;
        this.dispatchEvent(
            new CustomEvent('window-move', { bubbles: true, detail: { x: event.clientX, y: event.clientY } }),
        );
    };
}

customElements.define('gtk-window-handle', GtkWindowHandle);
