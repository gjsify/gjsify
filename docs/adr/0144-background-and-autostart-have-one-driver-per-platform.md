# 144. Background running and autostart join `@gjsify/xdp`, with one driver per platform

- Status: **Accepted** (2026-11-14)
- Date: 2026-11-14
- Deciders: Pascal Garber
- Decides: the "Background and Secret in `@gjsify/xdp`" open question of
  [ADR 0138](0138-one-app-inside-and-outside-a-sandbox.md), for Background. Secret stays open.
- Depends on: [ADR 0101](0101-portals-are-the-platform-seam-below-the-gtk-api.md) (portals are the
  platform seam; `@gjsify/xdp` is a true subset of libportal under `gi://Xdp`),
  [ADR 0129](0129-a-status-icon-on-every-desktop.md) § 1 and § 6 (lifetime stays `hold()`; the
  facts the drivers start from), [ADR 0138](0138-one-app-inside-and-outside-a-sandbox.md) (ask for a
  capability, never a mechanism)
- Related: [ADR 0017](0017-native-package-distribution.md) (per-target native packages),
  [ADR 0018](0018-os-axis-declaration.md) (the OS axis), [ADR 0024](0024-ship-installable-artifacts.md)
  (what each OS artifact is; no MSIX today), [ADR 0003](0003-package-tiering.md) rule 3 (a new axis
  starts at Tier 3), [ADR 0032](0032-react-native-on-the-gtk-host.md) § 9 (the platform suffix chain),
  [ADR 0141](0141-a-dock-click-reopens-the-application-on-macos.md) (the darwin ObjC bridge pattern)
