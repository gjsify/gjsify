# @gjsify/sys

GJS implementation of the Node.js `sys` module (alias for util).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/sys

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/sys
yarn add @gjsify/sys
```

## Usage

```typescript
import sys from '@gjsify/sys';

// sys is an alias for util
console.log(sys.inspect({ key: 'value' }));
```

## License

MIT
