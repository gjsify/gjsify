// The React Native TEST DOUBLE — the runtime oracle for the `.native` half, and the
// exact statement of what it does and does not prove.
//
// WHY A DOUBLE AT ALL. `import { View } from 'react-native'` does not run in this
// repository's test chain: React Native's entry is Flow source (`@flow strict-local`
// on `index.js` and on every component beneath it) and the chain is
// `gjsify build … --app node` over oxc, which strips TypeScript and not Flow. The
// alternative is a second test framework — Jest plus `@react-native/babel-preset` —
// which none of this repository's four registration gates can see, and an unregistered
// suite is a suite that stops running without anyone noticing (#1365, #1367, #1370).
//
// WHY THIS IS NOT "THE TEST MEASURES THE COPY". The double is never a TYPE authority.
// `.native.tsx` imports `'react-native'`, and TypeScript resolves that to the REAL
// package — 32 MB as a devDependency, `types_generated/index.d.ts` under the `types`
// condition. The substitution happens only at BUNDLE time, through
// `gjsify build --alias`. So the surface the implementation is checked against is
// always React Native's own, and this file only has to be a host component React can
// render. `View` below is declared AS `typeof RealView`, so a double that grew a prop
// React Native does not have, or lost one it does, is a compile error here rather
// than a green test against a private fiction. `testing/react-native.spec.ts`
// falsifies that claim rather than asserting it.
//
// WHAT IT PROVES: which React Native primitives a widget emits, with which props, in
// which nesting, after which state transitions — i.e. everything the `.native` module
// decides. The numbers in those props come from `@gjsify/adwaita-core`, which this
// file does not touch.
//
// WHAT IT DOES NOT PROVE: Yoga. A `width` and a `marginStart` in a style object are
// an instruction to a layout engine that is not here, so "the child is 400 points
// wide" is asserted as an instruction, never as a measured pixel. The measured pixel
// exists only on the GTK side of this package (`../widgets/clamp.gtk.spec.tsx`
// photographs it through `shotEvidence`) and, for React Native, only on a device. That
// gap is named in the README and is not closed by this file.

import { createElement, type ReactElement } from 'react';
import type { View as RealView } from 'react-native';

/**
 * The host element name `View` renders as.
 *
 * `RCTView` is React Native's own name for the platform view — the type a real
 * `react-test-renderer` tree carries under the real runtime — so a test asserting on
 * it reads the same as one written against the real thing.
 */
export const RCT_VIEW = 'RCTView';

/**
 * `react-native`'s `View`, as a host component.
 *
 * Typed as `typeof RealView` rather than with its own prop interface: the annotation
 * IS the contract. `props` is widened for `createElement`, which is typed against
 * React's intrinsic elements and knows nothing about React Native's.
 */
export const View: typeof RealView = (props): ReactElement => createElement(RCT_VIEW, props as Record<string, unknown>);
