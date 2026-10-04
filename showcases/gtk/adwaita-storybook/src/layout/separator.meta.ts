// Shared, renderer-agnostic metadata for the Separator story. Imported by the GTK
// renderer (separator.story.ts) and the browser renderer (browser/layout/separator.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const separatorMeta: StoryMeta = {
    title: 'Layout/Separator',
    description:
        'Gtk.Separator — a one-pixel rule between two groups of widgets. Libadwaita ships no Adw.Separator; ' +
        'it only styles the GTK one, and the .spacer style class turns the rule into an empty 12px gap.',
    controls: [
        {
            name: 'orientation',
            label: 'Orientation',
            type: ControlType.SELECT,
            options: [
                { label: 'Horizontal', value: 'horizontal' },
                { label: 'Vertical', value: 'vertical' },
            ],
            defaultValue: 'horizontal',
        },
        { name: 'spacer', label: 'Spacer (draws nothing)', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
