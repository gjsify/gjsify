// Shared, renderer-agnostic metadata for the Shortcut Label story. Imported by
// the GTK renderer (shortcut-label.story.ts), the browser renderer
// (browser/presentation/shortcut-label.web.ts) and the NativeScript one, so all
// three expose identical controls.
//
// `accelerator` is a SELECT rather than free text: the interesting thing about
// this widget is its four-level grammar (` ` → `...` → `+` → `&`), and the
// presets put each level one tap away — which matters most on the NativeScript
// target, where typing `<Control>C` means fighting a phone keyboard.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** One row of the All Levels story. */
export interface ShortcutLabelLevel {
    readonly label: string;
    readonly accelerator: string;
}

/**
 * The rows the All Levels story stacks, shared by all three renderers.
 *
 * It lives in the meta because the whole value of that story is the COMPARISON:
 * three targets showing a different set of accelerators could not be compared at
 * all, which is the same reason the story SET is gated
 * (scripts/check-storybook-story-parity.mjs).
 */
export const SHORTCUT_LABEL_LEVELS: ReadonlyArray<ShortcutLabelLevel> = [
    { label: 'Single', accelerator: '<Control>C' },
    { label: 'Modifier order', accelerator: '<Shift><Control>a' },
    { label: 'Alternatives', accelerator: '<Shift>A Home' },
    { label: 'Range', accelerator: '<Alt>1...9' },
    { label: 'In sequence', accelerator: '<Control>C+<Control>X' },
    { label: 'Together', accelerator: 'Control_L&Control_R' },
    { label: 'Nested', accelerator: '<Alt>1...9 <Alt>0' },
    { label: 'Unset', accelerator: '' },
];

export const shortcutLabelMeta: StoryMeta = {
    title: 'Presentation/Shortcut Label',
    description:
        'Adw.ShortcutLabel — an accelerator drawn as keycaps. The four grammar levels: alternatives (space), a range (...), pressed in sequence (+), and pressed together (&).',
    controls: [
        {
            name: 'accelerator',
            label: 'Accelerator',
            type: ControlType.SELECT,
            options: [
                { label: 'Ctrl+C', value: '<Control>C' },
                { label: 'Modifier order (Shift+Ctrl+A)', value: '<Shift><Control>a' },
                { label: 'Alternatives (Shift+A / Home)', value: '<Shift>A Home' },
                { label: 'Range (Alt+1…9)', value: '<Alt>1...9' },
                { label: 'In sequence (Ctrl+C → Ctrl+X)', value: '<Control>C+<Control>X' },
                { label: 'Together (Ctrl L + Ctrl R)', value: 'Control_L&Control_R' },
                { label: 'Nested (Alt+1…9 / Alt+0)', value: '<Alt>1...9 <Alt>0' },
                { label: 'Glyph key (Ctrl+Space)', value: '<Control>space' },
                { label: 'Arrow key (Left)', value: 'Left' },
                { label: 'Unset — shows the placeholder', value: '' },
            ],
            defaultValue: '<Control>C',
        },
        {
            name: 'disabledText',
            label: 'Placeholder',
            type: ControlType.TEXT,
            defaultValue: 'Disabled',
        },
    ],
};

/**
 * Every grammar level at once.
 *
 * The interactive story above shows ONE accelerator per view, and the four
 * nesting levels are only legible side by side — `Modifier order` renders
 * `Ctrl Shift A` from `<Shift><Control>a`, and `Range` ends without a modifier,
 * neither of which reads as a rule until there is a neighbour to compare against.
 */
export const shortcutLabelLevelsMeta: StoryMeta = {
    title: 'Presentation/Shortcut Label (All Levels)',
    description:
        "Every Adw.ShortcutLabel grammar level at once: alternatives (space), a range (...), pressed in sequence (+), pressed together (&) — plus GTK's fixed keycap order and the disabled placeholder.",
    controls: [
        {
            name: 'disabledText',
            label: 'Placeholder',
            type: ControlType.TEXT,
            defaultValue: 'Disabled',
        },
    ],
};
