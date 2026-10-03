// <gtk-link-button> — a button that follows a URI. `Gtk.LinkButton` IS a `Gtk.Button`
// with two properties of its own, so this element extends `<gtk-button>` and inherits
// its label, icon, child and style-class attributes unchanged; `uri` and `visited` are
// the whole of the addition.
//
// `visited` is the state a browser already knows: once a link has been followed it is
// drawn in the visited colour and announces as visited. GTK reaches that through two
// state flags — `GTK_STATE_FLAG_LINK` when unvisited, `GTK_STATE_FLAG_VISITED` when
// visited (gtklinkbutton.c:359, 742-749) — and here it is one `.visited` class on the
// inner button, because the stylesheet has to be able to select on it.
//
// THE ORDER OF TWO OPERATIONS IS GTK'S, not ours. `gtk_link_button_set_uri()` ends with
// `gtk_link_button_set_visited (link_button, FALSE)` (gtklinkbutton.c:695): pointing the
// button somewhere else un-visits it, because the new target has not been seen. And
// `gtk_link_button_activate_link()` — the DEFAULT handler of `::activate-link` — sets it
// visited AFTER handing the URI to the launcher (:550). The state follows the click.
//
// `::activate-link` is a BOOLEAN-ACCUMULATOR signal: a handler returning TRUE stops the
// default handler from running (gtklinkbutton.c:216-238). The DOM spelling of "return
// TRUE" is `preventDefault()` on a cancelable event, so `activate-link` is dispatched
// cancelable and the launch happens only when nothing cancelled it.
//
// WHAT THE LAUNCH IS HERE. GTK hands the URI to the desktop's handler
// (`GtkUriLauncher`, gtklinkbutton.c:528-548), which opens it in ANOTHER application and
// leaves the button's window standing. The browser's equivalent of "another
// application" is another tab, so the URI goes to `window.open(uri, '_blank',
// 'noopener')` — deliberately not `location.assign`, which would tear the page down the
// way a desktop does not.
//
// NOT PORTED, and it is not a property: the CONTEXT MENU. `GtkLinkButton` installs
// `clipboard.copy` and `menu.popup` actions and binds Shift+F10 / Menu to them
// (gtklinkbutton.c:247-264), opening a `GtkPopoverMenu` with one entry. A browser
// already owns the context menu on a button, and taking it over would remove the
// platform's menu from every link on the page — so `::activate-link` is the whole of
// the activation surface here.
//
// A11Y: GTK's role is LINK (gtklinkbutton.c:244). A native `<button>` keeps the button
// role — a `<button role="link">` would stop being announced as pressable — and the URI
// rides along in the tooltip exactly as `gtk_link_button_query_tooltip_cb` puts it there
// when the button has no tooltip of its own and its label is not already the URI
// (:646-672).
//
// Reference: refs/gtk/gtk/gtklinkbutton.c (uri, visited, activate-link, the tooltip)
// Reference: refs/libadwaita/src/stylesheet/widgets/_links.scss (`button.link`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { GtkButton } from './gtk-button.js';

export class GtkLinkButton extends GtkButton {
    private _wired = false;

    static get observedAttributes() {
        return [...GtkButton.observedAttributes, 'uri', 'visited'];
    }

    /** `Gtk.LinkButton:uri` — the address this button points at. */
    get uri(): string {
        return this.getAttribute('uri') ?? '';
    }

    set uri(value: string) {
        this.setAttribute('uri', value);
    }

    /**
     * `Gtk.LinkButton:visited` — whether the link has been followed. The state flag
     * GTK swaps here is what the stylesheet paints as `:visited`, and the `VISITED`
     * accessibility state beside it; see the header.
     */
    get visited(): boolean {
        return this.hasAttribute('visited');
    }

    set visited(value: boolean) {
        this.toggleAttribute('visited', !!value);
    }

    connectedCallback() {
        super.connectedCallback();
        if (this._wired) return;
        this._wired = true;
        this.button.addEventListener('click', () => this._activateLink());
    }

    // Optional because `GtkButton`'s own callback declares no parameter, and an override
    // may not demand one the base signature does not pass.
    attributeChangedCallback(name?: string) {
        // A new destination has not been seen: `gtk_link_button_set_uri()` unsets
        // `visited` itself (gtklinkbutton.c:695), and only for `uri` — writing `visited`
        // directly is the author's own state change and has to survive.
        if (name === 'uri' && this.isConnected) this.visited = false;
        super.attributeChangedCallback();
        if (name === 'visited' && this.isConnected) {
            this.dispatchEvent(
                new CustomEvent('notify::visited', { bubbles: true, detail: { visited: this.visited } }),
            );
        }
    }

    /**
     * `::activate-link` — cancelable, because the signal is a boolean accumulator
     * (gtklinkbutton.c:216-238) and `preventDefault()` is the DOM spelling of a handler
     * returning TRUE. Nothing cancelled ⇒ the default handler runs.
     */
    private _activateLink(): void {
        const event = new CustomEvent('activate-link', { bubbles: true, cancelable: true });
        this.dispatchEvent(event);
        if (event.defaultPrevented) return;
        const { uri } = this;
        // `gtk_link_button_new()` requires a URI (`g_return_val_if_fail (uri != NULL)`),
        // so a button without one is half-written and there is nothing to launch.
        if (uri === '') return;
        this.launch(uri);
        this.visited = true;
    }

    /**
     * The launcher call, on its own method so a caller (or a spec) can stand in for the
     * window the desktop would have opened.
     */
    protected launch(uri: string): void {
        window.open(uri, '_blank', 'noopener');
    }

    protected override decorate(button: HTMLButtonElement): void {
        button.classList.add('link');
        button.classList.toggle('visited', this.visited);
        const label = (this.getAttribute('label') ?? '').trim();
        const tooltip = this.getAttribute('tooltip') ?? this.getAttribute('tooltip-text');
        // `query_tooltip_cb` shows the URI only when the label would not repeat it.
        if (tooltip === null && label !== '' && this.uri !== '' && this.uri !== label) {
            button.title = this.uri;
        }
    }
}

customElements.define('gtk-link-button', GtkLinkButton);
