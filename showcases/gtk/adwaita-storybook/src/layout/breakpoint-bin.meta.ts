// Shared, renderer-agnostic metadata for the Breakpoint Bin story. Imported by the GTK
// renderer (breakpoint-bin.story.ts) and the browser renderer
// (browser/layout/breakpoint-bin.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const breakpointBinMeta: StoryMeta = {
    title: 'Layout/Breakpoint Bin',
    description:
        'Adw.BreakpointBin gives breakpoints a home without a window: its one child rearranges ' +
        'itself at a size threshold, and the bin applies the LAST breakpoint whose condition ' +
        'holds. Resize the stage to see it.',
    controls: [
        {
            name: 'condition',
            label: 'Condition',
            type: ControlType.SELECT,
            options: [
                { label: 'max-width: 480px', value: 'max-width: 480px' },
                { label: 'max-width: 320px', value: 'max-width: 320px' },
                { label: 'max-height: 200px', value: 'max-height: 200px' },
            ],
            defaultValue: 'max-width: 480px',
        },
        {
            name: 'narrowLabel',
            label: 'Narrow label',
            type: ControlType.TEXT,
            defaultValue: 'Narrow',
        },
        {
            name: 'wideLabel',
            label: 'Wide label',
            type: ControlType.TEXT,
            defaultValue: 'Wide',
        },
    ],
};
