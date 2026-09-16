import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { MainWindow } from './main-window.js';

const app = new Gtk.Application({
    applicationId: 'org.gjsify.example',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    new MainWindow(app).present();
});

app.run([]);
