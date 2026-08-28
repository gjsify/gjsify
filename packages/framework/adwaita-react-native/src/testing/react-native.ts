// The React Native TEST DOUBLE — the runtime oracle for the `.native` half.
//
// WHY A DOUBLE AT ALL. `import { View } from 'react-native'` does not run in this
// repository's test chain: React Native's entry is Flow source (`@flow strict-local` on
// `index.js` and on every component beneath it) and the chain is `gjsify build … --app
// node` over oxc, which strips TypeScript and not Flow. The alternative is a second test
// framework — Jest plus `@react-native/babel-preset` — which none of this repository's
// four registration gates can see, and an unregistered suite is a suite that stops
// running without anyone noticing (#1365, #1367, #1370).
//
// IT IS NEVER A TYPE AUTHORITY, which is what separates it from "the test measures the
// copy": `.native.tsx` imports `'react-native'` and `tsc` resolves that to the REAL
// package, the substitution happening only at bundle time through `gjsify build --alias`.
// `testing/react-native.spec.ts` falsifies that rather than restating it.
//
// WHAT IT PROVES is which React Native primitives a widget emits, with which props, in
// which nesting, after which state transitions. WHAT IT DOES NOT PROVE is Yoga: a `width`
// in a style object is an instruction to a layout engine that is not here, so a size is
// asserted as an instruction and never as a measured pixel. The README carries that gap.

import { createElement, type ReactElement } from 'react';
import type { View as RealView } from 'react-native';

/**
 * The host element name `View` renders as.
 *
 * `RCTView` is React Native's own name for the platform view — the type a real
 * `react-test-renderer` tree carries under the real runtime — so a test asserting on it
 * reads the same as one written against the real thing.
 */
export const RCT_VIEW = 'RCTView';

/**
 * `react-native`'s `View`, as a host component.
 *
 * The `typeof RealView` annotation IS the contract: a double that grew a prop React
 * Native does not have, or lost one it does, is a compile error here rather than a green
 * test against a private fiction. `props` is widened because `createElement` is typed
 * against React's intrinsic elements and knows nothing about React Native's.
 */
export const View: typeof RealView = (props): ReactElement => createElement(RCT_VIEW, props as Record<string, unknown>);
