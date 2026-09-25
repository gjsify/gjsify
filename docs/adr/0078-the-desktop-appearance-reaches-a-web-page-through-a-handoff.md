# 78. The desktop's accent reaches a web page through a server handoff, snapped the way libadwaita snaps it

- Status: **Accepted**
- Date: 2026-09-25
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md),
  [ADR 0009 (the Adwaita app shell)](0009-native-adwaita-app-shell.md),
  [ADR 0018 (the OS axis)](0018-os-axis-declaration.md), #1821, JumpLink/beifahrer#18

## Context

A native libadwaita window follows the desktop's accent colour and colour scheme without a
line of app code: `Adw.StyleManager` reads the XDG Settings portal on Linux, WinRT's
`UISettings` on Windows and AppKit's `controlAccentColor` on macOS
(`adw-settings-impl-{portal,win32,macos}.c`) and snaps whatever colour it gets to one of the
nine `AdwAccentColor`s with `adw_accent_color_nearest_from_rgba()`.

A web page styled with `@gjsify/adwaita-web` gets none of that. It always paints Adwaita blue.
Three things stand in the way:

1. **The browser barely knows.** The CSS system colour `AccentColor` is the only standard
   route. Engine support is uneven (Chrome announced shipping it only in 2026; what Firefox
   resolves it to on Linux is not established; Firefox 156 on macOS 27 resolves it to
   `rgb(0, 122, 255)` for the default accent and to `rgb(149, 61, 150)` for purple, so there it is real), and a page cannot tell a real accent from an engine's fixed default.
   Measured on a GNOME 50 desktop set to purple: Playwright's headless Firefox 151 resolves
   `AccentColor` to `rgb(0, 96, 223)` and its headless Chromium 149 to `rgb(0, 117, 255)`.
   Both are blue, and neither is the desktop's accent. #1821 asks adwaita-web to use it
   anyway, where it exists.
2. **The process that serves the page often DOES know, but has no reader.** A gjsify app that
   serves a web UI — a local dashboard, a bridge for a browser extension like
   JumpLink/beifahrer — runs on GJS next to the desktop. It cannot use `Adw.StyleManager`:
   every libadwaita backend except the portal needs a `GdkDisplay`, and these processes never
   open one. beifahrer wrote its own GSettings reader, which is GNOME-only and cannot follow
   the accent on KDE, in a Flatpak, on Windows or on macOS.
3. **There is no format to hand the answer over.** Each consumer invents one, and then has to
   reimplement libadwaita's snapping and its standalone-colour derivation beside it.

## Decision

### 1. The snapping belongs to `@gjsify/adwaita-core`, verbatim

`nearestAccent(rgb)` ports `adw_accent_color_nearest_from_rgba()` exactly: an OkLCh hue ladder
with a chroma floor of 0.04 below which everything is `slate`. It is tested against every case
in libadwaita's own `tests/test-accent-color.c`, which are its reference expectations for the
GNOME palette and the accent sets of elementary, KDE, Ubuntu, Cinnamon, COSMIC and macOS.
They are transcribed into `conformance/accent.ts` as `NEAREST_ACCENT_VECTORS`.

**Every source is snapped.** The portal colour, the Windows registry colour, the macOS accent
index and the browser's `AccentColor` all pass through the same function, so a web page and a
native window on the same desktop show the same accent. It follows that the page paints a
palette colour and libadwaita's standalone derivation of it, never the raw system colour.

### 2. The reader is a subpath of `@gjsify/adwaita-app`: `@gjsify/adwaita-app/appearance`

`readDesktopAppearance()` and `watchDesktopAppearance(cb)` return a `DesktopAppearance`:
`{ accent?, accentRgb?, colorScheme?: 'light' | 'dark' | 'no-preference' }`. **An absent field
means unknown**, never a guessed default, so a consumer can tell "the user picked blue" from
"nothing was read". The reader never throws.

