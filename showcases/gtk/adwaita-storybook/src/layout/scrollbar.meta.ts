// Shared, renderer-agnostic metadata for the Scrollbar story. Imported by the GTK renderer
// (layout/scrollbar.story.ts) and the browser renderer (browser/layout/scrollbar.web.ts), so
// both expose identical controls.

// THE CONTROL NAMES ARE CAMEL-CASE ARG NAMES, not the adjustment's GIR field spellings: the
// control panel's reader takes `name` as an identifier
// (`scripts/check-storybook-control-parity.mjs` reads `\bname:\s*'([A-Za-z0-9_]+)'`), and
// each renderer writes it into the adjustment whose own field it is.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const scrollbarMeta: StoryMeta = {
    title: 'Layout/Scrollbar',
    description:
        'Gtk.Scrollbar — a trough and a slider, positioned by a GtkAdjustment. The slider is ' +
        'page_size over the whole range long and sits at the position over the SCROLLABLE range, ' +
        'which is why the two numbers it is made of do not share a denominator.',
    controls: [
        {
            name: 'orientation',
            label: 'Orientation',
            type: ControlType.SELECT,
            options: [
                { label: 'Horizontal', value: 'horizontal' },
                { label: 'Vertical', value: 'vertical' },
            ],
            defaultValue: 'vertical',
        },
        { name: 'upper', label: 'Adjustment upper', type: ControlType.NUMBER, defaultValue: 400 },
        { name: 'pageSize', label: 'Adjustment page size', type: ControlType.NUMBER, defaultValue: 120 },
        { name: 'value', label: 'Adjustment value', type: ControlType.NUMBER, defaultValue: 80 },
    ],
};
