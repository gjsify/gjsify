// Shared, renderer-agnostic metadata for the Inscription story. Imported by the GTK
// renderer (inscription.story.ts) and the browser renderer
// (browser/media/inscription.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const inscriptionMeta: StoryMeta = {
    title: 'Media/Inscription',
    description:
        'Gtk.Inscription — text laid out to a size in CHARACTERS and LINES rather than to a size in pixels. ' +
        'It is the widget for text whose extent should be the same everywhere, so it never measures its own ' +
        'content: min-chars/nat-chars and min-lines/nat-lines ARE its size request.',
    controls: [
        { name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: 'Inscription' },
        { name: 'minChars', label: 'Min chars', type: ControlType.RANGE, min: 0, max: 40, step: 1, defaultValue: 3 },
        { name: 'natChars', label: 'Nat chars', type: ControlType.RANGE, min: 0, max: 40, step: 1, defaultValue: 0 },
        { name: 'minLines', label: 'Min lines', type: ControlType.RANGE, min: 0, max: 6, step: 1, defaultValue: 1 },
        { name: 'natLines', label: 'Nat lines', type: ControlType.RANGE, min: 0, max: 6, step: 1, defaultValue: 0 },
        {
            name: 'wrapMode',
            label: 'Wrap mode',
            type: ControlType.SELECT,
            options: [
                { label: 'Word', value: 'word' },
                { label: 'Char', value: 'char' },
                { label: 'Word-char (default)', value: 'word-char' },
            ],
            defaultValue: 'word-char',
        },
        {
            name: 'textOverflow',
            label: 'Text overflow',
            type: ControlType.SELECT,
            options: [
                { label: 'Clip (default)', value: 'clip' },
                { label: 'Ellipsize start', value: 'ellipsize-start' },
                { label: 'Ellipsize middle', value: 'ellipsize-middle' },
                { label: 'Ellipsize end', value: 'ellipsize-end' },
            ],
            defaultValue: 'clip',
        },
        { name: 'xalign', label: 'X align', type: ControlType.RANGE, min: 0, max: 1, step: 0.05, defaultValue: 0 },
        { name: 'yalign', label: 'Y align', type: ControlType.RANGE, min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
    ],
};
