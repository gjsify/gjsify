# @gjsify/module

GJS implementation of the Node.js `module` module using Gio and GLib. Provides builtinModules, isBuiltin, and createRequire.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/module

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/module
yarn add @gjsify/module
```

## Usage

```typescript
import { builtinModules, isBuiltin, createRequire } from '@gjsify/module';

console.log(builtinModules);
console.log(isBuiltin('fs')); // true

const require = createRequire(import.meta.url);
```

## License

MIT
