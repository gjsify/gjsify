# @gjsify/vm

GJS stub implementation of the Node.js `vm` module. Provides runInThisContext via eval and Script.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/vm

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/vm
yarn add @gjsify/vm
```

## Usage

```typescript
import { runInThisContext, Script } from '@gjsify/vm';

const result = runInThisContext('1 + 2');
console.log(result); // 3
```

## License

MIT
