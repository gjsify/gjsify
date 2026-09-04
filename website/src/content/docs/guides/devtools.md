---
title: Devtools & MCP
description: Inspect, screenshot and drive a running GJSify app by hand with gdbus, from an AI agent over MCP, or headless in CI. Works for GTK apps and for web apps in the bundled Adwaita browser.
---

Add one call to your app and it exposes a stable `org.gjsify.Devtools` control plane. From
there you can take a screenshot, dump the widget tree, activate an action, swap in new CSS,
and read the app's state, from three places:

- **A shell**, with `gdbus`, d-feet or GNOME Builder. No AI, no dev server.
- **An AI agent** (Claude Code, the MCP Inspector) over MCP, via `gjsify debug`.
- **CI**, where the same calls make an end-to-end UI test harness with no agent involved.

It works for GTK apps and, through the bundled Adwaita web browser, for web apps you build
with GJSify.

## 1. Turn it on

```bash
gjsify install @gjsify/devtools
```

Call `installDevtools` from your application's `startup` handler. The bus connection and
object path only exist after the application has registered, which is what `startup`
guarantees.

```ts
import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { installDevtools } from '@gjsify/devtools';

export class MyApplication extends Adw.Application {
    static { GObject.registerClass(MyApplication); }

    vfunc_startup(): void {
        super.vfunc_startup();
        // register your actions and create the main window first

        installDevtools(this, {
            // Adw.ApplicationWindow does not expose its win.* actions as a group,
            // so pass it explicitly if you want win.* commands bridged.
            winActionGroup: this._window,
        });
    }
}
```

It does nothing unless `GJSIFY_DEVTOOLS` is set, so leave it in your release build. Run with
the gate on:

```bash
GJSIFY_DEVTOOLS=1 gjsify run dist/app.gjs.mjs                  # an --app gjs bundle, on gjs
GJSIFY_DEVTOOLS=1 gjsify run --runtime node dist/app.node.mjs  # an --app node bundle
```

