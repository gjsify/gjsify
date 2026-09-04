// The JSX/Solid surface in its WORKING spellings — one file per mechanism the
// negatives then probe from the other side.
//
// A positive file cannot detect a misconfigured compiler (that is what
// `sentinel.tsx` and the probe tsconfigs are for), and it is not here for that.
// It is here so that a change which breaks a LEGAL spelling fails loudly instead
// of reading as one more caught negative: every negative in this directory would
// still be "caught" by a surface that rejects EVERYTHING.
//
// Consumers configure exactly what `tsconfig.json` next to this file configures:
// `"jsx": "preserve"` + `"jsxImportSource": "@gjsify/gtk-host"`, and TypeScript
// appends `/jsx-runtime` itself.

import type Gtk from '@girs/gtk-4.0';

/**
 * Nested children, camelCase props, a kebab-spelled prop and two enum nicks.
 *
 * `baseline-child` is the kebab spelling of `baselineChild`. Both are generated;
 * see `known-hole-hyphen.tsx` for what checking a hyphenated attribute does and
 * does not cover.
 */
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
 * An inferred parameter proves only that a function was accepted; annotating it
 * is what makes the generated signature load-bearing, and `strictFunctionTypes`
 * is what makes the wrong annotation an error (`negative-handlers.tsx`).
 */
export const rows = <gtk-list-box onRowActivated={(row: Gtk.ListBoxRow) => row.set_selectable(false)} />;

/** `ref` carries the widget's own instance type, not `unknown`. */
export const boxRef = <gtk-box ref={(el) => el.set_spacing(12)} />;

/** The `.once` spelling `WithOnce` derives for every `on*` prop. */
export const once = <gtk-button onClickedOnce={() => {}} />;

/** `slot` routes a child into a container's named slot. */
export const slotted = (
    <adw-action-row title="Row">
        <gtk-switch slot="suffix" />
    </adw-action-row>
);

/**
 * The `on:<raw-signal>` escape hatch: a signal name passed verbatim, for the
 * names the camelCase derivation cannot reach.
 */
export const rawSignal = <gtk-button on:clicked={() => {}} />;

/**
 * `children` is OPTIONAL and also assignable as a prop.
 *
 * Both halves are asserted deliberately: a `children` declared as REQUIRED makes
 * every self-closing tag an error (TS2741), and a `children` not declared at all
 * makes every NESTED element an error (TS2559) — the two failure modes
 * `JsxAttributes` exists to avoid.
 */
export const selfClosing = <gtk-box />;
export const childrenAsProp = <gtk-box children={<gtk-label label="x" />} />;

/** A widget whose GType carries adjacent capitals, in its JSX (kebab) spelling. */
export const glArea = <gtk-gl-area hasStencilBuffer={true} />;

/**
 * A MENU written as a value (ADR 0042).
 *
 * The thing that was untypeable before: `menuModel`'s GObject type is a
 * `GMenuModel`, a GObject with no literal spelling, so a JSX tree could not carry a
 * menu at all — and the website gallery refused a Solid, Vue and React snippet for
 * both menu buttons for exactly that reason. `WithPortableMenu<T>` widens the six
 * `GMenuModel`-typed prop spellings to accept the portable model; `coerce` builds
 * the real `Gio.Menu` from it at the ParamSpec seam.
 *
 * All three input forms are legal here on purpose: the bare-string shorthand, item
 * descriptors with a detailed action, and the two links.
 */
export const menus = (
    <gtk-box orientation="vertical">
        <adw-split-button label="Save" menuModel={['Save as…', 'Export']} />
        <gtk-menu-button
            iconName="open-menu-symbolic"
            menuModel={[
                { label: 'Preferences', action: 'app.preferences' },
                { section: [{ label: 'About', action: 'app.about' }] },
                { label: 'More', submenu: [{ label: 'Quit', action: 'app.quit' }] },
            ]}
        />
        {/* The kebab spelling is widened too, and so is a text widget's `extra-menu`. */}
        <gtk-entry extra-menu={[{ label: 'Paste', action: 'app.paste' }]} />
    </gtk-box>
);
