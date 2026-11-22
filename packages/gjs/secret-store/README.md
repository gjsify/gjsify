# @gjsify/secret-store

Secrets an app owns: a password the user typed, a refresh token from the app's own OAuth flow. One store per namespace, one driver per platform ([ADR 0152](../../../docs/adr/0152-app-owned-secrets-get-their-own-seam.md)).

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: the interface and the `memory` driver only; the Android Keystore driver ships as [`@gjsify/native-secret-store-bridge`](../../nativescript-bridge/secret-store) (NativeScript, Android only); libsecret, portal secret and Keychain follow.

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

`createMemoryDriver()` keeps secrets for the life of the process (`persistent: false`). It is for tests and is never selected automatically: install it with `useSecretStoreDriver(createMemoryDriver())`. On NativeScript Android, importing `@gjsify/native-secret-store-bridge` installs the `keystore-file` driver. The other platform drivers install themselves per ADR 0152 step 3; until they land, those platforms throw.

## License

MIT
