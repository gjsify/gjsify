// The fixture entry: a React Native application whose WHOLE bootstrap is
// `registerRootComponent`, exactly as this layer's README documents it.
//
// Nothing here registers a widget table, constructs an `Adw.Application` or
// touches devtools, because a ported React Native entry file cannot: none of those
// are React Native names. That is the point of the fixture — everything the suite
// asserts has to come from `AppRegistry.runApplication` itself.
//
// `createElement` rather than JSX for the same reason `react-native-gate`'s
// fixtures set `transform.jsx: false`: the dialect is a build-configuration
// question this suite is not about, and `createElement` is what JSX compiles to.

import { createElement, useState, type ReactElement } from 'react';
import { AppRegistry, Pressable, registerRootComponent, Text, View } from '@gjsify/react-native';
import { RouterRoot, Stack, type RouteManifest } from '@gjsify/react-native/router';

/**
 * Which half of the devtools contract this run exercises.
 *
 * `option` passes `devtools: true` through `RunApplicationOptions` and runs with
 * `GJSIFY_DEVTOOLS` UNSET, so a successful export can only have come from the
 * option; the default reads the env gate and passes no devtools option at all.
 */
const BY_OPTION = process.env.PROBE_DEVTOOLS_OPTION === '1';

/**
 * Render the router instead of a plain view, for the window-chrome vector.
 *
 * A routed tree is the only shape that can SEE `runApplication`'s chrome hand-over:
 * the outermost navigator takes the window's header bar only if `provideWindowChrome`
 * published one, and a plain `<View>` never asks. `useWindowChrome()` answering
 * `null` is an ordinary answer for a consumer who built their own window, so nothing
 * throws when the publish is missing — the window simply keeps its bar while the
 * navigator grows a second one, which is #1460 all over again and invisible from
 * inside the process.
 */
const ROUTED = process.env.PROBE_ROUTED === '1';

function App() {
    const [pressed, setPressed] = useState(false);
    // The application handle, read from inside the tree — where a ported
    // application's own code lives. Printed rather than asserted in-process: an
    // in-process claim about the application is exactly the kind of evidence this
    // suite exists to replace, so the log line only says the accessor answered and
    // the assertions live on the DBus side.
    const app = AppRegistry.getApplication();
    const window = AppRegistry.getWindow();
    console.log(`[probe] getApplication -> ${app === null ? 'null' : app.applicationId}`);
    console.log(`[probe] getWindow -> ${window === null ? 'null' : window.title}`);
    return createElement(
        View,
        null,
        createElement(Text, { testID: 'probe-label' }, pressed ? 'PRESSED' : 'INITIAL'),
        createElement(Pressable, { testID: 'probe-button', onPress: () => setPressed(true) }, 'Press me'),
    );
}

/** The routes directory a real application has as files, written out as an array. */
function RootLayout(): ReactElement {
    return createElement(
        Stack,
        null,
        createElement(Stack.Screen, { key: 'index', name: 'index', options: { title: 'Probe' } }),
    );
}
function IndexScreen(): ReactElement {
    return createElement(View, null, createElement(Text, { testID: 'probe-label' }, 'ROUTED'));
}
const MANIFEST: RouteManifest = [
    { contextKey: '_layout.tsx', module: { default: RootLayout } },
    { contextKey: 'index.tsx', module: { default: IndexScreen } },
];
function RoutedApp(): ReactElement {
    return createElement(RouterRoot, { manifest: MANIFEST });
}

const code = await registerRootComponent((ROUTED ? RoutedApp : App) as never, {
    applicationId: 'org.gjsify.RnDevtoolsProbe',
    title: 'RN Devtools Probe',
    ...(BY_OPTION ? { devtools: true } : {}),
});
console.log(`[probe] exit ${code}`);
