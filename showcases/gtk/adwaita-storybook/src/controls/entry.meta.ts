// Shared, renderer-agnostic metadata for the Entry story. Imported by the GTK
// renderer (entry.story.ts), the browser renderer (browser/controls/entry.web.ts)
// and the NativeScript one, so all three expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const entryMeta: StoryMeta = {
    title: 'Controls/Entry',
    description:
        'Gtk.Entry — a single-line text field. Libadwaita ships no AdwEntry; the Adwaita look is the ' +
        'GTK entry styled by the stylesheet, which is why the row variants (Entry Row, Password Entry Row) ' +
        'are the widgets with an Adw prefix.',
    controls: [
        { name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: '' },
        { name: 'placeholder', label: 'Placeholder', type: ControlType.TEXT, defaultValue: 'Search files…' },
        { name: 'editable', label: 'Editable', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
