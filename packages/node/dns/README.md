# @gjsify/dns

GJS implementation of the Node.js `dns` module using Gio.Resolver. Supports lookup, resolve4/6, reverse, and promises API.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/dns
# or
yarn add @gjsify/dns
```

## Usage

```typescript
import { lookup, promises } from '@gjsify/dns';

lookup('example.com', (err, address, family) => {
  console.log(`Address: ${address}, Family: ${family}`);
});

const result = await promises.resolve4('example.com');
```

## License

MIT
