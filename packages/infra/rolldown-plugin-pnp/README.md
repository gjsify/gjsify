# @gjsify/rolldown-plugin-pnp

Rolldown/Rollup/Vite plugin that resolves modules through a Yarn Plug'n'Play (`.pnp.cjs`) manifest, so gjsify builds work correctly inside Yarn PnP projects. Automatically no-ops when no PnP root is found.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/rolldown-plugin-pnp
```

## Usage

```typescript
import { defineConfig } from 'vite';
import { pnpPlugin } from '@gjsify/rolldown-plugin-pnp';

export default defineConfig({
    plugins: [await pnpPlugin()],
});
```

The plugin returns `null` when not running under Yarn PnP, so spreading it is safe in any environment:

```typescript
import { rolldown } from 'rolldown';
import { pnpPlugin } from '@gjsify/rolldown-plugin-pnp';

const build = await rolldown({
    input: 'src/index.ts',
    plugins: [await pnpPlugin({ issuerUrl: import.meta.url })],
});
```

## License

MIT
