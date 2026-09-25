# @gjsify/https

GJS partial implementation of the Node.js `https` module: `request`/`get` over Soup.Session, a stub
`Agent`, and `createServer`, whose server terminates TLS with the certificate you pass.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/https

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/https
yarn add @gjsify/https
```

## Usage

```typescript
import { Agent } from '@gjsify/https';

const agent = new Agent({ keepAlive: true });
```

### HTTPS server

```typescript
import { createServer } from 'node:https';

const server = createServer({ key: keyPem, cert: certPem }, (req, res) => {
    res.end('hello over TLS');
});
server.listen(8443);
```

libsoup performs the handshake. `key`/`cert` take PEM strings or Buffers (a chain may follow the
leaf in `cert`). For client certificates, set `requestCert: true` and `ca` to the anchors they must
chain to; `rejectUnauthorized: false` lets unverified clients through, as on Node. Not yet
supported on GJS: `pfx`, an encrypted `key` with `passphrase`, and `SNICallback`. Without a
certificate `listen()` emits `'error'` instead of serving plain text.

## License

MIT
