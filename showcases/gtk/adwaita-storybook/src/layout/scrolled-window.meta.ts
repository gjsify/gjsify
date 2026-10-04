// Shared, renderer-agnostic metadata for the Scrolled Window story. Imported by the GTK
// renderer (layout/scrolled-window.story.ts) and the browser renderer
// (browser/layout/scrolled-window.web.ts), so both expose identical controls.
//
// THE CONTROL NAMES ARE CAMEL-CASE ARG NAMES, not GIR property spellings: the control
// panel's reader takes `name` as an identifier (`scripts/check-storybook-control-parity.mjs`
// reads `\bname:\s*'([A-Za-z0-9_]+)'`), and each renderer writes it onto the property
// whose own name it is — `hscrollbar-policy` here.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const scrolledWindowMeta: StoryMeta = {
    title: 'Layout/ScrolledWindow',
    description:
        'Gtk.ScrolledWindow — one child, two adjustments, and a scrollbar per edge that can ' +
        'actually scroll. The policies decide whether a bar appears, window-placement which ' +
        'edge it takes, and overlay-scrolling turns the bars into the auto-hiding indicators ' +
        'GNOME draws over the content.',
    controls: [
        {
            name: 'hPolicy',
            label: 'Horizontal policy',
            type: ControlType.SELECT,
            options: [
                { label: 'Automatic', value: 'automatic' },
                { label: 'Always', value: 'always' },
                { label: 'Never', value: 'never' },
            ],
            defaultValue: 'automatic',
        },
        {
            name: 'vPolicy',
            label: 'Vertical policy',
            type: ControlType.SELECT,
            options: [
                { label: 'Automatic', value: 'automatic' },
                { label: 'Always', value: 'always' },
                { label: 'Never', value: 'never' },
            ],
            defaultValue: 'automatic',
        },
        {
            name: 'placement',
            label: 'Window placement',
            type: ControlType.SELECT,
            options: [
                { label: 'Top left', value: 'top-left' },
                { label: 'Top right', value: 'top-right' },
                { label: 'Bottom left', value: 'bottom-left' },
                { label: 'Bottom right', value: 'bottom-right' },
            ],
            defaultValue: 'top-left',
        },
        { name: 'frame', label: 'Frame', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'overlayScrolling', label: 'Overlay scrolling', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
