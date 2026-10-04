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
// `group` IS `gtk_toggle_button_set_group` — the doubly-linked `group_next`/`group_prev` list
// (gtktogglebutton.c:121-122, 511-556), transcribed the way `<gtk-toggle-button>` transcribes
// it, so the two renderers agree on its three visible rules: activating a member releases
// every other member, an ACTIVE member with a link cannot be clicked off (so it is the button
// that GAINED the link, not its target, that stops being clickable-off), and a button cannot be
// its own group. It is write-only, as it is upstream (`G_PARAM_WRITABLE`), and takes the other
// BUTTON: markup has no spelling for a widget reference, so it is the code door.
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

/** Event name emitted when `group` changes. Mirrors GObject `notify::group`. */
export const NOTIFY_TOGGLE_GROUP = 'notify::group';

/** How far the walk back to the first member goes; it only bounds what a cycle can cost. */
const GROUP_WALK_LIMIT = 1024;

export class GtkToggleButton extends GtkButton {
    static override readonly emittedSignals: readonly string[] = [
        ...GtkButton.emittedSignals,
        GTK_TOGGLE_BUTTON_TOGGLED,
        NOTIFY_TOGGLE_ACTIVE,
    ];

    private _active = false;
    private _groupNext: GtkToggleButton | null = null;
    private _groupPrev: GtkToggleButton | null = null;

    constructor(props?: ConstructProps<GtkToggleButton>) {
        super();

        this.addEventListener('clicked', () => {
            // `gtk_toggle_button_clicked` refuses to release an active member that has a link.
            if (this._active && this._grouped) return;
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
        // Before `_active` moves, so a `toggled` listener on a released member reads this
        // one as still released (`gtk_toggle_button_set_active` clears the group first).
        if (next && this._grouped) this._clearGroup();
        this._active = next;
        this._restyle();
        this.notify({ eventName: GTK_TOGGLE_BUTTON_TOGGLED, object: this });
        this.notify({ eventName: NOTIFY_TOGGLE_ACTIVE, object: this });
    }

    /**
     * `Gtk.ToggleButton:group` — the button this one joins, or `null` to leave the group.
     * Write-only, as `G_PARAM_WRITABLE` has it.
     */
    set group(value: GtkToggleButton | null) {
        this._setGroup(value);
    }

    private get _grouped(): boolean {
        return this._groupNext !== null || this._groupPrev !== null;
    }

    /** `gtk_toggle_button_set_group` — insert this button directly BEFORE `group`, or unlink it. */
    private _setGroup(group: GtkToggleButton | null): void {
        if (group === this) {
            console.error('Gtk.ToggleButton cannot be its own group; the group is unchanged.');
            return;
        }
        if (group === null) {
            if (this._groupPrev) this._groupPrev._groupNext = this._groupNext;
            if (this._groupNext) this._groupNext._groupPrev = this._groupPrev;
            this._groupNext = null;
            this._groupPrev = null;
        } else {
            if (this._groupNext === group) return;
            // No unlink from a previous group first: the C has none (:542-554), and a list
            // that silently dropped the old link would make the renderers disagree.
            this._groupPrev = null;
            if (group._groupPrev) {
                const previous = group._groupPrev;
                previous._groupNext = this;
                this._groupPrev = previous;
            }
            group._groupPrev = this;
            this._groupNext = group;
        }
        this.notify({ eventName: NOTIFY_TOGGLE_GROUP, object: this });
    }

    /** Release every OTHER member: walk back to the first, then forwards (:426-434). */
    private _clearGroup(): void {
        for (
            let iter: GtkToggleButton | null = GtkToggleButton._groupHead(this);
            iter !== null;
            iter = iter._groupNext
        ) {
            if (iter !== this) iter.active = false;
        }
    }

    /** Walk back to the first member of a toggle group, bounded like GTK. */
    private static _groupHead(start: GtkToggleButton): GtkToggleButton {
        let first = start;
        for (let depth = 0; first._groupPrev !== null && depth < GROUP_WALK_LIMIT; depth++) first = first._groupPrev;
        return first;
    }

    protected _stateClasses(): readonly string[] {
        return this._active ? [GTK_TOGGLE_BUTTON_CHECKED_CLASS] : [];
    }
}