| OS | Source | Change detection |
|---|---|---|
| Linux, every free desktop | Portal `org.freedesktop.portal.Settings.ReadAll(["org.freedesktop.appearance"])`, then, only when `XDG_CURRENT_DESKTOP` names GNOME, GSettings `org.gnome.desktop.interface` for any field the portal left unknown | `SettingChanged`, `changed::<key>` |
| Windows | `reg.exe query` for `Explorer\Accent AccentPalette` (entry 3 is WinRT's `UIColorType_Accent`), falling back to `DWM AccentColor`, plus `Themes\Personalize AppsUseLightTheme` | polling, every 3 s while watched |
| macOS | `defaults read -g` for `AppleAccentColor`, `AppleInterfaceStyle`, `AppleInterfaceStyleSwitchesAutomatically` | a debounced monitor on `~/Library/Preferences`, then a re-read |

Why each spelling was chosen:

- **`ReadAll`, not `ReadOne`.** It is interface version 1, so it needs no version probe, and
  it omits a key the backend does not provide instead of raising `NotFound`. One round trip
  answers both keys.
- **reg.exe instead of `GWin32RegistryKey`.** `g_win32_registry_key_get_value` and
  `g_win32_registry_value_iter_get_data` return data through an untyped `gpointer` out
  parameter, which introspection cannot marshal into a JS value, and `…_key_watch` takes a
  callback with no scope annotation. No JS runtime can read a registry value through GIO, so
  the rule against shelling out where an API exists does not apply: reg.exe is run with an
  argv array. The same missing watch is why Windows polls.
- **`defaults` instead of parsing the plist.** cfprefsd owns the preferences and writes
  `.GlobalPreferences.plist` late and by replacing the file. `defaults` asks cfprefsd. The
  monitor watches the directory because a replaced file can escape a file monitor.
- **GSettings only on GNOME.** KDE, Xfce and Homebrew on macOS install the schema but never
  write it, so `get_string` answers the schema default. Measured on a Mac set to purple
  (`AppleAccentColor = 5`): GSettings said `blue`. Outside GNOME its answer is unknown, and
  the macOS reader never consults GSettings.
- **macOS absence is a value, measured.** On a fresh macOS 27 account all three keys are
  absent, which means multicolour (blue) and light. The one exception is Auto appearance,
  where a missing `AppleInterfaceStyle` no longer proves light, so the scheme stays unknown
  and a page falls back to `prefers-color-scheme`.

**Why the home is `adwaita-app` and not a new package.** It is the Adwaita app-shell domain:
the question is "what does the desktop tell an Adwaita app", the answer's type and its
snapping are `adwaita-core`'s, and `adwaita-app` already carries the package's OS
declaration. A new npm name would need a manual first publish before any release could carry
it. The root barrel pulls in GTK, so the reader is a subpath and reaches only Gio and GLib,
and a display-less server can load it.

**Not measured on every OS.** Linux is measured. On the same purple GNOME desktop the reader
returns `{ accent: "purple", accentRgb: "#9141ac", colorScheme: "dark" }` through the portal.
In CI the reader's specs export a fake portal on a peer-to-peer `Gio.DBusServer` and drive the
real GVariant marshalling and `SettingChanged` subscription. The Windows and macOS mappings run on every host as pure
functions. Spawning reg.exe or `defaults` and the macOS directory monitor have not run on
their OS. The `os` declaration of `@gjsify/adwaita-app` says so.

### 3. The handoff is two `<meta>` tags, and JSON for live updates

```html
<meta name="adw-accent" content="purple">
<meta name="adw-color-scheme" content="dark">
```

`renderAppearanceMeta(appearance)` writes them. `@gjsify/adwaita-web` reads them on import and
watches them for changes, so a page that carries them needs no code. `adw-accent` also takes
`system`, meaning "follow CSS `AccentColor`", for a server that knows it cannot read the
desktop. For live updates the JSON form of `DesktopAppearance` goes over whatever channel the
app already has (SSE, WebSocket, a message port) into `applyDesktopAppearance(json)`, which
validates it. A payload that carries only `accentRgb` is snapped in the page. Both ends of the format live in `adwaita-core` (`renderAppearanceMeta` /
`appearanceFromMeta` / `parseDesktopAppearance`), so they cannot drift.

Meta tags because they are the framework-neutral way to hand a value from server to page.
Every templating system can print one, a static export keeps it, and the page reads it
synchronously before first paint. A header or cookie would need the page to fetch.

### 4. Precedence, highest first

1. **the app's own choice**, `applyAdwaitaAccent(name)`: never overwritten; `clearAdwaitaAccent()` hands the element back
2. **the server handoff**: the tags, or the last `applyDesktopAppearance(json)`
3. **the CSS system colour** `AccentColor`, once asked for with `applySystemAccent()` or `content="system"`, snapped
4. **Adwaita blue**, the stylesheet's own value

The handoff outranks `AccentColor` because the server read the desktop itself, while
`AccentColor` may be a default the page cannot detect. A handed-over colour scheme becomes a
`.theme-dark` / `.theme-light` class on `<html>`, unless the app put one there itself. Only
`<html>` follows. An accent on any other element is the app's.

## Consequences

- beifahrer can delete its GSettings reader and its local `AccentColor` shim: the bridge calls
  `watchDesktopAppearance` and forwards the JSON, and the pages call
  `applyDesktopAppearance`. It gains KDE, Flatpak, Windows and macOS.
- A server that renders the tags needs `@gjsify/adwaita-app` at runtime. The subpath keeps that
  to Gio and GLib, but the package's declared dependencies include the GTK typings.
- adwaita-web now runs a `MutationObserver` on `<head>` from import. It re-reads only when one
  of its own tags changes, because frameworks insert `<style>` and `<script>` all the time.
- `applySystemAccent()` closes #1821 for engines that resolve `AccentColor`. Where one does
  not, the page keeps blue and says so: the function returns `null` and
  `adwaitaAccentSource()` reports `default`.
- Windows and macOS stay `partial` in `@gjsify/adwaita-app`'s `os` declaration until the
  reader's own suite runs on those hosts.
