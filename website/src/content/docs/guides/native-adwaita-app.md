---
title: Native Adwaita Apps
description: Build a GNOME/Adwaita app with @gjsify/adwaita-app, on GJS or on Node, Bun and Deno. Application shell, sidebar split view, async view loading, and promise-based dialogs, toasts and file pickers.
---

Every native GNOME app starts with the same code: an `Adw.Application`, a CSS bootstrap,
quit and about actions, a sidebar, a content stack.
[`@gjsify/adwaita-app`](https://www.npmjs.com/package/@gjsify/adwaita-app) hands you those
pieces so you can skip straight to your views.

Nothing here hides `Adw` or `Gtk`. Your views are plain `Gtk.Widget`s, the shell returns
real Adwaita objects, and you can drop any helper you don't want.

## Install

```bash
gjsify install @gjsify/adwaita-app
```

## Which runtime

The package is written against `gi://` and `@girs/*`, so one source builds for either
target and you pick by the runtime you already have:

```bash
gjsify build src/main.ts --app gjs  --outfile dist/app.gjs.mjs   # for gjs
gjsify build src/main.ts --app node --outfile dist/app.node.mjs  # for node, bun and deno

gjsify run dist/app.gjs.mjs
gjsify run --runtime node dist/app.node.mjs   # or --runtime bun / --runtime deno
```

With no `--app` the CLI targets whatever runtime is executing it, so a bare `gjsify build`
follows your install. What actually differs is one layer: on `gjs` the `Adw` and `Gtk`
namespaces resolve in the host itself, with nothing in between, and `gjs` exists on Linux
but not on Windows. Node, Bun and Deno share a single `--app node` bundle (Node-API is
their common ABI) and reach `gi://` through
[`@gjsify/node-gi`](/gjsify/projects/node-gi/), which is the route that also covers macOS
and Windows.

The shell's own suites (the nav model, `LoadToken`, the dialog model) are built and run
twice, `--app gjs` on `gjs` and `--app node` on Node. Bun and Deno load that same
`--app node` bundle but are not exercised for this package yet, so take them as untested
here rather than promised. Its widget modules need a display, so what CI proves there is GTK and
Adwaita under node-gi generally: an unchanged `Adw.Application` on Linux, and the full
Adwaita storybook gallery on Linux and Windows.

## Show a window

`runAdwaitaApp` builds the application, wires the standard actions, and runs it. Give it an
application id and a function that builds your main window.

```ts
import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { runAdwaitaApp } from '@gjsify/adwaita-app';

class MainWindow extends Adw.ApplicationWindow {
    constructor(app: Adw.Application) {
        super({ application: app, defaultWidth: 900, defaultHeight: 640 });
        // build your content here
    }

    static { GObject.registerClass({ GTypeName: 'MyMainWindow' }, this); }
}

await runAdwaitaApp({
    applicationId: 'org.example.App',
    createWindow: (app) => new MainWindow(app),
    css: '/* optional app CSS, applied display-wide on startup */',
    about: { applicationName: 'My App', version: '1.0.0', developerName: 'Me' },
});
```

`createWindow` runs once, on the first `activate`. After that the same window is presented
again, so starting the app a second time brings the running one to the front instead of
opening a duplicate. When that happens you get a line on stderr saying so, which saves you
from reading a silent exit code 0 as a crash.

### Options

| Option | Default | What it does |
|---|---|---|
| `applicationId` | required | GApplication id, e.g. `org.example.App`. |
| `createWindow` | required | `(app) => Gtk.Window`, called once on first activate. |
| `flags` | `Gio.ApplicationFlags.DEFAULT_FLAGS` | GApplication flags. |
| `css` | none | CSS string applied display-wide on startup. |
| `about` | none | Fields for an `Adw.AboutDialog`; wires an `app.about` action. |
| `quitAction` | `true` | Wire `app.quit` on `<primary>q`. |
| `devtools` | env-gated | `true` force-enables, an object passes [devtools options](/gjsify/guides/devtools/) through, `false` turns it off. Left out, it stays gated on `GJSIFY_DEVTOOLS`, which is safe in a release build. |
| `onStartup` | none | `(app) => void`, runs on startup after CSS and devtools are wired. |

### If you run your own Adw.Application

Use `runAsync()`, not `run()`. Under sync `run()` a view that awaits anything never
finishes loading, so its spinner keeps spinning. `runApplication(app, argv)` is exported for
exactly this: it runs any `Gio.Application` on `runAsync` and adds the second-instance
notice.

```ts
import { runApplication } from '@gjsify/adwaita-app';
import system from 'system';

await runApplication(myApp, [system.programInvocationName, ...system.programArgs]);
```

`system` is a bare built-in module, not a GJS-only import: `@gjsify/node-gi` carries it
across, so that line resolves in an `--app node` bundle too.

## Add a sidebar and views

`createNavShell(window, options)` builds an `Adw.NavigationSplitView` with a sidebar
`Gtk.ListBox` and a content `Gtk.Stack`, from a plain array of nav items. It also adds the
responsive breakpoint to your window, so the split view collapses on narrow screens.

Call it from your `Adw.ApplicationWindow` subclass, fill the returned `stack`, and set the
returned `widget` as the window content.

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

You get back `{ widget, stack, contentHeader, selectById, selectByIndex }`. `contentHeader`
is the content pane's `Adw.HeaderBar`, so pack your own buttons into it. Selecting a row
while the shell is collapsed reveals the content pane for you.

Two more options are worth knowing: `sidebarHeaderStart` / `sidebarHeaderEnd` take a widget
to pack into the sidebar header (an open button, a menu button), and `collapseWidth` moves
the breakpoint away from its 720px default.

## Load a view asynchronously

A view backed by an async source needs three states: a spinner while it loads, the content
when it arrives, an error page when it doesn't. `LoadingStack` is a `Gtk.Stack` that already
has those three pages, named `loading`, `content` and `error`.

```ts
import { LoadingStack } from '@gjsify/adwaita-app';

const stack = new LoadingStack({ widthRequest: 360, heightRequest: 220 });
stack.setContent(buildReportView());
stack.setError('Could not load the report', 'Check your connection and try again.');
stack.showContent();
```

`loadIntoStack` drives it. Pass the stack, a shared `LoadToken`, a `load` function (sync or
async) and a `fill` function that renders the result.

```ts
import { LoadToken, loadIntoStack } from '@gjsify/adwaita-app';

const token = new LoadToken();

function reload(): void {
    loadIntoStack({
        stack,
        token,
        load: () => fetchReport(currentYear),
        fill: (data) => stack.setContent(renderReport(data)),
        onError: (err) => console.error(err),
    });
}
```

Each call takes a fresh ticket from the token. If you click through the sidebar quickly, a
slow load whose ticket is no longer current is dropped instead of overwriting the view you
are now looking at. `loadIntoStack` never rejects, so you don't need a `catch` around it.

Using your own stack instead of `LoadingStack`? Give its children the names `loading`,
`content` and `error`, or override them with `loadingName` / `contentName` / `errorName`.

## Ask, notify, pick a file

These wrap the response-signal Adwaita widgets so you can `await` them.

```ts
import {
    confirmDialog, errorDialog,
    registerToastOverlay, showToast,
    pickFile, saveFile,
} from '@gjsify/adwaita-app';

if (await confirmDialog(window, { heading: 'Delete this report?', destructive: true, defaultResponse: 'cancel' })) {
    // the user said yes
}

await errorDialog(window, 'Import failed', String(err));

registerToastOverlay(myToastOverlay);   // once, while building the window
showToast('Saved.');                     // from anywhere afterwards
showToast('Still working…', 0);          // 0 seconds = sticky

const path = await pickFile(window, {
    title: 'Open project',
    filters: [{ name: 'JSON', patterns: ['*.json'] }],
});
const target = await saveFile(window, { title: 'Export', initialName: 'report.csv' });
```

`pickFile` and `saveFile` resolve to `null` when the user cancels, so a cancel is a normal
value and not an exception.

Pair `destructive: true` with `defaultResponse: 'cancel'`. The reason to show a "really
delete this?" dialog is the accidental gesture, and a confirm default hands the reflex of
dismissing a dialog with Enter the deletion instead of the escape.

## Jump straight to a view while developing

`readAppDevHooks({ prefix })` reads three environment variables, so you can restart into the
view you're working on instead of clicking there every time.

```ts
import { readAppDevHooks, resolveInitialNavIndex } from '@gjsify/adwaita-app';

const hooks = readAppDevHooks({ prefix: 'MYAPP' });
shell.selectByIndex(resolveInitialNavIndex(NAV, hooks.view));
if (hooks.file) store.load(hooks.file);
if (hooks.debug) console.log('verbose load logging on');
```

| Variable | Effect |
|---|---|
| `MYAPP_VIEW` | Nav item id to open on startup. Falls back to the first item when the id is unknown. |
| `MYAPP_FILE` | A file path your app can auto-load. |
| `MYAPP_DEBUG` | `true` unless unset, empty, `0`, `false` or `no`. |

```bash
MYAPP_VIEW=reports gjsify run dist/app.gjs.mjs
MYAPP_VIEW=reports gjsify run --runtime node dist/app.node.mjs
```

## See also

- [Devtools & MCP](/gjsify/guides/devtools/) for screenshotting and driving the running app.
- [Storybook](/gjsify/guides/storybook/) for developing a widget on its own, with live controls.
- [GObject Classes](../../patterns/gobject-classes/) for the `registerClass` rules your
  window and widget subclasses follow.
- [Adwaita gallery](../../adwaita/) for the widgets to put inside your views.
