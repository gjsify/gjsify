# 101. xdg-desktop-portal interfaces are the platform seam below the GTK API

- Status: **Proposed**
- Date: 2026-10-09
- Deciders: Pascal Garber
- Related: [ADR 0078](0078-the-desktop-appearance-reaches-a-web-page-through-a-handoff.md)
  (the Settings portal as the Linux appearance source),
  [ADR 0095](0095-system-accounts-are-asked-by-capability.md) (`system-accounts`),
  [ADR 0096](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md) (a GObject subset),
  [ADR 0098](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md) (a minimal Application),
  ADR 0099 (`Gio.Settings`) and ADR 0100 (`Gtk.FileDialog`, `Gio.File`), both proposed in PR #2111
  and not on `main` yet

## Rule for every stage

The app-facing API is GTK's and GIO's: a true subset, the same names and semantics. What is not
implemented throws, naming it. A claim needs a conformance vector; a refusal must throw.

## Context

gjsify uses every available standard where it can. Several GTK features that apps call are, on
Linux, a thin client of a D-Bus service: the file dialog, the colour scheme, opening a URI, a
notification, the user's name. That service is `xdg-desktop-portal`. Its interfaces are written down
and versioned, with D-Bus XML in `data/` of `flatpak/xdg-desktop-portal`.

Measured, by reading the sources.

