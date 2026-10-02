// Shared, renderer-agnostic metadata for the GL Area story. Imported by the GTK
// renderer (gl-area.story.ts) and the browser renderer
// (browser/drawing/gl-area.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const glAreaMeta: StoryMeta = {
    title: 'Drawing/GL Area',
    description:
        'Gtk.GLArea — a widget whose contents are drawn on a GPU. GTK emits `::resize` before the first ' +
        '`::render` and the render flag is cleared AFTER the signal, so a handler may queue another frame ' +
        'with `queue_render()`. Here the replica is a `<canvas>` with a real WebGL context: the browser has ' +
        'no desktop GL, so `api` always reports the ES flavour it was given.',
    controls: [
        { name: 'autoRender', label: 'Auto render', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'hasDepthBuffer', label: 'Depth buffer', type: ControlType.BOOLEAN, defaultValue: false },
        {
            name: 'allowedApis',
            label: 'Allowed APIs',
            type: ControlType.SELECT,
            options: [
                { label: 'GL and GLES (default)', value: 'gl gles' },
                { label: 'GLES only', value: 'gles' },
                { label: 'GL only', value: 'gl' },
            ],
            defaultValue: 'gl gles',
        },
        { name: 'spinning', label: 'Spin the triangle', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
