// The types for `corpus/real-expectations.mjs`, hand-written for the reason `manifest.d.mts`
// gives: this package has no build step, so a `.d.mts` is the declaration and not an output.
//
// The consumer that needed it is `@gjsify/adwaita-nativescript`'s gallery-Blueprint spec,
// which builds every gallery `.blp`'s expected tree. A `.ts` importing the bare `.mjs` is
// refused by its project (the file sits outside `rootDir`); a declaration is not.

import type { ProjectedLoss, SharedNode } from '../src/shared-node.mjs';

export interface RealExpectation {
    /** The real `.blp`, repo-relative. */
    readonly file: string;
    /** What the projection must produce. */
    readonly node: SharedNode;
    readonly lost: readonly ProjectedLoss[];
    /** Something true of this file that the tree cannot say. */
    readonly note?: string;
}

export declare const REAL_EXPECTATIONS: readonly RealExpectation[];
