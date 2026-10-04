// <gtk-popover> story: the plain content popover. Shared, renderer-agnostic metadata for the
// GTK renderer (popover.story.ts) and the browser one
// (browser/layout/popover.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const popoverMeta: StoryMeta = {
    title: 'Layout/Popover',
    description:
        'Gtk.Popover — the bubble-like surface. No model and no menu: it holds whatever widget you ' +
        'put in it, and everything here is about WHERE it appears and WHEN it goes away. ' +
        '`autohide` off is entry completion: the list follows the typing and the caret never leaves.',
    controls: [
        {
            name: 'position',
            label: 'Position',
            type: ControlType.SELECT,
            options: [
                { label: 'Bottom', value: 'bottom' },
                { label: 'Top', value: 'top' },
                { label: 'Start', value: 'start' },
                { label: 'End', value: 'end' },
            ],
            defaultValue: 'bottom',
        },
        {
            name: 'align',
            label: 'Align',
            type: ControlType.SELECT,
            options: [
                { label: 'Start', value: 'start' },
                { label: 'End', value: 'end' },
            ],
            defaultValue: 'start',
        },
        { name: 'autohide', label: 'Dismiss on outside click', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
