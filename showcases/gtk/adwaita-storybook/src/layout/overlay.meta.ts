// Shared, renderer-agnostic metadata for the Overlay story. Imported by the GTK renderer
// (overlay.story.ts) and the browser renderer (browser/layout/overlay.web.ts), so both
// expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const overlayMeta: StoryMeta = {
    title: 'Layout/Overlay',
    description:
        'Gtk.Overlay — widgets stacked on top of one main child. The main child sizes the overlay; ' +
        'every other child is placed by its own halign/valign, which is what ' +
        'gtk_overlay_get_child_position reads and nothing else. Libadwaita ships no Adw.Overlay ' +
        'and gives the node no rule of its own — the .left/.right/.top/.bottom classes it puts on ' +
        'an edge-aligned child are the whole published contract.',
    controls: [
        {
            name: 'halign',
            label: 'Overlay halign',
            type: ControlType.SELECT,
            options: [
                { label: 'Fill (the default)', value: 'fill' },
                { label: 'Start', value: 'start' },
                { label: 'Center', value: 'center' },
                { label: 'End', value: 'end' },
            ],
            defaultValue: 'end',
        },
        {
            name: 'valign',
            label: 'Overlay valign',
            type: ControlType.SELECT,
            options: [
                { label: 'Fill (the default)', value: 'fill' },
                { label: 'Start', value: 'start' },
                { label: 'Center', value: 'center' },
                { label: 'End', value: 'end' },
            ],
            defaultValue: 'end',
        },
        { name: 'showLabel', label: 'Label the overlay', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
