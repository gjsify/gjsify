// Shared, renderer-agnostic metadata for the Window Handle story. Imported by the GTK
// renderer (presentation/window-handle.story.ts) and the browser renderer
// (browser/presentation/window-handle.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const windowHandleMeta: StoryMeta = {
    title: 'Presentation/WindowHandle',
    description:
        'Gtk.WindowHandle — the titlebar strip. Dragging it moves the window; a double click, ' +
        'a middle click and a right click raise the window actions the compositor (or, here, the ' +
        'titlebar settings) names.',
    controls: [
        {
            name: 'action',
            label: 'Double-click action',
            type: ControlType.SELECT,
            options: [
                { label: 'Toggle maximize', value: 'toggle-maximize' },
                { label: 'Minimize', value: 'minimize' },
                { label: 'Menu', value: 'menu' },
                { label: 'None', value: 'none' },
            ],
            defaultValue: 'toggle-maximize',
        },
    ],
};
