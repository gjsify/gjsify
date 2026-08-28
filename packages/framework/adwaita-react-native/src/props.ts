// The ONE API surface — the half that is neither GTK nor React Native.
//
// Every widget in this package is a prop type HERE and two implementations
// elsewhere, and this file is what makes "one API surface, two implementations" a
// claim a compiler can refuse. `parity.spec.ts` asserts each platform module is
// assignable to its base module, and each base module declares its component
// against a type from this file; without a shared declaration the two halves would
// each be internally consistent and free to disagree with the other.
//
// PROPS ARE NAMED IN LIBADWAITA'S VOCABULARY, camelCased. `maximumSize` is
// `AdwClamp:maximum-size`, not a React Native `maxWidth` — the package's promise is
// the Adwaita design language on React Native, so the property a reader looks up in
// libadwaita's documentation is the property they write. The GTK half hands the name
// straight to the real widget; the React Native half feeds it to
// `@gjsify/adwaita-core`, which owns the arithmetic on both paths.

import type { ReactNode } from 'react';

/** What every widget in this package accepts. */
export interface AdwWidgetProps {
    children?: ReactNode;
}

/**
 * `Adw.Bin` — a widget with one child and no layout of its own.
 *
 * It carries no properties beyond the child, which is why it is the first widget in
 * this package rather than an afterthought: it is the smallest thing that exercises
 * the whole vertical (base refusal, two platform modules, the `exports` map, the
 * gate) with nothing else in the way.
 */
export type AdwBinProps = AdwWidgetProps;

/**
 * `Adw.Clamp` — constrain a child's size and centre it.
 *
 * Both defaults are libadwaita's own and are re-exported from
 * `@gjsify/adwaita-core`'s `ADW_CLAMP_DEFAULTS` rather than repeated here.
 */
export interface AdwClampProps extends AdwWidgetProps {
    /** `maximum-size` — how wide the child may get. Default 600. */
    maximumSize?: number;
    /** `tightening-threshold` — where the eased tightening starts. Default 400. */
    tighteningThreshold?: number;
}
