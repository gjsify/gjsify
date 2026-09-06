// The `@girs/*` half of the arm. `@girs/adw-1`'s runtime body is, in full,
// `import Adw from 'gi://Adw?version=1'; export default Adw;` — so this file reaches the
// renderer only if `emptyGirs: false` lets the package resolve to that body AND the arm
// then claims its inner `gi://`. With the arm off, `gjsImportsEmptyPlugin` claims
// `@girs/adw-1` itself and `kind` is `'undefined'`.
import Adw from '@girs/adw-1';

export const actionRow = Adw.ActionRow;
export const kind = typeof Adw.ActionRow;
