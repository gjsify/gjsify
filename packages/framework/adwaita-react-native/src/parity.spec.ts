// "One API surface, two implementations" — as a thing the compiler refuses, not a
// sentence in a README.
//
// The claim has a precise form: for every widget, the GTK module and the React Native
// module are each assignable to the BASE module, which declares the prop type and the
// signature. A platform module that renames a prop, drops one, changes an arity or widens
// a return is then a type error here rather than a divergence somebody finds on one of the
// two devices — where, on GTK, the failure mode is a window that renders and is wrong at
// exit 0.
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
//
// AND FALSIFIED AGAIN, WHERE ASSIGNABILITY ALONE COULD NOT SEE IT. Assignability was the
// whole check here, and on these props it is exactly as weak as
// `testing/react-native.spec.ts` says it is on `ViewProps`: every prop in `props.ts` is
// OPTIONAL, and a target of all-optional properties accepts a source that shares one of
// them. Measured — `clamp.native.tsx` renaming `maximumSize` to `maximumWidth`, with its
// suite following the new name, left `tsc` at exit 0 and this file silent; so did
// dropping `tighteningThreshold` from that half's surface altogether. Both fall now,
// because the check also compares prop NAME SETS: a key set is a union of string
// literals, and a union missing a member is not assignable to one that has it. Same
// instrument as the double's contract, exported from here rather than written twice.

import { describe, expect, it } from '@gjsify/unit';

import type * as BinBase from './widgets/bin.js';
import type * as BinGtk from './widgets/bin.gtk.js';
import type * as BinNative from './widgets/bin.native.js';
import type * as ClampBase from './widgets/clamp.js';
import type * as ClampGtk from './widgets/clamp.gtk.js';
import type * as ClampNative from './widgets/clamp.native.js';
import type * as HeaderBarBase from './widgets/header-bar.js';
import type * as HeaderBarGtk from './widgets/header-bar.gtk.js';
import type * as HeaderBarNative from './widgets/header-bar.native.js';
import type * as StatusPageBase from './widgets/status-page.js';
import type * as StatusPageGtk from './widgets/status-page.gtk.js';
import type * as StatusPageNative from './widgets/status-page.native.js';
import type * as ToolbarViewBase from './widgets/toolbar-view.js';
import type * as ToolbarViewGtk from './widgets/toolbar-view.gtk.js';
import type * as ToolbarViewNative from './widgets/toolbar-view.native.js';
import type * as WindowTitleBase from './widgets/window-title.js';
import type * as WindowTitleGtk from './widgets/window-title.gtk.js';
import type * as WindowTitleNative from './widgets/window-title.native.js';
import type * as WrapBoxBase from './widgets/wrap-box.js';
import type * as WrapBoxGtk from './widgets/wrap-box.gtk.js';
import type * as WrapBoxNative from './widgets/wrap-box.native.js';

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

/**
 * Are `A` and `B` the same type, without a union distributing on the way in?
 *
 * The tuple wrappers are load-bearing: a bare `A extends B` distributes over a union,
 * and the two things this file compares — key sets — are unions.
 */
export type Identical<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Do `A` and `B` accept exactly the same property NAMES?
 *
 * The half of a props contract that structural assignability cannot express when every
 * property is optional. Used here per widget, and by `testing/react-native.spec.ts`
 * against React Native's own `View`.
 */
export type SameKeys<A, B> = Identical<keyof A, keyof B>;

/** The props a component accepts, or `never` for anything that is not one. */
type PropsOf<Component> = Component extends (props: infer P) => unknown ? P : never;

/**
 * Does `Platform` provide everything `Base` declares — the whole module surface by
 * assignability, AND `Name`'s prop names exactly?
 *
 * The component is named rather than derived because a mapped type over `keyof Base`
 * stays deferred when `Base` is a type parameter, and two deferred mapped types compare
 * EQUAL: written that way the key-set half was inert, and the rename it was added for
 * went on passing. A named component is also the better diagnostic, and `Name` is
 * constrained to both modules, so a wrong one is an error here rather than a silent
 * `never`.
 *
 * The assignability half stays: it is what catches a REQUIRED prop the base does not
 * declare, a changed arity and a widened return, none of which a key set can see. A
 * platform-only export beyond `Name` is deliberately fine — the surface promise is about
 * the widgets, not about a helper one half happens to need.
 */
type SatisfiesBase<Platform, Base, Name extends keyof Base & keyof Platform> = Platform extends Base
    ? SameKeys<PropsOf<Platform[Name]>, PropsOf<Base[Name]>>
    : false;

