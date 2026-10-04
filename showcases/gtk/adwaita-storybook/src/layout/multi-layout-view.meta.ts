// Shared, renderer-agnostic metadata for the Multi Layout View story. Imported by the GTK
// renderer (multi-layout-view.story.ts) and the browser renderer
// (browser/layout/multi-layout-view.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const multiLayoutViewMeta: StoryMeta = {
    title: 'Layout/Multi Layout View',
    description:
        'Adw.MultiLayoutView holds one set of children and several arrangements of them: each ' +
        'child has an id, each layout has slots with ids, and switching layouts re-inserts ' +
        'every child into the slot of the SAME id.',
    controls: [
        {
            name: 'layoutName',
            label: 'Layout',
            type: ControlType.SELECT,
            options: [
                { label: 'wide (split)', value: 'wide' },
                { label: 'narrow (stacked)', value: 'narrow' },
            ],
            defaultValue: 'wide',
        },
        {
            name: 'showDetails',
            label: 'Show the details pane',
            type: ControlType.BOOLEAN,
            defaultValue: true,
        },
    ],
};