Bun and Deno take that second bundle too, and the whole control plane is identical on all
four; [step 7](#7-gjs-nodejs-bun-and-deno) has the detail.

`installDevtools` never throws. If it cannot come up it prints why on stderr and returns
`null`, so a devtools problem can never cost you your window.

If you use [`@gjsify/adwaita-app`](/gjsify/guides/native-adwaita-app/), this is already wired: pass
`devtools: true` to force it on, or leave the option out and keep the env gate.

The same is true of [`@gjsify/react-native`](/gjsify/frameworks/react-native/), where there is no
`startup` handler to call anything from: `registerRootComponent(App)` is the whole bootstrap, and
it brings devtools with it. Set `GJSIFY_DEVTOOLS=1`, or force it on where you register:

```tsx
import { registerRootComponent, Text } from '@gjsify/react-native';

const App = () => <Text>Hello</Text>;

await registerRootComponent(App, {
    applicationId: 'org.example.MyApp',
    title: 'My App',
    devtools: true,
});
```

Everything in the rest of this page — `DumpTree`, `Screenshot`, `ActivateWidget` — then works
against the rendered widget tree, not just against the application object.

### Options

| Option | What it does |
|---|---|
| `enabled` | `true` force-enables regardless of `GJSIFY_DEVTOOLS`. |
| `winActionGroup` | The action group to bridge as `win.*`. Needed for `Adw.ApplicationWindow`. |
| `instance` | A label, so several copies of the app can be driven side by side. Defaults to `GJSIFY_DEVTOOLS_INSTANCE`. |
| `address` | A D-Bus address to listen on instead of the session bus. Defaults to `GJSIFY_DEVTOOLS_ADDRESS`. |
| `paused` | A predicate; while it returns `true`, mutating calls are rejected. |
| `extend` | Your own app-specific methods (see [Add your own commands](#add-your-own-commands)). |

## 2. Drive it from a shell

The control plane is plain D-Bus, so you can poke it without any tooling:

```bash
# A JSON snapshot: app id, active window, toplevel count, focused widget,
# pause state, plus anything an extension contributes
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.GetStatus

# The active window as PNG bytes (a GVariant `ay`; gdbus prints it as text, so
# use the MCP `screenshot` tool when you want a file on disk)
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.Screenshot 'window'

# List GActions, then invoke one
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.ListActions
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.ActivateAction 'app' 'about' ''
```

The object path is your application id with dots turned into slashes, plus `/devtools`. A
hyphen is not legal in a D-Bus path element, so it becomes an underscore on the way:
`org.example.my-app` is served at `/org/example/my_app/devtools`.

This is also how you write a headless UI test: script a sequence of `ActivateAction`,
`ChangeActionState` and `Screenshot` calls, then assert on `GetStatus`.

## 3. Drive it from an AI agent

`gjsify debug` builds and launches the MCP bridge. Point your MCP client at it with a
`.mcp.json` at the project root:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "my-app": { "command": "gjsify", "args": ["debug", "--bus-name", "org.example.App"] }
  }
}
```

The typical loop:

> launch the app with `GJSIFY_DEVTOOLS=1`, `get_status` to see where it is, `screenshot` to
> see it, `activate_action` or `activate_widget` to drive it, `screenshot` again to confirm.

To stop the client rebuilding on every launch, build once and point at the bundle:

```bash
gjsify debug --build-only --out dist/bridge.gjs.mjs
# .mcp.json → { "mcpServers": { "my-app": { "command": "dist/bridge.gjs.mjs" } } }
```

The bridge picks a tool profile from your `package.json` dependencies (`storybook`,
`browser`, `cdp` or `generic`), or you can force one with `--profile`.

### The generic tools

Available in every profile. All of them take an optional `instance` argument when you are
running more than one copy of the app.

| Tool | What it does |
|---|---|
| `get_status` | App id, active window, toplevel count, focused widget, pause state. |
| `screenshot` | PNG of the active window or the whole app. |
| `list_actions` / `activate_action` / `change_action_state` | Enumerate and drive GActions. |
| `present_window` / `resize_window` | Bring the window forward; resize it for layout testing. |
| `list_toplevels` | Every toplevel window the app owns. |
| `dump_tree` | The widget tree from a root down to a depth, with concrete GTypes. |
| `get_property` / `get_focused` | Read one widget property; find what has focus. |
| `activate_widget` | Click or activate a widget by its path. |
| `dump_css` / `swap_css` | Read the loaded CSS; replace a named provider live. |
| `dump_gsettings` | Every key in a GSettings schema. |
| `list_instances` | The labelled app instances currently on the bus. |

## 4. On macOS and Windows, where there is no session bus

Nothing extra to do. When no session bus answers, the app listens on a socket of its own and
publishes the address to a file; `gjsify debug` reads that file and dials it. The app prints
the address on stderr so you can see what happened.

To pin the address yourself, set the same value on both sides:

```bash
GJSIFY_DEVTOOLS=1 GJSIFY_DEVTOOLS_ADDRESS=unix:path=/tmp/myapp.sock gjsify run dist/index.js
gjsify debug --address unix:path=/tmp/myapp.sock
```

`--address` also accepts `unix:tmpdir=/tmp` and `nonce-tcp:host=127.0.0.1`.

## 5. Debug a web app with `gjsify browse`

The bundled Adwaita browser renders your web app and exposes the same control plane, so an
agent can drive the page itself. Launch it with `--devtools`:

```bash
gjsify browse http://localhost:8080 --devtools
```

Then bridge it with the browser profile:

```jsonc
{ "mcpServers": { "browser": { "command": "gjsify", "args": ["debug", "--profile", "browser"] } } }
```

On top of the generic tools you get:

| Tool | What it does |
|---|---|
| `navigate` / `back` / `forward` / `reload` | Drive history; keeps the URL bar in sync. |
| `get_page_info` | Current page state: uri, appUrl, title, canGoBack, canGoForward, lastLoadError. |
| `wait_for_load` | Wait for the next navigation to finish (ms, default 30000). |
| `page_screenshot` | PNG of the rendered web content through the WebKit compositor. Use this one, not the generic `screenshot`, which comes back blank because WebKit composites out of process. `region=full\|visible`. |
| `set_viewport` | Resize the content region for responsive testing. |
| `eval_js` | Evaluate a JS expression in the page; result comes back as JSON. |
| `get_links` / `follow_link` | Enumerate `<a href>`; click one and await the navigation. |
| `query_dom` | Metadata for every element matching a CSS selector. |
| `get_console` | Buffered `console.*` output captured from the page. |
| `inspect_element` | Tag, id, classes, attributes, bounding rect, box model and curated computed styles in one call. |
| `dom_tree` | The elements tree from a selector down to a depth. |
| `get_network` | Page network activity via the Resource Timing API. |
| `get_accessibility` | An approximate accessibility tree (role, name, `aria-*`). |
| `open_inspector` / `close_inspector` | Toggle the WebKit Web Inspector panel. |
| `list_stories` / `open_story` / `get_current_story` / `set_story_arg` | Drive a running `@gjsify/adwaita-storybook` page the same way as the native storybook. |

Two shortcuts worth knowing:

```bash
# One-shot capture, no window to close: load, screenshot, exit.
gjsify browse http://localhost:8080 --screenshot shot.png

# WebKit's remote inspector protocol on a port, plus the cdp profile's
# cdp_discover_targets / cdp_connect / cdp_send / cdp_drain_events tools.
gjsify browse http://localhost:8080 --inspector-port 9222
```

## 6. Debug the storybook

[`gjsify storybook`](/gjsify/guides/storybook/) speaks the same plane. Run it with `GJSIFY_DEVTOOLS=1`
and bridge with `--profile storybook`; you get `list_stories`, `get_current_story`,
`open_story` and `set_story_arg`, so an agent can open a widget in isolation, flip its args
and `screenshot` each variant.

## 7. GJS, Node.js, Bun and Deno

The control plane belongs to your app, not to a runtime. One `installDevtools(app, …)`
call, one interface, the same MCP profiles, on all four. The layer underneath is what
differs: on `gjs` your `--app gjs` bundle resolves `gi://` in the host itself, while Node,
Bun and Deno run the same `--app node` bundle with `gi://` going through
[`@gjsify/node-gi`](/gjsify/projects/node-gi/).

```bash
GJSIFY_DEVTOOLS=1 gjsify run                dist/app.gjs.mjs
GJSIFY_DEVTOOLS=1 gjsify run --runtime node dist/app.node.mjs
GJSIFY_DEVTOOLS=1 gjsify run --runtime bun  dist/app.node.mjs
GJSIFY_DEVTOOLS=1 gjsify run --runtime deno dist/app.node.mjs
```

`GetStatus`, `DumpTree`, `ListToplevels` and the async `Screenshot` produce the same results
across the four, real PNGs included, and `DumpTree` reports the same concrete runtime GTypes
whichever bundle is loaded.

## Pausing external control

Every method is classified, so a host can stop an agent driving the UI without going dark:

- **read-only** (`get_status`, `screenshot`, `dump_tree`, `inspect_element`, …) is always
  allowed.
- **presence** covers an external driver's own awareness channel, such as a cursor or label,
  and is allowed.
- **mutating** (`activate_action`, `change_action_state`, `eval_js`, `navigate`, `swap_css`,
  …) is rejected while paused.

Pass a `paused: () => boolean` predicate to `installDevtools` to control it.

## Add your own commands

A `DevtoolsExtension` adds app-specific methods to the same interface, so an agent drives
them through the same bridge:

```ts
installDevtools(this, {
    extend: [{
        methodsXml: ['<method name="PaintTile"><arg type="i" direction="in" name="x"/></method>'],
        handlers: { PaintTile: (x: number) => paintTile(x) },
        methodKinds: { PaintTile: 'mutating' },
        contributeStatus: () => ({ tiles: countTiles() }),
    }],
});
```

Every method needs a `methodKinds` entry. The registry rejects an unclassified method, so a
new command cannot slip past the pause policy by accident. Anything you return from
`contributeStatus` shows up in `get_status`.

## See also

- [CLI reference → `gjsify debug`](../../cli-reference/#gjsify-debug),
  [`gjsify browse`](../../cli-reference/#gjsify-browse),
  [`gjsify storybook`](../../cli-reference/#gjsify-storybook)
- Package READMEs:
  [devtools](https://www.npmjs.com/package/@gjsify/devtools) ·
  [devtools-protocol](https://www.npmjs.com/package/@gjsify/devtools-protocol) ·
  [devtools-mcp](https://www.npmjs.com/package/@gjsify/devtools-mcp) ·
  [devtools-browser](https://www.npmjs.com/package/@gjsify/devtools-browser) ·
  [devtools-cdp](https://www.npmjs.com/package/@gjsify/devtools-cdp)
