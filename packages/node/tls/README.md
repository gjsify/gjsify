# @gjsify/tls

GJS partial implementation of the Node.js `tls` module using Gio.TlsClientConnection.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/tls
# or
yarn add @gjsify/tls
```

## Usage

```typescript
import { TLSSocket, connect } from '@gjsify/tls';

const socket = connect({ host: 'example.com', port: 443 }, () => {
  console.log('Connected');
});
```

## License

MIT
