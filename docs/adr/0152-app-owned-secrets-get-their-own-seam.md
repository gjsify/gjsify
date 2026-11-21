# 152. App-owned secrets get their own seam; `system-accounts` stays the user's accounts

- Status: **Proposed** (2026-11-22)
- Date: 2026-11-22
- Deciders: Pascal Garber
- Related: [ADR 0095](0095-system-accounts-are-asked-by-capability.md) (`system-accounts` is asked by
  capability; "a secret store" was its non-goal),
  [ADR 0101](0101-portals-are-the-platform-seam-below-the-gtk-api.md) (portals are the platform seam,
  and a refusal throws),
  [ADR 0138](0138-one-app-inside-and-outside-a-sandbox.md) (an app asks for a capability, never a
  mechanism; where no standard exists gjsify defines the seam),
  [ADR 0147](0147-node-sqlite-on-nativescript-binds-the-platform-sqlite.md) (one driver per OS on
  NativeScript, with a device proof)

## Context

ADR 0095 gave gjsify `@gjsify/system-accounts`: the questions an app asks about the accounts a user
*already set up on their system*, answered on Linux by GNOME Online Accounts. It named two things it
did not settle, and both are now blocking:

- its platform table calls Android and iOS **unexplored**, and `runtimes.nativescript` is `"none"`
  because nobody had looked, not because anybody had decided;
- **a secret store was listed as a non-goal**, with the open question of whether postbote's (today
  curlew's) `SecretStore` moves to gjsify.

Curlew's Android shell now runs IMAP over TLS and its store on device (real GObject,
`@gjsify/native-sqlite-bridge`). The next screen is an account form, and that form needs an answer to
"where does this password live on this device" before it can be written. Reminder will ask the same
question for a CalDAV password weeks later. Curlew already anticipated this: its `SecretFiles` seam
exists so an Android shell can plug its own key story in (`useSecretFiles()`), and its
`@curlew/protocol` rule — a credential never travels in a DTO, only a `getPassword()` thunk does —
already assumes a store behind the thunk.

So two different questions have been sitting in one package name, and they have opposite shapes:

| | `system-accounts` | an app's own secret |
|---|---|---|
| who owns the data | another app (GOA, an Android authenticator) | this app |
| may it be absent | **yes** — a host with no account store is normal | **no** — an app that cannot keep its own password is broken |
| what the app does when absent | falls through to its own account form | nothing; it cannot work |
| lifetime of the value | never stored (the OAuth2 type says so) | persisted by design |

ADR 0095's capability model is right for the first column and wrong for the second. Answering
`Unavailable` for both makes the word meaningless at the call site.

### What Android actually offers

Verified against the platform reference, not from memory:

