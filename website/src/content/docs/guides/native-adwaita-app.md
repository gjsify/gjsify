---
title: Native Adwaita Apps
description: Assemble a native GNOME/Adwaita GJS app from the reusable shell in @gjsify/adwaita-app — runAsync lifecycle, a NavigationSplitView nav shell, async view mounting, and dialog/toast/file helpers
---

Every native Adwaita app on GJSify repeats the same shell: an `Adw.Application`
run with `runAsync`, a startup CSS bootstrap, the [devtools](./devtools/) control
plane, standard quit/about actions, an `Adw.NavigationSplitView` with a sidebar
and a content stack, and a way to mount views that may load asynchronously.

[`@gjsify/adwaita-app`](https://www.npmjs.com/package/@gjsify/adwaita-app) is that
shell, extracted. It is **composition-first** — opt-in wiring for the boilerplate,
never a wrapper that hides `Adw`/`Gtk`. You still write your views as plain
`Gtk.Widget`s. (See [ADR 0009](https://github.com/gjsify/gjsify/blob/main/docs/adr/0009-native-adwaita-app-shell.md)
for the rationale; it generalizes the shell proven in [`gjsify storybook`](../../cli-reference/#gjsify-storybook).)

## Install

```bash
gjsify install @gjsify/adwaita-app
```

## 1. A minimal app

`runAdwaitaApp` builds an `Adw.Application`, wires the standard actions, installs
devtools (env-gated), and runs it with **`runAsync()`** — not sync `run()`, under
which a synchronous view load hangs its spinner because GJS does not flush the
promise-job queue.

```ts
import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';

class MainWindow extends Adw.ApplicationWindow {
    static { GObject.registerClass({ GTypeName: 'MyMainWindow' }, MainWindow); }
    constructor(app: Adw.Application) {
        super({ application: app, defaultWidth: 900, defaultHeight: 640 });
        // … build content …
    }
}

await runAdwaitaApp({
    applicationId: 'org.example.App',
    createWindow: (app) => new MainWindow(app),
    css: '/* optional app CSS, applied display-wide on startup */',
    about: { applicationName: 'My App', version: '1.0.0', developerName: 'Me' },
    // devtools omitted → gated on GJSIFY_DEVTOOLS (safe in production).
});
```

`AdwaitaAppOptions`: `applicationId`, `createWindow`, and optional `flags`, `css`,
`about` (an `AboutInfo`), `quitAction` (default on — `<primary>q`), `devtools`
(`true` | `InstallDevtoolsOptions` | omitted), `onStartup`.

## 2. The navigation shell

`createNavShell(window, options)` builds the `Adw.NavigationSplitView` — a sidebar
`Gtk.ListBox` (`.navigation-sidebar`) plus a content `Gtk.Stack` — from a
data-driven `NavItem[]`, and adds the responsive `Adw.Breakpoint` (default
`max-width: 720px`) to `window`. Fill the returned `stack` with your view widgets.

```ts
import { createNavShell, type NavItem } from '@gjsify/adwaita-app';

const NAV: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: 'go-home-symbolic' },
    { id: 'reports', label: 'Reports', icon: 'x-office-spreadsheet-symbolic', subtitle: 'Monthly' },
];

const shell = createNavShell(this, {
    items: NAV,
    sidebarTitle: 'My App',
    onSelect: (item) => shell.stack.set_visible_child_name(item.id),
});
shell.stack.add_named(buildOverview(), 'overview');
shell.stack.add_named(buildReports(), 'reports');
this.set_content(shell.widget);
shell.selectById('overview');
```

`NavShell` exposes `{ widget, stack, contentHeader, selectById, selectByIndex }`.
Selecting a row on a collapsed shell reveals the content pane automatically.

## 3. Mounting views that load asynchronously

A view backed by an async source should show a spinner while loading, drop a
result a newer reload superseded, and show an error page on failure.
`loadIntoStack` + `LoadToken` capture that once — point them at a `Gtk.Stack` with
`loading` / `content` / `error` children:

```ts
import { LoadToken, loadIntoStack } from '@gjsify/adwaita-app';

const token = new LoadToken();

function reload(): void {
    loadIntoStack({
        stack,
        token,
        load: () => fetchReport(currentYear), // sync or async
        fill: (data) => renderReport(data),
        onError: (err) => console.error(err),
    });
}
```

Each call takes a fresh ticket; a slow load whose ticket is no longer current is
silently dropped, so rapid re-selects never render stale data.

## 4. Dialogs, toasts, files

Promise-based wrappers over the response-signal Adwaita widgets:

```ts
import { confirmDialog, errorDialog, registerToastOverlay, showToast, pickFile } from '@gjsify/adwaita-app';

if (await confirmDialog(window, { heading: 'Delete?', destructive: true })) { /* … */ }
await errorDialog(window, 'Import failed', String(err));

registerToastOverlay(myToastOverlay);       // once, at window build
showToast('Saved.');                         // anywhere afterwards

const path = await pickFile(window, { title: 'Open project', filters: [{ name: 'JSON', patterns: ['*.json'] }] });
```

## 5. Dev hooks

`readAppDevHooks({ prefix })` reads the `${PREFIX}_VIEW` / `${PREFIX}_FILE` /
`${PREFIX}_DEBUG` env pattern, so `MYAPP_VIEW=reports myapp` opens straight to a
view during development:

```ts
import { readAppDevHooks, resolveInitialNavIndex } from '@gjsify/adwaita-app';

const hooks = readAppDevHooks({ prefix: 'MYAPP' });
shell.selectByIndex(resolveInitialNavIndex(NAV, hooks.view));
if (hooks.file) store.load(hooks.file);
```

## See also

- [Devtools & MCP](./devtools/) — the `org.gjsify.Devtools` control
  plane `runAdwaitaApp` wires in on startup.
- [`gjsify storybook`](../../cli-reference/#gjsify-storybook) — the component
  browser this shell was generalized from.
