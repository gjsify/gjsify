// The ONE API surface — the half that is neither GTK nor React Native. Every widget is a
// prop type here and two implementations elsewhere; `parity.spec.ts` is what holds both
// implementations to this declaration rather than letting each half be internally
// consistent and free to disagree with the other.
//
// PROPS ARE NAMED IN LIBADWAITA'S VOCABULARY, camelCased. `maximumSize` is
// `AdwClamp:maximum-size`, not a React Native `maxWidth` — the package's promise is the
// Adwaita design language on React Native, so the property a reader looks up in
// libadwaita's documentation is the property they write.

import type { ReactNode } from 'react';

/** What every widget in this package accepts. */
export interface AdwWidgetProps {
    children?: ReactNode;
}

/** `Adw.Bin` — a widget with one child and no layout of its own. */
export type AdwBinProps = AdwWidgetProps;

/**
 * `Adw.Clamp` — constrain a child's size and centre it.
 *
 * The defaults named below are libadwaita's own; in code both halves read them from
 * `@gjsify/adwaita-core`'s `ADW_CLAMP_DEFAULTS` rather than repeating them.
 */
export interface AdwClampProps extends AdwWidgetProps {
    /** `maximum-size` — how wide the child may get. Default 600. */
    maximumSize?: number;
    /** `tightening-threshold` — where the eased tightening starts. Default 400. */
    tighteningThreshold?: number;
}
