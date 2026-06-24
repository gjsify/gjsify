// Shared, renderer-agnostic metadata for the Toggle Group story. Imported by
// both the GTK renderer (toggle-group.story.ts) and the browser renderer
// (browser/buttons/toggle-group.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const toggleGroupMeta: StoryMeta = {
    title: 'Buttons/Toggle Group',
    description: 'Adw.ToggleGroup — a linked group of Adw.Toggle buttons where exactly one is active.',
    controls: [
        {
            name: 'active',
            label: 'Active toggle',
            type: ControlType.SELECT,
            options: [
                { label: 'List', value: 0 },
                { label: 'Grid', value: 1 },
                { label: 'Columns', value: 2 },
            ],
            defaultValue: 0,
        },
        {
            name: 'style',
            label: 'Style',
            type: ControlType.SELECT,
            options: [
                { label: 'Default', value: 'default' },
                { label: 'Flat', value: 'flat' },
                { label: 'Round', value: 'round' },
            ],
            defaultValue: 'default',
        },
    ],
};
