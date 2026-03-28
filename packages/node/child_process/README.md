# @gjsify/child_process

GJS implementation of the Node.js `child_process` module using Gio.Subprocess. Supports exec, execSync, spawn, and spawnSync.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/child_process
# or
yarn add @gjsify/child_process
```

## Usage

```typescript
import { execSync, spawn } from '@gjsify/child_process';

const output = execSync('echo hello').toString();
const child = spawn('ls', ['-la']);
```

## License

MIT
