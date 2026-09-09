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
  `bundledIcons` (default on — see below), `onStartup`.
- `AdwaitaApp` — the configured `Adw.Application` subclass, if you need the
  instance instead of `runAdwaitaApp`.

### Bundled icons

`icon-name` on GTK resolves against the icon theme the HOST has installed, and
nothing guarantees that is Adwaita — so a documented name can draw a different
glyph, or the broken-image paintable, on a machine that ships a different set.
This package bundles a subset of `@gjsify/adwaita-icons` into a GResource and
registers it on `startup`, so the names your app writes always resolve to a
glyph your app ships. **On by default.**

The subset is the same one `@gjsify/adwaita-web` compiles into its stylesheet
(41 glyphs, 20.3 KiB compiled, 27.1 KiB as the base64 the bundle travels as), so
one `icon-name` means one glyph on the browser, on GTK and on NativeScript.
`scripts/check-bundled-icon-parity.mjs` fails when the two lists drift apart.

```ts
runAdwaitaApp({
    applicationId: 'org.example.App',
    createWindow,
    // bundledIcons: true,                  // the default
    // bundledIcons: { prefer: 'bundled' }, // the shipped set is authoritative
    // bundledIcons: false,                 // host theme only, the way it was before
});
```

`prefer` decides how the bundle relates to the host's theme, and the difference
is measured rather than assumed:

| `prefer` | host theme HAS the name | host theme lacks it |
|---|---|---|
| `'fallback'` (default) | the host's glyph is drawn | **the bundled glyph is drawn** |
| `'bundled'` | **the bundled glyph is drawn** | **the bundled glyph is drawn** |
| `'host'` | the host's glyph | nothing is registered — broken image |

`'fallback'` is the default because `Gtk.IconTheme.add_resource_path()`
*contributes* to the theme rather than overriding it — its own documentation
says so — and a user who chose Papirus should keep Papirus. It already closes
the failure this exists for: the name never fails to resolve.

`'bundled'` is for the case where the shipped glyph matters more than the host's
taste — a screenshot rig, a kiosk, a gallery whose pictures must match its
prose. It works by pointing the icon theme at a theme name nothing installs, so
only the app's resource can answer. The cost: a name **outside** the bundle then
has nothing behind it but GTK's own builtins. Register your own with
`registerBundledIconResource()` + `Gtk.IconTheme.add_resource_path()`, or pass a
`Gdk.Paintable` to the few widgets that accept one.

- `installBundledIconTheme(options?): boolean` — what `AdwaitaApp` calls on
  `startup`. For an app that builds its `Adw.Application` some other way.
- `addBundledIconsToTheme(theme)` — the same, on a `Gtk.IconTheme` you own.
- `registerBundledIconResource(): Gio.Resource` — register the GResource only.
- `BUNDLED_ICON_RESOURCE_PATH`, `BUNDLED_ICON_THEME_NAME`, `BUNDLED_ICON_COUNT`.

> Only 15 of the 22 `icon-name` properties in Gtk-4.0 + Adw-1 have a
> `Gdk.Paintable`/`Gio.Icon` sibling at all (`Gtk.Button`, `Adw.ActionRow`,
> `Adw.ButtonRow`, `Adw.SplitButton`, `Adw.Toggle`, … have none), which is why
> the guarantee is built on the icon THEME rather than on handing widgets an
> imported SVG: for most of them there is no property to hand it to.

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
