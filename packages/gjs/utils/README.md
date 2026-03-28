# @gjsify/utils

Shared utility functions for gjsify packages including error polyfills, structured clone, and GNOME library helpers.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/utils
# or
yarn add @gjsify/utils
```

## Usage

```typescript
import { ensureMainLoop } from '@gjsify/utils';

// Start GLib MainLoop if not already running (no-op on Node.js)
ensureMainLoop();
```

## License

MIT
