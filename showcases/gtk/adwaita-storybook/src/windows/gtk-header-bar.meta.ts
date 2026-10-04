// Shared, renderer-agnostic metadata for the GTK Header Bar story. Imported by the GTK
// renderer (gtk-header-bar.story.ts) and the browser renderer
// (browser/windows/gtk-header-bar.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const gtkHeaderBarMeta: StoryMeta = {
    title: 'Windows/Header Bar',
    description:
        'Gtk.HeaderBar — the titlebar widget: children packed at the start and at the end, ' +
        'the window title in the middle, and the window-frame buttons GTK would otherwise ask ' +
        'the window manager for. `end` PREPENDS, so the first end child sits nearest the ' +
        'edge; a `title` child takes the middle away from the derived title label; and ' +
        '`show-title-buttons` CREATES and REMOVES the two control groups rather than hiding them.',
    controls: [
        {
            name: 'titleWidget',
            label: 'Title widget',
            type: ControlType.SELECT,
            options: [
                { label: 'The window title', value: 'none' },
                { label: 'A custom centre widget', value: 'custom' },
            ],
            defaultValue: 'none',
        },
        { name: 'showTitleButtons', label: 'Title buttons', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'decorationLayout',
            label: 'Decoration layout',
            type: ControlType.SELECT,
            options: [
                { label: 'GNOME (menu:minimize,maximize,close)', value: 'menu:minimize,maximize,close' },
                { label: 'Close only', value: ':close' },
                { label: 'macOS (icon:minimize,maximize)', value: 'icon:minimize,maximize' },
            ],
            defaultValue: 'menu:minimize,maximize,close',
        },
    ],
};
