# @gjsify/os

GJS implementation of the Node.js `os` module using GLib. Provides homedir, hostname, cpus, and more.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/os
# or
yarn add @gjsify/os
```

## Usage

```typescript
import { homedir, hostname, platform, cpus } from '@gjsify/os';

console.log(homedir());
console.log(hostname());
console.log(platform());
console.log(cpus().length);
```

## License

MIT
