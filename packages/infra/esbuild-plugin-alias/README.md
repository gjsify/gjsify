# @gjsify/esbuild-plugin-alias

esbuild plugin for module aliasing. Used internally by @gjsify/esbuild-plugin-gjsify.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/esbuild-plugin-alias
# or
yarn add @gjsify/esbuild-plugin-alias
```

## Usage

```typescript
import { build } from 'esbuild';
import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  plugins: [aliasPlugin({
    'original-module': 'replacement-module',
  })],
});
```

## License

MIT
