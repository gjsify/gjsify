# 138. An app is one codebase inside and outside a sandbox

- Status: **Accepted** (2026-11-10)
- Date: 2026-11-10
- Deciders: Pascal Garber
- Related: [ADR 0101](0101-portals-are-the-platform-seam-below-the-gtk-api.md) (portals are the platform seam),
  [ADR 0095](0095-system-accounts-are-asked-by-capability.md) (`system-accounts`),
  [ADR 0129](0129-a-status-icon-on-every-desktop.md) (background and status icon),
  [ADR 0135](0135-store-listings-come-from-the-metainfo.md) (store listings)

## Context

Apps built on gjsify ship to stores and package formats that run them in a sandbox: Flatpak on
Linux, the App Sandbox on macOS, and on Windows a packaged-app isolation that this repo has not
checked. Android and iOS are sandboxed by construction. An app is written once. If it is written
for the unsandboxed desktop first, it grows habits the sandbox then breaks or pays for with a
permission hole:

- raw D-Bus calls to `org.freedesktop.portal.*`, `org.freedesktop.Notifications` or `systemd`;
- `systemctl` to start an app at login;
- a path handed to another process, which assumes the receiver can read it;
- reading another app's files, or the home directory, directly.

ADR 0101 already decides that the portal interfaces are the contract below the GTK API, on every
platform, and that a standard beats an own invention. This ADR takes the next step: the sandbox is a
delivery target, and the same app code runs inside and outside it.

## Decision

1. **A sandbox is a supported target, not an afterthought.** Flatpak, the macOS App Sandbox and a
   comparable Windows isolation where one exists. An app's package asks for the smallest permission
   set that works.
2. **App code asks for a capability, never a mechanism.** "Pick a file", "open this", "notify",
   "start me at login", "list my accounts". Which mechanism answers (a portal, a native dialog, a
   unit file, a drawn fallback) is decided below the call, by the platform driver, and the call is the
   same inside and outside a sandbox. An app never branches on "am I sandboxed".
3. **The standard is xdg-desktop-portal, also off Linux.** Its interface is the contract (ADR 0101).
   Apps reach it through GTK, GIO and `Xdp` (`@gjsify/xdp`), never through a hand-written D-Bus call.
4. **Where no standard exists, gjsify defines the seam, shaped like a portal.** One interface, a
   request/response shape where the call is interactive, a capability that reads as a value when it
   is missing, a driver per platform. It lives under a gjsify name, never under
   `org.freedesktop.portal`, and it says in its own doc that it gives way to an official portal. When
   one appears the seam migrates to it and the old name goes. `system-accounts` is the worked example
   (ADR 0095).
5. **Data crosses a process boundary as a descriptor or a portal document, not as a path.** A path
   is meaningful only inside one filesystem view. Where a call hands a file to another process (a
   daemon, an opener, a share target), it passes an open file descriptor (`Gio.UnixFDList` on D-Bus)
   or goes through the Documents portal.
6. **A permission hole is the last resort, and it is written down.** If a capability has no portal and
   no seam yet, the app may declare a hole (for example `--talk-name=org.gnome.OnlineAccounts` in a
   Flatpak manifest) with the reason beside it. The hole becomes a gjsify issue for the missing seam;
   it is not a feature of the app.
7. **"Works in a sandbox" needs a run in one.** A package target ships a CI job that builds the
   sandboxed package, and the claim in a README or a listing names what was run.

## What gjsify provides, and what is missing

State of the seams an app meets first. "Missing" means no gjsify seam exists today; it is not a
claim that nothing can be done.

| Capability | Seam | State |
|---|---|---|
| Pick or save a file | `Gtk.FileDialog` (FileChooser portal in a sandbox, ADR 0101, 0100) | exists |
| Open a URI or file | `Gtk.FileLauncher`, `Gio.AppInfo` (OpenURI portal) | exists |
| Appearance | `org.freedesktop.appearance` through Settings (ADR 0078) | exists |
| Notify | `Gio.Notification` through a `Gio.Application` (GLib uses the Notification portal in a sandbox) | exists in GLib; an app must use it, not the D-Bus name |
| Stay in the background, start at login | `Gio.Application.hold()` (ADR 0129); the Background portal through `Xdp.Portal.request_background` ([ADR 0144](0144-background-and-autostart-have-one-driver-per-platform.md)) | **decided**, not yet built: ADR 0144 puts `request_background` / `set_background_status` in `@gjsify/xdp`, with a Linux autostart-file fallback, `SMAppService` on macOS and `HKCU\Run` on Windows |
| Online accounts | `@gjsify/system-accounts` (ADR 0095) | exists on GOA; in a Flatpak it needs the GOA hole (rule 6) until a portal exists |
| Per-app secret | Secret portal (`Xdp.Portal.retrieve_secret`-style master secret) | **missing**; consumers keep their own store until then |
| Hand a file to another process | descriptor over D-Bus (rule 5) | the recipe is documented here; no helper yet |

A row goes from "missing" to "exists" when a consumer needs it (ADR 0101: a portal is added when an
API an app already calls needs it, not before).

## Consequences

- An app author reads one rule instead of learning each sandbox. A new platform is a new driver, not
  an app rewrite.
- Code review has a test: a `systemctl`, a raw `org.freedesktop.portal.*` call or a path passed
  across processes is a finding.
- A Flatpak manifest, a macOS entitlements file and a Windows package manifest are reviewed as the
  record of the holes an app declares.
- The cost is real: an app that wants to start at login must go through a seam that does not exist
  yet instead of writing a unit file.

## Not goals

- Making every platform sandbox identical. They differ; the app code does not.
- Inventing an own portal where one exists.
- Sandbox escapes for convenience. A hole needs a reason and an issue.

## Open questions

- **macOS.** The App Sandbox's equivalents of file access (security-scoped bookmarks), shared data
  between a GUI and a helper (App Groups) and login items are not checked here. Each needs reading
  Apple's documentation before a driver is claimed.
- **Windows.** Which isolation a packaged GTK app gets, and what a file handle crossing a process
  boundary looks like there, is not checked.
- ~~**Background and Secret in `@gjsify/xdp`.**~~ **Background: decided** by
  [ADR 0144](0144-background-and-autostart-have-one-driver-per-platform.md) (2026-11-14) — it joins
  the subset now, because two consumers exist. **Secret stays open:** whether a per-app master
  secret call joins, or consumers keep their own stores, is undecided; no consumer has asked.
