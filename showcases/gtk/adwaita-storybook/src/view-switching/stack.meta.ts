// Shared, renderer-agnostic metadata for the Stack story. Imported by the GTK
// renderer (stack.story.ts) and the browser renderer
// (browser/view-switching/stack.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/**
 * The three pages both renderers build, as the C would: a name for `visible-child-name`,
 * a short title for the switcher's button, and a body. `attn` marks the page as
 * `needs-attention`, which is what the switcher draws the dot for.
 */
export const STACK_PAGES = [
    { name: 'overview', title: 'Overview', attn: false, body: 'Three pages, one visible at a time.' },
    { name: 'activity', title: 'Activity', attn: false, body: 'Switching is animated by transition-type.' },
    { name: 'settings', title: 'Settings', attn: true, body: 'This page wants your attention.' },
] as const;

export const stackMeta: StoryMeta = {
    title: 'View Switching/Stack',
    description:
        'Gtk.Stack — one visible child out of many, with the animated change between them. ' +
        '`transition-type` picks the animation and `transition-duration` its length; `hhomogeneous` and ' +
        '`vhomogeneous` say whether every page is allocated the same size. A Gtk.StackPage is a GObject ' +
        'rather than a widget, so its title, icon and needs-attention live on the page itself.',
    controls: [
        {
            name: 'transitionType',
            label: 'Transition type',
            type: ControlType.SELECT,
            options: [
                { label: 'None', value: 'none' },
                { label: 'Crossfade', value: 'crossfade' },
                { label: 'Slide left / right', value: 'slide-left-right' },
                { label: 'Slide up / down', value: 'slide-up-down' },
                { label: 'Over left / right', value: 'over-left-right' },
                { label: 'Rotate left / right', value: 'rotate-left-right' },
            ],
            defaultValue: 'slide-left-right',
        },
        {
            name: 'transitionDuration',
            label: 'Duration (ms)',
            type: ControlType.RANGE,
            min: 0,
            max: 600,
            step: 50,
            defaultValue: 200,
        },
        { name: 'interpolateSize', label: 'Interpolate size', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'hhomogeneous', label: 'HHomogeneous', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'vhomogeneous', label: 'VHomogeneous', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
