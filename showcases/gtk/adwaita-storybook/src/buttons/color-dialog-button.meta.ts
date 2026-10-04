// Shared, renderer-agnostic metadata for the Color Dialog Button story. Imported by the
// GTK renderer (color-dialog-button.story.ts) and the browser renderer
// (browser/buttons/color-dialog-button.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const colorDialogButtonMeta: StoryMeta = {
    title: 'Buttons/Color Dialog Button',
    description:
        'Gtk.ColorDialogButton — a button that shows a colour and opens a chooser for it. It is ' +
        'insensitive until a dialog is set, and the swatch announces the channel percentages.',
    controls: [
        { name: 'rgba', label: 'Colour', type: ControlType.TEXT, defaultValue: '#3584e4' },
        { name: 'title', label: 'Dialog title', type: ControlType.TEXT, defaultValue: 'Choose a colour' },
    ],
};
