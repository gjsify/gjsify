// The `model` slot `<adw-combo-row>` and `<gtk-drop-down>` share — ADR 0072.
//
// A `.blp` writes a list model as an OBJECT at the property it sets,
// `model: Gtk.StringList { strings [ "Blue", "Teal" ] }`, and the shared-tree builder hands
// that over as a `<gtk-string-list slot="model" strings='["Blue","Teal"]'>` child. The slot
// CONSUMES it: the child is data, read for its strings and then gone, as GtkBuilder leaves no
// list model in the widget tree. The strings are JSON because `model` itself is a JSON
// attribute on both elements, so the one parser reads both spellings.

import { parseListModel } from '@gjsify/adwaita-core';
import type { AdwComboOption } from '@gjsify/adwaita-core';

import type { AdwSlotConsume } from './slotted-children.js';

/** The `model` slot, handing the authored list to `adopt`. */
export function stringListSlot(adopt: (model: AdwComboOption[]) => void): AdwSlotConsume {
    return {
        name: 'model',
        consume: (node) => adopt(parseListModel(node instanceof Element ? node.getAttribute('strings') : null)),
    };
}
