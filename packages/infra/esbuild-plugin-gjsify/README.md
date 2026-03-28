# @gjsify/esbuild-plugin-gjsify

Main esbuild plugin for Gjsify. Handles Node.js to GJS module aliasing, CJS-ESM interop patching, and extension transforms.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/esbuild-plugin-gjsify
# or
yarn add @gjsify/esbuild-plugin-gjsify
```

## Usage

```typescript
import { build } from 'esbuild';
import { gjsifyPlugin } from '@gjsify/esbuild-plugin-gjsify';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  format: 'esm',
  plugins: [gjsifyPlugin()],
});
```

## License

MIT