**The portal interfaces** ([docs](https://flatpak.github.io/xdg-desktop-portal/docs/)):

- **Request pattern.** An interactive call returns a `Request` object path. The result arrives once,
  as `Request::Response(u response, a{sv} results)`: `0` success, `1` the user cancelled, `2` ended
  in some other way. The caller passes `handle_token`, which fixes the object path, so it can
  subscribe before it calls (`doc-org.freedesktop.portal.Request`). `Close()` aborts and emits no
  `Response`.
- **FileChooser** (version 4). `OpenFile`, `SaveFile`, `SaveFiles`, each `(parent_window s, title s,
  options a{sv}) → handle o`. Options: `accept_label`, `modal`, `multiple`, `directory` (since 3),
  `filters a(sa(us))` (a name plus glob `0` or MIME `1` entries), `current_filter`, `choices`,
  `current_folder` (`ay`, the portal may ignore it), `current_name`, `current_file`, and for
  `SaveFiles` `files aay`. Results: `uris` (always `file://`), `choices`, `current_filter`. The docs
  say filters only aid the user: the portal may return a file that matches none.
- **Settings** (version 2). Read-only. `ReadAll(namespaces)`, `ReadOne(ns, key)`, `Read` (deprecated),
  `SettingChanged`. Standard namespace `org.freedesktop.appearance`: `color-scheme` (`u`: 0 none,
  1 dark, 2 light), `accent-color` (`(ddd)` sRGB in 0..1, out of range means unset), `contrast`
  (`u`: 0, 1) and `reduced-motion`. The doc says it is "not for general purpose settings".
- **OpenURI** (version 5). `OpenURI(parent_window, uri, options)`; `file://` is explicitly not
  supported there, `OpenFile(parent_window, fd h, options)` takes a file descriptor. Options:
  `writable`, `ask`, `activation_token`.
- **Notification** (version 2). `AddNotification(id, notification a{sv})`, `RemoveNotification`.
  Reusing an `id` updates the notification. The app cannot learn whether it was shown. Actions
  prefixed `app.` activate through `org.freedesktop.Application.ActivateAction`.
- **Account** (version 1). `GetUserInformation(window, options)` returns, through `Response`,
  `id`, `name` and `image` (a URI) of the current user. Option: `reason`.
- **Secret** (version 1). `RetrieveSecret(fd, options)`: one opaque master secret per application.

**No portal covers what `system-accounts` does.** Account returns three fields about the login user.
Secret returns one secret per application. Neither lists accounts, mail servers or credentials of
other services. The portal index has no accounts interface. This ADR checked the doc index and the
`data/` XML, not the issue tracker.

**How GTK chooses a backend** (`GNOME/gtk`, `main`):

- `gtk/gtkfiledialog.c` builds a `GtkFileChooserNative` (`gtk_file_chooser_native_new`, line 917) and
  shows it as a `GtkNativeDialog`.
- `gtk/gtkfilechoosernative.c`, `gtk_file_chooser_native_show` (lines 709-736), starts in
  `MODE_FALLBACK` and tries in this order: win32 (`IFileDialog`, `gtkfilechoosernativewin32.c`), macOS
  (`NSOpenPanel` / `NSSavePanel`, `gtkfilechoosernativequartz.c`), Android, then the portal
  (`gtkfilechoosernativeportal.c`). If none claims it, `show_dialog` draws the in-process
  `GtkFileChooserWidget`. The win32 backend gives the dialog back to the widget when a filter uses a
  MIME type.
- The portal path asks `gdk_display_should_use_portal (display, FileChooser, 3)`
  (`gtkfilechoosernativeportal.c:487`; `gdk/gdk.c:631`). That function is true in a sandbox
  (`/.flatpak-info`, `gdk/gdk.c:409`), false when portals are disabled, otherwise it checks that the
  interface exists in at least the given version. Its own comment: if it returns true and the portal
  fails, that is an error, not a reason to fall back.

So GTK already has this layering: the same API, then the platform's own mechanism, then a drawn
fallback. Windows and macOS are not portal platforms, and GTK does not pretend they are.

**In this repo:**

- `packages/framework/adwaita-app/src/appearance/portal.ts` calls
  `org.freedesktop.portal.Settings.ReadAll(["org.freedesktop.appearance"])` over `Gio.DBusConnection`
  and handles `SettingChanged`; `reader.ts` chooses per OS (portal, `reg.exe`, `defaults`), `reader.spec.ts`
  runs against a fake portal on a peer-to-peer `Gio.DBusServer` (ADR 0078). It is the only portal
  client; there is no libportal / `Xdp` binding.
- `packages/framework/adwaita-app/src/file-dialog.ts` wraps `Gtk.FileDialog`; on GJS the portal is
  reached through GTK, not by gjsify.
- `packages/gjs/system-accounts` (ADR 0095): one interface `SystemAccounts`
  (`capabilities`, `listAccounts`, `getMailSettings`, `getCredentials`), one Linux driver on GOA
  (`goa.ts`, `createGoaAccounts`), a `no-account-store.ts` answer for hosts without it, a mapping layer
  (`mapping.ts`) as pure functions, and `system-accounts.ts` as the entry that picks the driver. A missing
  capability is a value (`Unavailable`), not a throw. `os` is `linux: supported`, `darwin` and `win32`
  `none`. Its test serves a fake GOA on a peer-to-peer `Gio.DBusServer`. No other platform has a driver.

**Browser facts for a FileChooser driver** (MDN browser-compat-data, `api/Window.json`,
`api/FileSystemFileHandle.json`, `api/StorageManager.json`; web-features `file-system-access` and
`origin-private-file-system`):

| API | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| `showOpenFilePicker`, `showSaveFilePicker` | 86 (Chrome Android 132) | no | no |
| OPFS `navigator.storage.getDirectory()` | 86 | 111 | 15.2 |
| `FileSystemFileHandle.createWritable()` | 86 | 111 | 26 |
| `createSyncAccessHandle()` (workers) | 102 | 111 | 15.2 |

web-features lists File System Access as not Baseline (`baseline: false`, support Chrome and Edge 86,
Chrome Android 132) and OPFS as Baseline high (Chrome 108, Firefox 111, Safari 16.4 as the feature's
support floor). OPFS reaches Safari 15.2 for `getDirectory()` but `createWritable()` on the main
thread arrives only in Safari 26; before that a writer needs a worker and `createSyncAccessHandle`.
I did not find a WebKit release note that names `createWritable`; the Safari 26 value is the
compat-data entry.

## Decision

**The portal interfaces are the contract below the GTK API, on every platform. Linux talks to the
real portal. Every other platform gets a gjsify driver that implements the same interface semantics
with that platform's own means.**

```text
app code            Gtk.FileDialog · Adw.StyleManager · Gio.AppInfo.launch_default_for_uri · Gio.Notification
                    (GTK / GIO API: true subset, same names, same semantics; ADR 0096, 0098)
                                         │
portal contract     FileChooser · Settings(appearance) · OpenURI · Notification · Account
                    (org.freedesktop.portal.*: method shapes, Request/Response, option keys)
                                         │
driver, per platform
  Linux             D-Bus to xdg-desktop-portal  (the real thing)
  browser           File System Access or OPFS + drawn Adwaita dialog · matchMedia · window.open · Notification API
  Android           SAF intents · Configuration.uiMode · ACTION_VIEW · NotificationManager
  Windows           IFileDialog · registry / WinRT UISettings · ShellExecute · toast
  macOS             NSOpenPanel · NSApp.effectiveAppearance · NSWorkspace · UNUserNotificationCenter
```

Three consequences.

1. **App code sees only GTK and GIO.** A portal call never appears in an app. The portal is how the
   GTK-shaped call is carried, as it is for GTK itself.
2. **The contract is the portal's, even where the portal project does not run.** Windows, macOS, the
   browser and Android have no portal. A driver there answers what the interface says: the same
   option keys, the same `Response` codes (success, cancelled, other), the same result shapes, the
   same refusals. Where a platform cannot honour an option, the driver does what the portal's own docs
   allow (FileChooser may ignore `current_folder`), or it throws.
3. **Below the API each platform behaves as its native apps do.** The Windows driver opens
   `IFileDialog`, the browser opens its own picker. This matches what GTK does in
   `gtk_file_chooser_native_show`.

### Portals by platform

"Planned" means nobody has built it. "Implemented" is stated only where this repo has the code.

| Portal | Linux (D-Bus) | Browser | Android (NativeScript) | Windows | macOS |
|---|---|---|---|---|---|
| FileChooser | via `Gtk.FileDialog` on GJS: GTK carries it. A direct D-Bus client for Node: planned | File System Access where present (Chromium); else OPFS + drawn Adwaita dialog: planned (ADR 0100) | Storage Access Framework: planned | `IFileDialog`: GTK has it on GJS; other hosts planned | `NSOpenPanel`: GTK has it on GJS; other hosts planned |
| Settings (`org.freedesktop.appearance`) | **implemented** (`appearance/portal.ts`, ADR 0078) | `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion`: planned | `Configuration.uiMode`: planned | **implemented** via registry (`reader.ts`, ADR 0078) | **implemented** via `defaults` (ADR 0078) |
| OpenURI | planned | `window.open`, `location`: planned | `ACTION_VIEW` intent: planned | `ShellExecute`: planned | `NSWorkspace.open`: planned |
| Notification | planned | Notification API: planned | `NotificationManager`: planned | toast: planned | `UNUserNotificationCenter`: planned |
| Account (`GetUserInformation`) | planned | none (no user name in a page) | planned, limits not read | planned, limits not read | planned, limits not read |

Two rows deserve a note. The Settings row for Windows and macOS exists already, under ADR 0078, as
OS-specific readers that produce the portal's answer shape; this ADR names it as the pattern.
The Account row is a candidate only: nobody has decided that `Gtk` or `Gio` has an API that needs it.

A portal is added to this table when a GTK/GIO API an app already calls needs it, not before.

### The preference rule: a standard beats an own invention

When a capability has a portal, gjsify uses the portal's interface as the contract. When no portal
covers it, gjsify defines its own interface, and that interface carries a note that it would give way
to a portal. When a portal appears, the own invention migrates to it.

`system-accounts` (ADR 0095) is the worked example. It is gjsify's own interface because no portal
lists accounts or hands out credentials (see Context). Its shape already follows this ADR: one
interface, a driver per platform, a missing capability as a value. If a portal for online accounts
appears, `SystemAccounts` is re-expressed as that portal's contract, the GOA driver stays as the Linux
backend behind it, and the capability vocabulary moves with it. Until then it stays. The Secret portal
is not a candidate: it is a per-application master secret, which is not what `getCredentials` returns.

### Relation to ADR 0099 and ADR 0100 (PR #2111)

- **ADR 0099, `Gio.Settings`, is not a portal.** The Settings portal is read-only and "not for general
  purpose settings". An app's own keys live in `Gio.Settings` / the platform's key-value store (ADR 0099).
  Only the `org.freedesktop.appearance` keys come through the Settings portal, and they feed
  `Adw.StyleManager`.
- **ADR 0100, `Gtk.FileDialog`, sits on this seam.** The FileChooser portal is the contract under
  `Gtk.FileDialog`. ADR 0100 decides the dialog and file API; this ADR decides that the thing below
  it is the portal's contract, and that the browser and Android drivers are drivers of it.

### Browser rules for the FileChooser driver

Pascal's rule: **a download is not saving.**

- With File System Access (`showOpenFilePicker`, `showSaveFilePicker`): the picker is the dialog.
  The returned handle is the `Gio.File`.
- Without it (Firefox, Safari): files live in OPFS and are chosen in a dialog gjsify draws as
  Adwaita, as GTK's `GtkFileChooserWidget` does when no portal exists. A repeated "save" writes to the
  OPFS file again.
- A download exists only as an explicit export, never as the answer to `save`.
- A file opened through `<input type=file>` is copied into OPFS when it is opened, so it has the same
  handle from then on.
- OPFS writes need `createWritable()` on the main thread: Chrome 86, Firefox 111, Safari 26. Before
  Safari 26 a worker with `createSyncAccessHandle` is needed. Which of the two the driver ships is open.

## Conformance

- **A claim needs a vector.** A driver says it implements a portal only for the options and results a
  conformance vector covers. A portal option no vector covers is refused by the driver, and the
  refusal throws, naming the option.
- **Vectors are the portal's.** The vectors express the interface: `Response` `0/1/2` mapped to the
  GTK result (success, `Gtk.DialogError.DISMISSED`, other), the filter shape, `SaveFiles` keeping the
  given names, `Close()` emitting no `Response`. The same vector runs against every driver.
- **Linux runs against the real portal where CI can.** The existing approach stays (a fake portal on a
  peer-to-peer `Gio.DBusServer`, ADR 0078) for fast, hermetic checks. In addition, one job runs the
  vectors against a real `xdg-desktop-portal` with a test backend on a session bus, so the fake cannot
  drift from the real interface. Whether a CI runner can host `xdg-desktop-portal` with a headless
  backend is unmeasured: that job is **planned**, and until it exists the claim is "matches the
  documented interface", not "matches the portal".
- **A refusal throws.** A platform that cannot do what the portal says throws; it does not return a
  quietly different answer.

## Consequences

- One vocabulary for platform services. A driver author reads the portal's XML, not a new design.
- Windows, macOS and the browser inherit a spec they did not choose. Where a platform differs, the
  driver documents the gap in its table row.
- Bundles for the browser and NativeScript gain code only for the portals an app's GTK calls reach.
- `system-accounts` becomes the template for "no portal exists yet".

## Not goals

- App code calling `org.freedesktop.portal.*`. Apps call GTK and GIO.
- A libportal binding. GJS apps reach portals through GTK; Node and other hosts through a D-Bus client.
- Portals with no GTK or GIO API behind them today (Camera, ScreenCast, Location, and so on).

## What this does not decide

- Whether Node and Bun hosts get a direct D-Bus portal client, or only GJS does (through GTK).
- Which Android and Windows means back each cell beyond the first guess in the table.
- Whether the Account portal is exposed at all, and through which GTK/GIO name.
- Whether the browser driver ships a main-thread `createWritable()` path, a worker path, or both,
  given Safari 26 is the first version with the former.
