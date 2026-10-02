// Shared, renderer-agnostic metadata for the Progress Bar story. Imported by the GTK
// renderer (progress-bar.story.ts) and the browser renderer
// (browser/controls/progress-bar.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const progressBarMeta: StoryMeta = {
    title: 'Controls/Progress Bar',
    description:
        'Gtk.ProgressBar — how much of a long operation is done. `fraction` is 0…1, `pulsing` is the ' +
        'indeterminate mode where the app knows it is busy but not how far along it is, and `osd` is ' +
        "libadwaita's hairline variant for under a header bar. Adw.Spinner is the size-less sibling.",
    controls: [
        { name: 'fraction', label: 'Fraction', type: ControlType.RANGE, min: 0, max: 1, step: 0.05, defaultValue: 0.4 },
        { name: 'pulsing', label: 'Pulsing (indeterminate)', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'showText', label: 'Show text', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'inverted', label: 'Inverted', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'osd', label: 'OSD (hairline)', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
