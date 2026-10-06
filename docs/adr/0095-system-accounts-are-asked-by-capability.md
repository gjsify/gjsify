# 95. System accounts are asked by capability, not by GNOME Online Accounts

- Status: **Proposed**
- Date: 2026-10-06
- Deciders: Pascal Garber
- Related: [ADR 0078](0078-the-desktop-appearance-reaches-a-web-page-through-a-handoff.md)
  (per-OS drivers behind one reader, a fake service in CI),
  [ADR 0087](0087-an-optional-gi-namespace-is-declared-on-the-import.md) (`gi://Goa?…&optional`),
  [ADR 0003](0003-package-tiering.md), #1931, #2069

## Context

Apps built on gjsify want the accounts the user already set up on their system: find them,
read their mail server settings, log in without asking for a password again. The only code that
does this today is a consumer's: postbote's `@postbote/gnome` (`goa.gjs.ts`, `credentials.gjs.ts`)
speaks GNOME Online Accounts (GOA) directly. The next consumer, sending an invoice by SMTP from
the accounting app, would copy it.

A package that mirrors GOA's object model would be Linux-only by construction. Other systems
keep accounts in other shapes (or not at all), so a caller written against GOA's vocabulary
cannot move.

## Decision

**A new package answers questions about accounts. Its interface is the capabilities a caller
needs; drivers map each runtime's account store onto them.**

```ts
interface SystemAccounts {
  capabilities(): AccountCapabilities;                      // what THIS host can answer
  listAccounts(service?: 'mail' | …): Promise<Account[]>;
  getMailSettings(account: Account): Promise<MailSettings>; // IMAP + SMTP + sender
  getCredentials(account: Account, purpose: 'imap' | 'smtp'): Promise<Credentials>;
}
// Credentials = { kind: 'password'; secret } | { kind: 'oauth2'; token; expiresAt } | Unavailable
// Unavailable = { kind: 'unavailable'; reason }, also the other answer of getMailSettings
```

- `capabilities()` is how a caller finds out that a host has no account store, or one that hands
  out no credentials. A missing capability is a value, never a thrown surprise.
  The value is `Unavailable` with a reason (`no-account-store`, `unknown-account`, `not-supported`,
  `credentials-unavailable`): the two-member `Credentials` above had no place for it, and a call that
  must return something cannot report a missing capability any other way without throwing.
- Credentials are returned to the caller and never logged, cached to disk or put in an error.
- The package is named `@gjsify/system-accounts` as a working name; the name is open.
- Drivers hang off the existing runtime slots (gjs, node, browser, nativescript, react-native).
  The `gjs` slot gets the Linux driver on GOA; a host without `libgoa` still starts (ADR 0087)
  and reports empty capabilities.
- The starting point is postbote's GOA code, lifted with its behaviour intact. postbote then
  consumes the package instead of its own copy.

### Platforms

| Platform | State | Note |
|---|---|---|
| Linux, GNOME (GOA) | **planned, first driver** | postbote already runs this code on GJS and, through node-gi, on Node |
| Linux, other desktops | **unexplored** | no GOA there; whether a Secret Service based driver is useful is open |
| macOS | **unexplored** | no system-account API for third-party apps found (not proven either way); the interface assumes nothing it offers. Keychain Services exists as a secret store, details not read |
| Windows | **unexplored** | no system-account API found (not proven either way). Credential Locker (`PasswordVault`) and DPAPI exist as secret stores |
| Android, iOS (NativeScript) | **unexplored** | Android `AccountManager` and iOS limits for third-party apps not read; the Android Keystore does not export key material |
| Browser | **none** | no system account store |

"Unexplored" means nobody has checked what the platform allows, not that it is impossible.

### Not goals

- Drivers for any platform other than Linux in the first release.
- OAuth through the browser as a fallback driver.
- Contacts and calendar (EDS) and mail itself. This package only finds accounts and credentials.
- A secret store. Where a consumer keeps its own secrets stays open, see Consequences.

### Test approach

As in ADR 0078: the spec exports a fake accounts service on a peer-to-peer `Gio.DBusServer` and
drives the real GVariant marshalling, so CI needs no GNOME session. The capability mapping
itself runs as pure functions on every host.

Verified when the driver was written (libgoa 3.58.1, GJS 1.88.1): `Goa.Client` has only `new`,
`new_sync` and `new_finish`, no constructor taking a connection, and it dials the **session bus**.
A peer-to-peer server therefore has to play that bus as well: the fake answers `Hello`,
`GetNameOwner`, `StartServiceByName` and `AddMatch` on `org.freedesktop.DBus`, serves
`GetManagedObjects` on `/org/gnome/OnlineAccounts` (the `Account`, `Mail`, `PasswordBased`,
`OAuth2Based` and service interfaces as properties) and `GetPassword` / `GetAccessToken` on each
account path, and the process's `DBUS_SESSION_BUS_ADDRESS` points at it. With that, libgoa's own
client code runs unmodified against the fake. GLib caches the session connection for the life of
the process, so the fake is one server per process and the spec refuses to run when the process is
already bound to another bus (a developer's real accounts would otherwise reach the test).

The `&optional` import costs a top-level await (ADR 0087 clause 9), and a `@gjsify/unit` run that
reaches it wedges: `run()` enters a blocking `GLib.MainLoop.run()` from a promise job (ADR 0085
clause 5). The driver and its specs therefore carry no `&optional` import; only the entry point
`createSystemAccounts` does.

## Consequences

- A new `@gjsify/*` name needs the manual first publish and Trusted Publisher bootstrap before
  the release that ships it, or the train skips it and ships its dependents (see
  `docs/publishing.md`). The tier and the `os` declaration (`linux: supported`, the rest `none`)
  are set in the package.
- postbote waits for a release containing the package, then drops `goa.gjs.ts` and
  `credentials.gjs.ts`. Until then its copy stays.
- Whether the secret store (postbote's `SecretStore`) moves to gjsify is **open**; decide after
  the first consumer has used the accounts package.
- Where there is no system account store, a driver would need OAuth in the browser (RFC 8252:
  external user agent, loopback or private-use redirect, PKCE). Google and Microsoft both accept
  XOAUTH2 for SMTP; Exchange Online's SMTP AUTH basic-auth timeline moved and is only confirmed
  from secondary sources. This is a non-goal now and recorded so the interface keeps room for it.
- Whether SMTP login by OAuth works with the user's providers is not a gjsify question, and is
  being measured separately in the consumer. The interface carries both shapes either way.
