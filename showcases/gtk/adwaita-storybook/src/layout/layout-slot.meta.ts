// Shared, renderer-agnostic metadata for the Layout Slot story. Imported by the GTK
// renderer (layout-slot.story.ts) and the browser renderer
// (browser/layout/layout-slot.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const layoutSlotMeta: StoryMeta = {
    title: 'Layout/Layout Slot',
    description:
        'Adw.LayoutSlot is the named hole a layout of an Adw.MultiLayoutView leaves for a ' +
        'child: it takes the child whose id matches, and its visible property follows that ' +
        "child's. On its own it is a bin, which is what this story shows.",
    controls: [
        { name: 'label', label: 'Child title', type: ControlType.TEXT, defaultValue: 'Inbox' },
        {
            name: 'visible',
            label: 'Child visible',
            type: ControlType.BOOLEAN,
            defaultValue: true,
        },
    ],
};
