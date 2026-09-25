// The debug panel of the GTK entries (GJS, and Node through @gjsify/node-gi): which
// backend drives this process — on Linux GJSIFY_GAMEPAD_BACKEND=manette|sdl|compare
// chooses, see @gjsify/gamepad's README — the raw W3C values, and a rumble button, so a
// real controller can be checked by hand on every OS.

import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { debugText, rumble, type GetGamepads } from './snes-gamepad-demo.js';

export interface DebugPanel {
    /** The monospace readout, refreshed every 100 ms. */
    label: Gtk.Label;
    /** Plays half a second of dual-rumble; its tooltip says what happened. */
    rumbleButton: Gtk.Button;
}

export function createDebugPanel(backendName: Promise<string>, getGamepads?: GetGamepads): DebugPanel {
    const label = new Gtk.Label({ xalign: 0, selectable: true, wrap: true });
    label.add_css_class('monospace');
    label.set_margin_start(12);
    label.set_margin_end(12);
    label.set_margin_bottom(12);
    let backend = '…';
    void backendName.then((name) => (backend = name));
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        label.set_label(debugText(backend, getGamepads));
        return GLib.SOURCE_CONTINUE;
    });

    const rumbleButton = new Gtk.Button({ label: 'Rumble' });
    rumbleButton.connect('clicked', () => {
        void rumble(getGamepads).then((result) => rumbleButton.set_tooltip_text(result));
    });
    return { label, rumbleButton };
}
