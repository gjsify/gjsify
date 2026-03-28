# @gjsify/esbuild-plugin-transform-ext

esbuild plugin for transforming file extensions in import paths.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/esbuild-plugin-transform-ext
# or
yarn add @gjsify/esbuild-plugin-transform-ext
```

## Usage

```typescript
import { build } from 'esbuild';
import { transformExtPlugin } from '@gjsify/esbuild-plugin-transform-ext';

await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist/',
  bundle: false,
  format: 'esm',
  plugins: [transformExtPlugin({ outExtension: { '.ts': '.js' } })],
});
```

### Example

Input (`index.ts`):
```typescript
import { a } from './a.ts';
import { b } from './b.ts';
```

Output (`index.js`):
```javascript
import { a } from './a.js';
import { b } from './b.js';
```

## License

MIT
