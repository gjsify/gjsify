// "One API surface, two implementations" — as a thing the compiler refuses, not a
// sentence in a README.
//
// The claim has a precise form: for every widget, the GTK module and the React Native
// module are each assignable to the BASE module. Base declares the prop type and the
// signature; a platform module that renames a prop, drops one, changes an arity or
// widens a return is then a type error in this file rather than a divergence somebody
// finds on one of the two devices — where, on GTK, the failure mode is a window that
// renders and is wrong at exit 0.
//
// THE ASSERTIONS ARE TYPE-LEVEL AND THE IMPORTS ARE `import type`, which is what lets
// one file hold both halves. `clamp.gtk.tsx` imports `gi://Adw` transitively and
// `clamp.native.tsx` imports `react-native`; neither would load in the other's runtime,
// and neither has to — a type import is erased before the bundle exists. The runtime
// half of this file is the other claim the design rests on: that reaching a base module
// is a named refusal and not a silent half-implementation. Why that is asserted on the
// refusal rather than on the base module itself is measured, and written down at the
// `describe` below.
//
// FALSIFIED, not assumed. `AdwBin`'s React Native module was given a required prop the
// base does not declare — a drift no other file in the package would notice, because
// nothing renders `AdwBin` in a spec. The first version of this check stayed GREEN;
// the version below fails with `Type 'false' does not satisfy the constraint 'true'`
// on `BinNativeSatisfiesBase`.

import { describe, expect, it } from '@gjsify/unit';

import type * as BinBase from './widgets/bin.js';
import type * as BinGtk from './widgets/bin.gtk.js';
import type * as BinNative from './widgets/bin.native.js';
import type * as ClampBase from './widgets/clamp.js';
import type * as ClampGtk from './widgets/clamp.gtk.js';
import type * as ClampNative from './widgets/clamp.native.js';

import { refuseBaseModule } from './refuse.js';

/**
 * `Assert<false>` is a constraint violation, and that is the whole trick.
 *
 * THE FIRST VERSION OF THIS FILE WAS INERT, and it failed in the way this repository
 * pays for most often: a conditional type resolved to `never` exactly as designed, and
 * the witness that was supposed to reject `never` used an `as` cast, which TypeScript
 * permits from `{}`. Measured — making `AdwBin`'s React Native props require a field
 * the base does not declare left the whole package at exit 0. So the assertion is a
 * CONSTRAINT now: `Assert<T extends true>` cannot be satisfied by `false`, there is no
 * cast in the expression, and the diagnostic names the alias, which names the widget
 * and the platform.
 *
 * Exported: `testing/react-native.spec.ts` holds the double against React Native's own
 * surface with the same trick, and a second copy of a one-line type is a second copy.
 */
export type Assert<T extends true> = T;

/** Does `Platform` provide everything `Base` declares — same names, same signatures? */
type SatisfiesBase<Platform, Base> = Platform extends Base ? true : false;

export type BinGtkSatisfiesBase = Assert<SatisfiesBase<typeof BinGtk, typeof BinBase>>;
export type BinNativeSatisfiesBase = Assert<SatisfiesBase<typeof BinNative, typeof BinBase>>;
export type ClampGtkSatisfiesBase = Assert<SatisfiesBase<typeof ClampGtk, typeof ClampBase>>;
export type ClampNativeSatisfiesBase = Assert<SatisfiesBase<typeof ClampNative, typeof ClampBase>>;

/**
 * The names above, as data, so the RUNTIME half can assert the set is complete.
 *
 * A type alias that is deleted takes its check with it and leaves no trace; this list
 * is what a test can count, and `check-adwaita-rn-platform-split.mjs` holds it against
 * the widgets on disk. Two derivations of one fact, and the weaker one is the one that
 * would otherwise wave a missing widget through.
 */
export const PARITY_ASSERTIONS = [
    'BinGtkSatisfiesBase',
    'BinNativeSatisfiesBase',
    'ClampGtkSatisfiesBase',
    'ClampNativeSatisfiesBase',
] as const;

/** What the refusal says when something actually reaches it. */
const refusalOf = (component: string): string => {
    try {
        refuseBaseModule(component);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    return '<no refusal: the base module returned>';
};

export default async () => {
    await describe('the platform modules satisfy one surface', async () => {
        await it('has a witness for every widget on both platforms', async () => {
            // The type-level work is done by the checker. What a runtime assertion can
            // still add is COMPLETENESS: one assertion per widget per platform, which
            // is the half a deleted alias would silently take with it.
            expect([...PARITY_ASSERTIONS].sort()).toStrictEqual([
                'BinGtkSatisfiesBase',
                'BinNativeSatisfiesBase',
                'ClampGtkSatisfiesBase',
                'ClampNativeSatisfiesBase',
            ]);
        });
    });

    await describe('the base modules refuse', async () => {
        // THIS TESTS THE REFUSAL, NOT THE REACHING OF IT, and the reason is a
        // measurement that also corrects the design. `import { AdwClamp } from
        // './index.js'` inside this package does NOT load the base barrel in any
        // gjsify build: `platform-resolve` rewrites the specifier to `./index.gtk.js`
        // before the bundler sees it, for a relative import exactly as for one from
        // `node_modules`. Written the obvious way, this suite asserted a refusal
        // against the GTK component and reported "the base module returned".
        //
        // So the audience for the throw is narrower than the design said: not "a tool
        // that ignores export conditions", but a tool that ignores export conditions
        // AND is not gjsify (which resolves past the base file) AND is not Metro
        // (which honours them). What holds the other half — that every base module
        // routes through this function and re-exports no platform sibling — is
        // `scripts/check-adwaita-rn-platform-split.mjs`, statically, with no build.
        // The third derivation, loading the shipped `lib/esm/index.js` in plain Node,
        // wants an e2e suite and is named in the README as absent.
        await it('names the component and the export-condition cause', async () => {
            const message = refusalOf('AdwClamp');
            expect(message).toContain('<AdwClamp>');
            expect(message).toContain('BASE module');
            expect(message).toContain('export conditions');
        });

        await it('names whichever component reached it, not a fixed one', async () => {
            expect(refusalOf('AdwBin')).toContain('<AdwBin>');
        });
    });
};
