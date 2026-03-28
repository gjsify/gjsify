# @gjsify/path

GJS implementation of the Node.js `path` module. Provides full POSIX and Win32 path utilities.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/path
# or
yarn add @gjsify/path
```

## Usage

```typescript
import { join, resolve, basename, dirname, extname } from '@gjsify/path';

console.log(join('/home', 'user', 'file.txt'));
console.log(resolve('relative/path'));
console.log(basename('/home/user/file.txt')); // 'file.txt'
```

## License

MIT
