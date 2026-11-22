# @gjsify/native-secret-store-bridge

The NativeScript driver behind [`@gjsify/secret-store`](../../gjs/secret-store) ([ADR 0152](../../../docs/adr/0152-app-owned-secrets-get-their-own-seam.md)).
Importing it on a NativeScript Android app installs the `keystore-file` driver with
`useSecretStoreDriver`; anywhere else the import does nothing.

| Platform | Driver |
|---|---|
| Android | `keystore-file`: an AES-256-GCM key in the `AndroidKeyStore` seals a file per namespace |
| iOS | not built: the first use throws, naming the platform (the Keychain driver is a later half of ADR 0152) |

```typescript
import '@gjsify/native-secret-store-bridge'; // once, in the app entry
import { openSecretStore } from '@gjsify/secret-store';

const store = await openSecretStore('curlew/accounts');
await store.set('acc1:imap', password);
```

`secretStoreInfo()` reports `{ driver: 'keystore-file', persistent: true, encryptedAtRest: true }`.

## How it stores

- One key per namespace (`KeyGenParameterSpec`, `PURPOSE_ENCRYPT | PURPOSE_DECRYPT`, `GCM`,
  `NoPadding`, 256 bit, randomized encryption required). The key never leaves the keystore.
- One file per namespace, named from the hex of the namespace, holding `[ivLength][iv][ciphertext ‖ tag]`
  of the JSON map. Every write picks a fresh IV and replaces the file atomically (temp file, `fsync`, `rename`).
- Errors name the operation and the exception class, never a key or a value.
- `clear()` deletes the file **and** the namespace's key. Measured on the API 36 emulator (x86_64,
  median of 15 writes right after a `clear()`): 2 ms keeping the key, 4 ms creating a new one. The
  2 ms is not worth a key that outlives the account it protected, so the default drops it;
  `createNativescriptSecretDriver({ dropKeyOnClear: false })` keeps it.

## Why `getNoBackupFilesDir()`, not `getFilesDir()`

The files live in `Context.getNoBackupFilesDir()`: Auto Backup and device-to-device transfer skip
that directory by definition, so no manifest rule has to be remembered. A restored ciphertext whose
key stayed on the old device could never be read. `getFilesDir()` would need `dataExtractionRules`
and `fullBackupContent` entries in every consuming app.

## What an app must add

Nothing in Gradle: `AndroidKeyStore`, `Cipher` and `java.io` are platform API (minSdk 24 suffices
for `KeyGenParameterSpec`, API 23). The spec for the device is `tests/integration/nativescript`
(`app/specs/secret-store.smoke.ts`); that app has no `native-api-usage.json`, so there is no whitelist to extend.

## License

MIT
