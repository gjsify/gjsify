# @gjsify/devtools

The in-app **DBus devtools control plane** for GTK/GJS apps. Opt in with one call and your running app exposes `org.gjsify.Devtools` — a control plane you can drive from `gdbus`, d-feet, GNOME Builder, headless CI, or (via [`@gjsify/devtools-mcp`](../devtools-mcp)) an AI agent.

It implements the toolkit-neutral [`@gjsify/devtools-protocol`](../devtools-protocol) contract over DBus and re-exports it, so a consumer needs one import.

## Install it in your app

`installDevtools` is a no-op unless `GJSIFY_DEVTOOLS=1` (or `enabled: true`). Call it from `onStartup`/`vfunc_startup`, after the actions and the active window exist.

```ts
import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
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

## No session bus? (macOS, Windows)

**The capture is already OS-agnostic — only the transport ever needed a bus.** `captureWidgetPng` is pure GTK4/GSK, in-process (`widget.get_native().get_renderer()` → `Gtk.WidgetPaintable` → `Gsk.Renderer.render_texture` → `texture.save_to_png_bytes()`): no `grim`, no `gnome-screenshot`, no xdg portal, no GStreamer, no OS branch. It is CI-proven on darwin-arm64.

What macOS and Windows lack is the **session bus**. So `installDevtools` speaks GDBus **peer-to-peer** when there is none: it stands up a `Gio.DBusServer` on a socket and exports the same `org.gjsify.Devtools` interface — every method, same object path — on each incoming connection.

### The recipe (one env var, no daemon)

```bash
# the app
GJSIFY_DEVTOOLS=1 GJSIFY_DEVTOOLS_ADDRESS=unix:path=/tmp/myapp-devtools.sock gjs -m dist/app.js
# the bridge
GJSIFY_DEVTOOLS_ADDRESS=unix:path=/tmp/myapp-devtools.sock gjsify debug --bus-name org.example.App
#   …or equivalently:  gjsify debug --bus-name org.example.App --address unix:path=/tmp/myapp-devtools.sock
```

Setting nothing at all also works: with no usable bus the app picks a socket itself, logs the address and **publishes** it to `<runtime-dir>/gjsify-devtools/<app-id>[.<instance>].address` (removed on `unexport` and on `shutdown`) — the bus-less analogue of `DBUS_SESSION_BUS_ADDRESS`. The bridge reads that file, so `gjsify debug` needs no configuration either, and it **verifies** it: an address nothing answers on is deleted and the bridge continues down its precedence, because Ctrl-C, `SIGKILL` and a crash all skip every cleanup hook an app has.

### Restarting, and two apps at once

`unix:path=` is a pinned address, so the two obvious mishaps have defined answers instead of a `Gio.IOErrorEnum`:

- **Ctrl-C, then restart.** `stop()` unlinks the socket, an abnormal exit does not, and binding over the leftover inode fails with `ADDRESS_IN_USE` exactly like a live server would. The app therefore probes it: a socket that refuses connections is **reclaimed** (and the reclaim is logged), a live one is never touched, and a path holding something that is not a socket is never deleted at all.
- **A second app on the same address.** The first keeps its control plane; the second logs `devtools stayed OFF, the app is unaffected — cannot listen on …` and **runs normally without devtools**. `installDevtools` never throws: it is called from `startup`/`activate` handlers, and GJS logs a throw from a handler and swallows it — so a throw would silently cost the app its `present()` call, not just its devtools.

### Transport precedence

| explicit address (`options.address` / `GJSIFY_DEVTOOLS_ADDRESS`) | app holds a bus connection | session bus answers | transport |
|---|---|---|---|
| set   | any | any | peer server at that address |
| unset | yes | any | the session bus — **Linux is unchanged** |
| unset | no  | no  | peer server at an auto-picked socket (address logged + published) |
| unset | no  | yes | none: the bus works, so the diagnosis is a too-early call — call `installDevtools` from `startup` |

Auto-picking rather than failing is deliberate: `GJSIFY_DEVTOOLS=1` asks for a control plane, and answering it with a service that is constructed but never exported is exactly the silent absence this transport removes. The bridge mirrors the order: `--address` → env var → published address file → session bus.

### The `dbus-run-session` trap

The fallback everyone reaches for first — an external session bus — **does not work on macOS as spelled everywhere else**. Homebrew's dbus listens on launchd, so `dbus-run-session` dies with `DBUS_LAUNCHD_SESSION_BUS_SOCKET is empty`. A hand-started private bus does work:

```bash
dbus-daemon --session --nofork --address=unix:path=/tmp/devtools-bus.sock &
export DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/devtools-bus.sock
# …or hand dbus-run-session a config file whose <listen> is a plain socket:
dbus-run-session --config-file=session.conf -- <command>   # <listen>unix:tmpdir=/tmp</listen>
# a ready-made one lives at packages/node-gi/node-gi/test/session.conf (its `test:dbus` uses it)
```

Prefer the peer transport; the above is only for tooling that must have a bus NAME.

### Two macOS gotchas that are not about devtools

- **`DYLD_*` must be exported by the shell that `exec`s `gjs`.** SIP strips those variables through a `nohup`/`sh` wrapper, so a prebuild's sibling library silently fails to load.
- **Cold start can take a very long time.** Measured on a GPU-less QEMU VM: 94 s before the control plane answered its first call (1 s warm). Anything that waits on the app must **poll `GetStatus`**, never sleep a fixed time.

### Address forms

`unix:path=…` / `unix:tmpdir=…` (POSIX; `unix:tmpdir` is the auto-picked default — GDBus generates a unique socket name, so there is no stale-socket collision) and `nonce-tcp:host=127.0.0.1` (the portable form; GLib implements no unix-socket transport on win32). Both measured working under gjs 1.88.1.

Access control follows the address FAMILY, not the platform: a unix socket authenticates with `EXTERNAL` and the server requires the peer's uid to equal ours; TCP carries no peer credentials — that same flag rejects every client there — so the nonce file is the secret. On a shared machine that is measured, not asserted: GDBus creates the nonce file **mode 0600**, binds **127.0.0.1 only**, and a client that opens the port without sending the 16 nonce bytes gets no reply at all (the connection times out). The 0600 is spec-checked, so a GLib change or a wrong flag surfaces as a failing test rather than as an open control plane.

### One export per CONNECTION, and flags per address FAMILY

`DevtoolsService` keys its `Gio.DBusExportedObject`s **by connection**. A peer server hands out one connection per client and keeps no shared registry, so a single export slot served the FIRST client and left every later one seeing `UnknownMethod` for all 26 methods — the bug that made this per-connection.

The flag follows the address family, not the OS: `unix:` gets `AUTHENTICATION_REQUIRE_SAME_USER` (the `EXTERNAL` uid match above), and `nonce-tcp:` MUST get `NONE`. Measured on gjs 1.88.1, `REQUIRE_SAME_USER` rejects every TCP client with *"Unexpected lack of content when trying to read a line"*, because TCP carries no peer credentials — which is why the nonce file's 0600 is the secret there.

win32 is detected as `GLib.DIR_SEPARATOR === 92` — GLib's own introspected compile-time constant, so there is no `uname` probe and no extra dependency ([ADR 0018](../../../docs/adr/0018-os-axis-declaration.md)).

### The published address is a CLAIM, and the bridge VERIFIES it

The address file (`devtoolsAddressFilePath`) outranks the session bus, because it is positive evidence that an app of that id is listening NOW. Nothing makes it true, though: it is removed on `unexport()` and on `GApplication::shutdown`, and shutdown covers SIGTERM but **not** SIGINT or SIGKILL. Worse off Linux — on macOS and Windows `GLib.get_user_runtime_dir()` degrades to the user CACHE directory, where a leftover file survives REBOOTS.

So `connectToDevtools` dials, then falls back: a published address that does not answer (`G_IO_ERROR_NOT_FOUND`, measured) is DELETED and resolution continues down the precedence to the session bus, or to the diagnostic naming all three ways in — never a raw localised GIO error out of `runDevtoolsMcp`'s first statement.

An EXPLICIT `--address` / `GJSIFY_DEVTOOLS_ADDRESS` does **not** fall back. It is pinned on both sides, so a dead one has to be reported rather than routed around.

A peer call carries no destination bus name at all, so `nameHasOwner` / `listInstances` answer from the connection instead of from a daemon.

## Generic methods (out of the box)

| method | signature | what it does |
|---|---|---|
| `Screenshot` | `(scope: s) -> ay` | PNG bytes. `scope` `''`/`window` shoots the active window; a widget path shoots ONE widget. |
| `DumpTree` | `-> s` | the widget tree as JSON, with stable `toplevel:N/child:M` paths. |
| `GetProperty` | `(path, prop) -> s` | read one property off the widget at `path`. |
| `GetFocused` / `ListToplevels` | `-> s` | the focused widget's path; the toplevel list. |
| `FindWidget` | `(selector) -> s` | first VISIBLE+mapped match for `Type`, `:css-class` or `Type:css-class`, depth-first from the active window; `''` when none. |
| `SendKey` | `(accel, path) -> b` | deliver a key to a widget's key controllers; an empty path means the FOCUSED widget. |
| `ActivateWidget` | `(path) -> b` | click-drive: `gtk_widget_activate` for Button/Entry/Toggle, with a `GtkListBox` select-row / `row-activated` fallback for nav and preference rows. |
| `GetStatus` | `-> s` | liveness + whatever extensions contribute. |
| `ListActions` / `ActivateAction` / `ChangeActionState` | | the GAction bridge. |
| `ResizeWindow` / `PresentWindow` | | window control. |
| `DumpCss` / `SwapCss` | | live CSS hot-swap. |
| `DumpGSettings` | `-> s` | the app's GSettings. |

GActions are auto-bridged into the command registry (handling the `Adw.ApplicationWindow` non-export gotcha via `winActionGroup`).

Three of those need their reason stated, because the obvious use is the wrong one:

- **`FindWidget` exists because widget paths are POSITIONAL.** A `toplevel:0/child:3` written into a script is wrong the moment a widget is inserted above it, and every click-driving caller was re-walking `DumpTree` JSON in its own language to avoid that.
- **`SendKey` is the half of headless driving `ActivateWidget` does not cover.** Nothing could be TYPED, so every `Gtk.EventControllerKey` handler was unverifiable. It emits `key-pressed` on the widget's own controllers rather than fabricating a `Gdk.Event` — GTK4 made events opaque with no public constructor — so it proves the HANDLER, not GDK's routing. Pair it with `GetProperty(path, "focusable")`: an unfocusable widget swallows every real key silently.
- **`ActivateWidget` is the mutating counterpart of `GetProperty`.**

`opts.extend` adds app-specific methods (§ below); `opts.instance` / `GJSIFY_DEVTOOLS_INSTANCE` scope a multi-instance app.

### Calling one by hand

```bash
gdbus call --session --dest <app-id> --object-path <path>/devtools \
  --method org.gjsify.Devtools.Screenshot ""
