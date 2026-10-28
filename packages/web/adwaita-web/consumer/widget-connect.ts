// Consumer typing of the GObject signal API on every widget element (checked against the SHIPPED
// `lib/types`): `connect` / `disconnect` / `emit` / `notify` are declared once, on the widget base.
import { Adw, Gtk } from '../lib/types/index.js';

const viewStack = new Adw.ViewStack();
const stackId = viewStack.connect('notify::visible-child-name', () => {});
viewStack.disconnect(stackId);

const stack = new Gtk.Stack();
stack.connect('notify::visible-child-name', (self) => self.visibleChildName);

const button = new Gtk.Button();
const clickedId: number = button.connect('clicked', (self) => self.get_tooltip_text());
button.disconnect(clickedId);
button.emit('clicked');
button.notify('tooltip-text');
