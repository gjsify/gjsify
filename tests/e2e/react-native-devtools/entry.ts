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

import { createElement, useState } from 'react';
import { AppRegistry, Pressable, registerRootComponent, Text, View } from '@gjsify/react-native';

/**
 * Which half of the devtools contract this run exercises.
 *
 * `option` passes `devtools: true` through `RunApplicationOptions` and runs with
 * `GJSIFY_DEVTOOLS` UNSET, so a successful export can only have come from the
 * option; the default reads the env gate and passes no devtools option at all.
 */
const BY_OPTION = process.env.PROBE_DEVTOOLS_OPTION === '1';

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

const code = await registerRootComponent(App as never, {
    applicationId: 'org.gjsify.RnDevtoolsProbe',
    title: 'RN Devtools Probe',
    ...(BY_OPTION ? { devtools: true } : {}),
});
console.log(`[probe] exit ${code}`);
