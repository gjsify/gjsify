// <gtk-window-controls> — the window-frame buttons of ONE side: the window icon and the
// minimize, maximize and close buttons, in the order the decoration layout names them.
// GTK puts one of these at each end of a header bar and binds the bar's `decoration-layout`
// to both (gtkheaderbar.c:222-249), which is why `side` exists at all.
//
// WHAT IT IS NOT: A TOPLEVEL. `update_window_buttons` opens with the root check and
// RETURNS on it — no `GtkWindow` above, `set_empty (self, TRUE)` and nothing else
// (gtkwindowcontrols.c:257-264). A `GtkWindowControls` outside a window therefore draws
// nothing, and the story on /gjsify/gtk/windows/ puts one inside a `<gtk-window>` for
// exactly that reason. A browser has no toplevel and no window manager to ask, so the ROOT
// here is the nearest `<gtk-window>`/`<adw-window>` ancestor: this is the widget's DECISION
// LOGIC run against an in-page frame, not a window.
//
// WHICH BUTTONS, IN WHICH ORDER — `update_window_buttons` (gtkwindowcontrols.c:247-426):
//   · the layout is split on the FIRST ':' into a start half and an end half, and a layout
//     with no ':' is the SAME half on both sides (:141-166). `side` picks which half and
//     defaults to `start` (`GTK_PACK_START`, :68); setting it swaps the `start`/`end` style
//     classes exactly as `gtk_window_controls_set_side` does (:496-522).
//   · the half is split on ',' and each token builds one child, or none:
//       `icon`     — a `GtkImage`, SOVEREIGN WINDOWS ONLY: a modal window or one with a
//                    `transient-for` has no window icon of its own, and the image is
//                    dropped altogether when there is no icon to show (:299-317)
//       `minimize` — `window-minimize-symbolic`, sovereign only (:318-341)
//       `maximize` — `window-maximize-symbolic`, or `window-restore-symbolic` while the
//                    window is `maximized`, and only while the window is `resizable`
//                    (:342-367)
//       `close`    — `window-close-symbolic`, and only while the window is `deletable`
//                    (:368-393)
//     A token that names none of them builds nothing, which is what the tail of the loop
//     does with it (:416-419).
//   · `empty` is TRUE when no token produced a button. It is a real GObject property with a
//     notify of its own (`set_empty`, :216-230), so it is read, styled and notified here.
//
// WHERE THE LAYOUT COMES FROM, AND WHY THAT IS THE ONE DIVERGENCE. `get_layout` takes this
// widget's own `decoration-layout`, and failing that the DISPLAY-WIDE
// `Gtk.Settings:gtk-decoration-layout` (:129-140). A browser page has no settings object,
// so the port's second stop is the FRAME's own `decoration-layout` — the nearest thing a
// page has to a display-wide default, and the one value a page author can actually reach.
// With neither, the default is GNOME's `:minimize,maximize,close`, which is the layout
// libadwaita's own rules are drawn against (`_header-bar.scss:175-207` styles the three
// buttons and nothing else).
//
// WHAT RE-RENDERS IT. `window_notify_cb` (:428-441) re-runs `update_window_buttons` for six
// window properties — `deletable`, `icon-name`, `maximized`, `modal`, `resizable`,
// `transient-for` — and `gtk_window_controls_root` (:443-467) adds `notify::gtk-decoration-layout`
// from the settings. All seven are observed here, the last one through the frame.
//
// KEYS: GTK sets `can_focus = FALSE` on all three buttons (:333, :364, :394) because the
// window manager owns those actions. NOT PORTED, AND DELIBERATELY: a page has no window
// manager, and taking the only close/minimize affordance out of the tab order would leave a
// keyboard user unable to reach them at all. The buttons stay ordinary buttons.
//
// A11Y: `role="group"`, GtkWindowControls's own accessible role (:95). Each button carries
// the LABEL GTK gives it (`Minimize` / `Maximize` / `Close`, :337, :362, :390) and the icon
// node is `aria-hidden`, as GTK marks those images `presentation`.
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on every real
// change, and `window-action` (CustomEvent, bubbles, detail `{ action }`) when a button is
// pressed — the `GtkActionable` action name of the button that was pressed
// (`window.minimize`, `window.toggle-maximized`, `window.close`). `<gtk-window>` listens for
// it and performs the default.
//
// Reference: refs/gtk/gtk/gtkwindowcontrols.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_header-bar.scss (GtkWindowControls)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { createGtkImage } from './gtk-image.js';

/** `Gtk.PackType`, spelled as the GIR's enum nicks (gtkwindowcontrols.c:68). */
type PackSide = 'start' | 'end';

/** What a press asks for: the `GtkActionable` action name minus its `window.` prefix. */
export type WindowAction = 'minimize' | 'toggle-maximized' | 'close';

