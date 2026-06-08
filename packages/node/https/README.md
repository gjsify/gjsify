# @gjsify/https

GJS partial implementation of the Node.js `https` module. Provides Agent with stub request/get.

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

## License

MIT
