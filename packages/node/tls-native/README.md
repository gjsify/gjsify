# @gjsify/tls-native

Optional native Vala + C bridge for advanced TLS capabilities on GJS that are not exposed by `Gio.TlsConnection`: OCSP response parsing (RFC 6960) via GnuTLS, TLS session resumption data (`getSession` / `setSession`), and channel binding (`tls-unique`, `tls-exporter`) for SCRAM-SHA-* authentication. Consumed by `@gjsify/tls` to back `TLSSocket.getFinished()`, `getPeerFinished()`, `getSession()`, and OCSP stapling support.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

This package is loaded automatically by `@gjsify/tls` when present. Install it to enable OCSP parsing and session access in your GJS TLS code:

```bash
gjsify install @gjsify/tls-native

# npm or yarn also work:
npm install @gjsify/tls-native
yarn add @gjsify/tls-native
```

## Usage

```typescript
// Loaded automatically by @gjsify/tls.
// For direct OCSP parsing:
import {
    hasNativeTls,
    parseOcspResponse,
    OcspCertStatus,
} from '@gjsify/tls-native';

if (hasNativeTls()) {
    // derBytes: Uint8Array containing a DER-encoded OCSPResponse
    const info = parseOcspResponse(derBytes);
    if (info && info.certStatus === OcspCertStatus.GOOD) {
        console.log('certificate is valid');
    }
}
```

Requires `glib-networking` with a GnuTLS backend (the default on Fedora / GNOME platforms) for the Phase-2 session APIs. See [Platform coverage](#platform-coverage) for the prebuilt platforms.

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64` | ✅ `.so` + `.gir` + `.typelib` | native runner |
| `linux-arm64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ✅ | QEMU emulation |
| `darwin-arm64` (macOS, Apple silicon) | ✅ `.dylib` + `.gir` + `.typelib` | `macos-latest` runner |
| `darwin-x64` (macOS, Intel) | ❌ | — no runner leg yet |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

All prebuilds are produced by [`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml)
and committed back to the repository.

The macOS prebuild links GnuTLS from Homebrew, so **Phase 1 (OCSP response parsing) is fully
functional there**. Phase 2 (`SessionAccess`, channel bindings, session resumption) additionally
requires `glib-networking` built with the GnuTLS backend at *runtime*; where that backend is
absent, `hasTlsSessionAccess()` reports `false` and the API degrades to the documented
`undefined` / `false` / no-op contract — exactly as Node behaves on a build without session
support. No runtime verification of Phase 2 on macOS has been done.

**Known gap — a `darwin-arm64` prebuild is built and shipped, but the CLI does not
load it yet.** `detectNativePackages()` (`packages/infra/cli/src/utils/detect-native-packages.ts`)
hardcodes a `linux-` directory prefix, and `buildNativeEnv()` exports `LD_LIBRARY_PATH`,
which macOS `dyld` ignores in favour of `DYLD_LIBRARY_PATH`.

## License

MIT
