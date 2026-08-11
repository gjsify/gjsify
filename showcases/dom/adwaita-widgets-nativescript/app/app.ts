// The Adwaita widgets are built PROGRAMMATICALLY in the page code-behind (home/home-page.ts) rather
// than through XML custom elements, so the spike validates native rendering and native-tree
// introspection without depending on the `registerElement` XML path.

import { Application, Frame } from '@nativescript/core';
import { installDevtools } from '@gjsify/devtools-nativescript';

// Normally env-gated by GJSIFY_DEVTOOLS, forced on here so an MCP agent can attach over the V8 CDP
// inspector via `nativescript debug android` without injecting env into the device. The agent
// resolves the root view lazily from the passed Application/Frame at dispatch time.
installDevtools({
    enabled: true,
    application: Application,
    frame: Frame,
    appId: 'studio.artandcode.gjsify.adwaita',
});

Application.run({ moduleName: 'app-root' });

/*
Do not place any code after the application has been started as it will not
be executed on iOS.
*/
