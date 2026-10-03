// Shared, renderer-agnostic metadata for the Revealer story. Imported by the GTK renderer
// (revealer.story.ts) and the browser renderer (browser/layout/revealer.web.ts), so both
// expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const revealerMeta: StoryMeta = {
    title: 'Layout/Revealer',
    description:
        'Gtk.Revealer — shows and hides its child with an animation. The transition is one of ' +
        'fourteen nicks and it is not only an opacity change: a slide scales the box along one ' +
        'axis while allocating the child at its UNSCALED size, and a swing folds it in with ' +
        'sin (π · pos / 2). Libadwaita styles no revealer node of its own, so everything here is ' +
        'GTK behaviour the browser element ports.',
    controls: [
        {
            name: 'transitionType',
            label: 'Transition',
            type: ControlType.SELECT,
            options: [
                { label: 'Slide down (the default)', value: 'slide-down' },
                { label: 'Slide up', value: 'slide-up' },
                { label: 'Slide left', value: 'slide-left' },
                { label: 'Slide right', value: 'slide-right' },
                { label: 'Crossfade', value: 'crossfade' },
                { label: 'Fade + slide down', value: 'fade-slide-down' },
                { label: 'Swing down (fold)', value: 'swing-down' },
                { label: 'Swing right (fold)', value: 'swing-right' },
                { label: 'None', value: 'none' },
            ],
            defaultValue: 'slide-down',
        },
        {
            name: 'transitionDuration',
            label: 'Duration (ms)',
            type: ControlType.RANGE,
            min: 0,
            max: 800,
            step: 50,
            defaultValue: 250,
        },
        { name: 'revealChild', label: 'Reveal', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
