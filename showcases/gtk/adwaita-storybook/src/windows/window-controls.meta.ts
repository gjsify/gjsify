// Shared, renderer-agnostic metadata for the Window Controls story. Imported by the GTK
// renderer (window-controls.story.ts) and the browser renderer
// (browser/windows/window-controls.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const windowControlsMeta: StoryMeta = {
    title: 'Windows/Window Controls',
    description:
        'Gtk.WindowControls — one SIDE of the window frame controls, and the decision table ' +
        'behind them. The decoration layout is split on the first colon; each token of the ' +
        'selected half builds one button or none, because `icon` and `minimize` want a ' +
        'SOVEREIGN window, `maximize` wants a resizable one and `close` wants a deletable one. ' +
        '`empty` is the property that says none of them did.',
    controls: [
        {
            name: 'side',
            label: 'Side',
            type: ControlType.SELECT,
            options: [
                { label: 'Start', value: 'start' },
                { label: 'End', value: 'end' },
            ],
            defaultValue: 'start',
        },
        {
            name: 'decorationLayout',
            label: 'Decoration layout',
            type: ControlType.SELECT,
            options: [
                { label: 'GNOME (menu:minimize,maximize,close)', value: 'menu:minimize,maximize,close' },
                { label: 'Windows (icon:minimize,maximize,close)', value: 'icon:minimize,maximize,close' },
                { label: 'Close only', value: ':close' },
                { label: 'macOS (icon:minimize,maximize)', value: 'icon:minimize,maximize' },
            ],
            defaultValue: 'menu:minimize,maximize,close',
        },
        { name: 'resizable', label: 'Resizable window', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'maximized', label: 'Maximized window', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'modal', label: 'Modal window', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
