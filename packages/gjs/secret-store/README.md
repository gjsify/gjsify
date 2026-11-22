# @gjsify/secret-store

Secrets an app owns: a password the user typed, a refresh token from the app's own OAuth flow. One store per namespace, one driver per platform ([ADR 0152](../../../docs/adr/0152-app-owned-secrets-get-their-own-seam.md)).

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: the interface, the `memory` driver and the GJS `libsecret` driver (unsandboxed Linux); the Android Keystore driver ships as [`@gjsify/native-secret-store-bridge`](../../nativescript-bridge/secret-store) (NativeScript, Android only); the Flatpak `portal-secret` driver is the same GJS driver (libsecret's file backend over `org.freedesktop.portal.Secret`); Keychain follows.

## Installation

```bash
gjsify install @gjsify/secret-store
```

## Usage

```typescript
import { openSecretStore } from '@gjsify/secret-store';

const store = await openSecretStore('curlew/accounts');
await store.set('acc1:imap', password);
const again = await store.get('acc1:imap'); // string | null
```

| Call | Answers |
|---|---|
| `openSecretStore(namespace)` | a `SecretStore`; throws, naming the platform, where there is no driver |
| `store.get(key)` / `set` / `delete` | the secret or `null`; replace; missing is not an error |
| `store.keys()` | keys only, never values |
| `store.clear()` | forgets the namespace |
| `secretStoreInfo()` | `{ driver, persistent, encryptedAtRest }` for an about dialog; never branch on it |

## Not `system-accounts`

[`@gjsify/system-accounts`](../system-accounts) reports a missing account store as a *value* (`Unavailable`), because a host without one is normal. An app cannot work without its own secret, so this package has no `Unavailable`: **no driver means `openSecretStore` throws.** There is no plaintext fallback. A credential obtained from `system-accounts` is never stored here.

## Drivers

| Driver | Where | How it is installed |
|---|---|---|
| `libsecret` | GJS, Linux, no sandbox | `import '@gjsify/secret-store/libsecret'` once, in the app entry |
| `keystore-file` | NativeScript, Android | `import '@gjsify/native-secret-store-bridge'` |
| `memory` | tests, any runtime | `useSecretStoreDriver(createMemoryDriver())`; never selected automatically |
| `portal-secret` | GJS inside a Flatpak | the same `import '@gjsify/secret-store/libsecret'`; chosen automatically when `/.flatpak-info` exists |

Nothing is chosen behind your back: without an installed driver `openSecretStore` throws, naming the platform.

### `libsecret`

```typescript
import '@gjsify/secret-store/libsecret'; // installs the driver
import { openSecretStore } from '@gjsify/secret-store';

const store = await openSecretStore('curlew/accounts');
```

`secretStoreInfo()` reports `{ driver: 'libsecret', persistent: true, encryptedAtRest: true }`.

- One `Secret.Schema` (`org.gjsify.SecretStore`), attributes `namespace` and `key`, stored in the default collection. `keys()` searches on `namespace`; `clear()` removes every item of the namespace and throws if some stayed behind (a locked keyring). The label is `<namespace>: <key>`, never the value.
- Every call is libsecret's async form, so unlocking the keyring never blocks the main loop.
- `openSecretStore` asks the session bus for the Secret Service. No service (no gnome-keyring, KeePassXC, …) or no `Secret-1` typelib throws an error naming that cause. There is no fallback to `memory`.
- **Inside a Flatpak** (`/.flatpak-info` exists) the same driver reports `{ driver: 'portal-secret', persistent: true, encryptedAtRest: true }`. libsecret (≥ 0.20) switches to its file backend there by itself: the master secret comes from `org.freedesktop.portal.Secret` and the items are encrypted into `$XDG_DATA_HOME/keyrings/default.keyring`. The app needs no `--talk-name=org.freedesktop.secrets`. `openSecretStore` probes the portal first; if it is missing or the keyring file cannot be opened, it throws, naming `portal-secret`, the portal and the cause. There is no fallback to `memory`.
- **Why libsecret's file backend and not our own file.** Wrapping an app-private file with the portal secret ourselves would mean writing the key derivation, the cipher, the file format and its migration: our own crypto. libsecret already does exactly that, is maintained by GNOME and is in the runtime. The cost is a Secret Service-shaped file format we do not control.
- Flatpak proof: `flatpak-probe/run.sh` builds `org.gjsify.SecretStoreProbe` (`--user`, empty `finish-args`, build dir under `/tmp`), runs the contract over two namespaces, runs a second process that re-reads after the restart, and uninstalls the app with its data. Needs `flatpak-builder` and `org.gnome.Platform//49` + `Sdk//49`. It is not part of the published package.
- Errors carry the operation and the Secret Service's own message, never a key's value.
- Tests: `gjsify run test` runs the real-service suite when a Secret Service is on the bus and skips it, printing why, when not. To run it by hand without touching your keyring: `XDG_DATA_HOME=$(mktemp -d) dbus-run-session -- sh -c 'echo | gnome-keyring-daemon --unlock --components=secrets >/dev/null; gjsify run test.gjs.mjs'`.

### Memory and NativeScript

`createMemoryDriver()` keeps secrets for the life of the process (`persistent: false`). On NativeScript Android, importing `@gjsify/native-secret-store-bridge` installs the `keystore-file` driver. Other platforms throw until their driver lands (ADR 0152 step 3 onward).

## License

MIT
