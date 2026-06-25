# @gjsify/example-dom-adwaita-widgets-nativescript

Native **Adwaita widgets on NativeScript-Android** — a real NativeScript app that
renders Libadwaita-styled components as **real native views** (no webview), and is
**MCP-drivable** by an LLM agent over the V8 CDP inspector.

It is the de-risking spike for bringing GNOME/Adwaita apps to Android (and later
iOS) via NativeScript, the true-native path:

- **`@gjsify/adwaita-nativescript`** — `AdwPreferencesGroup` / `AdwActionRow` /
  `AdwSwitchRow` built on native NS `StackLayout` / `GridLayout` / `Switch` /
  `Label`, styled with the Adwaita CSS theme + Adwaita Sans font. The agent's
  introspection sees the actual Adwaita widget tree (`AdwSwitchRow`), not a DOM.
- **`@gjsify/devtools-nativescript`** — an in-app agent (`globalThis.__adwDevtools`)
  reusing the transport-agnostic `@gjsify/devtools-protocol` method registry; the
  host-side `@gjsify/devtools-mcp` `nativescriptProfile` reaches it over the V8
  CDP inspector (`Runtime.evaluate`) to `dump_tree` / `screenshot` / `get_property`.

The widget tree is built **programmatically** in `app/home/home-page.ts` (the spike
validates native rendering + native-tree introspection without the XML
`registerElement` path).

## Version line

Targets the **`@nativescript/vite` 8.x** line (Vite 8 / Rolldown / HMR) with the
NS **9.1.0-alpha** runtime — `@gjsify/nativescript-vite` auto-detects the major and
skips its Vite-8 compatibility patches (upstream handles Vite 8 / Rolldown
natively on 8.x). Falls back cleanly to the 9.0.x / `@nativescript/vite@2` line.

## Run

```bash
# Boot an Android emulator / connect a device first, then:
nativescript run android            # build + deploy + run (Vite 8 / Rolldown)
nativescript debug android          # same + serve the V8 CDP inspector for the MCP agent
```

## Drive it with an agent

With `nativescript debug android` running (the in-app devtools agent is
force-enabled in `app/app.ts`), point the gjsify MCP bridge at the inspector:

```bash
gjsify debug --profile nativescript   # bridges the V8 inspector → MCP tools
# agent tools: get_status · list_toplevels · dump_tree · get_property · screenshot
```
