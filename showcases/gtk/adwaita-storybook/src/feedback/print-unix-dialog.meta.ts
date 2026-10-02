// Shared, renderer-agnostic metadata for the Gtk.PrintUnixDialog story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const printUnixDialogMeta: StoryMeta = {
    title: 'Feedback/Print Dialog',
    description:
        'Gtk.PrintUnixDialog — the Unix print dialog: seven notebook pages over a printer list, a Range and a Copies group on General, the sheet preview on Page Setup, and the Preview / Cancel / Print action area.',
    controls: [
        {
            name: 'capabilities',
            label: 'Capabilities',
            type: ControlType.TEXT,
            defaultValue: 'copies|collate|reverse|scale|preview|page-set',
        },
        {
            name: 'range',
            label: 'Range',
            type: ControlType.SELECT,
            options: [
                { label: 'All Pages', value: 'all' },
                { label: 'Current Page', value: 'current' },
                { label: 'Selection', value: 'selection' },
                { label: 'Pages', value: 'pages' },
            ],
            defaultValue: 'all',
        },
        { name: 'copies', label: 'Copies', type: ControlType.NUMBER, defaultValue: 2 },
    ],
};
