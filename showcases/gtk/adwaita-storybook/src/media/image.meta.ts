// Shared, renderer-agnostic metadata for the Image story. Imported by the GTK
// renderer (image.story.ts) and the browser renderer (browser/media/image.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const imageMeta: StoryMeta = {
    title: 'Media/Image',
    description:
        'Gtk.Image — a symbolic icon, drawn as a CSS-masked box in the surrounding text colour. It takes a ' +
        'NAME, not a file: a name the icon theme cannot resolve draws the missing-image glyph, which is exactly ' +
        'what GTK draws for it. That is why <gtk-picture> is a separate widget — an icon sized by the theme and ' +
        'an image fitted to a box are two different jobs.',
    controls: [
        {
            name: 'iconName',
            label: 'Icon name',
            type: ControlType.TEXT,
            defaultValue: 'avatar-default-symbolic',
        },
        { name: 'size', label: 'Size (px)', type: ControlType.RANGE, min: 16, max: 96, step: 8, defaultValue: 48 },
        { name: 'disabled', label: 'Disabled', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
