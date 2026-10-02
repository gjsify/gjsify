// GENERATED from ldraw-window.blp — do not edit. ADR 0088 says what these exports mean.
// Regenerate with `gjsify blueprint types`; `scripts/check-blueprint-sidecars.mjs` holds it.

import type Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

/** The GtkBuilder XML this `.blp` compiles to. */
declare const xml: string;
export default xml;

/** The class `template $LDrawWindow` defines. */
export declare const GTypeName: 'LDrawWindow';

/**
 * Every id inside the template, in source order — what `registerClass` is given.
 *
 * A MUTABLE tuple, and the `readonly` is missing for a reason that is not ours: `@girs`
 * declares `GObject.MetaInfo['InternalChildren']` as `string[]`, so a `readonly` tuple is
 * refused at the call site with TS4104 and the consumer would have to spread it — the
 * boilerplate ADR 0088 exists to remove. The tuple still pins the exact ids and arity,
 * which is the property that matters. `status/open-todos/blueprint.md` carries the
 * upstream half.
 */
export declare const InternalChildren: [
    'modelRow',
    'flatColorsRow',
    'mergeModelRow',
    'smoothNormalsRow',
    'buildingStepRow',
    'displayLinesRow',
    'conditionalLinesRow',
    'glAreaContainer',
];

/** The `_`-prefixed members GJS installs for them. Merge it into the class interface. */
export interface Children {
    _modelRow: Adw.ComboRow;
    _flatColorsRow: Adw.SwitchRow;
    _mergeModelRow: Adw.SwitchRow;
    _smoothNormalsRow: Adw.SwitchRow;
    _buildingStepRow: Adw.SpinRow;
    _displayLinesRow: Adw.SwitchRow;
    _conditionalLinesRow: Adw.SwitchRow;
    _glAreaContainer: Gtk.Box;
}
