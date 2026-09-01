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
import type {
    Pressable as RealPressable,
    Switch as RealSwitch,
    Text as RealText,
    TextInput as RealTextInput,
    View as RealView,
} from 'react-native';

import type { Assert, SameKeys } from '../parity.spec.js';
import {
    Pressable,
    RCT_SWITCH,
    RCT_TEXT,
    RCT_TEXT_INPUT,
    RCT_VIEW,
    Switch,
    Text,
    TextInput,
    View,
} from './react-native.js';

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

/**
 * The same contract for `Text`, which most of this package's widgets render.
 *
 * A SECOND PRIMITIVE IS A SECOND CHANCE TO INVENT ONE. `View` was pinned from the day it
 * existed and `Text` arrived later, with widgets already leaning on it — which is exactly
 * the order in which a double acquires a prop React Native does not have. And it is not
 * redundant with the assertion above: `ViewProps` and `TextProps` are different key sets
 * — `numberOfLines`, `ellipsizeMode` and `onPress` are on one and not the other — so a
 * `Text` double annotated `typeof RealView` by a copy-paste would satisfy every assertion
 * about `View` and none about the component the widgets actually use.
 */
export type TextPropsMatchReactNative = Assert<SameKeys<Parameters<typeof Text>[0], Parameters<typeof RealText>[0]>>;

/**
 * The same instrument for the three primitives the boxed-list rows added.
 *
 * One alias per primitive rather than a mapped type over them: `SameKeys` is a
 * CONSTRAINT violation when it fails, and the diagnostic then names the alias — which
 * names the primitive. A mapped type would report one error naming the map.
 */
export type PressablePropsMatchReactNative = Assert<
    SameKeys<Parameters<typeof Pressable>[0], Parameters<typeof RealPressable>[0]>
>;
export type SwitchPropsMatchReactNative = Assert<
    SameKeys<Parameters<typeof Switch>[0], Parameters<typeof RealSwitch>[0]>
>;
export type TextInputPropsMatchReactNative = Assert<
    SameKeys<Parameters<typeof TextInput>[0], Parameters<typeof RealTextInput>[0]>
>;

/** The value half: the double is still React Native's `View` by type, at runtime too. */
const CONTRACT: typeof RealView = View;

/** The same value half for the four primitives above, each held by its own annotation. */
const CONTRACTS: Array<[name: string, double: unknown, host: string]> = [
    ['Text', Text satisfies typeof RealText, RCT_TEXT],
    ['Pressable', Pressable satisfies typeof RealPressable, RCT_VIEW],
    ['Switch', Switch satisfies typeof RealSwitch, RCT_SWITCH],
    ['TextInput', TextInput satisfies typeof RealTextInput, RCT_TEXT_INPUT],
];

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

        await it('renders each added primitive as react-native’s own host element', async () => {
            // The COUNT is asserted first: a `CONTRACTS` list that lost an entry would
            // otherwise leave this row green over three primitives instead of four,
            // which is the vacuous-scan shape the gates in `scripts/` all refuse.
            expect(CONTRACTS.length).toBe(4);
            for (const [name, double, host] of CONTRACTS) {
                const render = double as (props: Record<string, unknown>) => unknown;
                const element = render({ children: null }) as { type: unknown };
                expect(`${name}:${String(element.type)}`).toBe(`${name}:${host}`);
            }
            // The loop only proves each double renders ITS CONSTANT. These pin the
            // constants themselves to React Native's own spellings — the half a renamed
            // constant would otherwise carry past the loop unseen.
            expect([RCT_VIEW, RCT_TEXT, RCT_SWITCH, RCT_TEXT_INPUT]).toStrictEqual([
                'RCTView',
                'RCTText',
                'RCTSwitch',
                'RCTSinglelineTextInputView',
            ]);
        });

        await it('refuses TextInput.State rather than inventing a focus registry', async () => {
            // `typeof RealTextInput` demands the static, and the double cannot answer it
            // honestly off-device. A stub returning `undefined` would say “nothing is
            // focused”, which no test here has earned.
            let message = '<no refusal>';
            try {
                TextInput.State.currentlyFocusedInput();
            } catch (error) {
                message = error instanceof Error ? error.message : `<not an Error: ${typeof error}>`;
            }
            expect(message).toContain('TextInput.State.currentlyFocusedInput()');
            expect(message).toContain('not in the test double');
        });
    });
};
