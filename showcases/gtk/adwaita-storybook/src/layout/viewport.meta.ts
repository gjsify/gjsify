// Shared, renderer-agnostic metadata for the Viewport story. Imported by the GTK renderer
// (layout/viewport.story.ts) and the browser renderer (browser/layout/viewport.web.ts), so
// both expose identical controls.

// THE CONTROL NAME IS A CAMEL-CASE ARG NAME, not the GIR spelling: the control panel's
// reader takes `name` as an identifier (`scripts/check-storybook-control-parity.mjs` reads
// `\bname:\s*'([A-Za-z0-9_]+)'`), and each renderer writes it onto the property whose own
// name it is — `scroll-to-focus` here.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const viewportMeta: StoryMeta = {
    title: 'Layout/Viewport',
    description:
        'Gtk.Viewport — scrollability for a widget that has none of its own. It has one ' +
        'property, scroll-to-focus: whether a widget that takes the focus is scrolled into ' +
        'view. It is also what a Gtk.ScrolledWindow puts its child in.',
    controls: [{ name: 'scrollToFocus', label: 'Scroll to focus', type: ControlType.BOOLEAN, defaultValue: true }],
};
