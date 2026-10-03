// Shared, renderer-agnostic metadata for the Fixed story. Imported by the GTK
// renderer (fixed.story.ts) and the browser renderer (browser/layout/fixed.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const fixedMeta: StoryMeta = {
    title: 'Layout/Fixed',
    description:
        'Gtk.Fixed — children at pixel positions, which is the whole of its API: it declares no property of ' +
        'its own. The two offsets are the arguments of gtk_fixed_put().',
    controls: [
        { name: 'offsetX', label: 'Offset x', type: ControlType.RANGE, min: 0, max: 80, step: 4, defaultValue: 24 },
        { name: 'offsetY', label: 'Offset y', type: ControlType.RANGE, min: 0, max: 80, step: 4, defaultValue: 16 },
    ],
};
