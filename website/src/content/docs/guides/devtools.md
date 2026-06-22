---
title: Debugging & remote control (DBus + MCP)
description: Inspect, screenshot and drive a running gjsify app — by hand with gdbus or from an AI agent over MCP — for GTK and web apps alike
---

gjsify ships a **devtools control plane**: opt your app in with one call and it exposes a stable `org.gjsify.Devtools` interface you can drive three ways —

- **By hand** with `gdbus` / d-feet / GNOME Builder — no AI, no dev server.
- **From an AI agent** (Claude Code, the MCP Inspector, …) over **MCP**, via `gjsify debug`.
- **Headless in CI** — the same calls make a no-AI end-to-end UI test harness.

It works for **GTK apps** (DBus is the idiomatic GNOME transport) and, through the bundled Adwaita web browser, for **web apps you build with gjsify** too. The contract — *commands + state + introspection* — is the same across both.

## The packages

| Package | Role |
|---|---|
| [`@gjsify/devtools-protocol`](https://www.npmjs.com/package/@gjsify/devtools-protocol) | The transport-agnostic contract (pure TS): methods, pause classification, envelope, interface name. |
| [`@gjsify/devtools`](https://www.npmjs.com/package/@gjsify/devtools) | The in-app **DBus** adapter for GTK/GJS. `installDevtools(app, …)`. |
| [`@gjsify/devtools-mcp`](https://www.npmjs.com/package/@gjsify/devtools-mcp) | The **MCP bridge** an agent talks to. Powers `gjsify debug`. |
| [`@gjsify/devtools-browser`](https://www.npmjs.com/package/@gjsify/devtools-browser) | The minimalist Adwaita **web browser** for debugging gjsify web apps. Powers `gjsify browse`. |

Two CLI commands tie it together: [`gjsify debug`](../../cli-reference/#gjsify-debug) (the MCP bridge) and [`gjsify browse`](../../cli-reference/#gjsify-browse) (the web browser). The GTK [`gjsify storybook`](../../cli-reference/#gjsify-storybook) is debuggable through the same plane.

## 1. Enable devtools in your app

Add the dependency and call `installDevtools` from startup. It is a **no-op unless `GJSIFY_DEVTOOLS=1`** (or you pass `enabled: true`), so it is safe to leave in release builds.

```ts
import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { installDevtools } from '@gjsify/devtools';

export class MyApplication extends Adw.Application {
    static { GObject.registerClass(MyApplication); }

    vfunc_startup(): void {
        super.vfunc_startup();
        // … register actions + create the main window first …

        installDevtools(this, {
            // Adw.ApplicationWindow does not expose its win.* actions as a group —
            // pass it explicitly so win.* commands are bridged.
            winActionGroup: this._window,
        });
    }
}
```

Run it with the gate on:

```bash
GJSIFY_DEVTOOLS=1 gjsify run dist/index.js
```

## 2. Drive it by hand (gdbus — no AI)

The control plane is plain DBus, so you can poke it from a shell:

```bash
# A JSON snapshot: app id, active window, toplevel count, focused widget,
# pause state (+ any keys an extension contributes via contributeStatus)
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.GetStatus

# The active window as PNG bytes (returned as a GVariant `ay`; gdbus prints
# them as text — use the MCP `screenshot` tool for a ready-to-save PNG file)
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.Screenshot 'window'

# List GActions, then invoke one
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.ListActions
gdbus call --session -d org.example.App -o /org/example/App/devtools \
  -m org.gjsify.Devtools.ActivateAction 'app' 'about' ''
```

This is also the basis for **headless UI tests**: script a sequence of `ActivateAction` / `ChangeActionState` / `Screenshot` calls and assert on `GetStatus` — no agent required.

## 3. Drive it from an AI agent (MCP)

`gjsify debug` builds and launches the MCP bridge. Point your MCP client at it with a `.mcp.json` at the project root:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "my-app": { "command": "gjsify", "args": ["debug", "--bus-name", "org.example.App"] }
  }
}
```

Now an agent has tools like `get_status`, `screenshot`, `list_actions`, `activate_action`, `change_action_state`, `resize_window`, plus introspection (`dump_tree`, `get_property`). The typical loop:

> launch the app with `GJSIFY_DEVTOOLS=1` → `get_status` to see where it is → `screenshot` to see it → `activate_action` / `change_action_state` to drive it → `screenshot` again to confirm.

For a fixed binary path (so the client doesn't rebuild on every launch), build once and point at the bundle:

```bash
gjsify debug --build-only --out dist/bridge.gjs.mjs
# .mcp.json → { "mcpServers": { "my-app": { "command": "dist/bridge.gjs.mjs" } } }
```

The bridge auto-detects a **tool profile** from your `package.json` dependencies — `storybook`, `browser`, or `generic` — or you can force one with `--profile`.

## 4. Debug web apps — `gjsify browse`

Because the apps you debug are **themselves built with gjsify**, you can render them in the bundled Adwaita web browser and drive *its* devtools plane. Launch with `--devtools`:

```bash
gjsify browse https://localhost:8080 --devtools
```

Then bridge it with the **browser profile**:

```jsonc
{ "mcpServers": { "browser": { "command": "gjsify", "args": ["debug", "--profile", "browser"] } } }
```

The browser profile adds web-debugging tools on top of the generics:

| Tool | What it does |
|---|---|
| `navigate` / `back` / `forward` / `reload` | Drive history; keeps the URL bar in sync. |
| `get_page_info` | Current page state: uri, appUrl, title, canGoBack, canGoForward, lastLoadError. |
| `wait_for_load` | Wait for the next navigation to finish (ms; default 30000). |
| `page_screenshot` | PNG of the rendered **web content** via the WebKit compositor (the generic `screenshot` is blank — WebKit composites out-of-process). `region=full\|visible`. |
| `set_viewport` | Resize the content region for responsive testing. |
| `eval_js` | Evaluate a JS expression in the page; JSON round-trip. |
| `get_links` / `follow_link` | Enumerate `<a href>`; click + await the navigation. |
| `query_dom` | Metadata for elements matching a CSS selector. |
| `get_console` | Buffered `console.*` output captured from the page. |
| `inspect_element` | Tag/id/class + attributes + bounding rect + box model + curated computed styles (Elements + Computed + Box Model in one call). |
| `dom_tree` | The Elements tree from a selector down to a depth. |
| `get_network` | Page network activity via the Resource Timing API. |
| `get_accessibility` | An approximate accessibility tree (role + name + aria-*). |
| `open_inspector` / `close_inspector` | Toggle the WebKit Web Inspector panel. |

This is purpose-built for the gjsify web-app workflow: a developer (or an agent) opens the app, screenshots the real rendered output, evaluates assertions in-page, and inspects layout/network/a11y — without a separate browser-automation stack.

## 5. Storybook

[`gjsify storybook`](../../cli-reference/#gjsify-storybook) is debuggable the same way. Run it with `GJSIFY_DEVTOOLS=1` and bridge with `--profile storybook`; the agent gets `list_stories`, `get_current_story`, `open_story`, and `set_story_arg` — drive a component in isolation, flip its args, and `screenshot` (the generic tool) each variant.

## The pause policy (read-only vs mutating)

Every method is classified so a host can **pause external control** without going dark:

- `read-only` (`get_status`, `screenshot`, `dump_tree`, `inspect_element`, …) — always allowed.
- `presence` — an external driver's own awareness channel (cursor/label) — allowed.
- `mutating` (`activate_action`, `change_action_state`, `eval_js`, `navigate`, `swap_css`, …) — rejected while paused.

The registry **rejects an unclassified method**, so a new app-specific method can't silently bypass the policy. Add your own methods with a `DevtoolsExtension` (see the [`@gjsify/devtools` README](https://www.npmjs.com/package/@gjsify/devtools)).

## See also

- [CLI reference → `gjsify debug`](../../cli-reference/#gjsify-debug), [`gjsify browse`](../../cli-reference/#gjsify-browse), [`gjsify storybook`](../../cli-reference/#gjsify-storybook)
- Package READMEs: [devtools](https://www.npmjs.com/package/@gjsify/devtools) · [devtools-protocol](https://www.npmjs.com/package/@gjsify/devtools-protocol) · [devtools-mcp](https://www.npmjs.com/package/@gjsify/devtools-mcp) · [devtools-browser](https://www.npmjs.com/package/@gjsify/devtools-browser)
