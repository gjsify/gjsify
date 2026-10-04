// GtkToggleButton — a button that stays pressed, for NativeScript.
//
// `Gtk.ToggleButton` IS a `Gtk.Button` with one more bit, so this extends the port's
// `GtkButton` and inherits all of it: `label`, `icon-name`, `child`, `use-underline`, the
// style classes, the press feedback and the `clicked` signal. What it adds is `active`, the
// `toggled` signal beside GObject's `notify::active`, and the `checked` look.
//
// A TAP TOGGLES BEFORE ANY `clicked` HANDLER RUNS, because GTK's toggle is the class handler
// of `clicked` (`gtk_toggle_button_clicked`, a RUN_FIRST default handler). The listener is
// added in this constructor, ahead of anything a caller connects afterwards, and listeners
// run in registration order — so a `clicked` handler reads the NEW `active`, as in C.
//
// THE LOOK IS A STATE CLASS, NOT A STYLE CLASS. `:checked` is a pseudo-class in GTK and
// never a member of `css-classes`; NativeScript's CSS has no checked state, so the view
// wears `checked` beside its own classes (`GtkButton._stateClasses`) while `styleClasses`
// reads back exactly what the caller set.
//
// WHAT IT DOES NOT DO: `group` (the radio exclusivity between toggle buttons) is not
// implemented — it is an object property, which that gate's scalar census does not list.
//
// Reference: refs/gtk gtk/gtktogglebutton.c (GtkToggleButton)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { GtkButton } from './gtk-button.js';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when `active` changes. Mirrors `Gtk.ToggleButton::toggled`. */
export const GTK_TOGGLE_BUTTON_TOGGLED = 'toggled';

/** Event name emitted when `active` changes. Mirrors GObject `notify::active`. */
export const NOTIFY_TOGGLE_ACTIVE = 'notify::active';

/** The class a pressed-in toggle button wears, which the theme gives the pressed shade. */
export const GTK_TOGGLE_BUTTON_CHECKED_CLASS = 'checked';

export class GtkToggleButton extends GtkButton {
    private _active = false;

    constructor(props?: ConstructProps<GtkToggleButton>) {
        super();

        this.addEventListener('clicked', () => {
            this.active = !this._active;
        });

        applyConstructProps(this, props);
    }

    /** `Gtk.ToggleButton:active` — whether the button is pressed in. Defaults to `false`. */
    get active(): boolean {
        return this._active;
    }

    set active(raw: boolean | string) {
        const next = xmlBoolean(raw, this._active);
        if (next === this._active) return;
        this._active = next;
        this._restyle();
        this.notify({ eventName: GTK_TOGGLE_BUTTON_TOGGLED, object: this });
        this.notify({ eventName: NOTIFY_TOGGLE_ACTIVE, object: this });
    }

    protected _stateClasses(): readonly string[] {
        return this._active ? [GTK_TOGGLE_BUTTON_CHECKED_CLASS] : [];
    }
}
