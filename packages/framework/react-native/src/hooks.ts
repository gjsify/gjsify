// The React hooks. One of them, and it is three lines over a GTK-only module.
//
// `useSyncExternalStore` and not `useState` + `useEffect`, because the scheme is an
// EXTERNAL store that can change between render and commit: a user flipping the
// desktop to dark while a tree is rendering is exactly the tear
// `useSyncExternalStore` exists to prevent, and React 18 made it the sanctioned way
// to read one. The effect-based spelling also renders once with the wrong value on
// mount, which for a colour scheme is a visible flash.

import { useSyncExternalStore } from 'react';

import { currentColorScheme, onColorSchemeChange, type ColorSchemeName } from './apis/color-scheme.js';

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
