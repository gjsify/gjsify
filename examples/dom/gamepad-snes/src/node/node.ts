// SNES Gamepad Tester — the Node entry (`--app node`, through @gjsify/node-gi), for
// Windows and macOS where there is no GJS. The debug panel only: the visualizer draws
// through @gjsify/canvas2d, which has no node slot, so this window shows what the W3C
// surface reports rather than the controller drawing.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { describeGamepadBackend, GamepadManager } from '@gjsify/gamepad';
import { createDebugPanel } from '../debug-panel.js';

// The manager directly, not `@gjsify/gamepad/register`: an `--app node` build routes a
// `/register` import to @gjsify/empty unless it detects GJS ambient globals in the
// source (open-todos "`--app node` genuine-GJS-source detection is narrower than the
// reverse bridge it gates"), so navigator.getGamepads would never be installed here.
const gamepads = new GamepadManager();

const app = new Adw.Application({
    application_id: 'gjsify.examples.gamepad-snes.node',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({
        application: app,
        default_width: 700,
        default_height: 260,
        title: 'SNES Gamepad Tester (debug panel)',
    });
    const { label, rumbleButton } = createDebugPanel(describeGamepadBackend(), () => gamepads.getGamepads());
    label.set_valign(Gtk.Align.START);
    label.set_margin_top(12);
    const headerBar = new Adw.HeaderBar();
    headerBar.pack_end(rumbleButton);
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(label);
    win.set_content(toolbarView);
    win.present();
});

// runAsync, not run(): the sync loop blocks promise continuations, and the gamepad
// backend is probed and started asynchronously (a sync run() never connects a pad).
await app.runAsync([]);
