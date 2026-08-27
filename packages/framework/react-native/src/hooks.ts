// The React hooks. Two of them, and each is three lines over a GTK-only module.
//
// `useSyncExternalStore` and not `useState` + `useEffect`, because both of them read an
// EXTERNAL store that can change between render and commit: a user flipping the desktop
// to dark while a tree is rendering, or dragging the window edge, is exactly the tear
// `useSyncExternalStore` exists to prevent, and React 18 made it the sanctioned way to
// read one. The effect-based spelling also renders once with the wrong value on mount,
// which for a colour scheme is a visible flash and for a window size is a layout
// computed against the wrong breakpoint.

import { useSyncExternalStore } from 'react';

import { currentColorScheme, onColorSchemeChange, type ColorSchemeName } from './apis/color-scheme.js';
import { onWindowMetricsChange, windowMetricsSnapshot, type DisplayMetrics } from './apis/display.js';

/**
 * The desktop's current colour scheme, re-rendering when it changes.
 *
 * Reports what the user is LOOKING AT (`Adw.StyleManager:dark`), not what the
 * application asked for — see `apis/color-scheme.ts` for why those are two
 * different questions and which one React Native means.
 *
 * The server snapshot is the same read: there is no server, and returning a
 * different value there is what produces a hydration mismatch in the one
 * environment that has none.
 */
export function useColorScheme(): ColorSchemeName {
    return useSyncExternalStore(subscribe, currentColorScheme, currentColorScheme);
}

// A module-level subscriber, so its identity is stable: `useSyncExternalStore`
// re-subscribes whenever this function changes, and an inline arrow would tear the
// subscription down and build it up again on every render.
const subscribe = (onStoreChange: () => void): (() => void) => onColorSchemeChange(() => onStoreChange());

/**
 * The application window's size, re-rendering when it changes.
 *
 * The WINDOW and not the screen: a desktop application is not full-screen, so the
 * screen's number would be wrong in the ordinary case rather than the rare one (ADR
 * 0032's own planning entry). `apis/display.ts` holds the measurements — including the
 * one that makes this hook's mechanism look odd: the notification comes from the
 * `Gdk.Surface` and the VALUE comes from the window, because `Gtk.Widget` installs no
 * size property and emits no size-allocate signal.
 *
 * The snapshot is cached by value (`windowMetricsSnapshot`), because
 * `useSyncExternalStore` compares snapshots by identity and a fresh record per call is
 * React's own "getSnapshot should be cached" loop.
 */
export function useWindowDimensions(): DisplayMetrics {
    return useSyncExternalStore(subscribeToWindow, windowMetricsSnapshot, windowMetricsSnapshot);
}

// Module-level, for the reason `subscribe` above is: `useSyncExternalStore`
// re-subscribes whenever this function's identity changes.
const subscribeToWindow = (onStoreChange: () => void): (() => void) => onWindowMetricsChange(() => onStoreChange());
