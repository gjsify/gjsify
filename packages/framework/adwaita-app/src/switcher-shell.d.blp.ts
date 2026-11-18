// GENERATED from switcher-shell.blp — do not edit. ADR 0088 says what these exports mean.
// Regenerate with `gjsify blueprint types`; `scripts/check-blueprint-sidecars.mjs` holds it.

import type Adw from 'gi://Adw?version=1';

/** The GtkBuilder XML this `.blp` compiles to. */
declare const xml: string;
export default xml;

/** The class `template $AdwaitaAppSwitcherShell` defines. */
export declare const GTypeName: 'AdwaitaAppSwitcherShell';

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
export declare const InternalChildren: ['toolbar_view', 'stack', 'header_bar', 'switcher', 'switcher_bar'];

/** The `_`-prefixed members GJS installs for them. Merge it into the class interface. */
export interface Children {
    _toolbar_view: Adw.ToolbarView;
    _stack: Adw.ViewStack;
    _header_bar: Adw.HeaderBar;
    _switcher: Adw.ViewSwitcher;
    _switcher_bar: Adw.ViewSwitcherBar;
}
