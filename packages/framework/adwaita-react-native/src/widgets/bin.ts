// `AdwBin` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwBinProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A widget with one child.
 *
 * The declaration here is the CONTRACT both platform modules are held to:
 * `parity.spec.ts` asserts `typeof import('./bin.gtk.js')` and
 * `typeof import('./bin.native.js')` are each assignable to `typeof import('./bin.js')`,
 * so a platform module that renames a prop or changes an arity is a type error rather
 * than a divergence somebody finds on one of the two devices.
 */
export function AdwBin(_props: AdwBinProps): ReactElement | null {
    return refuseBaseModule('AdwBin');
}
