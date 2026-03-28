# @gjsify/esbuild-plugin-deepkit

esbuild plugin for Deepkit type compiler integration.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/esbuild-plugin-deepkit
# or
yarn add @gjsify/esbuild-plugin-deepkit
```

## Usage

```typescript
import { build } from 'esbuild';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  format: 'esm',
  platform: 'node',
  plugins: [deepkitPlugin()],
});
```

### Example

src/index.ts:
```typescript
import { deserialize } from '@deepkit/type';

interface User {
  id: number;
  createdAt: Date;
  username: string;
}

const user = deserialize<User>({
  id: 0,
  username: 'peter',
  createdAt: '2021-06-26T12:34:41.061Z',
});

console.log(user.createdAt instanceof Date); // true
```

## License

MIT
