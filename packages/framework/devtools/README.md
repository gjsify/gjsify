# @gjsify/devtools

The in-app **DBus devtools control plane** for GTK/GJS apps. Opt in with one call and your running app exposes `org.gjsify.Devtools` — a control plane you can drive from `gdbus`, d-feet, GNOME Builder, headless CI, or (via [`@gjsify/devtools-mcp`](../devtools-mcp)) an AI agent.

It implements the toolkit-neutral [`@gjsify/devtools-protocol`](../devtools-protocol) contract over DBus and re-exports it, so a consumer needs one import.

## Install it in your app

`installDevtools` is a no-op unless `GJSIFY_DEVTOOLS=1` (or `enabled: true`). Call it from `onStartup`/`vfunc_startup`, after the actions and the active window exist.

```ts
import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { installDevtools } from '@gjsify/devtools';

export class MyApplication extends Adw.Application {
    static { GObject.registerClass(MyApplication); }

    vfunc_startup(): void {
        super.vfunc_startup();
        // … create actions + the main window …

        installDevtools(this, {
            // Adw.ApplicationWindow does NOT expose its win.* actions as a group —
            // pass one explicitly so win.* commands are bridged.
            winActionGroup: this._window,
            // Optional: contribute app-specific methods (see below).
            extend: [],
            // Optional: gate mutating methods behind your own pause state.
            paused: () => this._externalControlPaused,
        });
    }
}
```

Then drive it without any AI:

```bash
GJSIFY_DEVTOOLS=1 gjsify run dist/index.js &
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.GetStatus
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.Screenshot 'window'   # PNG bytes as a GVariant `ay`
```

## Generic methods (out of the box)

`GetStatus`, `Screenshot` (GSK widget snapshot PNG), `ListActions` / `ActivateAction` / `ChangeActionState` (GAction bridge), `PresentWindow`, `ResizeWindow`, plus full introspection: `ListToplevels`, `DumpTree`, `GetProperty` (by index path), `GetFocused`, `DumpGSettings`, `DumpCss` / `SwapCss` (live CSS hot-swap).

GActions are auto-bridged into the command registry (handling the `Adw.ApplicationWindow` non-export gotcha via `winActionGroup`).

## App-specific methods — a `DevtoolsExtension`

Add your own methods without forking the core. The `<method>` XML is merged into the interface, handlers attach as DBus methods, and each method declares a kind the pause guard enforces.

```ts
import type { DevtoolsExtension } from '@gjsify/devtools';

const myExtension: DevtoolsExtension = {
    methodsXml: ['<method name="DoThing"><arg type="s" direction="in" name="what"/></method>'],
    handlers: { DoThing: (what: string) => { /* … */ } },
    methodKinds: { DoThing: 'mutating' },
    contributeStatus: () => ({ thing: currentThing }),
};

installDevtools(this, { extend: [myExtension] });
```

## Exports

- `installDevtools(app, options)` → returns a `DevtoolsService` (or `null` when the env gate is off); `uninstallDevtools(service)` — opt-in lifecycle.
- `DevtoolsService` — the exported service object `installDevtools` returns and `uninstallDevtools` accepts.
- `DevtoolsExtension`, `InstallDevtoolsOptions` — the extension + options types.
- `captureWidgetPng` (GSK screenshot), `buildVariant` / `variantKindFor` / `VariantKind` (GVariant), `activateAction` / `changeActionState` / `describeActions` (GAction bridge).
- widget-tree helpers (`dumpTree`, `getWidgetProperty`, `listToplevels`, `resolveWidgetPath`, …), `dumpCss` / `swapCss` / `removeCss`, `dumpGSettings`, `buildDevtoolsIfaceXml`.
- the re-exported `@gjsify/devtools-protocol` contract.

> **GJS gotcha:** the long-lived `Gio.DBusExportedObject` is reachable only through a self-cycle, which SpiderMonkey's GC can collect mid-run. `installDevtools` roots the service in a module-level set to defeat this — keep that rooting if you wire the service by hand.

## Build / test

```bash
gjsify workspace @gjsify/devtools build
gjsify workspace @gjsify/devtools test
```