export type BinGtkSatisfiesBase = Assert<SatisfiesBase<typeof BinGtk, typeof BinBase, 'AdwBin'>>;
export type BinNativeSatisfiesBase = Assert<SatisfiesBase<typeof BinNative, typeof BinBase, 'AdwBin'>>;
export type ClampGtkSatisfiesBase = Assert<SatisfiesBase<typeof ClampGtk, typeof ClampBase, 'AdwClamp'>>;
export type ClampNativeSatisfiesBase = Assert<SatisfiesBase<typeof ClampNative, typeof ClampBase, 'AdwClamp'>>;
export type HeaderBarGtkSatisfiesBase = Assert<
    SatisfiesBase<typeof HeaderBarGtk, typeof HeaderBarBase, 'AdwHeaderBar'>
>;
export type HeaderBarNativeSatisfiesBase = Assert<
    SatisfiesBase<typeof HeaderBarNative, typeof HeaderBarBase, 'AdwHeaderBar'>
>;
export type StatusPageGtkSatisfiesBase = Assert<
    SatisfiesBase<typeof StatusPageGtk, typeof StatusPageBase, 'AdwStatusPage'>
>;
export type StatusPageNativeSatisfiesBase = Assert<
    SatisfiesBase<typeof StatusPageNative, typeof StatusPageBase, 'AdwStatusPage'>
>;
export type ToolbarViewGtkSatisfiesBase = Assert<
    SatisfiesBase<typeof ToolbarViewGtk, typeof ToolbarViewBase, 'AdwToolbarView'>
>;
export type ToolbarViewNativeSatisfiesBase = Assert<
    SatisfiesBase<typeof ToolbarViewNative, typeof ToolbarViewBase, 'AdwToolbarView'>
>;
export type WindowTitleGtkSatisfiesBase = Assert<
    SatisfiesBase<typeof WindowTitleGtk, typeof WindowTitleBase, 'AdwWindowTitle'>
>;
export type WindowTitleNativeSatisfiesBase = Assert<
    SatisfiesBase<typeof WindowTitleNative, typeof WindowTitleBase, 'AdwWindowTitle'>
>;
export type WrapBoxGtkSatisfiesBase = Assert<SatisfiesBase<typeof WrapBoxGtk, typeof WrapBoxBase, 'AdwWrapBox'>>;
export type WrapBoxNativeSatisfiesBase = Assert<SatisfiesBase<typeof WrapBoxNative, typeof WrapBoxBase, 'AdwWrapBox'>>;

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
    'HeaderBarGtkSatisfiesBase',
    'HeaderBarNativeSatisfiesBase',
    'StatusPageGtkSatisfiesBase',
    'StatusPageNativeSatisfiesBase',
    'ToolbarViewGtkSatisfiesBase',
    'ToolbarViewNativeSatisfiesBase',
    'WindowTitleGtkSatisfiesBase',
    'WindowTitleNativeSatisfiesBase',
    'WrapBoxGtkSatisfiesBase',
    'WrapBoxNativeSatisfiesBase',
] as const;

/**
 * What the refusal says when something actually reaches it.
 *
 * A non-`Error` is reported as such rather than stringified into a passing assertion.
 * Measured: with `String(error)` here, changing `refuse.ts` to `throw String(…)` left
 * `tsc`, the gate and all 19 Node tests green — the message still contained every
 * substring asserted below, and the only thing lost was the stack, which is the whole
 * value of the throw to whoever hits it.
 */
const refusalOf = (component: string): string => {
    try {
        refuseBaseModule(component);
    } catch (error) {
        return error instanceof Error ? error.message : `<not an Error: ${typeof error}>`;
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
                'HeaderBarGtkSatisfiesBase',
                'HeaderBarNativeSatisfiesBase',
                'StatusPageGtkSatisfiesBase',
                'StatusPageNativeSatisfiesBase',
                'ToolbarViewGtkSatisfiesBase',
                'ToolbarViewNativeSatisfiesBase',
                'WindowTitleGtkSatisfiesBase',
                'WindowTitleNativeSatisfiesBase',
                'WrapBoxGtkSatisfiesBase',
                'WrapBoxNativeSatisfiesBase',
            ]);
        });
    });

    await describe('the base modules refuse', async () => {
        // THIS TESTS THE REFUSAL, NOT THE REACHING OF IT, and the reason is a
        // measurement that also narrowed the design's claim about who reaches it
        // (`refuse.ts`). `import { AdwClamp } from './index.js'` inside this package
        // does NOT load the base barrel in any gjsify build: `platform-resolve`
        // rewrites the specifier to `./index.gtk.js` before the bundler sees it, for a
        // relative import exactly as for one from `node_modules`. Written the obvious
        // way, this suite asserted a refusal against the GTK component and reported
        // "the base module returned".
        //
        // What holds the other half — that every base module routes through this
        // function and re-exports no platform sibling — is
        // `scripts/check-adwaita-rn-platform-split.mjs`, statically, with no build. The
        // third derivation, loading the shipped `lib/esm/index.js` in plain Node, wants
        // an e2e suite and is named in the README as absent.
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
