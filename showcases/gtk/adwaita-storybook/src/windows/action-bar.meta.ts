// Shared, renderer-agnostic metadata for the Action Bar story. Imported by the GTK
// renderer (action-bar.story.ts) and the browser renderer
// (browser/windows/action-bar.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const actionBarMeta: StoryMeta = {
    title: 'Windows/Action Bar',
    description:
        "Gtk.ActionBar — GTK's bottom bar, and the one libadwaita styles but does not own " +
        '(`actionbar > revealer > box`). `start` appends and `end` PREPENDS, so the first end ' +
        'child sits nearest the edge; `center` is a real placement with no property behind it, ' +
        'because GtkBuilder refuses `center-widget`; and `revealed` slides the whole bar away.',
    controls: [
        { name: 'revealed', label: 'Revealed', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'center',
            label: 'Centre',
            type: ControlType.SELECT,
            options: [
                { label: 'A label', value: 'label' },
                { label: 'Nothing', value: 'none' },
            ],
            defaultValue: 'label',
        },
    ],
};
