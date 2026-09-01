// `react-native-safe-area-context` — the inset has no desktop meaning, the layout does.
//
// That sentence is `react-native`'s own `SafeAreaView` entry, and this surface is the
// same decision three more times: a desktop window has no notch, no home indicator
// and no carrier bar, and the window manager's decorations are OUTSIDE the surface
// this layer lays out. So every inset is zero — constant, so nothing re-renders — and
// what is left is the box, the column and the children.
//
// WHAT IS A NO-OP IS THE INSET, NOT THE COMPONENT. `SafeAreaProvider` wraps the whole
// application in most React Native codebases; a provider that rendered nothing would
// be a window that silently went blank. Both components are Views and say so.
//
// ONE DELIBERATE DIVERGENCE: the real `useSafeAreaInsets` THROWS when there is no
// `SafeAreaProvider` above it. This one does not. A refusal there would be inventing a
// requirement this implementation does not have — the insets are a constant, not
// something a provider supplies — and it would fail applications that use the hook in
// a test or a screen rendered outside the provider.

import { createElement, type ReactElement } from 'react';

import { SafeAreaView as ReactNativeSafeAreaView, View, type ViewProps } from '../components.js';
import { useWindowDimensions } from '../hooks.js';

/** The four insets. Always zero here. */
export interface EdgeInsets {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/** A frame, in this package's own shape: the window, at the origin. */
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface Metrics {
    readonly insets: EdgeInsets;
    readonly frame: Rect;
}

const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface SafeAreaViewProps extends ViewProps {
    /** Which edges to inset. Accepted; every inset is zero, so there is no edge to apply one to. */
    edges?: readonly ('top' | 'right' | 'bottom' | 'left')[];
    /** `padding` or `margin`. Accepted, for the same reason. */
    mode?: 'padding' | 'margin';
}

/** `react-native`'s own `SafeAreaView`, under this package's name and props. */
export const SafeAreaView = ReactNativeSafeAreaView as (props: SafeAreaViewProps) => ReactElement;

export interface SafeAreaProviderProps extends ViewProps {
    /** Seeds the metrics before the first measurement. Accepted; the metrics here are constant. */
    initialMetrics?: Metrics | null;
}

/**
 * A `View` that publishes nothing, because the insets are a constant.
 *
 * It renders its children, and that is the whole requirement: the real provider
 * measures the native window and puts the result in a context, and here there is
 * nothing to measure and nothing that changes.
 */
export function SafeAreaProvider({ initialMetrics: _initialMetrics, ...rest }: SafeAreaProviderProps): ReactElement {
    return createElement(View, rest);
}

/** Zero, always, and the same object every time so a dependency list never fires. */
export function useSafeAreaInsets(): EdgeInsets {
    return ZERO_INSETS;
}

/**
 * The window, at the origin.
 *
 * `useWindowDimensions` under another name, so every one of its limits applies to
 * `width` and `height` — including the measured one that makes it look odd: the
 * `Gdk.Surface` says WHEN the size changed and the `Gtk.Window` says WHAT it is.
 */
export function useSafeAreaFrame(): Rect {
    const size = useWindowDimensions();
    return { x: 0, y: 0, width: size.width, height: size.height };
}

/**
 * Zero insets and a ZERO frame — not the window's size.
 *
 * React Native populates this from the native side before the first render, so a
 * screen can lay out without a flash. There is nothing to read before a GTK window
 * exists, and `Dimensions.get("window")` refuses that read BY NAME for exactly this
 * reason. A plausible number here would be the same lie in a value nobody checks.
 */
export const initialWindowMetrics: Metrics = { insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 0, height: 0 } };

export * from '../generated/unsupported-react-native-safe-area-context.js';
