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
