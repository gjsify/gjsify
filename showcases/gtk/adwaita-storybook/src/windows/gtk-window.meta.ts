// Shared, renderer-agnostic metadata for the GTK Window story. Imported by the GTK
// renderer (gtk-window.story.ts) and the browser renderer
// (browser/windows/gtk-window.web.ts), so both expose identical controls.
//
// The NAME is `gtk-window` and not `window` because `Adw.Window` holds that bare name
// on the adwaita/layout page, and the storybook keys every meta on its file name: a
// second `window.meta.ts` would silently displace one of the two. The block in
// /gjsify/gtk/windows/ is titled `Gtk.Window`, which `TITLED_AFTER` in
// `scripts/check-website-adwaita-gallery.mjs` maps onto this meta.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const gtkWindowMeta: StoryMeta = {
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
