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

Ships as a prebuilt `.so` + `.typelib` for `linux-x86_64`. Requires `glib-networking` with a GnuTLS backend (the default on Fedora / GNOME platforms).

## License

MIT
