import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import css from './style.css';
import { MainWindow } from './main-window.js';

const app = new Gtk.Application({
    applicationId: 'org.gjsify.example',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

// Only on `activate`: while this module is evaluated there is no display yet, so
// `Gdk.Display.get_default()` is null and GTK aborts the call with "Argument display may not be
// null". `css` is the stylesheet as a string — a bare `import './style.css'` would be a module
// whose only effect is that default export, and the bundler would tree-shake it away.
function applyStylesheet(): void {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(css);
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default()!,
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
}

app.connect('activate', () => {
    applyStylesheet();
    new MainWindow(app).present();
});

app.run([]);
