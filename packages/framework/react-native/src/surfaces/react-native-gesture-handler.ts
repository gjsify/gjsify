// `react-native-gesture-handler` — the root view, and nothing else, on purpose.
//
// `GestureHandlerRootView` wraps the whole application in every codebase that uses
// this library. What it does there is host the library's own native touch
// arbitration; there is none here, so what is left is the View — and it MUST render,
// because a root that rendered nothing would delete the application below it.
//
// EVERYTHING ELSE IS `not-reachable`, WHICH IS NOT A SCHEDULE. `Gesture` and
// `GestureDetector` run WORKLETS, compiled by a Babel plugin that is not in this
// build chain — ADR 0032's own Consequences are where that status comes from, and the
// library they name there is `react-native-reanimated`, which is the worklet compiler
// this API is built on rather than this package. The legacy handler components (`PanGestureHandler` and friends) need
// no worklets and GTK really has the controllers (`Gtk.GestureDrag`,
// `Gtk.GestureClick`, `Gtk.GestureZoom`); what they need is an arbitration model, and
// GTK's is claim/deny on a `Gtk.GestureGroup` rather than React Native's. That is
// `PanResponder`'s own project in the react-native table, and it is `planned`.

import { createElement, type ReactElement } from 'react';

import { View, type ViewProps } from '../components.js';

/**
 * A `View`. It arbitrates nothing, and says so in the table.
 *
 * `Gtk.Widget` gesture controllers resolve conflicts through their own group model,
 * which is not React Native's — so this is not "arbitration, simplified", it is a box.
 */
export function GestureHandlerRootView(props: ViewProps): ReactElement {
    return createElement(View, props);
}

export * from '../generated/unsupported-react-native-gesture-handler.js';
