// Consumer typing of `Gtk.WindowCommon` (ADR 0098 Amendment 4): every window element is one, checked
// against the SHIPPED `lib/types` by `check:consumer`, so a member that drifts shows up here.
import { Adw, Gtk } from '../lib/types/index.js';

export const windows: Gtk.WindowCommon<Element>[] = [
    new Gtk.Window(),
    new Gtk.ApplicationWindow(),
    new Adw.Window(),
    new Adw.ApplicationWindow(),
];

const shared: Gtk.WindowCommon = new Adw.ApplicationWindow();
shared.connect('close-request', (self) => self.is_active);
shared.connect('notify::maximized', (self) => void self.is_maximized());
