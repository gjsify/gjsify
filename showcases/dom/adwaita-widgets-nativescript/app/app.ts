// NativeScript entry. Installs the in-app gjsify devtools agent (so an MCP agent
// can attach over the V8 CDP inspector and screenshot / dump the native Adwaita
// view tree), then starts the app.
//
// The Adwaita widgets are built PROGRAMMATICALLY in the page code-behind
// (home/home-page.ts) rather than via XML custom elements — the spike validates
// native rendering + native-tree introspection without depending on the
// `registerElement` XML path.

import { Application, Frame } from '@nativescript/core';
import { installDevtools } from '@gjsify/devtools-nativescript';

// Force-enable the in-app devtools agent for this debug showcase. Normally it is
// env-gated by GJSIFY_DEVTOOLS; forced on here so an MCP agent can attach via
// `nativescript debug android` without injecting env into the device. The agent
// attaches `globalThis.__adwDevtools` and resolves the root view lazily from the
// passed Application/Frame at dispatch time.
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