```

That returns an `ay` variant. `gdbus` itself cannot save binary, so unpack it from a tiny GJS caller.

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

- `installDevtools(app, options)` → returns a `DevtoolsService`, or `null` when the env gate is off **or the transport could not come up**. It never throws: every failure is one stderr line naming the address and the way out. `uninstallDevtools(service)` — opt-in lifecycle; it stops the socket *and* retracts the published address.
- `DevtoolsService` — the exported service object `installDevtools` returns and `uninstallDevtools` accepts; `service.peerAddress` is the address clients dial in bus-less mode (`null` on a bus), `service.addressFile` is where that address is published (`null` when it is not).
- `DevtoolsExtension`, `InstallDevtoolsOptions` — the extension + options types.
- `startDevtoolsPeerServer(service, objectPath, address?)` → `DevtoolsPeerServer` — the bus-less transport by hand; it throws `DevtoolsPeerServerError` (with `address` + `reason`) when the address is unusable, which is what `installDevtools` catches. `chooseDevtoolsTransport(input)` — the precedence table above as a pure function; `writeDevtoolsAddressFile` / `removeDevtoolsAddressFile` — publish/retract a peer address.
- `captureWidgetPng` (GSK screenshot), `buildVariant` / `variantKindFor` / `VariantKind` (GVariant), `activateAction` / `changeActionState` / `describeActions` (GAction bridge).
- widget-tree helpers (`dumpTree`, `getWidgetProperty`, `listToplevels`, `resolveWidgetPath`, …), `dumpCss` / `swapCss` / `removeCss`, `dumpGSettings`, `buildDevtoolsIfaceXml`.
- the re-exported `@gjsify/devtools-protocol` contract.

> **GJS gotcha:** the long-lived `Gio.DBusExportedObject` is reachable only through a self-cycle, which SpiderMonkey's GC can collect mid-run. `installDevtools` roots the service in a module-level set to defeat this — keep that rooting if you wire the service by hand.

## Build / test

```bash
gjsify workspace @gjsify/devtools build
gjsify workspace @gjsify/devtools test
```
