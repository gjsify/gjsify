# @gjsify/bridge-types

Shared interfaces and environment classes used by the gjsify GTK↔DOM bridge packages. Provides `DOMBridgeContainer` (the common interface for all bridges), `BridgeEnvironment` (an isolated per-bridge document, body, and window), and `BridgeWindow` (requestAnimationFrame, performance.now, and viewport dimensions delegated back to the owning GTK widget).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/bridge-types

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/bridge-types
yarn add @gjsify/bridge-types
```

## Usage

```typescript
import { BridgeEnvironment, BridgeWindow } from '@gjsify/bridge-types';
import type { DOMBridgeContainer, BridgeWindowHost } from '@gjsify/bridge-types';

// Each bridge creates its own isolated environment so multiple bridges
// can coexist without polluting a shared global state.
const env = new BridgeEnvironment(host); // host implements BridgeWindowHost
const { document, window } = env;
```

This package is primarily consumed by `@gjsify/canvas2d`, `@gjsify/webgl`, `@gjsify/iframe`, and `@gjsify/video` — you rarely need to import it directly unless you are implementing a new bridge.

## License

MIT
