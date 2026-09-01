// `expo-status-bar` — react-native's own answer, re-exported (ADR 0036 § 4).
//
// A desktop window has no bar above it, and `react-native`'s `StatusBar` already
// says so with its measurements and its refusals: the component renders `null`, its
// declarative props are accepted no-ops, and `currentHeight` throws rather than
// answering 0 because code reads it straight into a layout.
//
// RE-EXPORTED AND NOT RE-DECIDED, which is the rule ADR 0036 § 4 exists for. A
// second `StatusBar` here would be a second truth about one question, and the drifted
// one would be whichever a porter happened to import.
//
// expo-status-bar's own props (`style="auto"|"inverted"`, `hideTransition`) widen the
// declared type and change nothing: the component they configure draws nothing.

import { StatusBar as ReactNativeStatusBar, type StatusBarProps } from '../components.js';

export interface ExpoStatusBarProps extends StatusBarProps {
    /** `auto` follows the colour scheme, `inverted` opposes it. Accepted; there is no bar. */
    style?: 'auto' | 'inverted' | 'light' | 'dark';
    hideTransition?: 'fade' | 'slide' | 'none';
}

/**
 * `react-native`'s `StatusBar` under expo's name.
 *
 * The statics come with it — `Object.defineProperties` copied the DESCRIPTORS onto
 * the react-native component (its `currentHeight` is a throwing getter, and copying
 * its value would have fired the refusal at module load), so `StatusBar.setHidden`
 * refuses here exactly as it does there.
 */
export const StatusBar = ReactNativeStatusBar as (props: ExpoStatusBarProps) => null;

export * from '../generated/unsupported-expo-status-bar.js';
