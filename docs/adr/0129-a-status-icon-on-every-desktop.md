# 129. A status icon on every desktop; running in the background stays with GIO and the portal

- Status: **Accepted** (2026-11-02); the consumer and its need are named in Context
- Date: 2026-11-02
- Deciders: Pascal Garber
- Depends on: [ADR 0101 (portals are the platform seam below the GTK API)](0101-portals-are-the-platform-seam-below-the-gtk-api.md)
  — its preference rule decides § 1 and its "a portal is added when an app needs it" rule decides
  when; [ADR 0128 (a menu model is a real menu model)](0128-a-menu-model-is-a-real-menu-model.md)
  — the icon's menu is a real `Gio.MenuModel`, and what is not implemented is refused BY NAME;
  [ADR 0003 (package tiering)](0003-package-tiering.md) rule 3 (new axes start at Tier 3);
  [ADR 0005 (node-gi scope)](0005-node-gi-scope.md) (the dependency-isolation rule);
  [ADR 0017 (native package distribution)](0017-native-package-distribution.md) (per-target
  packages behind `optionalDependencies`)
- Related: [ADR 0022 (WebKit on darwin)](0022-webkit-on-darwin.md) — the ObjC→GObject shim pattern
  and the CFRunLoop-vs-`GMainContext` finding; [ADR 0024 (ship installable artifacts)](0024-ship-installable-artifacts.md)
  — the Windows artifact is a program directory, not MSIX, and there is no GJS host on Windows;
  [ADR 0074 (one declared macOS floor)](0074-one-declared-macos-floor.md);
  [ADR 0018 (OS axis declaration)](0018-os-axis-declaration.md)

## Rule for every stage

The API is GTK's and GJS's. Where GTK, GIO or libportal has the API, gjsify implements a strict
subset of it — same names, same semantics — and refuses the rest BY NAME. Where none of them has
one, gjsify defines its own interface, and that interface says what it would give way to
(ADR 0101, "a standard beats an own invention").

## Context

Two things get called "background" and they have different owners:

