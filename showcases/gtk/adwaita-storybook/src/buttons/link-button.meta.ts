// Shared, renderer-agnostic metadata for the Link Button story. Imported by the GTK
// renderer (link-button.story.ts) and the browser renderer
// (browser/buttons/link-button.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const linkButtonMeta: StoryMeta = {
    title: 'Buttons/Link Button',
    description:
        'Gtk.LinkButton — a button that follows a URI. It is a Gtk.Button with a uri and a visited ' +
        'state: clicking launches the URI and marks the link visited, and pointing it somewhere new ' +
        'un-visits it.',
    controls: [
        { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'GNOME' },
        { name: 'uri', label: 'URI', type: ControlType.TEXT, defaultValue: 'https://gnome.org' },
        { name: 'visited', label: 'Visited', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
