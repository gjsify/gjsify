// The contract that keeps the double from becoming a private fiction.
//
// A test double is only worth the oracle it stands in for, and the failure mode is
// specific: the double grows a prop React Native does not have, the implementation starts
// using it, and the suite stays green against a surface nobody ships. So the double is
// DECLARED as `typeof RealView` in `react-native.ts`, and this file FALSIFIES that
// annotation rather than restating it — plus asserts the one runtime property a host
// component must have.

import { describe, expect, it } from '@gjsify/unit';
import { isValidElement } from 'react';
import type { View as RealView } from 'react-native';

import type { Assert, SameKeys } from '../parity.spec.js';
import { RCT_VIEW, View } from './react-native.js';

/**
 * The double accepts EXACTLY React Native's `View` props — same names, no more, no
 * fewer.
 *
 * ON KEY SETS, AND WHY THE OBVIOUS VERSION DOES NOT WORK. The first attempt was
 * `const CONTRACT: typeof RealView = View`, which reads like the whole contract and
 * catches almost nothing: `ViewProps` is entirely OPTIONAL properties, and under
 * structural typing any two all-optional object types are assignable to each other in
 * both directions. Measured with that assertion ALONE in the file — replacing the
 * annotation in `react-native.ts` with a hand-written interface carrying an invented
 * `notOnTheRealOne?: number` produced no complaint from the contract at all. Comparing
 * `keyof` is what bites, because a key set is a union of string literals and a union
 * with an extra member is not assignable to one without it. Both directions were run
 * against the version below: an invented prop and a dropped `onLayout` each fail on
 * `DoublePropsMatchReactNative` and nowhere else. A third, added since: a prop whose
 * TYPE changes while the key set does not (`onLayout?: string`) is invisible here and
 * falls on `CONTRACT` below — the two assertions cover different halves and both are
 * needed.
 *
 * The check is deliberately TAUTOLOGICAL while `react-native.ts` annotates `View` as
 * `typeof RealView` — that is the point. It is the annotation this holds in place, and
 * removing the annotation is the only way for the double to acquire a surface of its
 * own.
 *
 * `SameKeys` comes from `parity.spec.ts`, which needs the same instrument for the same
 * reason one level up: the package's own props are all-optional too.
 */
export type DoublePropsMatchReactNative = Assert<SameKeys<Parameters<typeof View>[0], Parameters<typeof RealView>[0]>>;

/** The value half: the double is still React Native's `View` by type, at runtime too. */
const CONTRACT: typeof RealView = View;

export default async () => {
    await describe('the react-native double', async () => {
        await it('is react-native’s own View by type, and a function at runtime', async () => {
            // The type work is `DoublePropsMatchReactNative` and `CONTRACT` above,
            // both settled by `tsc`. This asserts the binding EXISTS, so deleting the
            // contract cannot leave a green suite behind it.
            expect(typeof CONTRACT).toBe('function');
        });

        await it('renders as a host element, which is what makes a tree readable', async () => {
            const element = View({ children: null });
            expect(isValidElement(element)).toBe(true);
            expect((element as { type: unknown }).type).toBe(RCT_VIEW);
        });

        await it('forwards every prop it is given, so a tree assertion sees the real one', async () => {
            const style = { width: 400 };
            const element = View({ style }) as { props: Record<string, unknown> };
            expect(element.props.style).toBe(style);
        });
    });
};
