// Shared, renderer-agnostic metadata for the Text View story. Imported by the GTK
// renderer (text-view.story.ts) and the browser renderer (browser/text/text-view.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const textViewMeta: StoryMeta = {
    title: 'Text/Text View',
    description:
        'Gtk.TextView — the multi-line editor. Its text lives in a Gtk.TextBuffer rather than in a ' +
        "property, wrap-mode and justification are Pango's, and accepts-tab defaults to TRUE, which is " +
        "the opposite of a browser's.",
    controls: [
        {
            name: 'text',
            label: 'Text',
            type: ControlType.TEXT,
            defaultValue: 'A text view holds as many lines as it is given.\nTab inserts a tab character.',
        },
        {
            name: 'wrapMode',
            label: 'Wrap mode',
            type: ControlType.SELECT,
            options: [
                { label: 'None', value: 'none' },
                { label: 'Char', value: 'char' },
                { label: 'Word', value: 'word' },
                { label: 'Word or char', value: 'word-char' },
            ],
            defaultValue: 'none',
        },
        {
            name: 'justification',
            label: 'Justification',
            type: ControlType.SELECT,
            options: [
                { label: 'Left', value: 'left' },
                { label: 'Right', value: 'right' },
                { label: 'Center', value: 'center' },
                { label: 'Fill', value: 'fill' },
            ],
            defaultValue: 'left',
        },
        { name: 'monospace', label: 'Monospace', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'acceptsTab', label: 'Tab inserts a tab', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'cursorVisible', label: 'Show cursor', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'topMargin', label: 'Top margin', type: ControlType.NUMBER, defaultValue: 6 },
    ],
};