/** The button one token builds: its style class, its icon, its accessible name. */
interface ControlSpec {
    readonly className: string;
    readonly icon: string;
    readonly label: string;
    readonly action: WindowAction;
}

/** The three button glyphs, named as C names them (:333, :364, :377, :382). */
const TOKEN_BUTTONS: Record<'minimize' | 'maximize' | 'close', ControlSpec> = {
    minimize: { className: 'minimize', icon: 'window-minimize-symbolic', label: 'Minimize', action: 'minimize' },
    maximize: {
        className: 'maximize',
        icon: 'window-maximize-symbolic',
        label: 'Maximize',
        action: 'toggle-maximized',
    },
    close: { className: 'close', icon: 'window-close-symbolic', label: 'Close', action: 'close' },
};

/** What `maximize` draws while the window is maximized instead (gtkwindowcontrols.c:347-350). */
const RESTORE_ICON_NAME = 'window-restore-symbolic';
const RESTORE_LABEL = 'Restore';

/**
 * GNOME's `Gtk.Settings:gtk-decoration-layout`, and the layout libadwaita's rules are drawn
 * against. The port's stand-in for the settings object — see the header.
 */
const DEFAULT_DECORATION_LAYOUT = ':minimize,maximize,close';

/**
 * The window properties `window_notify_cb` re-renders on (:430-436), plus `decoration-layout`
 * standing in for the settings notify of :445-447.
 */
const WINDOW_ATTRIBUTES = [
    'decoration-layout',
    'deletable',
    'icon-name',
    'maximized',
    'modal',
    'resizable',
    'transient-for',
];

/** `closest` over both window spellings — `Adw.Window` is a `GtkWindow` subclass. */
const WINDOW_SELECTOR = 'gtk-window, adw-window';

export class GtkWindowControls extends HTMLElement {
    private _initialized = false;
    private _empty = true;
    /** The frame this controls answers to, or `null` outside one (`:257-263`). */
    private _window: Element | null = null;
    private _windowObserver: MutationObserver | null = null;

    static get observedAttributes() {
        return ['decoration-layout', 'side', 'use-native-controls'];
    }

    /** `Gtk.WindowControls:side` — which half of the decoration layout to build. */
    get side(): PackSide {
        return this.getAttribute('side') === 'end' ? 'end' : 'start';
    }

    set side(value: PackSide) {
        this._write('side', value);
    }

    /** `Gtk.WindowControls:use-native-controls` — a macOS-only branch; see KNOWN_GAPS. */
    get useNativeControls(): boolean {
        return this.hasAttribute('use-native-controls');
    }

    /**
     * `Gtk.WindowControls:empty` (read-only in GIR). TRUE — the GIR default (:618) — until a
     * render finds a button, which is what happens outside a window.
     */
    get empty(): boolean {
        return this._empty;
    }

