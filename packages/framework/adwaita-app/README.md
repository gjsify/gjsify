# @gjsify/adwaita-app

Native Adwaita application shell for GJS/GTK apps. It wires the boilerplate every
native Adwaita app repeats — the `runAsync` lifecycle, the opt-in
[`@gjsify/devtools`](../devtools) control plane, a startup CSS bootstrap, standard
`app.quit`/`app.about` actions, a data-driven `Adw.NavigationSplitView` nav shell,
an async-view mounter, and promise-based dialog/toast/file helpers.

It is **composition-first**: opt-in wiring for the parts that are pure
boilerplate, never a wrapper that hides `Adw`/`Gtk`. You still write your views as
plain `Gtk.Widget`s.

> GJS-only (`runtimes.gjs = polyfill`, everything else `none`). Tier 2.

## Install

```bash
gjsify install @gjsify/adwaita-app
```

## Quick start

```ts
import Adw from 'gi://Adw?version=1';
import { runAdwaitaApp, createNavShell, type NavItem } from '@gjsify/adwaita-app';

const NAV: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: 'go-home-symbolic' },
    { id: 'reports', label: 'Reports', icon: 'x-office-spreadsheet-symbolic' },
];

class MainWindow extends Adw.ApplicationWindow {
    static { imports.gi.GObject.registerClass({ GTypeName: 'MyMainWindow' }, MainWindow); }
    constructor(app: Adw.Application) {
        super({ application: app, defaultWidth: 1000, defaultHeight: 700 });
        const shell = createNavShell(this, {
            items: NAV,
            sidebarTitle: 'My App',
            onSelect: (item) => shell.stack.set_visible_child_name(item.id),
        });
        shell.stack.add_named(buildOverview(), 'overview');
        shell.stack.add_named(buildReports(), 'reports');
        this.set_content(shell.widget);
        shell.selectById('overview');
    }
}

await runAdwaitaApp({
    applicationId: 'org.example.App',
    createWindow: (app) => new MainWindow(app),
    css: '/* optional app CSS, loaded display-wide on startup */',
    about: { applicationName: 'My App', version: '1.0.0', developerName: 'Me' },
    // devtools omitted → gated on the GJSIFY_DEVTOOLS env var (safe in prod).
});
```

`runAdwaitaApp` uses `Adw.Application.runAsync()` — **not** sync `run()` — so a
synchronous view load does not hang its spinner (GJS does not flush the
promise-job queue under `run()`).

## API

### Application

- `runAdwaitaApp(options): Promise<number>` — construct + run, resolve with the
  exit code. `AdwaitaAppOptions`: `applicationId`, `createWindow`, optional
  `flags`, `css`, `about` (`AboutInfo`), `quitAction` (default on, `<primary>q`),
  `devtools` (`true` | `InstallDevtoolsOptions` | omitted = env-gated),
  `onStartup`.
- `AdwaitaApp` — the configured `Adw.Application` subclass, if you need the
  instance instead of `runAdwaitaApp`.

### Navigation shell

- `createNavShell(window, options): NavShell` — builds the
  `Adw.NavigationSplitView` (sidebar `Gtk.ListBox` + content `Gtk.Stack`) into
  `window` (which owns the responsive `Adw.Breakpoint`, default `max-width: 720px`).
  Returns `{ widget, stack, contentHeader, selectById, selectByIndex }`.
- `resolveInitialNavIndex(items, wantedId?)`, `findNavItem(items, id)` — pure
  helpers (e.g. to turn a `${PREFIX}_VIEW` dev hook into a start index).

### Async view mounting

- `LoadToken` + `loadIntoStack({ stack, token, load, fill, onError? })` — show a
  loading page, run `load` (sync or async), then `fill` + show content — dropping
  a result a newer reload superseded, and showing the error page on failure.

### Interaction helpers

- `confirmDialog(parent, { heading, body?, confirmLabel?, cancelLabel?, destructive?, defaultResponse? }): Promise<boolean>`
  — `defaultResponse` (`'confirm' | 'cancel'`, default `'confirm'`) picks the
  response Enter activates. A destructive question wants both: `destructive: true`
  for the red button and `defaultResponse: 'cancel'` so the reflex keystroke
  escapes instead of deleting. An id that is neither throws a `TypeError`.
- `errorDialog(parent, heading, body?): Promise<void>`
- `registerToastOverlay(overlay)` + `showToast(title, timeout?)`
- `pickFile(parent, { title?, filters? }): Promise<string | null>` /
  `saveFile(parent, { title?, filters?, initialName? }): Promise<string | null>`

### Dev hooks

- `readAppDevHooks({ prefix, env? }): { view?, file?, debug }` — the
  `${PREFIX}_VIEW` / `${PREFIX}_FILE` / `${PREFIX}_DEBUG` env pattern (e.g.
  `MYAPP_VIEW=reports myapp` to open straight to a view in dev).

## See also

- [`@gjsify/devtools`](../devtools) — the DBus control plane wired in on startup.
- [`@gjsify/storybook`](../storybook) — the component browser this shell was
  generalized from ([ADR 0009](../../../docs/adr/0009-native-adwaita-app-shell.md)).
