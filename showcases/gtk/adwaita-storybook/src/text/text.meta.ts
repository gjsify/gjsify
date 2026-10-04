// Shared, renderer-agnostic metadata for the Text story. Imported by the GTK
// renderer (text.story.ts) and the browser renderer (browser/text/text.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const textMeta: StoryMeta = {
    title: 'Text/Text',
    description:
        'Gtk.Text — the single-line text widget every Gtk.Entry is built on. Standalone it is a ' +
        'field with a placeholder and a length limit; visibility=false masks it, propagate-text-width ' +
        'grows it with its text.',
    controls: [
        { name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: 'Ada Lovelace' },
        { name: 'placeholderText', label: 'Placeholder', type: ControlType.TEXT, defaultValue: '' },
        { name: 'editable', label: 'Editable', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'visibility', label: 'Visible', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'maxLength', label: 'Max length (0 = none)', type: ControlType.NUMBER, defaultValue: 0 },
        { name: 'propagateTextWidth', label: 'Grow with text', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
