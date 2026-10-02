// Shared, renderer-agnostic metadata for the Drag Icon story. Imported by the GTK renderer
// (drag-icon.story.ts) and the browser renderer (browser/drawing/drag-icon.web.ts), so both
// expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const dragIconMeta: StoryMeta = {
    title: 'Drawing/Drag Icon',
    description:
        'Gtk.DragIcon — the widget that follows the pointer while a drag is in flight, and is destroyed ' +
        'with the drag. No application builds one: `get_for_drag` returns the icon a drag is using, and ' +
        'the drag source sets its child. What it takes as that child is the interesting part, because ' +
        '`create_widget_for_value` answers for six kinds of value and a drag source that offers a string ' +
        'gets a label and one that offers a colour gets a swatch. A drag icon takes no input at all, which ' +
        "is the C's own note: 'drag icons do not allow user input'.",
    controls: [
        {
            name: 'value',
            label: 'Value being dragged',
            type: ControlType.SELECT,
            options: [
                { label: 'A string (a Gtk.Label)', value: 'string' },
                { label: 'A GdkRGBA (a colour swatch)', value: 'rgba' },
                { label: 'A content provider only (no icon)', value: 'none' },
            ],
            defaultValue: 'string',
        },
        {
            name: 'actions',
            label: 'Drag actions',
            type: ControlType.SELECT,
            options: [
                { label: 'Copy', value: 'copy' },
                { label: 'Move', value: 'move' },
            ],
            defaultValue: 'copy',
        },
    ],
};
