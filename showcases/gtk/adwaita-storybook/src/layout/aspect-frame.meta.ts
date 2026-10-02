// Shared, renderer-agnostic metadata for the Aspect Frame story. Imported by the GTK
// renderer (aspect-frame.story.ts) and the browser renderer
// (browser/layout/aspect-frame.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const aspectFrameMeta: StoryMeta = {
    title: 'Layout/Aspect Frame',
    description:
        'Gtk.AspectFrame — one child, given a width/height ratio and a place in the space left over. ' +
        'obey-child is TRUE by default and takes the ratio from the child itself, so the story starts with ' +
        'it FALSE or the ratio control would be inert.',
    controls: [
        { name: 'ratio', label: 'Ratio', type: ControlType.RANGE, min: 0.5, max: 3, step: 0.25, defaultValue: 2 },
        { name: 'xalign', label: 'Xalign', type: ControlType.RANGE, min: 0, max: 1, step: 0.5, defaultValue: 0.5 },
        { name: 'yalign', label: 'Yalign', type: ControlType.RANGE, min: 0, max: 1, step: 0.5, defaultValue: 0.5 },
        { name: 'obeyChild', label: 'Obey child', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