1. **Keeping a process alive with no window, and starting it at login.** GIO and the portal already
   own this. `Gio.Application.hold()` / `release()` keep an application running without a window;
   that is the lifetime API on every host. The permission to do so inside a sandbox, the
   user-visible status line and autostart are the Background portal, which libportal exposes as
   `Xdp.Portal.request_background(parent, reason, commandline, flags)` with
   `XdpBackgroundFlags` for autostart and D-Bus activation, and `Xdp.Portal.set_background_status`
   ([libportal](https://libportal.org/method.Portal.request_background.html),
   [portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Background.html)).
2. **A status icon** (tray, menu bar extra, notification-area icon) to get the window back.
   GTK 4 has none — `GtkStatusIcon` went with GTK 3 — and no portal covers it.

An earlier draft of this ADR invented a `BackgroundSession` for (1). That contradicts ADR 0101: (1)
has a portal and a libportal API, so app code calls `Xdp`, and other platforms get a driver below
it. This version keeps (1) where ADR 0101 puts it and decides only (2).

**The consumer.** Beifahrer (<https://github.com/JumpLink/beifahrer>) has a window for
beginners and a bridge that the coding agent starts as a subprocess over stdio. Its owner decided
on 2026-11-02 that the window stays in the background and shows whether agent and browser are
connected; the bridge stays with the agent, the window hosts nothing
([Beifahrer ADR 0024](https://github.com/JumpLink/beifahrer/blob/main/docs/adr/0024-the-window-stays-in-the-background.md)).
It needs `hold()` and `Xdp.Portal.request_background` first (no gjsify code on GJS/Linux), then a
status icon with a two-entry menu and a tooltip that changes with the state. ADR 0101 adds a
portal row "when a GTK/GIO API an app already calls needs it, not before"; the Background row is
added when Beifahrer's first call lands.

## Decision

### 1. Background running: `hold()` plus `Xdp`, nothing new

- **Lifetime** is `Gio.Application.hold()` / `release()`. An app that wants to survive its last
  window holds the application; no gjsify API is added for that.
- **Permission, status line and autostart** are `Xdp.Portal.request_background` /
  `set_background_status`. On GJS on Linux the real libportal answers — ADR 0101 measured it in the
  GNOME Flatpak runtime, Debian and Fedora — so a GJS app on Linux needs **no gjsify code** for
  this. The Background row is added to ADR 0101's "Portals by platform" table, with drivers for
  node-gi, macOS and Windows, when an app calls it. The facts those drivers will need are recorded
  in § 6 so nobody re-researches them.
- `@gjsify/background` is therefore NOT created. The package this ADR proposes is
  `@gjsify/status-icon`.

What GNOME shows depends on how the app is installed, and app authors should know it before they
design around it. GNOME's "Background Apps" list in the quick settings reads
`org.freedesktop.background.Monitor`, whose entries carry a Flatpak `instance`
([docs](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.background.Monitor.html));
the portal maintainers state that unsandboxed apps are not listed, because outside a sandbox there
is no "application" to map a process to
([xdg-desktop-portal#899](https://github.com/flatpak/xdg-desktop-portal/issues/899)). A host
(deb/rpm) app also needs an app ID for the Background portal to grant autostart: the portal derives
it from an `app-…` systemd unit or from the host Registry, which `GtkApplication` registers during
startup if no portal call came first
([GNOME blog, 2025](https://blogs.gnome.org/ignapk/2025/06/04/using-portals-with-unsandboxed-apps/)).

| Installed as | In GNOME's Background Apps list | Status icon on GNOME |
|---|---|---|
| Flatpak | yes, with the `set_background_status` line, while it runs without a window | only with the AppIndicator extension |
| deb / rpm | no | only with the AppIndicator extension |

For a Flatpak on GNOME, `hold()` plus `request_background` IS the native answer and needs no icon.
What the ✕ in that list does to the app is UNVERIFIED; an app must treat it as a quit request.

### 2. The status icon: an own interface, until a portal exists

`@gjsify/status-icon` exports one GObject class, `StatusIcon`. No portal or GTK 4 API exists, so
this is gjsify's own interface under ADR 0101's preference rule: if a status-icon portal appears,
`StatusIcon` is re-expressed as that portal's contract and the drivers below stay.

| Member | Semantics |
|---|---|
| `icon-name` | a themed icon name; the only icon input |
| `title`, `tooltip` | one string each |
| `menu` | a real `Gio.MenuModel` (ADR 0128); actions resolve through the application's `Gio.ActionGroup` |
| `visible` | show or hide the item |
| `activate` signal | primary click |
| `available` | **read before building UI**: `false` when no host will display the item |

Property names follow `AyatanaAppIndicatorGlib.Indicator` where the meaning is the same (`icon-name`,
`title`, `menu`, its `connected` ≈ our `available`), so the shape is familiar. The import is NOT
`gi://AyatanaAppIndicatorGlib`, because the wire protocol differs (§ 3), and under ADR 0101 the real
library would answer on GJS with menus no host reads.

Refused by name rather than approximated: badges and counts, pixmap and animated icons
(`IconPixmap`, `AttentionMovieName`), overlay and attention icons, labels next to the icon,
scroll events, notifications (that is the Notification portal), and anything the macOS menu bar or
the Windows shell offers that the other two cannot express.

`available` is the load-bearing honesty: it is `false` on a GNOME session without a host and inside
a Flatpak that may not talk to the watcher, and an app that reads it keeps its in-window affordance
instead of shipping a dead feature.

### 3. Linux: a StatusNotifierItem exported over Gio, with our own dbusmenu exporter

The item is `org.kde.StatusNotifierItem`, registered with `org.kde.StatusNotifierWatcher`, exported
from our own process with `Gio.DBusConnection` — no system dependency, no native addon, the same
code on GJS and node-gi. Its surface is fixed: properties `Category, Id, Title, Status, WindowId,
IconThemePath, Menu (o), ItemIsMenu (b), IconName, IconPixmap, OverlayIconName/Pixmap,
AttentionIconName/Pixmap, AttentionMovieName, ToolTip`, methods `ProvideXdgActivationToken,
ContextMenu, Activate, SecondaryActivate, Scroll`, and the `New*` signals
([KDE's interface XML](https://invent.kde.org/frameworks/kstatusnotifieritem/-/raw/master/src/org.kde.StatusNotifierItem.xml)).
We implement the subset § 2 promises.

That is a D-Bus *server* for a desktop-shell protocol, not a client to a portal, so ADR 0101's
"no hand-written D-Bus client" does not apply; SNI has no portal equivalent, which is why it lives
here and not behind `Xdp`.

**The menu is the one real cost, and the alternatives are measured out.** `Menu` must point at a
`com.canonical.dbusmenu` object. GLib's `g_dbus_connection_export_menu_model` exports GLib's own
`org.gtk.Menus`, documented as an API that "should be considered private"
([Gio docs](https://docs.gtk.org/gio/method.DBusConnection.export_menu_model.html)).
`libayatana-appindicator-glib` takes exactly that route — `Gio.MenuModel` exported as
`org.gtk.Menus`, "100% dbusmenu-free"
([README](https://github.com/AyatanaIndicators/libayatana-appindicator-glib/)) — and is therefore
not read by other SNI hosts: its own issue tracker records it as incompatible with KDE, and the
maintainer of the GNOME AppIndicator extension declines to follow it ("it's just not the standard")
([ayatana#89](https://github.com/AyatanaIndicators/libayatana-appindicator-glib/issues/89)). The
GTK 3 `libayatana-appindicator` speaks dbusmenu but needs a `GtkMenu` and GTK 3 in our runtime
closures. So the package ships its own dbusmenu exporter driven from a `Gio.MenuModel`. It is also
the first consumer of the menu-over-D-Bus hook ADR 0128 noted has none.

**How it degrades.** The watcher has an `IsStatusNotifierHostRegistered (b)` property and
`StatusNotifierHostRegistered` / `Unregistered` signals
([XML](https://invent.kde.org/frameworks/kstatusnotifieritem/-/raw/master/src/org.kde.StatusNotifierWatcher.xml)).
The driver reads the property, watches the signals and drives `available` from them, so a GNOME
session where a host exists only through the AppIndicator extension
(<https://extensions.gnome.org/extension/615/appindicator-support/>) is not special-cased: the host
is there or it is not. Inside a Flatpak, nothing grants `--talk-name=org.kde.StatusNotifierWatcher`
by default; without it, `available` is `false` even on a desktop that has a host.

### 4. macOS: `NSStatusItem` behind an ObjC→GObject shim

`NSStatusItem` comes from `NSStatusBar.statusItem(withLength:)` and carries `button`, `menu`,
`isVisible`, `length`, `behavior` and `autosaveName`
([AppKit](https://developer.apple.com/documentation/appkit/nsstatusitem)).

- **Recommended: a shim in the ADR 0022 pattern** — `.h`/`.m` under `src/objc`, a GIR and typelib,
  built with meson, shipped as `@gjsify/status-icon-native` plus `-darwin-arm64` / `-darwin-x64`
  behind `optionalDependencies` (ADR 0017), as `packages/framework/webkit-native` does. Status-item
  callbacks arrive on the main CFRunLoop; ADR 0022 found that a `GMainContext` never looks at
  CFRunLoop sources and needs a drain source. Whether that bridge is reusable as code or only as a
  finding is open.
- Rejected: script-side FFI for ObjC message sends (none is sanctioned on GJS, and selector-level
  AppKit calls are untestable here); a helper subprocess over a pipe (a second binary and a
  lifecycle whose failures the app cannot see).

The `GMenuModel` is translated into an `NSMenu` in the shim. The Dock entry is NOT this package's
business: `NSApplication.setActivationPolicy(_:)` is how an app hides it while windowless
([AppKit](<https://developer.apple.com/documentation/appkit/nsapplication/setactivationpolicy(_:)>));
`LSUIElement` would make it dockless always
([Bundle Resources](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement)).
That belongs with the macOS driver for `hold()`/background, when it is built.

### 5. Windows: `Shell_NotifyIconW` with a pump on its own thread

`Shell_NotifyIconW(dwMessage, PNOTIFYICONDATAW)` with `NIM_ADD / MODIFY / DELETE / SETFOCUS /
SETVERSION`; `NIM_SETVERSION` must follow every `NIM_ADD` and is not persisted across logoff; with
`NOTIFYICON_VERSION_4` the shell sends `WM_CONTEXTMENU`, `NIN_SELECT` and `NIN_KEYSELECT` through
the app-defined callback message
([Win32](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)).
The callback needs an `HWND`, and an `HWND` needs a thread that pumps messages, while the GLib main
loop already owns the main thread.

- **Recommended: a message-only window pumped on a dedicated thread inside the addon**, with events
  marshalled one way into the GLib main context. It leaves the main loop untouched, which matters
  on the thinnest-tested target.
- Rejected: a `GSource` that calls `PeekMessage` each iteration (polling latency or a busy loop);
  replacing the main loop's wait with `MsgWaitForMultipleObjects` (the largest change, for one
  icon).

Whether node-gi can host an addon that owns a thread and posts into the GLib context safely is
UNVERIFIED, and this section's design depends on it. The context menu is built from the
`GMenuModel` as a `HMENU` on `WM_CONTEXTMENU`.

### 6. Facts for the future Background drivers (not decided here)

Recorded so the ADR 0101 row starts from them:

- **macOS autostart:** `SMAppService` (macOS 13.0+) — `mainApp`, `loginItem(identifier:)`,
  `register()` / `unregister()`, `status`, `openSystemSettingsLoginItems()`
  ([ServiceManagement](https://developer.apple.com/documentation/servicemanagement/smappservice)).
  The `autostart` flag of `request_background` maps to `mainApp.register()`.
- **Windows autostart:** the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value works for an
  unpackaged app, and the system may delay Run entries
  ([Win32](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)).
  MSIX `uap5:StartupTask` with `Windows.ApplicationModel.StartupTask` has a real state
  (`Disabled`, `DisabledByUser`, `DisabledByPolicy`, `Enabled`)
  ([WinRT](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask)) but
  needs a packaged app, and ADR 0024 ships none. Whether a driver can read that the user disabled a
  Run entry in Task Manager (reportedly under `Explorer\StartupApproved\Run`) is UNVERIFIED.
- **Permission:** neither macOS nor Windows asks to run windowless; the driver grants and reports
  `background: true`, and `set_background_status` throws by name there.

### 7. Tier 3, isolated, tested as far as a runner can see

`@gjsify/status-icon` starts at **Tier 3** (ADR 0003 rule 3). It declares no dependency on
`@gjsify/node-gi` (ADR 0005); the native shims are `optionalDependencies` with `os` and `cpu`
fields (ADR 0017, ADR 0018), so a Linux install pulls no darwin or win32 artifact. The Windows
driver cannot rise above Tier 3 regardless, because the only Windows engine is node-gi (ADR 0024).

CI reuses what exists: the Linux GUI recipe in `.github/workflows/node-gi.yml`
(`xvfb-run -a dbus-run-session -- …`), `macos-suites.yml` (arm64 always, x64 behind the
`ci:macos` label) with `prebuilds.yml` publishing the darwin targets, and `windows-suites.yml`,
where `test:gjs` does not run, so Windows is tested through node-gi or not at all.

Testable on a runner: under `dbus-run-session`, a **fake StatusNotifierWatcher in the test** sees
our item register, `GetAll` returns exactly the § 2 property set, and `available` flips with the
host signals; a fake host walks the dbusmenu export and gets the labels, sections and action names
of the source model. Not testable on a runner: that the macOS menu bar, the Windows notification
area or the AppIndicator extension actually show the item. Acceptance there is **the call sequence
succeeds and the resources are released**; anything beyond is a manual check on real hardware
(macOS arm64, a Windows VM), recorded in the PR, and stated as one person's observation, not CI's.

Privacy: the package opens no socket other than the session bus, sends nothing anywhere, and a
review that finds otherwise treats it as a defect.

### 8. Order

Linux first: it needs no native code, so it validates the API against real desktops at the lowest
build cost, and the native drivers then implement a proven interface.

1. **Skeleton and the refusal path.** AC: import succeeds on every target; every unimplemented
   member throws an error naming it.
2. **The SNI item, menuless.** AC: the fake watcher sees registration and the exact property set;
   `available` follows the host signals.
3. **The dbusmenu exporter from a `Gio.MenuModel`.** AC: the fake host's walk equals the model.
4. **The macOS shim.** AC: the darwin-arm64 leg builds it, and a test creates and drops an item
   with no leak.
5. **The Windows addon.** AC: `NIM_ADD`, `NIM_SETVERSION`, `NIM_MODIFY`, `NIM_DELETE` return
   nonzero, and the pump thread joins on shutdown.

## Consequences

- Background running needs no new gjsify API: GJS apps on Linux can call `hold()` and `Xdp`
  today; other hosts get drivers under ADR 0101 when an app asks.
- Apps get a status icon without learning three platform APIs. The API is smaller than any one
  platform's, by design.
- Two native build axes on a Tier-3 package; the Windows one introduces this repository's first
  message pump, the riskiest piece.
- A hand-written dbusmenu exporter becomes ours to maintain, because the GLib-only route speaks a
  protocol no host reads.
- On GNOME without the AppIndicator extension there is no icon. A Flatpak is still listed under
  Background Apps; a deb/rpm install has no shell-side presence at all, so its window must stay
  reachable by relaunching the app.

## Open questions

1. **The `com.canonical.dbusmenu` interface is not read from a primary source here.** Its method
   and signal list decides cut 3's size, and whether `ItemIsMenu = false` plus handling
   `Activate`/`ContextMenu` ourselves avoids part of it.
2. **Whether GNOME Shell has no SNI host in its base.** Only the AppIndicator extension's own
   description supports it. The driver reads the watcher either way.
3. **Whether the AppIndicator extension honours `ItemIsMenu` and `ProvideXdgActivationToken`.**
   It decides whether a left click can do anything but open the menu on GNOME.
4. **Whether node-gi can host a thread-owning addon** (§ 5).
5. **Whether ADR 0022's CFRunLoop bridge is reusable as code** (§ 4).
6. **A second consumer.** ADR 0003's promotion gate needs one; Beifahrer is the first.
