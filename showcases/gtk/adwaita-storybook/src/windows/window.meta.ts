// Shared, renderer-agnostic metadata for the Window story. Imported by the GTK
// renderer (window.story.ts) and the browser renderer
// (browser/windows/window.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const windowMeta: StoryMeta = {
    title: 'Windows/Window',
    description:
        'Gtk.Window — a toplevel with a `titlebar` and a `child`, and the properties that ' +
        'decide what its frame shows: `decorated`, `deletable`, `resizable`, `maximized` and ' +
        '`hide-on-close`. The BROWSER replica of this one is an IN-PAGE FRAME, not a toplevel: ' +
        'a browser document has no window to map. The story therefore cancels `close-request`, ' +
        'which is what an application does when it wants to keep the window.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Documents' },
        { name: 'decorated', label: 'Decorated', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'deletable', label: 'Deletable', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'resizable', label: 'Resizable', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'maximized', label: 'Maximized', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'modal', label: 'Modal', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'hideOnClose', label: 'Hide on close', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
