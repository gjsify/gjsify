// Consumer typings of the application windows: compiled against the SHIPPED `lib/types` by
// `check:consumer`, so a cast a consumer needs shows up here as an error.
import { Adw, Gio, Gtk } from '../lib/types/index.js';

const window = new Adw.ApplicationWindow();
window.add_action(new Gio.SimpleAction({ name: 'x' }));
const found = window.lookup_action('x');
window.remove_action('x');
window.application?.set_accels_for_action('win.x', ['<Primary>x']);
window.application = new Gtk.Application();

const plain = new Gtk.ApplicationWindow();
plain.add_action(new Gio.SimpleAction({ name: 'y' }));
plain.application?.set_accels_for_action('win.y', ['<Primary>y']);

export { found };
