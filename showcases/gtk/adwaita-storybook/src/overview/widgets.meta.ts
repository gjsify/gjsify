// Shared metadata for the Overview story — the widget gallery.
//
// WHAT THIS REPLACES. The gallery used to be two standalone apps rendering the
// same page: `examples/gtk/adwaita-reference` and
// `showcases/dom/adwaita-widgets-nativescript`. Both existed to answer "do these
// widgets look right TOGETHER", which is a question the storybook already hosts —
// it just had no story that composed more than one widget. Two apps meant two
// toolchains, two copies of the content, and (measured) a theme copy in one of
// them that had drifted to a quarter of the package's stylesheet.
//
// So it is one story on all three targets instead, and the two apps are gone.
// Story-set parity is machine-checked, which the two apps never were.
//
// The `revealed` control is the one thing here that varies meaningfully: it is
// `Adw.Banner:revealed`, a real property with a real animation, rather than a knob
// invented so the panel is not empty.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** One row of the Account group's expander. */
export interface OverviewExpanderRow {
    readonly title: string;
    readonly kind: 'switch' | 'action';
    readonly active?: boolean;
}

/** The Account group's expander contents, shared so the three targets agree. */
export const OVERVIEW_ADVANCED_ROWS: ReadonlyArray<OverviewExpanderRow> = [
    { title: 'Sync', kind: 'switch', active: true },
    { title: 'Export', kind: 'action' },
];

/** The accent names the gallery's combo row offers — a plain widget demo, not the real setting. */
export const OVERVIEW_ACCENT_OPTIONS: readonly string[] = ['Blue', 'Teal', 'Green', 'Orange'];

/** The shortcut rows, so the newest widget appears in context and not only alone. */
export const OVERVIEW_SHORTCUTS: ReadonlyArray<{ title: string; accelerator: string }> = [
    { title: 'Copy', accelerator: '<Control>C' },
    { title: 'Select all', accelerator: '<Shift><Control>a' },
    { title: 'Switch tab', accelerator: '<Alt>1...9' },
];

export const overviewWidgetsMeta: StoryMeta = {
    title: 'Overview/Widgets',
    description:
        'Many widgets at once, the way an app composes them: a banner, preference groups of rows, an expander, buttons and shortcut labels. Use it to judge spacing, alignment and the theme as a whole rather than one widget in isolation.',
    controls: [
        {
            name: 'revealed',
            label: 'Show banner',
            type: ControlType.BOOLEAN,
            description: 'Adw.Banner:revealed — animates in and out',
            defaultValue: true,
        },
    ],
};
