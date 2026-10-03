// Shared, renderer-agnostic metadata for the GTK Spinner story. Imported by the GTK
// renderer (gtk-spinner.story.ts) and the browser renderer
// (browser/controls/gtk-spinner.web.ts), so both expose identical controls.
//
// The NAME is `gtk-spinner` and not `spinner` because `Presentation/Spinner` already
// holds that bare name for `Adw.Spinner`, and the storybook keys every meta on its file
// name: a second `spinner.meta.ts` would silently displace one of the two. The block in
// /gjsify/gtk/indicators/ is titled `Gtk.Spinner`, which `TITLED_AFTER` in
// `scripts/check-website-adwaita-gallery.mjs` maps onto this meta.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const gtkSpinnerMeta: StoryMeta = {
    title: 'Controls/Spinner (GTK)',
    description:
        "Gtk.Spinner — GTK's own busy indicator: a faint ring with a quarter arc turning around it, " +
        'sized by its allocation. Adw.Spinner is the libadwaita replacement and looks different; under ' +
        'reduced motion GTK swaps this one for a static hourglass, which Adw.Spinner deliberately does not do.',
    controls: [
        { name: 'size', label: 'Size (px)', type: ControlType.RANGE, min: 16, max: 64, step: 4, defaultValue: 32 },
        { name: 'spinning', label: 'Spinning', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'disabled', label: 'Disabled', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
