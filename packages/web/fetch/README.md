# @gjsify/fetch

GJS implementation of the Web Fetch API using Soup 3.0 and Gio. Provides fetch(), Request, Response, and Headers.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/fetch

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/fetch
yarn add @gjsify/fetch
```

## Usage

```typescript
import { fetch, Request, Response, Headers } from '@gjsify/fetch';

const response = await fetch('https://example.com');
const text = await response.text();
console.log(text);
```

## TLS options (GJS)

- `rejectUnauthorized: false` accepts any peer certificate for that request (also `NODE_TLS_REJECT_UNAUTHORIZED=0`).
- `servername: 'host.example'` connects to the URL (e.g. `https://127.0.0.2:8443/` through an SSH tunnel)
  but verifies the certificate against `host.example` with the system CA. Only a hostname mismatch is
  forgiven, and only when the certificate names `servername`; an untrusted, expired or revoked chain
  still fails. `rejectUnauthorized: false` takes precedence.

The check runs per TLS handshake. libsoup/GIO may reuse a pooled connection or resume the TLS session
for a later request to the same host:port without a handshake, so do not mix verification policies
for one host:port in a process (this holds for `rejectUnauthorized: false` too).

## Inspirations and credits

- https://github.com/sonnyp/troll/blob/main/src/std/fetch.js
- https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node-fetch
- https://github.com/node-fetch/node-fetch
- https://github.com/denoland/deno/tree/main/ext/fetch

## License

MIT
