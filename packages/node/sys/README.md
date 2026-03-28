# @gjsify/sys

GJS implementation of the Node.js `sys` module (alias for util).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/sys
# or
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
