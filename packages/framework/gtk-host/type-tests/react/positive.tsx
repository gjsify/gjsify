// The REACT surface in its WORKING spellings — one per mechanism the negatives
// then probe from the other side.
//
// A positive file cannot detect a misconfigured compiler (that is what
// `sentinel.tsx` and the probes are for), and it is not here for that. It is here
// so that a change which breaks a LEGAL spelling fails loudly instead of reading
// as one more caught negative: every negative in this directory would still be
// "caught" by a surface that rejects EVERYTHING.
//
// Consumers configure exactly what `tsconfig.json` next to this file configures:
// `"jsx": "react-jsx"` + `"jsxImportSource": "@gjsify/gtk-host/react"`, and
// TypeScript appends `/jsx-runtime` itself.

import { createRef } from 'react';
import type Gtk from '@girs/gtk-4.0';

/** Nested children, camelCase props, a kebab-spelled prop and two enum nicks. */
export const layout = (
    <gtk-window title="Type surface" defaultWidth={640} heightRequest={200}>
        <gtk-box orientation="vertical" spacing={6} baseline-child={0}>
            <gtk-label label="a label" ellipsize="end" />
            <gtk-button iconName="list-add-symbolic" onClicked={() => {}} />
        </gtk-box>
    </gtk-window>
);

/**
 * A signal handler whose parameter is ANNOTATED against the GIR signature.
 *
 * The handler types are the generated ones the `jsx` half gates from the other
 * side; what this asserts is that the React surface composes them at all, since
 * `GtkReactIntrinsicElements` wraps `WidgetPropsByTag` in `WithOnce` and its own
 * attributes.
 */
export const rows = <gtk-list-box onRowActivated={(row: Gtk.ListBoxRow) => row.set_selectable(false)} />;

/** The `.once` spelling `WithOnce` derives for every `on*` prop. */
export const once = <gtk-button onClickedOnce={() => {}} />;

/** The `on:<raw-signal>` escape hatch, for names the camelCase derivation misses. */
export const rawSignal = <gtk-button on:clicked={() => {}} />;

/** `slot` routes a child into a container's named slot. */
export const slotted = (
    <adw-action-row title="Row">
        <gtk-switch slot="suffix" />
    </adw-action-row>
);

/**
 * `ref` in BOTH of React's spellings, each carrying the element's own widget type.
 *
 * The callback parameter is `Gtk.Box | null` — `RefCallback<T>` is `(instance: T |
 * null) => void`, so the optional call is React's shape and not defensiveness. The
 * object form is the one a Solid-shaped `ref` type cannot express at all.
 */
export const refCallback = <gtk-box ref={(el) => el?.set_spacing(12)} />;
export const refObject = <gtk-box ref={createRef<Gtk.Box>()} />;

/**
 * `children` is OPTIONAL and also assignable as a prop.
 *
 * Both halves are asserted deliberately: a `children` declared as REQUIRED makes
 * every self-closing tag an error (TS2741), and a `children` not declared at all
 * makes every NESTED element an error (TS2559).
 */
export const selfClosing = <gtk-box />;
export const childrenAsProp = <gtk-box children={<gtk-label label="x" />} />;

/** A widget whose GType carries adjacent capitals, in its JSX (kebab) spelling. */
export const glArea = <gtk-gl-area hasStencilBuffer={true} />;
