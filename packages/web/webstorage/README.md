# @gjsify/webstorage

GJS implementation of the Web Storage API (localStorage, sessionStorage) using Gio.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/webstorage
# or
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
