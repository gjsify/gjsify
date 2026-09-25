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
  `flags`, `css`, `about` (`AboutInfo`) or `aboutAppdata`
  (`CreateAboutDialogOptions`, see below), `quitAction` (default on, `<primary>q`),
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
(41 glyphs, 19.9 KiB compiled, 26.5 KiB as the base64 the bundle travels as), so
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

### About dialog from AppStream metainfo

`Adw.AboutDialog.new_from_appdata()` builds the whole dialog out of the metainfo
file an application already ships — name, developer, licence, urls, version,
release notes, translated. **It does not exist in the Windows GTK runtime.**
gvsbuild applies `patches/libadwaita/0001-remove-appstream-dependency.patch`,
which wraps every `*_from_appdata` entry point in `#ifndef G_OS_WIN32`, because
libadwaita 1.9.x parses AppStream through the heavyweight `appstream` library
and gvsbuild defines no project for it. Homebrew's formula `depends_on
"appstream"`, so **both darwin bundles have it and win32-x64 does not** —
measured symbol by symbol out of each published bundle's own `Adw-1.typelib`
([gjsify/gjsify#1662](https://github.com/gjsify/gjsify/issues/1662)). On Windows
11 the ordinary call site reads `no static method 'new_from_appdata'` and the
About dialog does not open at all.

`createAboutDialog` is the drop-in that works on all three:

```ts
import { createAboutDialog } from '@gjsify/adwaita-app';

createAboutDialog({
    appdataResource: '/org/example/App/metainfo/org.example.App.metainfo.xml',
    releaseNotesVersion: PACKAGE_VERSION,
    version: PACKAGE_VERSION,
}).present(window);
```

Or let the shell wire the `app.about` action to it:

```ts
runAdwaitaApp({
    applicationId: 'org.example.App',
    createWindow,
    aboutAppdata: { appdataResource: '/org/example/App/metainfo/org.example.App.metainfo.xml' },
});
```

Where the constructor exists it is used, unchanged. Where it does not, the same
dialog is assembled from the same document by `parseAppdata` — which **ports
`ministream`'s selection rules rule for rule** (the small parser libadwaita 1.10
replaced the `appstream` dependency with): BCP-47 segment scoring for
translations, the `+1024` shift that ranks `<developer><name>` over the legacy
`<developer_name>`, the `.desktop` id rule, per-language release-note buffers.
Picking fields by our own taste would show a *different* About dialog on Windows
than on the two platforms that run the real constructor, which is the whole
failure this closes.

It sets exactly what upstream's `populate_from_appdata` sets and nothing else —
application icon (from `<id>`), application name, developer name, version,
website, support url, issue url, licence **type**, and the release notes of one
named release. No `comments`, no `copyright`, no `translator-credits`, no
`developers`: AppStream's `<summary>` is not `Adw.AboutDialog:comments` and
upstream never treats it as one. Set those on the returned dialog yourself.

Three things it does that upstream does not, each for a measured reason:

| | why |
|---|---|
| checks the resource with `Gio.resources_get_info` **before** calling the constructor | libadwaita reports an unreadable resource with `g_error()`, which **aborts the process** — a mistyped resource path would kill the app the moment the user opens About, with no exception for any `catch` to see |
| accepts `appdataPath`, a plain file | a `gjsify ship` artifact may carry the metainfo beside the bundle rather than inside a GResource; upstream's constructor cannot read that at all, so such an app would have no About dialog on *any* platform |
| `forceParsedAppdata: true` | the parsed path is what every Windows user sees and what no Linux or macOS run would otherwise execute — this is how you look at it before shipping, and how the suite covers it |

**Two divergences, both named.** Releases are read in document order rather than
sorted by ministream's dpkg-style version comparison (AppStream requires
newest-first, and `appstreamcli validate` reports `releases-not-in-order`
otherwise) — pass `version` to remove the question on every platform at once. And
an SPDX id GTK does not know becomes `Gtk.License.CUSTOM` with **no** licence
text, exactly as upstream leaves it; filling the text with the raw id would be
more helpful and would show a licence line on Windows that Linux does not.

- `createAboutDialog(options?): Adw.AboutDialog` — `appdataResource`,
  `appdataPath`, `releaseNotesVersion`, `version`, `applicationIcon`,
  `forceParsedAppdata`.
- `buildAboutDialogFromAppdata(xml, { releaseNotesVersion?, locale? }): Adw.AboutDialog`
  — the parsed path on its own, given the document.
- `applyAppdataFields(dialog, fields, releaseNotesVersion?)` — for an app that
  already has a dialog.
- `parseAppdata(xml, { locale?, releaseNotesVersion? }): AppdataFields` and
  `appdataLocale(GLib.get_language_names(), { LANG })` — the reading half, with
  **no GI imports**, so it runs (and is tested) under Node as well as GJS.
- `licenseTypeFor(spdxId): Gtk.License`, `hasAppdataConstructor(namespace?): boolean`.

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

## Desktop appearance (`@gjsify/adwaita-app/appearance`)

The desktop's accent colour and colour-scheme preference, for a process that never
opens a window: a server behind a web UI, a bridge, a CLI. A GTK app does not need
it, because `Adw.StyleManager` already applies the same values to its widgets. This
subpath loads only Gio and GLib ([ADR 0078](../../../docs/adr/0078-the-desktop-appearance-reaches-a-web-page-through-a-handoff.md)).

```ts
import { readDesktopAppearance, renderAppearanceMeta, watchDesktopAppearance } from '@gjsify/adwaita-app/appearance';

const appearance = await readDesktopAppearance();
// { accent: 'purple', accentRgb: '#9141ac', colorScheme: 'dark' }; absent fields are unknown

const head = renderAppearanceMeta(appearance);
// <meta name="adw-accent" content="purple">
// <meta name="adw-color-scheme" content="dark">

const stop = watchDesktopAppearance((next) => broadcast(JSON.stringify(next))); // hold `stop`
```

A web server must `listen()` before the module's first top-level await. On GJS a server
started after one exits as soon as the module settles; see `status/open-todos.md`.
[`examples/node/net-adwaita-appearance`](../../../examples/node/net-adwaita-appearance)
serves a complete page that way.

A reported colour is snapped to one of libadwaita's nine accents with
`nearestAccent`, as libadwaita does. The reader never throws. Sources per OS:

| OS | Reads | Follows changes by | Measured |
|---|---|---|---|
| Linux (GNOME, KDE, Flatpak) | XDG Settings portal `org.freedesktop.appearance`, then GSettings `org.gnome.desktop.interface` for what the portal left unknown, only when `XDG_CURRENT_DESKTOP` names GNOME (elsewhere the schema answers its defaults) | `SettingChanged`, `changed::` | yes, in CI, against a fake portal on a peer D-Bus connection |
| Windows | `reg.exe query`: `Explorer\Accent AccentPalette` (else `DWM AccentColor`), `Personalize AppsUseLightTheme` | polling every 3 s | mapping only; reg.exe not run on Windows |
| macOS | `defaults read -g AppleAccentColor / AppleInterfaceStyle / AppleInterfaceStyleSwitchesAutomatically` | a debounced monitor on `~/Library/Preferences` | mapping only; not run end to end on a Mac |

On macOS with Auto appearance and no `AppleInterfaceStyle` key, `colorScheme` stays
absent: the system switches by time of day, so a missing key does not prove light.

## See also

- [`@gjsify/devtools`](../devtools) — the DBus control plane wired in on startup.
- [`@gjsify/storybook`](../storybook) — the component browser this shell was
  generalized from ([ADR 0009](../../../docs/adr/0009-native-adwaita-app-shell.md)).
