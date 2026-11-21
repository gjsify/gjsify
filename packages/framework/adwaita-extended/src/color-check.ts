import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { ensureStyles } from './styles.js';
import { Tint } from './tint.js';

/**
 * A round check button in an arbitrary source colour. It is a plain `Gtk.CheckButton`, so
 * `active`, `notify::active` and `toggled` are the toggle API; the accessible label is required.
 */
export class ColorCheck extends Gtk.CheckButton {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwColorCheck' }, ColorCheck);
    }

    private readonly tint: Tint;

    constructor(label: string, colour: string | null = null) {
        super({ valign: Gtk.Align.CENTER, tooltipText: label });
        ensureStyles();
        this.add_css_class('selection-mode');
        this.setAccessibleLabel(label);
        this.tint = new Tint(
            this,
            'check',
            (cls, c) =>
                // Adwaita draws the empty ring from currentColor, not a border: tint the ring itself and
                // keep white for the tick only, or the ring vanishes on a light background.
                `checkbutton.${cls} check { box-shadow: inset 0 0 0 2px ${c}; }` +
                `checkbutton.${cls} check:checked { background-color: ${c}; box-shadow: none; color: white; }`,
        );
        this.tint.set(colour);
    }

    setColour(colour: string | null): void {
        this.tint.set(colour);
    }

    setAccessibleLabel(label: string): void {
        this.update_property([Gtk.AccessibleProperty.LABEL], [label]);
        this.set_tooltip_text(label);
    }
}
