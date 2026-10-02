// Shared, renderer-agnostic metadata for the Font Dialog Button story. Imported by the GTK
// renderer (font-dialog-button.story.ts) and the browser renderer
// (browser/buttons/font-dialog-button.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const fontDialogButtonMeta: StoryMeta = {
    title: 'Buttons/Font Dialog Button',
    description:
        'Gtk.FontDialogButton — a button that shows a font and opens a chooser for it. At level family ' +
        'the label is the family alone; from font up it is family plus size, and the size box appears.',
    controls: [
        { name: 'fontDesc', label: 'Font', type: ControlType.TEXT, defaultValue: 'Sans Bold 12' },
        {
            name: 'level',
            label: 'Level',
            type: ControlType.SELECT,
            options: [
                { label: 'Family', value: 'family' },
                { label: 'Face', value: 'face' },
                { label: 'Font', value: 'font' },
                { label: 'Features', value: 'features' },
            ],
            defaultValue: 'font',
        },
        { name: 'useFont', label: 'Draw in the font', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'useSize', label: 'Draw in the size', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
