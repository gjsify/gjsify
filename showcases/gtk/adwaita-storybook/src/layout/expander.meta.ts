// Shared, renderer-agnostic metadata for the Expander story. Imported by the GTK renderer
// (expander.story.ts) and the browser renderer (browser/layout/expander.web.ts), so both
// expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const expanderMeta: StoryMeta = {
    title: 'Layout/Expander',
    description:
        'Gtk.Expander — a title the user clicks to reveal the child below it. The arrow is its ' +
        'own CSS node and `:checked` is set on THAT node, not on the widget, which is what ' +
        "libadwaita's _expanders.scss keys the glyph swap on. `use-underline` marks a mnemonic " +
        'with `_`, and Alt+that character activates the expander.',
    controls: [
        { name: 'expanded', label: 'Expanded', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'useUnderline', label: 'Label marks a mnemonic', type: ControlType.BOOLEAN, defaultValue: false },
        {
            name: 'label',
            label: 'Label',
            type: ControlType.TEXT,
            defaultValue: '_More options',
        },
        {
            name: 'resizeToplevel',
            label: 'Resize the toplevel',
            type: ControlType.BOOLEAN,
            defaultValue: false,
        },
    ],
};
