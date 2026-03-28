# @gjsify/resolve-npm

Module resolution utilities for mapping Node.js and Web API modules to their @gjsify/* equivalents.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/resolve-npm
# or
yarn add @gjsify/resolve-npm
```

## Usage

```typescript
import { resolveNpm } from '@gjsify/resolve-npm';

// Maps Node.js module names to @gjsify/* packages
const resolved = resolveNpm('fs'); // '@gjsify/fs'
```

## License

MIT
