// GtkLinkButton — a button that follows a URI, for NativeScript.
//
// `Gtk.LinkButton` IS a `Gtk.Button` with two more properties, so this extends the port's
// `GtkButton` and inherits all of it: `label`, `icon-name`, `child`, the style classes, the
// press feedback and `clicked`. What it adds is `uri`, `visited` and the `activate-link`
// signal, and it wears the `flat` and `link` classes GTK gives it.
//
// MEASURED on GTK 4.22: a new link button has css-classes `flat,text-button,link` and the css
// name `button`; `uri` and `label` default to NULL and read as `''`.
//
// THE ORDER OF TWO OPERATIONS IS GTK'S, not ours. `set_uri` notifies `uri` and THEN clears
// `visited` (which notifies only if it was set): pointing the button elsewhere un-visits it.
// A tap emits `activate-link` from the class handler of `clicked`, so it runs BEFORE any
// `clicked` handler a caller connected, and the listener is added in this constructor for that
// reason. `activate-link` has a handled accumulator: a handler returning true stops the launch,
// and with it the `visited` flip, because GTK sets `visited` inside its own default handler.
//
// DIFFERENCE: the launch is `launch_default_for_uri` through the host, as `Adw.AboutDialog`
// and `Gtk.Label` links do. A URI the host cannot open is dropped, as a failed launch is, and
// `visited` still becomes true (GTK sets it after the launch call without reading its result).
//
// Reference: refs/gtk gtk/gtklinkbutton.c (GtkLinkButton)
// Copyright (c) The GTK Team. LGPLv2.1+.

import type { EventData } from '@nativescript/core';
import { HandledAccumulator, createAppInfo } from '@gjsify/adwaita-core';

import { nativePlatformHost } from '../platform-host.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { GtkButton } from './gtk-button.js';
import { withProperties, type GObjectNotify } from './signals.js';

const appInfo = createAppInfo(nativePlatformHost);

/** Event name emitted before the launch, with a handled accumulator. Mirrors `Gtk.LinkButton::activate-link`. */
export const GTK_LINK_BUTTON_ACTIVATE_LINK = 'activate-link';

/** The class a followed link wears, which the theme gives the visited colour. */
export const GTK_LINK_BUTTON_VISITED_CLASS = 'visited';

export class GtkLinkButton extends withProperties(GtkButton, {
    GTypeName: 'GtkLinkButton',
    Properties: {
        uri: {
            kind: 'string',
            default: '',
            blurb: 'The URI bound to this button',
            // `gtk_link_button_set_uri` notifies on every write, an equal one included (measured).
            normalize: (value) => (value === null || value === undefined ? '' : String(value)),
            changed: () => true,
            // `set_uri` ends in `set_visited (FALSE)`, after its own notify (:695).
            afterNotify: (self) => {
                (self as GtkLinkButton).visited = false;
            },
        },
        visited: {
            kind: 'boolean',
            default: false,
            blurb: 'Whether this link has been visited',
            afterNotify: (self) => (self as GtkLinkButton)._restyle(),
        },
    },
}) {
    static readonly GTypeName: string = 'GtkLinkButton';

    /** `Gtk.LinkButton:uri` — where the button points. Defaults to `''`. */
    declare uri: string;

    /** `Gtk.LinkButton:visited` — whether the link has been followed. Defaults to `false`. */
    declare visited: boolean;

    /** GJS's `notify('<prop>')` beside NativeScript's `notify({ eventName })`; see the seam. */
    declare notify: GObjectNotify;

    constructor(props?: ConstructProps<GtkLinkButton>) {
        super();

        // Connected first, so it runs first: GTK's `activate-link` is the class handler of `clicked`.
        this.connect('clicked', () => this._activateLink());

        // `gtk_link_button_init`: `flat` and `link` are added by the widget itself.
        this.add_css_class('flat');
        this.add_css_class('link');

        applyConstructProps(this, props);
    }

    /** `gtk_link_button_new` — a link button with `label` pointing at `uri`. */
    static new_with_label(uri: string, label?: string | null): GtkLinkButton {
        return new GtkLinkButton({ uri, label: label ?? undefined });
    }

    /** `gtk_link_button_get_uri`. */
    get_uri(): string {
        return this.uri;
    }

    /** `gtk_link_button_set_uri`. */
    set_uri(uri: string): void {
        this.uri = uri;
    }

    /** `gtk_link_button_get_visited`. */
    get_visited(): boolean {
        return this.visited;
    }

    /** `gtk_link_button_set_visited`. */
    set_visited(visited: boolean): void {
        this.visited = visited;
    }

    /**
     * The default handler of `activate-link`: the handlers under GTK's handled accumulator,
     * then — only if none returned true — the launch, and `visited` after it.
     */
    private _activateLink(): void {
        const accumulator = new HandledAccumulator();
        this.notify({
            eventName: GTK_LINK_BUTTON_ACTIVATE_LINK,
            object: this,
            uri: this.uri,
            accumulator,
        } as EventData);
        if (accumulator.stopped) return;
        if (this.uri !== '') this.launch(this.uri);
        this.visited = true;
    }

    /**
     * The launcher call, on its own method so a caller (or a spec) can stand in for the app the
     * host would have opened. A URI the host cannot launch is dropped.
     */
    protected launch(uri: string): void {
        try {
            appInfo.launch_default_for_uri(uri, null);
        } catch {
            // no scheme, nothing to open
        }
    }

    protected _stateClasses(): readonly string[] {
        const inherited = super._stateClasses();
        return this.visited ? [...inherited, GTK_LINK_BUTTON_VISITED_CLASS] : inherited;
    }
}