- Consumers: [Curlew ADR 0011](https://github.com/JumpLink/curlew/blob/main/docs/adr/0011-same-app-inside-and-outside-a-sandbox.md)
  § 3 piece 3 ("keep receiving" behind an `Autostart` seam, explicitly a stand-in "until gjsify's
  portal table grows a Background row"), [Beifahrer ADR 0024](https://github.com/JumpLink/beifahrer/blob/main/docs/adr/0024-the-window-stays-in-the-background.md)
  § 2, § 4, § 5 (the window stays in the background; autostart is the portal's `autostart` flag, and
  macOS and Windows "wait for gjsify's Background drivers")

## Rule for every stage

The app-facing API is libportal's: a true subset, same names, same semantics. A platform without the
portal gets a gjsify driver that answers what the interface says. A member outside the subset throws,
naming itself. A capability the OS does not have reads as a value, never as a silent success.

## Context

Two apps have arrived at the same wall from different sides.

**Beifahrer** calls the real thing already, and only inside a Flatpak:
`app/src/window/background-portal.ts` loads `gi://Xdp` and `gi://XdpGtk4` lazily inside a `try`,
because a static import of a namespace whose typelib is missing stops the whole window on a deb/rpm
host. It needs GNOME runtime 51; runtime 50 ships no libportal typelib, so there every close quits
(Beifahrer ADR 0024, *Implemented*). Outside the Flatpak, and on macOS and Windows, its autostart
switch is not shown at all.

**Curlew** hand-wrote the wire: `app/src/core/lib/autostart-portal.ts` calls
`org.freedesktop.portal.Background.RequestBackground` over `Gio.DBusConnection`, with its own
`handle_token`, its own `Request` path construction, its own subscription and a 120 s timeout — 100
lines that libportal already has. ADR 0138 rule 3 forbids exactly this ("never through a
hand-written D-Bus call"), and Curlew's own ADR 0011 says the seam moves to gjsify when the
Background row exists. Beside it, `core/actions/autostart.ts` is the systemd driver for hosts, and
`core/platform.ts`'s `backgroundService()` answers `'while-open'` on macOS and Windows: the app
tells the person there is no background mode, because no driver exists.

So the row is needed now, by two consumers, which is ADR 0101's own trigger ("a portal is added when
a GTK/GIO API an app already calls needs it, not before").

### What the Background portal is

`org.freedesktop.portal.Background` ([portal docs](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Background.html)),
reached through libportal as `Xdp.Portal.request_background(parent, reason, commandline, flags,
cancellable, callback)` / `request_background_finish(result) → gboolean`, and
`Xdp.Portal.set_background_status(status, cancellable, callback)` / `set_background_status_finish`
([libportal](https://libportal.org/method.Portal.request_background.html)). `XdpBackgroundFlags` is
`NONE`, `AUTOSTART`, `ACTIVATABLE`.

Three semantics matter more than the signature:

1. **A request is the whole wish, not a delta.** A request *without* `AUTOSTART` removes an existing
   autostart entry. Beifahrer's file documents this and complies: every call there states whether
   autostart is wanted. Any driver must keep that semantics, or an app that asks for background
   permission on a later window close silently disables its own autostart.
2. **There is no query.** The portal has no "is autostart on" method. Curlew's driver therefore
   answers `status(): 'unknown'`, and its comment gives the deeper reason: a person can revoke the
   permission in the system settings behind the app's back, so a remembered answer would be a second
   truth. `unknown` is a state, not a failure.
3. **`reason` and `commandline` are shown and stored.** `reason` goes in the portal's dialog;
   `commandline` is what gets started at login, as the *sandbox* sees it (Curlew passes
   `['curlew', 'daemon']`, Beifahrer `beifahrer --background`).

### What a host (deb/rpm) app needs for it, and what GNOME shows

Recorded in ADR 0129 § 1 and not re-measured here: GNOME's Background Apps list reads
`org.freedesktop.background.Monitor`, whose entries carry a Flatpak `instance`, and the portal
maintainers state unsandboxed apps are not listed because outside a sandbox there is no
"application" to map a process to ([xdg-desktop-portal#899](https://github.com/flatpak/xdg-desktop-portal/issues/899)).
A host app also needs an app ID for the portal to grant autostart at all: the portal derives it from
an `app-…` systemd scope or from the host Registry, which `GtkApplication` registers during startup
if no portal call came first ([GNOME blog, 2025](https://blogs.gnome.org/ignapk/2025/06/04/using-portals-with-unsandboxed-apps/)).

Two consequences for the host case, and they are requirements on the *driver*, not on app code:

- the application id must equal the desktop file's basename
  (`eu.jumplink.curlew.desktop` → `eu.jumplink.curlew`), because that is what the portal resolves
  the ID to a `.desktop` file with; and
- the driver must not call the portal before `Gio.Application` startup has run, or the app ID
  registration the blog describes has not happened yet.

Whether a given host desktop's portal implementation then actually grants autostart is **UNVERIFIED**
— measured on neither GNOME-on-deb nor KDE here. This is the reason the Linux fallback below exists.

### What exists in gjsify today

Measured on `origin/main` with `git grep` / `git ls-tree`, no checkout:

| Looked for | Result |
|---|---|
| `packages/gjs/xdp` | does not exist; `@gjsify/xdp` is an ADR 0101 name with no code |
| `SMAppService`, `ServiceManagement`, `LSSharedFileList` | **no hit anywhere in `packages/`** — gjsify has no macOS login-item bridge |
| a darwin ObjC bridge to copy | `packages/framework/gtk-quartz-native` (`src/objc/gjsify-quartz.m`, ~40 lines, one entry point) plus `-darwin-arm64` / `-darwin-x64` prebuild packages and a row in `.github/prebuild-toolchain/darwin-bridges.mjs` (ADR 0141, ADR 0017) |
| a win32 native package to copy | only `packages/framework/webview2-native` + `webview2-native-win32-x64` |
| registry access from GJS | `packages/framework/adwaita-app/src/appearance/win32.ts`: `reg.exe query` with an argv array, because `g_win32_registry_key_get_value` returns data through an untyped `gpointer` out-parameter that introspection cannot marshal, and `…_key_watch`'s callback has no scope annotation. No JS runtime can read a registry value through GLib |
| optional native loading | `loadOptionalNativeModule()` in `packages/gjs/utils/src/native-library.ts`; a missing prebuild reads as "absent", never as a failed app |
| bus-less D-Bus | `packages/framework/devtools/src/peer-transport.ts`: `Gio.DBusServer`, `unix:tmpdir=` on POSIX, `nonce-tcp:host=127.0.0.1` on win32 because GLib implements no unix-socket transport there (measured under gjs 1.88.1) |
| the build-time platform fork | `desktopSuffixChain()` = `.gtk` → `.<os>` → `.desktop` → base, with `.<os>` from `desktopOsSuffix()` = the **build host**'s `process.platform` (`packages/infra/rolldown-plugin-gjsify/src/plugins/platform-resolve.ts`) |

## Decision

### 1. Background joins the `@gjsify/xdp` subset, with libportal's semantics

The subset of ADR 0101 grows four members and one enum:

| Member | Semantics |
|---|---|
| `Xdp.Portal.request_background(parent, reason, commandline, flags, cancellable, callback)` | libportal's. `parent` is an `XdpParent` (`XdpGtk4.parent_new_gtk`) or `null`. `commandline` is a string array or `null`. |
| `Xdp.Portal.request_background_finish(result) → boolean` | `true` = granted, `false` = the person said no. A cancelled request and a broken portal **throw**, as libportal's does. |
| `Xdp.Portal.set_background_status(status, cancellable, callback)` | one line, at most 96 characters by convention (Beifahrer ADR 0024 § 3); the portal does not promise to show it. |
| `Xdp.Portal.set_background_status_finish(result)` | completes the above. |
| `Xdp.BackgroundFlags` | `NONE`, `AUTOSTART`, `ACTIVATABLE`. |

Three rules bind every driver:

- **Whole wish.** A request carries the complete wanted state. A driver that keeps an autostart entry
  across a request without `AUTOSTART` is wrong. This is the one rule a conformance test must prove
  on every platform, because it is the one an implementer gets wrong by instinct.
- **One result shape:** `granted` / `denied` / `cancelled`. In the GObject API these are
  `_finish → true`, `_finish → false`, and a throw carrying `Gio.IOErrorEnum.CANCELLED`. Nothing else
  is a result; a platform that cannot ask reports `granted` (see § 2) and says so in its doc.
- **A status line the OS does not have is a documented no-op.** `set_background_status` on macOS and
  Windows completes successfully and shows nothing. It does **not** throw. ADR 0129 § 6 said it would
  throw by name; this ADR overrides that, because the call is decoration (Beifahrer already swallows
  its errors) and a throwing decoration call makes every consumer write a `try` that means nothing.
  The no-op is stated in the package README and in the `osNotes`.

`ACTIVATABLE` is accepted by every driver and honoured only on Linux: it means "start me by D-Bus
activation instead of by `commandline`", and no other platform has that concept. Elsewhere it is
ignored, which the README states.

### 2. One driver per platform

| Target | Mechanism | Permission question |
|---|---|---|
| **GJS / Linux, sandboxed** | the real libportal against `xdg-desktop-portal` | the portal's own dialog |
| **GJS / Linux, host (deb/rpm/tar) with a Background portal** | the real libportal, same call | the portal's dialog; needs the app ID of § *What a host app needs* |
| **GJS / Linux, host without a Background portal** | **XDG autostart `.desktop` file** written by the driver | none asked; `granted` |
| **macOS** | `SMAppService` | none asked; `granted` |
| **Windows, unpackaged** | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` via `reg.exe` | none asked; `granted` |
| **Windows, packaged (MSIX)** | `uap5:StartupTask` + `Windows.ApplicationModel.StartupTask` | the system's; **not built** (see below) |
| browser, NativeScript | not applicable: a page and an Android app have other lifetimes | `request_background` throws by name |

**Linux without a portal: an XDG autostart file, not a systemd user unit.** Both work; the
`.desktop` file wins for four reasons.

1. The [XDG Autostart spec](https://specifications.freedesktop.org/autostart-spec/latest/) is
   desktop-neutral and honoured by GNOME, KDE, Xfce and the rest; a systemd user unit requires
   systemd as the user-session manager, which a BSD-ish or runit host does not have, and gjsify's
   Linux containers (ADR 0024, ADR 0142) include a plain tarball that assumes nothing.
2. A `.desktop` entry starts **in the graphical session**, with the session's environment, display
   and bus. A `systemd --user` unit starts in a unit's environment and needs
   `WantedBy=graphical-session.target` plus `systemctl --user import-environment` incantations to get
   there — Curlew's `setup-unit.ts` exists because of that.
3. It is a file write, so it needs no `systemctl` subprocess. ADR 0138's review test names a
   `systemctl` call as a finding; a driver that shells out to it would be the mechanism leaking back
   into the seam gjsify is building to hide it.
4. It is the same shape the portal produces, so the fallback and the portal path are
   interchangeable from the person's point of view: both end up as an entry the desktop's own
   "Startup Applications" UI lists and can remove. That the portal's *backends* implement autostart
   by writing such a file is the obvious reading of the interface but **UNVERIFIED** here — the
   xdg-desktop-portal backend source was not read for this ADR.

The file is `$XDG_CONFIG_HOME/autostart/<app-id>.desktop`, written with `Gio.File.replace`, with
`Type=Application`, `Name` from the metainfo, `Exec` from `commandline` (shell-quoted),
`X-GNOME-Autostart-enabled=true` and a `X-GJSIFY-Background=true` marker so the driver only ever
deletes a file it wrote. Removing autostart deletes the file. Because the driver owns the file it
*can* answer a query — but it must not claim more than it knows, so `status` is not part of this
ADR's subset at all: libportal has none, and adding one only where a file exists would make app code
branch on the platform again.

**macOS: `SMAppService`, and which factory depends on who runs in the background.** macOS 13+
([ServiceManagement](https://developer.apple.com/documentation/servicemanagement/smappservice)) has
`SMAppService.mainApp`, `.agent(plistName:)`, `.daemon(plistName:)` and `.loginItem(identifier:)`,
each with `register()`, `unregister()` and `status`. The decision:

- **`mainApp` when the app process itself is what stays resident.** That is Beifahrer: one process,
  a window it hides, `hold()` keeping it alive. `SMAppService.mainApp.register()` is exactly "launch
  this app at login".
- **`agent(plistName:)` when the background part is a separate process.** That is Curlew: a `daemon`
  subcommand that receives mail and chat with no window. A LaunchAgent plist shipped inside the
  bundle at `Contents/Library/LaunchAgents/<id>.plist`, whose `ProgramArguments` is the daemon's
  argv, registered by name. `mainApp` would be wrong there: it would start the GUI at login, which is
  not what "keep receiving" asks for.
- **`daemon(plistName:)` is refused.** It is a root LaunchDaemon, needs an admin authorisation, and
  no gjsify app has a system-wide service.
- **`loginItem(identifier:)` is refused.** It is for a *bundled helper app* inside
  `Contents/Library/LoginItems`, which is a second app bundle to sign and ship for no gain over an
  agent plist.

So the driver cannot guess: the app declares which one it is. `commandline` already carries the
answer in practice — an argv equal to the app's own launch argv means `mainApp`, anything else means
the agent — but relying on that is a guess about argv. Instead the app declares it once, in its
`gjsify.ship` metadata (`background.macos: "main-app" | "agent"`), which is also where the plist has
to be staged into the bundle, so declaration and artifact stay in one place. A build that declares
`agent` and stages no plist fails the ship stage, not at runtime.

App Sandbox: `SMAppService` is usable from a sandboxed app, and registration requires a **signed**
bundle (an ad-hoc or unsigned build gets `kSMErrorInvalidSignature`-class failures). gjsify already
signs and notarises macOS artifacts (ADR 0126, ADR 0040), so this is a constraint on the *ship*
path, not a blocker. That the specific `agent(plistName:)` + App-Sandbox + Mac-App-Store combination
is accepted by App Review is **UNVERIFIED**; the API documentation does not forbid it, and nothing
here has been run on a Mac.

`SMAppService` is Swift/ObjC only. There is no C-level successor to the deprecated
`LSSharedFileList`, so this needs a **new native bridge**: a darwin-only GObject shim,
`@gjsify/xdp-native` with `-darwin-arm64` / `-darwin-x64` prebuild packages, built exactly like
`@gjsify/gtk-quartz-native` (ADR 0141) — one `.m` file, three entry points
(`register`, `unregister`, `status`), `buildtype=plain`, the 15.0 floor, GLib by `dynamic_lookup`,
a row in `.github/prebuild-toolchain/darwin-bridges.mjs`, reached through
`loadOptionalNativeModule()` so a missing prebuild reads as "no macOS autostart" and the switch is
hidden instead of the app failing. **It does not exist today** — the grep above is the evidence. Its
macOS floor is 13.0 for this call, above gjsify's declared floor (ADR 0074); below 13 the driver
reports the capability as absent rather than reaching for the deprecated API.

**Windows unpackaged: `reg.exe`, no bridge.** A `Run` value is a string set and deleted with
`reg add` / `reg delete`, run with an argv array through the same `runTool` path
`appearance/win32.ts` uses, for the same measured reason: GLib's registry getters are not
marshalable from JS. So Windows needs **no native bridge**, which is why it can ship before macOS.
The system may delay `Run` entries
([Win32](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)),
which the README states, because "it started 30 seconds late" is otherwise read as a bug. Whether a
driver can read that the person disabled the entry in Task Manager (reportedly
`Explorer\StartupApproved\Run`) stays **UNVERIFIED** (ADR 0129 § 6) and is not relied on: there is no
`status` in the subset.

**Windows packaged: declared, not built.** `uap5:StartupTask` with
`Windows.ApplicationModel.StartupTask`
([WinRT](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask)) has a real
state (`Disabled`, `DisabledByUser`, `DisabledByPolicy`, `Enabled`) and is the right mechanism for an
MSIX app — but ADR 0024 ships no MSIX, and reaching WinRT from GJS needs a bridge that does not
exist. The driver therefore detects a packaged context (`GetCurrentPackageFullName` succeeding, or
the simpler read: the ship channel is recorded in the artifact per ADR 0113) and **throws by name**
there rather than writing an `HKCU\Run` entry that an MSIX app's isolation may not honour. The MSIX
leg lands with the MSIX artifact, not before.

### 3. One import, and how it reaches the driver

**App code imports the package, `@gjsify/xdp`, never `gi://Xdp` directly.** Inside the package, the
platform fork is the **build-time suffix chain** that already exists (`desktopSuffixChain`,
ADR 0032 § 9): `src/portal.ts` is the Linux body, `src/portal.macos.ts` and `src/portal.windows.ts`
are the drivers, and a `--app gjs|node` build on each host resolves the right one. No runtime
branch, nothing of macOS in a Linux bundle.

This keeps ADR 0101's "on GJS the real libportal answers" because the **Linux body is a re-export of
the typelib**, not a wrapper:

```ts
// src/portal.ts — Linux
export { default as Portal, BackgroundFlags } from 'gi://Xdp?version=1.0';
```

The values an app gets on Linux *are* libportal's `XdpPortal` and `XdpBackgroundFlags`; no gjsify
object sits between the call and the typelib, which was the point of that rule. An app that already
imports `gi://Xdp` keeps working unchanged on Linux — Beifahrer's file does today — and gains the
other platforms by changing one import line.

Two alternatives were weighed and rejected.

- **A bundler alias of `gi://Xdp` per target.** Rejected: `aliasPlugin` matches exact specifiers and
  resolves in exactly one hop by design (`packages/infra/resolve-npm/AGENTS.md`), and an alias that
  silently turns a `gi://` specifier into a TypeScript module makes the import line lie about what
  answers it — the opposite of why ADR 0101 chose the libportal name. It would also apply to app code
  that imports `gi://Xdp` for *other* portal calls the subset does not cover.
- **A native library that claims `Xdp-1.0.typelib` on macOS and Windows,** the way
  `@gjsify/webkit-native` and `@gjsify/webview2-native` claim `WebKit-6.0` (ADR 0022, ADR 0035).
  Rejected for Background: those two had to claim a namespace because they implement *dozens* of
  GObject types a widget tree instantiates by name. Background needs two methods and an enum, no new
  GObject types, so a full GIR-generating library is a build-chain cost with no consumer. Worse, a
  gjsify `Xdp-1.0.typelib` on a Mac that also has libportal from Homebrew would shadow the real one
  with a subset — a trap ADR 0057 already documents in another form. The tiny `SMAppService` shim of
  § 2 claims its own namespace (`GjsifyXdp-1.0`), not `Xdp`.

The package declares `gjsify.runtimes` `{gjs: "polyfill", node: "polyfill", browser: "none",
nativescript: "none"}`, `gjsify.os` all three `supported` with `osNotes` naming each mechanism, and
Tier 3 (ADR 0003 rule 3). The browser entry is a named throwing stub (`(C)` in
`resolve-npm/AGENTS.md`'s classification), so linking succeeds and the refusal names the module,
runtime and importer.

`XdpGtk4.parent_new_gtk` stays as ADR 0101 left it: the real `gi://XdpGtk4` on Linux, and on macOS
and Windows a function that returns `null`, because `parent` only positions a portal dialog and
neither driver shows one.

### 4. Window ↔ background process where there is no session bus

Curlew's window, CLI and MCP layer reach its daemon over the **session bus** (Curlew ADR 0007: a
change journal in the index is the truth, a bus signal is the wake-up). macOS has no session bus
that survives — Homebrew's dbus listens on launchd, and `dbus-run-session` there dies with
`DBUS_LAUNCHD_SESSION_BUS_SOCKET is empty` — and Windows has none at all. Both facts are measured in
`packages/framework/devtools/src/peer-transport.ts`, which solved the same problem for
`org.gjsify.Devtools`.

**The decision: peer-to-peer D-Bus over `Gio.DBusServer`, with the same interface XML as the
session-bus case.** Not a bespoke protocol, not JSON over a socket: the same
`Gio.DBusConnection`, so `export(connection, path)`, signals, properties and the generated
client code are unchanged, and only the *address* differs. `@gjsify/devtools` is the precedent and
`@gjsify/ipc-channel` is explicitly *not* the answer — that package frames a parent/child pipe for a
process this one spawned, and a daemon started at login by `SMAppService` has no parent pipe.

Where the socket lives, per platform:

| Target | Address | Why |
|---|---|---|
| Linux | the session bus, unchanged | it exists; peer-to-peer is for the others |
| macOS, unsandboxed | `unix:path=$XDG_RUNTIME_DIR`-equivalent, i.e. a file under `~/Library/Application Support/<app-id>/` | the app's own directory, present for both processes |
| macOS, App Sandbox | a socket in the **App Group container**, `~/Library/Group Containers/<team-id>.<group>/` | two sandboxed processes of one app share nothing else; the group container is the documented shared place, and it requires the `com.apple.security.application-groups` entitlement in **both** bundles |
| Windows | `nonce-tcp:host=127.0.0.1` | GLib implements no unix-socket transport on win32 (measured, gjs 1.88.1); the nonce file's filesystem permissions are the secret |

A client finds the address the way `@gjsify/devtools` does: an environment variable when the parent
started the child, and otherwise a one-line address file at a path derived from the app ID, which the
server writes and removes. The server never guesses a socket name: `unix:tmpdir=` lets GDBus pick a
unique one and avoids the stale-socket and second-instance cases a deterministic `unix:path=` has.

Marked unverified, and each is a reason this section is a decision about *shape* and not a claim of
working code:

- **The App Group container path length.** `sun_path` is 104 bytes on Darwin, and a group container
  path (`/Users/<user>/Library/Group Containers/<10-char team>.<reverse-dns group>/`) consumes most
  of it before a socket name. Whether a usable address fits is **UNVERIFIED** and must be measured
  first; if it does not, the fallback is `nonce-tcp` on loopback, as on Windows.
- **`Gio.DBusServer` on Windows under GJS.** `peer-transport.ts` implements the win32 branch and
  states the GLib fact behind it, but nothing in this repo has *run* a GJS D-Bus peer connection on
  Windows — and ADR 0024 has no GJS host on Windows at all, so the host there is node-gi, where the
  main loop integration is a second unverified thing.
- **Whether an `SMAppService` agent may serve a socket at all under App Sandbox**, as opposed to only
  connecting out. Not read.

Because all three are unverified, the IPC half is **scoped as its own follow-up decision**, taken
when the first macOS or Windows daemon is actually built. This ADR fixes the shape (peer D-Bus, same
interface, address per platform) so that the Background drivers of § 2 can land without waiting for
it: a registered login item that starts a process is useful before that process can be talked to.

### 5. Order of work

Each step is useful on its own and testable before the next starts.

**(a) Curlew moves to libportal.** Delete `app/src/core/lib/autostart-portal.ts`'s hand-written
D-Bus and call `Xdp.Portal.request_background` through `gi://Xdp`, lazily and inside a `try`, the way
Beifahrer already does. No new gjsify code, no new package, and it removes ~100 lines plus the
ADR 0138 rule-3 violation. The `Autostart` seam, `systemdAutostart` and `autostartFor` stay exactly
as they are.

**(b) `@gjsify/xdp` with the Background subset and its drivers.** In this order, cheapest and most
load-bearing first:

1. the package skeleton, the Linux re-export body, the browser throwing stub, and the refusal path
   (every unimplemented member throws naming itself);
2. the **Linux autostart-file fallback**, with the whole-wish conformance test — this is where the
   semantics are proven, on the one platform CI has;
3. the **Windows** driver (`reg.exe`), which needs no native code;
4. the **macOS** driver and its `@gjsify/xdp-native` bridge, last, because it is the only step with
   a build-chain change (two prebuild targets, a `darwin-bridges.mjs` row, a signing requirement).

**Conformance tests** (one corpus, parameterised by driver, ADR 0030) assert, against a fake portal
on a peer-to-peer `Gio.DBusServer` for Linux and against a temporary `$HOME` for the file and
registry drivers:

- a request with `AUTOSTART` creates the entry; a following request **without** it removes the entry
  and still reports `granted` — the whole-wish rule;
- `denied` and `cancelled` are distinguishable, and `cancelled` throws with
  `Gio.IOErrorEnum.CANCELLED`;
- `set_background_status` completes on every driver and, where the OS has no status line, changes
  nothing observable;
- the driver only ever removes an entry carrying its own marker;
- `ACTIVATABLE` on a non-Linux driver is accepted and ignored.
- Not testable on a runner: that macOS really launches the agent at login, and that Windows really
  honours the `Run` value. Acceptance there is the call sequence succeeding, plus a manual check on
  real hardware recorded in the PR as one person's observation — ADR 0129 § 7's rule.

**(c) The consumers adopt it.** Curlew replaces its `Autostart` seam with `@gjsify/xdp` and
`backgroundService()` stops answering `'while-open'` on macOS and Windows; Beifahrer drops its lazy
`gi://Xdp` loader, shows the autostart switch outside the Flatpak, and its ADR 0024 § 4 "waits for
gjsify's Background drivers" becomes a pointer here.

## Consequences

- An app asks for "start me at login" once and gets it on four Linux shapes, macOS and unpackaged
  Windows. Curlew loses a hand-written portal client; Beifahrer loses a Flatpak-only restriction.
- ADR 0101's "Portals by platform" table gains a Background row, and ADR 0138's table row goes from
  **missing** to the package.
- One new per-target prebuild pair under ADR 0017 (`@gjsify/xdp-native-darwin-{arm64,x64}`), and a
  macOS 13.0 floor for one call, above the repo's declared floor — handled as an absent capability
  below it, not as a build-time bump.
- `@gjsify/xdp` gets an OS-specific **file-writing** responsibility, which no portal package would
  have had on Linux. That is the cost of the fallback: the package now owns a file in the person's
  config directory, and owning it means the marker and the delete-only-mine rule are load-bearing,
  not tidiness.
- A sandboxed macOS or MSIX build inherits a signing requirement for a feature that, on Linux, needs
  none. A switch that cannot work on an unsigned local build is a confusing developer experience; the
  driver must say "not signed" rather than "denied".

## Not goals

- A `status()` query. Neither libportal nor the portal has one, and inventing it only where a driver
  owns a file would put a platform branch back into app code.
- The Secret portal. ADR 0138's open question keeps it; consumers keep their own stores.
- Making every platform's background mode feel the same. GNOME lists a Flatpak under Background
  Apps, macOS shows a Login Item, Windows shows a Startup entry, and a host Linux app appears in
  none of GNOME's list. The app code does not branch; the person's experience differs, and ADR 0129's
  table is where an app author reads that before designing around it.
- An MSIX StartupTask leg before there is an MSIX artifact.

## Open questions

1. **Does a host (deb/rpm/tar) Linux desktop's Background portal grant autostart in practice?**
   Unverified. If it does not, the fallback of § 2 becomes the normal host path rather than the
   portal's, and the driver's probe order (portal first, file second) is what decides — so the probe
   must distinguish "no portal" from "portal said no", and only the first may fall through to the
   file.
2. **The App Group socket** (§ 4): path length, and whether a sandboxed agent may listen. Measured
   when the first macOS daemon is built; `nonce-tcp` on loopback is the fallback.
3. **`agent(plistName:)` under the App Sandbox and App Review.** Unverified; it decides whether
   Curlew's daemon can ship to the Mac App Store or only outside it.
4. **What the ✕ in GNOME's Background Apps list does to the process.** Still unverified (ADR 0129
   § 1, Beifahrer ADR 0024 open question 1). An app treats it as a quit request.
