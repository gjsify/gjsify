# @gjsify/example-dom-adwaita-storybook-nativescript

The full **Adwaita storybook** as a real **NativeScript-Android** app — the same
component browser as the native **GTK** (`@gjsify/storybook`) and **browser**
(`@gjsify/adwaita-storybook`) targets, rendered with **real native**
`@gjsify/adwaita-nativescript` widgets (NOT a webview) via
`@gjsify/storybook-nativescript`.

All three targets share the renderer-agnostic `*.meta.ts` metadata: this app
imports it from the GTK showcase's `@gjsify/example-gtk-adwaita-storybook/metas`
barrel, so every story exposes identical controls and the three targets can be
compared **1:1** by screenshot.

## Layout

```
app/
  app.ts              entry — Application.run({ moduleName: 'app-root' })
  app-root.xml        <Frame defaultPage="storybook-page" />
  storybook-page.*    builds runStorybook(...) + installs the devtools agent
  app.css             @nativescript/theme + adwaita.css + storybook.css + fonts
  adwaita.css         widget theme (copied from @gjsify/adwaita-nativescript)
  storybook.css       storybook chrome (copied from @gjsify/storybook-nativescript)
  fonts/              Adwaita Sans TTFs
src/
  <category>/<name>.ns.ts   one native story per *.meta.ts (StoryView subclass)
  stories.ts                aggregated NsStoryModule[] (category order)
```

## Run on an Android emulator

The `@gjsify/*` deps are resolved from the **hoisted workspace** `node_modules`
(caret ranges), so the NativeScript CLI must NOT run its own `npm install` —
every script passes `--disable-npm-install`:

```bash
emulator -avd Medium_Phone_API_36 -gpu host   # boot a device first
cd showcases/dom/adwaita-storybook-nativescript
npm run run:android        # or: npm run debug:android  (serves the V8 CDP inspector)
```

## MCP / devtools

`storybook-page.ts` installs the in-app devtools agent + the storybook control
surface (`installStorybookDevtools`), so an MCP agent attached over the V8 CDP
inspector (`nativescript debug android`) can `ListStories` / `OpenStory` /
`SetStoryArg`, `DumpTree` the native Adwaita view tree, and `Screenshot` it — the
same control plane as the GTK (`@gjsify/devtools`) and browser targets.

> This showcase is a NativeScript project (it owns `App_Resources/`,
> `nativescript.config.ts`); it is a workspace member only for dependency
> hoisting and declares no `build`/`check`/`test` scripts, so `gjsify foreach`
> skips it (built/run via the NativeScript CLI).