- `android.accounts.AccountManager` is "a centralized registry of the user's online accounts" served
  by **pluggable authenticator modules** per account type; Google, Facebook and Microsoft Exchange
  each ship their own.
  ([AccountManager](https://developer.android.com/reference/android/accounts/AccountManager))
- Account **type** and auth-token **type** are, in the reference's own words, "authenticator-specific
  strings, and must be known by the application in coordination with its preferred authenticators."
  `"oauth2:<scope>"` is therefore a convention of *Google's* authenticator, not an Android platform
  contract — there is no documented platform guarantee for it. (ibid.)
- Since Android 8.0 (API 26) a caller "will get list of accounts made visible to it by user … or
  AbstractAccountAuthenticator using `setAccountVisibility`. `GET_ACCOUNTS` permission is not used."
  Below API 26 without `GET_ACCOUNTS`, a caller sees only accounts whose authenticator signature
  matches it. (ibid.)
- `getAuthToken(account, authTokenType, options, activity, …)` prompts for consent and needs a
  foreground `Activity`; the blocking variants throw `IllegalStateException` on the main thread;
  tokens are cached and the app must call `invalidateAuthToken` itself when one goes stale; and
  requesting a token for an account no longer on the device is an "undefined failure." (ibid.)
- A de-Googled device (/e/OS, GrapheneOS without GMS) has no Google authenticator installed, so
  `getAccountsByType("com.google")` is simply empty — not an error, not a prompt.

So on Android the capability is real but thin, gated on consent and an Activity, and the only
interesting payload on a stock device is a Google token obtained through an undocumented token-type
string. **iOS has no counterpart at all**: there is no third-party-readable registry of the user's
accounts.

### What Android and iOS offer for an app's *own* secret

- The **Android Keystore** holds key material "in a container to make [it] more difficult to extract
  from the device", keeps it non-exportable from the app process and from the device, and can
  restrict when and how a key is used.
  ([Keystore](https://developer.android.com/privacy-and-security/keystore))
- `androidx.security.crypto.EncryptedSharedPreferences` — the obvious shortcut — **is deprecated as
  of security-crypto 1.1.0**, with the replacement given as plain `SharedPreferences`; androidx has
  withdrawn from this problem rather than solved it. Its own docs also warn that the file must be
  excluded from Auto Backup, because a restore brings back ciphertext whose key is gone.
  ([EncryptedSharedPreferences](https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences))
- iOS has **Keychain Services**: "an encrypted database" for "small bits of user data", exactly the
  generic-password case.
  ([Keychain services](https://developer.apple.com/documentation/security/keychain-services))

And on Linux there are two, depending on the container: the Secret Service via libsecret outside a
sandbox, and `org.freedesktop.portal.Secret` inside one — which hands the app a per-app master secret
it then uses to encrypt its own file. That is the *same shape* as the Android design (a key the app
cannot extract, a file the app owns), which is the sign that this belongs in one seam.

## Decision

### 1. `system-accounts` keeps its meaning, and its mobile answer becomes a decision

`@gjsify/system-accounts` stays what ADR 0095 made it: accounts **another** component owns, read by
capability. On NativeScript `runtimes.nativescript` stays `"none"` — but as a decided answer, not an
unexplored field:

- `capabilities()` returns `{ services: [], credentials: [] }`;
- `listAccounts()` returns `[]`; every other call returns `Unavailable` with reason
  `no-account-store`.

That is already the contract; this ADR makes it the declared mobile answer and records why, in
`gjsify.osNotes` keyed `android` and `ios` beside the existing `darwin`/`win32` notes. The OS axis of
ADR 0018 is untouched — mobile rides on `runtimes.nativescript` and platform-file routing
(`native.android.ts` / `native.ios.ts`), exactly as ADR 0147 binds SQLite.

**An `AccountManager` driver is not written now.** It is written when an app has a concrete need for
it, behind a device proof, and even then it answers only `listAccounts` plus `getCredentials` with
`kind: 'oauth2'` — never `getMailSettings`, because an Android account carries no IMAP host. The
reason for the delay is not difficulty: it is that on a stock device the driver's whole value is a
Google token through an undocumented token-type string and a consent dialog, and on a de-Googled
device — which is exactly what curlew's users run — it has no value at all. An app that works without
it works everywhere; an app that needs it works in one place.

### 2. App-owned secrets become a separate package: `@gjsify/secret-store`

Not an extension of `system-accounts`. New tier-3 package, new seam under a gjsify name in the sense
of ADR 0138 §4.

```ts
/** What a store does. Opaque namespaces; two namespaces never see each other. */
export interface SecretStore {
    readonly namespace: string;
    /** The stored secret, or `null` when this namespace has no such key. */
    get(key: string): Promise<string | null>;
    /** Store or replace. The value is never logged, cached or put in an error by this package. */
    set(key: string, secret: string): Promise<void>;
    /** Missing is not an error. */
    delete(key: string): Promise<void>;
    /** Keys only, never values — for cleaning up after an account the app removed. */
    keys(): Promise<string[]>;
    /** Forget this namespace: sign-out, account removal, "delete my data". */
    clear(): Promise<void>;
}

/** Diagnostics for an about dialog or a bug report. An app reports it; it never branches on it. */
export interface SecretStoreInfo {
    readonly driver: 'libsecret' | 'portal-secret' | 'keystore-file' | 'keychain' | 'memory';
    /** False when the secrets live only as long as the process. */
    readonly persistent: boolean;
    /** False when nothing but file permissions protects the bytes. */
    readonly encryptedAtRest: boolean;
}

/** Throws, naming the platform, where this build has no driver (ADR 0101). */
export function openSecretStore(namespace: string): Promise<SecretStore>;
export function secretStoreInfo(): SecretStoreInfo;
```

**Its relation to ADR 0095's capability model is deliberate inversion.** `system-accounts` reports a
missing capability as a *value*, because a host without an account store is a normal host and the app
has a sensible next move (ask the user). A secret store has no such next move, so it has no
`Unavailable`: on a platform with a driver it works, and on a platform without one `openSecretStore`
**throws, naming the platform** — which is ADR 0101's standing rule ("what is not implemented throws,
naming it"; "a refusal must throw"). The app is never handed a silent downgrade to plaintext.

Drivers, one per platform, chosen below the call (ADR 0138 §2):

| Platform | Driver | Mechanism |
|---|---|---|
| GJS, Linux, unsandboxed | `libsecret` | Secret Service via `gi://Secret` — the same store GOA uses |
| GJS, Linux, sandboxed | `portal-secret` | `org.freedesktop.portal.Secret`'s per-app secret wraps an app-private file; no `--talk-name` hole (ADR 0138 §6) |
| NativeScript, Android | `keystore-file` | a non-exportable AES-GCM key in `AndroidKeyStore` encrypts a file in `Context.getFilesDir()` |
| NativeScript, iOS | `keychain` | Keychain Services, `kSecClassGenericPassword`, service = namespace, accessible after first unlock, this device only |
| tests, any runtime | `memory` | `persistent: false`; never selected automatically |
| node, darwin, win32 | — | throws, naming the platform; the shape is the same key-wrapped file and each is a later ADR |

Two notes the implementation must not lose:

- **Not `EncryptedSharedPreferences`.** It is deprecated (above), and ADR 0147 already keeps the
  androidx surface in `native-api-usage.json` small and justified — adding a deprecated dependency to
  it is the wrong direction. The Keystore key plus an own file is four calls and has no deprecation.
- **The Android file is excluded from Auto Backup**, per the warning in androidx's own docs: a
  restore onto a new device brings ciphertext whose Keystore key never left the old one.

### 3. The one rule that keeps the two packages apart

**A credential that came out of `system-accounts` is never put into `secret-store`.** GOA's and an
authenticator's tokens are short-lived and owned elsewhere; the `OAuth2Credentials` type already says
"ask again afterwards; never store it". What an app stores is only what it obtained itself: a password
the user typed, or a refresh token from the app's own OAuth flow.

### 4. Curlew's and reminder's v1 on Android

Both ship **without** any Android account integration, and without a single `if (android)`:

1. They call `system-accounts` exactly as on the desktop. On Android it answers empty capabilities,
   and the existing fall-through — show the app's own account form — runs. That fall-through is not
   new code; it is the branch the desktop already takes on a host without GOA.
2. The user enters the server settings by hand: curlew IMAP + SMTP, reminder a CalDAV base URL.
3. The password goes into `@gjsify/secret-store` under a namespace per app and a key per account and
   purpose, e.g. `curlew/accounts` → `<accountId>:imap`.
4. `@curlew/protocol` is unchanged: the secret never enters a DTO. The worker's `getPassword()` thunk
   reads the store per connection, as it does today.
5. OAuth against Google or Microsoft on Android, if it happens at all, is the app's **own**
   authorization-code + PKCE flow in a Custom Tab, with the refresh token in the secret store — not
   `getAuthToken`. Out of scope for v1, named here so it is not reinvented.
6. Reminder's write grant (its own ADR) is untouched: the store holds the password, not the
   permission.

Curlew's `SecretStore` and `SecretFiles` are then retired as curlew-local code and replaced by this
package, which closes ADR 0095's open question. Curlew's SQLite keeps its non-secret session rows.

### 5. What the first device test proves

In ADR 0147's "device proof" sense — on a real phone, and on a de-Googled one (/e/OS) as the second
device, because that is where the two decisions above are actually load-bearing:

1. `secretStoreInfo()` reports `driver: 'keystore-file'`, `persistent: true`, `encryptedAtRest: true`.
2. `set()`, force-stop the app, cold start, `get()` → the same string. Proves the Keystore key
   outlives the process and the file is real, not a memory fallback.
3. Curlew logs into a real IMAP account after that cold start using only the stored password, and the
   protocol log contains no secret — the assertion is on the log, not on an eyeball.
4. Uninstall, reinstall: the store opens empty and `get()` returns `null` instead of throwing or
   returning garbage. Proves the Auto-Backup exclusion holds and a dead key never meets live
   ciphertext.
5. `system-accounts.capabilities()` on the same device returns empty `services` and `credentials`,
   and curlew shows its account form — no error dialog, no crash, no branch on the platform.
6. On the de-Googled device, (1)–(5) are byte-identical. Any difference is a bug in a driver, not a
   platform fact.

## Consequences

- One more published package. `@gjsify/secret-store` needs the manual first publish plus the Trusted
  Publisher bootstrap that every new `@gjsify/*` name needs (ADR 0095 Consequences, `docs/publishing.md`).
- Two seams where an app might have expected one, and the asymmetry — one returns `Unavailable`, the
  other throws — has to be taught once. It is written into both packages' doc comments.
- Curlew carries its own `SecretStore` until the package lands, then deletes it. Until then the
  Android shell has no secret storage, so the account form cannot ship first.
- gjsify owns a Keystore and a Keychain binding it did not own before: small surfaces, but they are
  cryptographic and they need the androidx/platform-API whitelist entries of ADR 0147.
- Choosing against an `AccountManager` driver means a stock-Android user who already has their Google
  account on the device still types their credentials into curlew. That is the accepted cost; it is
  revisited when the cross-platform work is done, not before.
- If `org.freedesktop.portal.Secret` turns out not to be reachable from a GJS Flatpak with the
  interfaces the apps already request, the Linux sandboxed row falls back to a declared `--talk-name`
  hole under ADR 0138 §6 — written down, not quietly taken.

## Implementation

1. Amend `packages/gjs/system-accounts/package.json`: `gjsify.osNotes` gains `android` and `ios`
   entries recording the decided empty answer and the reason. Its README gains the same paragraph.
2. Create `packages/gjs/secret-store` with the interface above, the `memory` driver and its tests;
   tier 3; `runtimes` `gjs: native`, `nativescript: native`, `node`/`browser` `none` for now.
3. Add the `libsecret` driver and run the desktop proof; then the `portal-secret` driver under a
   Flatpak build of an existing app.
4. Add `packages/nativescript-bridge/secret-store` with `native.android.ts` / `native.ios.ts`, per
   ADR 0147's routing and whitelist discipline; the Android half first, because curlew needs it.
5. Run the device proof above on both phones; record the result in this ADR and flip it to Accepted.
6. Move curlew to the package, delete `SecretStore`/`SecretFiles`, then build the Android account form.

## Open

- Does a GJS app inside a Flatpak reach `org.freedesktop.portal.Secret` through the portal
  interfaces the apps already hold? Untested; step 3 answers it.
- Binary secrets. The API is `string` because every caller today stores a password or a token. A
  `Uint8Array` variant is added when a caller needs one, not before.
- Whether `clear()` should also drop the Keystore key (cheap, total) or only the file (keeps the key
  warm for the next account). Decided at implementation with a measurement, not here.
- macOS and Windows drivers: same shape, separate ADRs, no date.
