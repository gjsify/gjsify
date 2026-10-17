// Consumer typing of `Gtk.Widget`'s `visible` and `tooltip-text` (checked against the SHIPPED `lib/types`):
// every widget element carries `visible`, and the ones that draw a tooltip carry its GTK spellings.
import { Adw, Gtk } from '../lib/types/index.js';

const box = new Gtk.Box();
box.visible = false;
box.set_visible(box.get_visible());

const button = new Gtk.Button();
button.visible = true;
button.set_visible(false);
button.tooltip_text = button.tooltipText;
button.tooltipText = button.get_tooltip_text();
button.set_tooltip_text(null);

const row = new Adw.ActionRow();
row.set_tooltip_text(button.get_tooltip_text());
row.set_visible(true);
