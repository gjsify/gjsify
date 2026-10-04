// Shared, renderer-agnostic metadata for the Gtk.PageSetupUnixDialog story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const pageSetupUnixDialogMeta: StoryMeta = {
    title: 'Feedback/Page Setup Dialog',
    description:
        "Gtk.PageSetupUnixDialog — the page setup dialog Unix platforms have instead of a native one: a printer and a paper size, the chosen sheet's size and margins, and four orientation buttons.",
    controls: [
        {
            name: 'paperSize',
            label: 'Paper size',
            type: ControlType.SELECT,
            options: [
                { label: 'US Letter', value: 'na_letter' },
                { label: 'US Legal', value: 'na_legal' },
                { label: 'A4', value: 'iso_a4' },
                { label: 'A5', value: 'iso_a5' },
                { label: 'B5', value: 'iso_b5' },
                { label: 'A3', value: 'iso_a3' },
            ],
            defaultValue: 'iso_a4',
        },
        {
            name: 'orientation',
            label: 'Orientation',
            type: ControlType.SELECT,
            options: [
                { label: 'Portrait', value: 'portrait' },
                { label: 'Landscape', value: 'landscape' },
                { label: 'Reverse portrait', value: 'reverse-portrait' },
                { label: 'Reverse landscape', value: 'reverse-landscape' },
            ],
            defaultValue: 'landscape',
        },
    ],
};
