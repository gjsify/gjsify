# 129. Background operation and a status icon, on every desktop

- Status: **Proposed** (owner, 2026-11-02)
- Date: 2026-11-02
- Deciders: Pascal Garber
- Depends on: [ADR 0101 (portals are the platform seam below the GTK API)](0101-portals-are-the-platform-seam-below-the-gtk-api.md)
  — the Background portal is a portal, so it belongs behind that seam and is CONSUMED here, not
  reimplemented; [ADR 0128 (a menu model is a real menu model)](0128-a-menu-model-is-a-real-menu-model.md)
  — the icon's menu is a real `Gio.MenuModel`, and what is not implemented is refused BY NAME;
  [ADR 0003 (package tiering)](0003-package-tiering.md) rule 3 (new axes start at Tier 3);
  [ADR 0005 (node-gi scope)](0005-node-gi-scope.md) (the dependency-isolation rule);
  [ADR 0017 (native package distribution)](0017-native-package-distribution.md) (per-target
  packages behind `optionalDependencies`)
- Related: [ADR 0022 (WebKit on darwin)](0022-webkit-on-darwin.md) — the ObjC→GObject shim pattern
  and the CFRunLoop-vs-`GMainContext` finding; [ADR 0024 (ship installable artifacts)](0024-ship-installable-artifacts.md)
  — the Windows artifact is a program directory, not MSIX, and there is no GJS host on Windows;
  [ADR 0074 (one declared macOS floor)](0074-one-declared-macos-floor.md) — floor 15.0, so
  `SMAppService` is unconditionally available; [ADR 0018 (OS axis declaration)](0018-os-axis-declaration.md);
  [ADR 0122 (a string list is a real list model)](0122-a-string-list-is-a-real-list-model.md)
  (the seam's object-kind rule)

## Rule for every stage

The API is one API with three drivers. A driver may implement a strict SUBSET: the same names
with the same semantics, and what it does not implement is refused BY NAME — never silently
ignored, never faked. Where a platform cannot answer a question, the API says so through a
capability the caller can read BEFORE it builds UI around the feature.

## Context

Beifahrer (<https://github.com/JumpLink/beifahrer>) is a GJS app on Linux and macOS and a node-gi
app on Windows — one app per OS. It has a window and a bridge CLI, and the bridge needs no
daemon: the agent starts it as a subprocess. What it does not have is a way to keep running with
its window closed, and no status icon to get the window back from. That is its deferred Phase 7.

Nothing about this is Beifahrer-specific. A grep across this repository finds no tray code, no
`StatusNotifierItem`, and no `packages/gjs/xdp` — the `@gjsify/xdp` package ADR 0101 plans does
not exist yet. So the capability is missing platform-wide, every gjsify app will want it, and it
gets built into the platform rather than into the one consumer that noticed it was missing.

The hard part is that the three platforms share almost nothing. Linux has a sandbox-aware
permission call (a portal) plus a desktop-shell protocol for the icon that the dominant desktop
does not implement in its base shell. macOS has a framework object for the icon, a separate
service API for the login item, and a third, independent switch for the Dock. Windows has a
single 1996-vintage shell call for the icon that requires a window and a message pump, and three
competing autostart mechanisms whose availability depends on how the app was packaged. An API
that pretends these are the same thing will be wrong on at least two platforms.

## Decision

A new Tier-3 package **`@gjsify/background`** with two objects and one driver per OS.

### 1. The API: the honest intersection, and a capability bit for everything else

`BackgroundSession` — permission to keep running, and the login item:

| Member | Semantics | Linux | macOS | Windows |
|---|---|---|---|---|
| `request({ reason })` | ask to keep running after the last window closes | `RequestBackground` | no-op, always granted | no-op, always granted |
| `granted` | result of the ask | portal result `background (b)` | `true` | `true` |
| `setStatus(message)` | one short user-visible line | `SetStatus`, ≤ 96 chars | refused by name | refused by name |
| `setAutostart(enabled)` | start on login, reversibly | portal `autostart` | `SMAppService` | Run key |
| `autostart` | current state, incl. "the user revoked it" | portal result `autostart (b)` | `SMAppService.status` | Run value present |
| `hideFromTaskSwitcher(bool)` | no Dock/taskbar entry while backgrounded | refused by name | activation policy | refused by name |

`StatusIcon` — the icon:

| Member | Semantics |
|---|---|
| `iconName` | a themed icon name; the only icon input the API takes |
| `tooltip` | one string |
| `menu` | a real `Gio.MenuModel` (ADR 0128), actions resolved through the app's `Gio.ActionGroup` |
| `visible` | show/hide the item |
| `activate` signal | primary click |
| `available` | **read before building UI**: `false` when no host will display the item |

Deliberately NOT covered, and refused by name rather than approximated: badges and counts,
pixmap and animated icons (`IconPixmap`, `AttentionMovieName`), overlay and attention icons,
notifications (that is a different API and a different ADR), scroll events, submenu-level
platform affordances, and anything the macOS menu bar or the Windows shell offers that the other
two cannot express.

`available` is the load-bearing honesty: it is `false` on a GNOME session with no SNI host and
`false` inside a Flatpak sandbox with no bus access, and a consumer that reads it keeps its
in-window affordance instead of shipping a dead feature.

### 2. Linux: the portal for permission, StatusNotifierItem for the icon, no native code

Permission is not a choice. `org.freedesktop.portal.Background` v2 is the only mechanism that
works inside and outside a sandbox: `RequestBackground(parent_window s, options a{sv}) → handle o`
with options `handle_token`, `reason`, `autostart (b)`, `commandline (as)`, `dbus-activatable (b)`,
and results `background (b)` and `autostart (b)`; `SetStatus(options)` carries `message (s)`,
documented as ≤ 96 characters and added in v2
([portal docs](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Background.html)).
One call buys both the permission and the login item, which is why `setAutostart` on Linux is the
same request with a different flag and not a second mechanism.

The icon is a choice, and these are the options:

- **`org.kde.StatusNotifierItem`, exported from our own process over Gio.** No new system
  dependency, no native addon: `Gio.DBusConnection` can own a name and register an object on both
  GJS and node-gi. Cost: the `Menu` property is an object path to a `com.canonical.dbusmenu`
  object, and GLib's `g_dbus_connection_export_menu_model` is documented as exporting an API that
  "should be considered private"
  ([Gio docs](https://docs.gtk.org/gio/method.DBusConnection.export_menu_model.html)) — it is
  GLib's own `org.gtk.Menus`, which no SNI host reads. So the menu needs a dbusmenu exporter
  written by hand, driven from a `Gio.MenuModel`.
- **libayatana-appindicator through its GIR.** The exporter comes for free. Cost: a system
  library that is in none of our runtime closures and would have to be bundled for Flatpak and
  for the relocated darwin/Windows closures where it does not exist at all — a dependency bought
  for one platform's convenience.
- **No icon on Linux; lean on `org.freedesktop.background.Monitor`** (v1, property
  `BackgroundApps aa{sv}` with keys `app_id`, `instance`, `message`,
  [docs](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.background.Monitor.html)),
  which is where a GNOME user already manages background apps. Cost: no way back to the window
  from the shell on the desktops that DO have a host.

**Recommendation: the first.** The property and method surface is small and fixed — properties
`Category, Id, Title, Status, WindowId, IconThemePath, Menu (o), ItemIsMenu (b), IconName,
IconPixmap, OverlayIconName/Pixmap, AttentionIconName/Pixmap, AttentionMovieName, ToolTip`,
methods `ProvideXdgActivationToken, ContextMenu, Activate, SecondaryActivate, Scroll`, signals
`NewTitle, NewIcon, NewAttentionIcon, NewOverlayIcon, NewMenu, NewToolTip, NewStatus`
([KDE's own interface XML](https://invent.kde.org/frameworks/kstatusnotifieritem/-/raw/master/src/org.kde.StatusNotifierItem.xml)),
and we implement the subset § 1 promises. The hand-written dbusmenu exporter is the one real cost,
and it is the right cost: it keeps the public API a real `Gio.MenuModel` per ADR 0128, and it is
the first consumer of the menu-over-D-Bus hook that ADR 0128 noted has none.

**How it degrades.** `org.kde.StatusNotifierWatcher` has a `IsStatusNotifierHostRegistered (b)`
property and `StatusNotifierHostRegistered`/`Unregistered` signals
([XML](https://invent.kde.org/frameworks/kstatusnotifieritem/-/raw/master/src/org.kde.StatusNotifierWatcher.xml)).
The driver reads that property, watches the signals, and drives `available` from it — so a GNOME
session where support arrives only via the AppIndicator extension (which describes itself as
adding "AppIndicator, KStatusNotifierItem and legacy Tray icons support to the Shell",
<https://extensions.gnome.org/extension/615/appindicator-support/>) is not a special case in our
code at all: the host is there or it is not, and `available` says which.

**GNOME's "Background Apps" list is a Flatpak feature.** The list in the quick settings (what a
user sees for Errands) is the Monitor above: `instance` is a Flatpak instance, and the portal
maintainers state that unsandboxed apps are not listed, because outside a sandbox there is no
"application" to map a process to
([xdg-desktop-portal#899](https://github.com/flatpak/xdg-desktop-portal/issues/899)). So the
sessions are not equal, and the API says so instead of hiding it:

| Distribution | Listed in GNOME's Background Apps | Status icon on GNOME |
|---|---|---|
| Flatpak | yes, with the `SetStatus` line, while it runs without a window | only with the AppIndicator extension |
| deb / rpm | no | only with the AppIndicator extension |

For a Flatpak, `request()` plus `setStatus()` IS the native GNOME answer and needs no icon at all;
`StatusIcon` is the answer for KDE, XFCE and everything with a host, and for unsandboxed GNOME
users with the extension. An app on GNOME therefore reads `StatusIcon.available` AND whether it
runs in a sandbox before deciding where its "show window" affordance lives. How the entry is
dismissed from the shell (the ✕ in the list) is not covered here and is UNVERIFIED; the app must
treat it as a quit request.

**Fit with ADR 0101.** Background is a portal, so it goes behind the `@gjsify/xdp` seam ADR 0101
describes, and `@gjsify/background` is a consumer of it. StatusNotifierItem is NOT a portal — it
is a desktop-shell protocol with no portal equivalent — so its implementation lives in this
package. That line is worth stating because it is the first case where a feature straddles it.

### 3. macOS: `NSStatusItem`, `SMAppService`, and the activation policy — three separate things

Verified surface. `NSStatusItem` is created by `NSStatusBar.statusItem(withLength:)` and carries
`button` (an `NSStatusBarButton`), `menu` (an `NSMenu`), `isVisible`, `length` /
`squareLength` / `variableLength`, `target`/`action`, `behavior` and `autosaveName`
([AppKit](https://developer.apple.com/documentation/appkit/nsstatusitem)). The login item is
`SMAppService` — macOS 13.0+, `mainApp`, `agent(plistName:)`, `daemon(plistName:)`,
`loginItem(identifier:)`, `register()` / `unregister()`, `status`, and
`openSystemSettingsLoginItems()`, replacing `SMLoginItemSetEnabled`
([ServiceManagement](https://developer.apple.com/documentation/servicemanagement/smappservice));
ADR 0074's floor of 15.0 means no availability branch. The Dock is a third, independent switch:
`LSUIElement`, an Info.plist boolean since macOS 10.0, "a Boolean value indicating whether the app
is an agent app that runs in the background and doesn't appear in the Dock"
([Bundle Resources](https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement)),
versus `NSApplication.setActivationPolicy(_:)`, macOS 10.6+, with any policy settable since 10.9
([AppKit](<https://developer.apple.com/documentation/appkit/nsapplication/setactivationpolicy(_:)>)).

How gjsify reaches AppKit:

- **An ObjC→GObject shim in the ADR 0022 pattern** — `.h`/`.m` under `src/objc`, a GIR and
  typelib, built with meson, shipped as `@gjsify/background-native` plus
  `-darwin-arm64` / `-darwin-x64` behind `optionalDependencies` (ADR 0017), exactly as
  `packages/framework/webkit-native` already does. Cost: a native build axis and two prebuild
  targets.
- **An FFI from the script side.** Cost: no sanctioned FFI exists on GJS for ObjC message sends,
  and selector-level calls to AppKit from script is a class of bug this repository has no way to
  test. Not a serious option.
- **A helper subprocess speaking a private protocol over a pipe.** Cost: a second binary, a
  second lifecycle, and the status item dies in ways the app cannot see.

**Recommendation: the shim.** It is the pattern the repository already proves, and the hardest
part is already recorded: ADR 0022 found the CFRunLoop-vs-`GMainContext` bridge, and status-item
callbacks arrive on the main CFRunLoop, so the bridge is reused rather than invented a second time.

**Recommendation for the Dock:** `setActivationPolicy(.accessory)` when the app enters background
mode, and back to `.regular` when a window opens. Do NOT ship `LSUIElement = true`: it is static
bundle metadata, it makes the app dockless always, and `hideFromTaskSwitcher` has to be reversible.

### 4. Windows: `Shell_NotifyIconW`, a pump on its own thread, and the Run key for now

Verified surface. `Shell_NotifyIconW(dwMessage, PNOTIFYICONDATAW)` with
`NIM_ADD / MODIFY / DELETE / SETFOCUS / SETVERSION`; `NIM_SETVERSION` must follow every `NIM_ADD`
and is not persisted across logoff; with `NOTIFYICON_VERSION_4` the shell sends `WM_CONTEXTMENU`,
`NIN_SELECT` and `NIN_KEYSELECT` as the `lParam` of the app-defined `uCallbackMessage`
([Win32](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)).
That callback needs an `HWND`, and an `HWND` needs a thread that pumps messages — which is the
only genuinely new problem on this platform, because the GLib main loop is already running on the
main thread.

- **Pump on a dedicated thread inside the addon**, with events marshalled into the GLib main
  context. Cost: one thread and one careful hand-off.
- **A `GSource` that calls `PeekMessage` on the main thread each iteration.** Cost: either a
  polling interval, which shows up as click latency, or a busy loop; and the icon's window then
  shares a thread with everything else that can block it.
- **A real loop bridge on `MsgWaitForMultipleObjects`.** Cost: replacing the main loop's wait on
  Windows — the largest change here, for a feature that is one icon.

**Recommendation: the dedicated thread.** The icon's window is message-only, owns no UI and does
nothing but pump; the hand-off is one-way into the GLib context, which is the shape of hand-off
GLib supports directly. This leaves the main loop untouched, which matters because the Windows
target is already the thinnest-tested one.

Autostart, three mechanisms:

- **`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`** — a command line ≤ 260 characters;
  Microsoft states the system gives no promptness guarantee and may deliberately delay Run and
  Startup entries
  ([Win32](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)).
  Works for any unpackaged app; the user can disable it in Task Manager, which our `autostart`
  getter will then disagree with unless it reads that state — and it cannot.
- **A shortcut in the Startup folder.** Same behaviour, plus having to write a `.lnk`. No
  advantage over the Run key.
- **MSIX `uap5:StartupTask`** (namespace `.../uap/windows10/5`, min Windows 10 1709/16299,
  attributes `TaskId`, `Enabled`, `DisplayName`, `uap11:UserConfigurable`,
  [schema](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap5-startuptask))
  driven by `Windows.ApplicationModel.StartupTask` — `GetAsync`, `RequestEnableAsync`, `Disable`,
  and a `State` of `Disabled`, `DisabledByUser`, `DisabledByPolicy` or `Enabled`; for a packaged
  desktop app `RequestEnableAsync` shows no consent dialog, and the user stays in control from
  Settings and Task Manager
  ([WinRT](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask)).
  Cost: it requires a packaged app, and ADR 0024 ships a program directory with an installer or a
  portable zip — there is no MSIX channel to put a manifest in.

**Recommendation: the Run key now, `StartupTask` the moment an MSIX channel exists.** The second
mechanism is clearly better — it has a real state machine and an honest user-revocation story —
and it is unreachable today. What the better mechanism changes NOW is the interface: because
`StartupTask` distinguishes `DisabledByUser` and `DisabledByPolicy`, `autostart` is a state the
caller reads, not a boolean the caller owns, and `setAutostart(true)` may legitimately end with
autostart still off. Designing that in today is free; retrofitting it is not.

### 5. Tier 3, isolated, and tested only as far as a runner can see

The package starts at **Tier 3** — ADR 0003 rule 3 makes that automatic for a new axis, and
nothing here argues for an exception: two of three drivers need native code that no maintainer
can regression-test by hand on every release.

Isolation per ADR 0005: `@gjsify/background` declares no `dependencies` or `optionalDependencies`
on `@gjsify/node-gi`. The native shims are `optionalDependencies` with `os` and `cpu` fields
(ADR 0017, ADR 0018), so a Linux install pulls no darwin or win32 artifact. The node-gi side
stays experimental and the Windows driver cannot be better than Tier 3 regardless of how well it
works, because ADR 0024 records that there is no GJS host on Windows at all — the only Windows
engine is the experimental one.

Prebuilds and CI, reusing what exists rather than adding a matrix:

- Linux lands in the existing GTK and node-gi suites. The one GUI recipe in this repository is
  `.github/workflows/node-gi.yml` — `xvfb-run -a dbus-run-session -- env GSK_RENDERER=cairo
  GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none`, plus a headless-weston leg — and that is
  what the Linux tests use. (gjsify has no `./scripts/headless-run`; that is a werkstatt script.)
- macOS: `macos-suites.yml` already has `macos-latest` (arm64) and `macos-15-intel` (x64, gated on
  a `ci:macos` PR label). The shim builds there; `prebuilds.yml` publishes the two targets.
- Windows: `windows-suites.yml` on `windows-latest`, where `test:gjs` does not run — so the
  Windows leg tests the addon through node-gi or not at all.

What is testable, and this is the measurable part: `dbus-run-session` plus a **fake
StatusNotifierWatcher written in the test** gives a real assertion — our item registers with the
watcher, answers `Introspect` and `GetAll`, and reports exactly the property set § 1 promises. The
dbusmenu exporter is testable the same way, against a fake host that walks the menu. Neither
needs a desktop shell.

What is NOT testable on a runner: that the macOS menu bar actually shows the item, that the
Windows notification area actually shows the icon, that the AppIndicator extension renders our
menu, or that a login item survives a reboot. Acceptance for those is therefore defined as **the
call sequence succeeds and the resources are released** — `statusItem(withLength:)` returns an
item and dropping it is clean; `NIM_ADD` then `NIM_SETVERSION` then `NIM_DELETE` all return
nonzero and the pump thread joins. Anything beyond that is a manual check on real hardware
(macOS arm64 laptop, a Windows VM), recorded in the PR description, and the ADR says plainly that
those claims rest on one person's eyes rather than on CI.

### 6. Privacy and security

No network, no telemetry, no analytics, ever — the package opens no socket other than the session
bus, and a review that finds one should treat it as a defect. Autostart is set only from an
explicit user action in the consuming app's own UI, never as a side effect of `request()`, and
`setAutostart(false)` fully undoes it on every platform: the portal request with `autostart:
false`, `SMAppService.unregister()`, deleting the Run value. The portal's `SetStatus` message is
user-visible text with a 96-character budget; it carries what the user's app chose to show and
nothing derived from their data.

Sandbox limits, stated rather than worked around: in a Flatpak, `RequestBackground` can be denied
and denial is a NORMAL return (`background: false`), not an error. Nothing grants
`--talk-name=org.kde.StatusNotifierWatcher` by default, so inside a sandbox the icon may be
unavailable even on a desktop that has a host — which is the same `available === false` path as
GNOME-without-the-extension, and the reason that bit exists instead of a platform check.

### 7. Linux first, in seven cuts with one acceptance criterion each

A vertical slice — one thin feature across all three platforms first — would front-load both
native build axes before the API shape is settled, and the two platforms whose cost is highest are
also the two that CI can barely verify. **Linux first**, because its driver needs no native code
at all and therefore validates the API against a real desktop at the lowest possible build cost;
the native work then implements a proven interface instead of defining one.

1. **Package skeleton, the interface, the refusal path.** AC: importing on every target succeeds,
   and every member a driver does not implement throws an error that names the member.
2. **`BackgroundSession` on the Background portal.** AC: against a stub portal, `request()`
   surfaces both result bits independently, and `setStatus()` refuses a message over 96 chars.
3. **The StatusNotifierItem, menuless.** AC: a fake watcher in the test sees the registration and
   reads every property in § 1 with the right signature; `available` flips with the host's
   registration signals.
4. **The dbusmenu exporter, driven from a `Gio.MenuModel`.** AC: a fake host walks the exported
   menu and gets the same labels, sections and action names as the model it was built from.
5. **The macOS shim.** AC: the darwin-arm64 leg builds the addon, and a test creates and destroys
   a status item with no leak; the activation-policy switch round-trips.
6. **The Windows addon.** AC: the windows leg runs `NIM_ADD`, `NIM_SETVERSION`, `NIM_MODIFY`,
   `NIM_DELETE` with nonzero returns, and the pump thread joins on shutdown.
7. **Autostart, per platform.** AC: enable then disable leaves no trace — no portal autostart, no
   login item, no Run value — asserted by reading the mechanism back, not by trusting the setter.

## Consequences

- Apps get background operation and a status icon without a per-app reimplementation, and
  Beifahrer's Phase 7 becomes consuming a package instead of learning three platform APIs.
- The API is smaller than any one platform's. That is the deliberate trade: a caller that reads
  `available` and handles a refusal gets the same code path everywhere, and a caller that wants a
  badge or an animated icon is told no by name instead of getting silence.
- Two new native build axes (darwin, win32) and their prebuild targets, on a Tier-3 package. The
  darwin one follows an existing pattern; the Windows one introduces this repository's first
  message pump, which is the single riskiest piece of the decision.
- A hand-written `com.canonical.dbusmenu` exporter becomes ours to maintain, because GLib's menu
  exporter speaks a private protocol no SNI host reads.
- On GNOME without the AppIndicator extension there is no icon, and the ADR does not pretend
  otherwise. A Flatpak is still managed where GNOME already puts background apps; a deb/rpm
  install is not listed there and has no shell-side presence at all, so its window must stay
  reachable some other way (relaunching the app, the activation path).

## Open questions

1. **The `com.canonical.dbusmenu` interface itself is UNVERIFIED here.** Its method, property and
   signal list was not read from a primary source in this pass, so the exporter's actual cost — and
   whether `ItemIsMenu = false` plus handling `Activate`/`ContextMenu` ourselves is a viable way to
   avoid it — is not yet established. Nothing in § 2 depends on the exporter's shape; cut 4 does.
2. **Whether GNOME Shell truly ships no SNI host in its base.** The only evidence gathered is the
   AppIndicator extension's own self-description. The decision does not rest on it — the driver
   reads `IsStatusNotifierHostRegistered` either way — but the sentence in § 2 should be confirmed
   before it is repeated as fact.
3. **Whether the AppIndicator extension honours `ItemIsMenu` and `ProvideXdgActivationToken`.**
   Unverified. It decides whether a left click can do anything other than open the menu on GNOME.
4. **`@gjsify/xdp` does not exist yet.** ADR 0101 plans it; this ADR assumes the Background portal
   arrives through it. If cut 2 lands first, it either creates that package or temporarily talks to
   the portal directly — and the second choice needs a deadline, not a TODO.
5. **Whether node-gi can host an addon that owns its own thread** and marshal into the GLib main
   context safely. Unverified, and cut 6's whole design depends on it.
6. **Whether ADR 0022's CFRunLoop/`GMainContext` bridge is reusable as-is** for status-item
   callbacks, or only the finding is reusable and the code is not.
7. **The package split.** One `@gjsify/background` with both objects, or `@gjsify/background` plus
   `@gjsify/status-icon`? They have different platform costs — the session is pure script on Linux,
   the icon is native on two platforms — which is an argument for two packages that was not settled
   here.
