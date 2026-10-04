// Shared, renderer-agnostic metadata for the Drawing Area story. Imported by the GTK
// renderer (drawing-area.story.ts) and the browser renderer
// (browser/drawing/drawing-area.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const drawingAreaMeta: StoryMeta = {
    title: 'Drawing/Drawing Area',
    description:
        'Gtk.DrawingArea — a blank widget that owns a size and a callback and nothing else: whatever you ' +
        'see is what `set_draw_func` painted. `content-width` and `content-height` are the MINIMUM and ' +
        'natural size at once, so a parent can hand the area more room but never less; at 0 the area has ' +
        'no intrinsic size at all and fills whatever it is given.',
    controls: [
        {
            name: 'contentWidth',
            label: 'Content width',
            type: ControlType.RANGE,
            min: 0,
            max: 320,
            step: 16,
            defaultValue: 160,
        },
        {
            name: 'contentHeight',
            label: 'Content height',
            type: ControlType.RANGE,
            min: 0,
            max: 320,
            step: 16,
            defaultValue: 120,
        },
        {
            name: 'shape',
            label: 'Shape',
            type: ControlType.SELECT,
            options: [
                { label: 'Circle', value: 'circle' },
                { label: 'Grid', value: 'grid' },
                { label: 'Crosshair', value: 'crosshair' },
            ],
            defaultValue: 'circle',
        },
    ],
};
