# @gjsify/webstorage

GJS implementation of the Web Storage API (localStorage, sessionStorage). Both stores are
in-memory: `sessionStorage` is per-process by spec, and `localStorage` does not yet persist
across one — `Gio.File` + `GLib.KeyFile` is the candidate backing and is not built.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/webstorage

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/webstorage
yarn add @gjsify/webstorage
```

## Usage

```typescript
import { localStorage, sessionStorage } from '@gjsify/webstorage';

localStorage.setItem('key', 'value');
console.log(localStorage.getItem('key'));
```

## License

MIT