    /** `setAttribute` for a write that changes nothing; every GObject setter here returns early. */
    private _write(name: string, value: string): void {
        if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    connectedCallback() {
        if (this._initialized) {
            this._followWindow();
            return;
        }
        this._initialized = true;

        this.setAttribute('role', 'group');
        this._followWindow();
    }

    disconnectedCallback() {
        this._windowObserver?.disconnect();
        this._windowObserver = null;
        this._window = null;
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    private _property(name: string): boolean | string {
        return name === 'side' ? this.side : this.hasAttribute(name);
    }

    /**
     * Bind to the frame above, the way `gtk_window_controls_root` binds to the settings and
     * to `notify` on the window (:443-462) — then run the build, which is that handler's
     * first act. Re-established on every connect: a bar moved into another window has a new
     * ancestor, which is why C does it in `root` and drops it in `unroot`.
     */
    private _followWindow() {
        this._windowObserver?.disconnect();
        this._applyEmptyClass();
        this._window = this.closest(WINDOW_SELECTOR);
        if (this._window !== null) {
            this._windowObserver ??= new MutationObserver(() => this._render());
            this._windowObserver.observe(this._window, { attributes: true, attributeFilter: WINDOW_ATTRIBUTES });
        }
        this._render();
    }

    /** `is_sovereign_window` (gtkwindowcontrols.c:272-273): neither modal nor transient. */
    private _isSovereign(window: Element): boolean {
        return !window.hasAttribute('modal') && !window.hasAttribute('transient-for');
    }

    /**
     * The window property, in ITS polarity. `resizable` and `deletable` default TRUE
     * (gtkwindow.c:893, :1024) and `maximized` defaults FALSE (:1044), so one helper reading
     * them alike would put a maximize button on a window that cannot be maximized — and a
     * restore glyph on every window there is.
     */
    private _windowFlag(element: Element, name: 'resizable' | 'deletable'): boolean {
        return element.getAttribute(name) !== 'false';
    }

    /**
     * `get_layout` (gtkwindowcontrols.c:120-176), reduced to what a page can answer: this
     * widget's own value, then the frame's, then GNOME's default. The first ':' splits the
     * layout in two, and a layout with no ':' is the same half on both sides.
     */
    private _layoutHalf(): string | null {
        const layout =
            this.getAttribute('decoration-layout') ??
            this._window?.getAttribute('decoration-layout') ??
            DEFAULT_DECORATION_LAYOUT;
        if (layout === '') return null;
        const colon = layout.indexOf(':');
        if (colon === -1) return layout;
        return this.side === 'start' ? layout.slice(0, colon) : layout.slice(colon + 1);
    }

    /** `update_window_buttons` (gtkwindowcontrols.c:247-426), token for token. */
    private _render(): void {
        // `gtk_window_controls_set_side` moves the style class as part of the same rebuild
        // (:496-522), so both halves of that setter live here.
        this.classList.toggle('start', this.side === 'start');
        this.classList.toggle('end', this.side === 'end');
        // `clear_controls` runs before anything is built (:271), so a window that stopped
        // being resizable loses its maximize button rather than keeping a stale one.
        this.replaceChildren();
        this._applyEmptyClass();

        const window = this._window;
        if (window === null) {
            this._setEmpty(true);
            return;
        }
        const sovereign = this._isSovereign(window);
        const half = this._layoutHalf();
        if (half === null) {
            this._setEmpty(true);
            return;
        }

        let empty = true;
        for (const token of half.split(',')) {
            const button = this._buttonFor(token, window, sovereign);
            if (button === null) continue;
            this.appendChild(button);
            empty = false;
        }
        this._setEmpty(empty);
    }

    /** Every render writes the class, whether the VALUE moved or not — see {@link _setEmpty}. */
    private _applyEmptyClass(): void {
        this.classList.toggle('empty', this._empty);
    }

    /** The one child a token builds, or `null` for the tokens that build nothing here. */
    private _buttonFor(token: string, window: Element, sovereign: boolean): HTMLElement | null {
        if (token === 'icon') return sovereign ? this._windowIcon(window) : null;
        if (token === 'minimize') return sovereign ? this._controlButton(TOKEN_BUTTONS.minimize) : null;
        if (token === 'maximize') {
            if (!sovereign || !this._windowFlag(window, 'resizable')) return null;
            // :347-350 — the glyph and the label follow the window's state, not the token.
            const maximized = window.hasAttribute('maximized');
            return this._controlButton(
                maximized
                    ? { ...TOKEN_BUTTONS.maximize, icon: RESTORE_ICON_NAME, label: RESTORE_LABEL }
                    : TOKEN_BUTTONS.maximize,
            );
        }
        if (token === 'close') {
            return this._windowFlag(window, 'deletable') ? this._controlButton(TOKEN_BUTTONS.close) : null;
        }
        return null;
    }

    /**
     * `update_window_icon` (gtkwindowcontrols.c:187-210): the icon node is `presentation` to
     * an accessibility tree, and it is dropped when the window has no icon — which for a
     * frame means no `icon-name`, the analogue of a window with no `GdkPaintable`.
     */
    private _windowIcon(window: Element): HTMLElement | null {
        const name = window.getAttribute('icon-name');
        return name === null || name === '' ? null : createGtkImage(name, 'icon');
    }

    /**
     * One `GtkButton` with its `GtkImage` child. A plain `<button>` rather than
     * `<gtk-button>`: libadwaita's own rules select `windowcontrols > button > image`
     * (refs/libadwaita/src/stylesheet/widgets/_header-bar.scss:178-202), so the button IS
     * the widget node here, and `<gtk-button>` would wrap a second one inside it.
     */
    private _controlButton(spec: ControlSpec): HTMLElement {
        const button = document.createElement('button');
        button.className = `adw-window-controls-button ${spec.className}`;
        button.setAttribute('aria-label', spec.label);
        button.title = spec.label;
        button.appendChild(createGtkImage(spec.icon));
        button.addEventListener('click', () =>
            this.dispatchEvent(new CustomEvent('window-action', { bubbles: true, detail: { action: spec.action } })),
        );
        return button;
    }

    /**
     * `set_empty` (gtkwindowcontrols.c:216-230): a style class, and a notify of its own.
     *
     * The early return is about the NOTIFY, and it is the whole of C's `if (empty ==
     * self->empty) return;`. The CLASS is not part of that comparison here: `empty` starts
     * TRUE, so the first render outside a window is a no-op against C and the widget was
     * left wearing nothing at all — a property whose style class only appears once it has
     * been wrong and then right again.
     */
    private _setEmpty(empty: boolean): void {
        if (empty === this._empty) return;
        this._empty = empty;
        this._applyEmptyClass();
        this.dispatchEvent(new CustomEvent('notify::empty', { bubbles: true, detail: { empty } }));
    }
}

customElements.define('gtk-window-controls', GtkWindowControls);
