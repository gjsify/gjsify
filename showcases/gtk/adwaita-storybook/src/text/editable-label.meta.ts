// Shared, renderer-agnostic metadata for the Editable Label story. Imported by the GTK
// renderer (editable-label.story.ts) and the browser renderer
// (browser/text/editable-label.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const editableLabelMeta: StoryMeta = {
    title: 'Text/Editable Label',
    description:
        'Gtk.EditableLabel — a label you click and edit in place. Enter starts editing, Enter commits, ' +
        'Escape discards, and editable=false leaves it a label; the draft lives in the entry, not in the label.',
    controls: [
        { name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: 'Ada Lovelace' },
        { name: 'editable', label: 'Editable', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'editing', label: 'Editing', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
