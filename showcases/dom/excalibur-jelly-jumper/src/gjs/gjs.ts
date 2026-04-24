// GJS/Adwaita entry point for the Excalibur Jelly Jumper showcase.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import { JellyJumperWindow } from './jelly-jumper-window.js';


const app = new Adw.Application({
    application_id: 'gjsify.examples.excalibur-jelly-jumper',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) win = new JellyJumperWindow(app);
    win.present();
});

app.run([]);
