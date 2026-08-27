// `<RouterRoot>` — the one component an application renders, and the only place the
// file convention, React Navigation's container and the module-level `router` meet.
//
// NOT A REACT NATIVE OR EXPO NAME, and part of the surface anyway. `expo-router`'s
// entry is a module side effect (`expo-router/entry` registers `<ExpoRoot>` against a
// `require.context`), and neither half of that exists here: `require.context` is a
// Metro feature (the bundler plugin's virtual module replaces it — see
// `rnRouteManifestPlugin`), and the root component is created by `AppRegistry`
// because on a desktop the application IS the process. So the manifest arrives as a
// prop and the component is public, the same way `configureStyle` is public in the
// main entry for the same kind of reason.
//
// WHAT IT DOES, in order:
//
//   1. builds the route tree from the manifest — where every convention refusal comes
//      from (`routes.ts`);
//   2. binds the module-level `router` to that tree, so `router.push('/x')` works from
//      an event handler with nothing in scope;
//   3. renders React Navigation's `BaseNavigationContainer` and publishes its state,
//      which is what `usePathname` subscribes to and what `router.push` reads to find
//      the navigator it should push at;
//   4. renders the root `_layout`'s component with the root route node published, so
//      the `<Stack>` or `<Tabs>` inside it finds the routes directory's own files.
//
// `BaseNavigationContainer` AND NOT `NavigationContainer`. The latter lives in
// `@react-navigation/native`, which depends on React Native — the dependency ADR 0032
// § 10 refuses to drag in. What it adds over the base is linking, theming and back-
// button handling for a phone; linking is `navigation.ts`' three upstream functions,
// theming is Adwaita's, and the back button is `Adw.NavigationView`'s own.

import { BaseNavigationContainer } from '@react-navigation/core';
import { createElement, useCallback, useLayoutEffect, useMemo, type ReactElement } from 'react';

import { RouterError } from './errors.js';
import { installRouter, navigationRef, notifyStateChanged, uninstallRouter } from './navigation.js';
import { buildRouteTree, type RouteManifest } from './routes.js';
import { componentFor } from './screens.js';

/** What `<RouterRoot>` needs. */
export interface RouterRootProps {
    /**
     * Every route file, as `{ contextKey, module }`.
     *
     * From the bundler plugin's virtual module in the ordinary case; a hand-written
     * array works identically, which is the point of putting the conventions in this
     * package rather than in the plugin (ADR 0032 § 12 — the build chain belongs to
     * the consumer).
     */
    manifest: RouteManifest;
}

/**
 * The router, mounted.
 *
 * Throws — by name, with the file to create — when the routes directory has no
 * `_layout`. expo-router requires one too, and the reason is worth stating: the root
 * layout is where the application says WHICH navigator its top level is, and there is
 * no defensible default. Quietly supplying a `<Stack>` would make a missing file look
 * like a working application whose tabs never appear.
 */
export function RouterRoot(props: RouterRootProps): ReactElement {
    const tree = useMemo(() => buildRouteTree(props.manifest), [props.manifest]);

    if (tree.contextKey === null) {
        throw new RouterError(
            'bad-manifest',
            'the routes directory',
            'has no `_layout` file, so nothing says what the top-level navigator is. Add `_layout.tsx` beside ' +
                'your routes, default-exporting a component that renders <Stack/> or <Tabs/>',
        );
    }

    // Bound in a LAYOUT effect, not during render: `installRouter` refuses a second
    // binding, and a render can be thrown away and re-run. The cleanup is what makes
    // a re-render safe — install, release, install again.
    useLayoutEffect(() => {
        installRouter(tree);
        return uninstallRouter;
    }, [tree]);

    // Both callbacks only NOTIFY: `navigation.ts` reads the state live off the
    // container, because a cached copy fed from `onStateChange` lags it by one effect
    // flush (measured — a popped page left `usePathname` on the URL it had left).
    //
    // `onReady` is needed as well as `onStateChange`, and the reason is the same
    // shape: `onStateChange` does NOT fire for the first state, so without it a
    // subscriber never learns that the container became readable at all.
    const onStateChange = useCallback(() => {
        notifyStateChanged();
    }, []);
    const onReady = useCallback(() => {
        notifyStateChanged();
    }, []);

    const Layout = componentFor(tree);
    // `children` in the PROPS object rather than as a vararg: `NavigationContainerProps`
    // declares it required, and `createElement`'s vararg overload does not satisfy a
    // required `children` — it type-errors on the props argument instead, which reads
    // as though the container rejected `ref`.
    return createElement(BaseNavigationContainer, {
        ref: navigationRef,
        onStateChange,
        onReady,
        children: createElement(Layout),
    });
}
