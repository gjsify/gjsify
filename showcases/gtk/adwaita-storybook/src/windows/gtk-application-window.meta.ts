// Shared, renderer-agnostic metadata for the GTK Application Window story. Imported by the GTK
// renderer (gtk-application-window.story.ts) and the browser renderer
// (browser/windows/gtk-application-window.web.ts), so both expose identical controls.
//
// The NAME is `gtk-application-window` and not `application-window` because
// `Adw.ApplicationWindow` holds that bare name on the adwaita/layout page, and the
// storybook keys every meta on its file name: a second `application-window.meta.ts`
// would silently displace one of the two. The block in /gjsify/gtk/windows/ is titled
// `Gtk.ApplicationWindow`, which `TITLED_AFTER` in
// `scripts/check-website-adwaita-gallery.mjs` maps onto this meta.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const gtkApplicationWindowMeta: StoryMeta = {
    title: 'Windows/Application Window',
    description:
        'Gtk.ApplicationWindow — a Gtk.Window that also handles an application menubar. The ' +
        'bar shows only when `show-menubar` is set AND the application HAS one: GTK builds it ' +
        "from the GtkApplication's menu model, and reads the item count before deciding " +
        '(gtkapplicationwindow.c:400-402). Everything else about the window is the base class.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Editor' },
        { name: 'showMenubar', label: 'Show menubar', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'hasMenubar', label: 'The application has one', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'deletable', label: 'Deletable', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
