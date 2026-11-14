# @gjsify/xdp

libportal's Background portal on every desktop: the real `gi://Xdp` on Linux, and a driver where there is none. Start-at-login and background permission are asked by capability, never by mechanism ([ADR 0144](../../../docs/adr/0144-background-and-autostart-are-asked-through-libportal.md)).

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: new, one platform, no promise yet.

## Installation

```bash
gjsify install @gjsify/xdp
```

`@gjsify/xdp` is not published on npm yet; the first publish is a queued maintainer action (`status/pending-npm-bootstrap.json`).

## Usage

```typescript
import { Portal, BackgroundFlags, XdpGtk4 } from '@gjsify/xdp';
```

On Linux these are libportal's own types: `Portal` is `Xdp.Portal`, with no gjsify object in between.

For a host that may have no libportal typelib or no Background portal, use the entry point with the fallback:

```typescript
import { requestBackground, setBackgroundStatus, BackgroundFlags } from '@gjsify/xdp/background';

const outcome = await requestBackground({
    appId: 'org.example.App',
    reason: 'Keep syncing in the tray',
    commandline: ['/usr/bin/example', '--tray'],
    flags: BackgroundFlags.AUTOSTART,
});
// 'granted' | 'denied'; a cancelled request rejects with Gio.IOErrorEnum.CANCELLED
await setBackgroundStatus('Syncing');
```

A request is the **whole wish**, not a delta: without `AUTOSTART` it removes an existing entry.

## Platforms

| Platform | State |
|---|---|
| Linux | `src/portal.ts` re-exports `Xdp.Portal` and `Xdp.BackgroundFlags`; `XdpGtk4.parent_new_gtk` is real |
| Linux, no Background portal | `@gjsify/xdp/background` writes `$XDG_CONFIG_HOME/autostart/<app-id>.desktop` |
| Windows, macOS | no driver in this package yet (ADR 0144 § 2) |
| Browser, NativeScript | named throwing stub (`ENOTSUP`); `XdpGtk4.parent_new_gtk` returns `null` |

## Fallback semantics

- The fallback asks nothing and always resolves `granted`. `commandline` is required there; without it the call rejects with `INVALID_ARGUMENT`.
- The probe reads `org.freedesktop.portal.Background` `version` on the session bus. Only "nobody serves it" (ServiceUnknown, NameHasNoOwner, UnknownObject, UnknownInterface, UnknownMethod, UnknownProperty, or no session bus) means *no portal* and falls through to the file. Any other error is a portal that answered badly: it is thrown and **never** falls through.
- The file carries `X-GJSIFY-Background=true`. Only a file with that marker is replaced or deleted. A file without it belongs to someone else and is left alone in both directions: an existing entry counts as the wish fulfilled.
- A portal on the bus but no `Xdp` typelib installed also falls back to the file.
- `Exec` is quoted per the Desktop Entry spec; an argument with a newline or NUL is refused.
- `set_background_status` without a portal completes and changes nothing.

## Testing

`gjsify run test` runs the pure suites on Node and everything on GJS. The GJS run serves a fake Background portal on a peer-to-peer `Gio.DBusServer` (`src/fake-portal.ts`) and uses temporary config directories. It covers granted, denied, cancelled, a broken portal (no fallthrough), an absent portal (fallthrough, whole-wish), marker-only deletion, and flag values against the typelib.

**Unverified:** no real xdg-desktop-portal backend has been measured; the fake serves what libportal's client calls.
