# @gjsify/vite-plugin-gjsify

Vite plugin presets that mirror `gjsify build --app browser` and `--app nativescript` under Vite's dev server and HMR. Ensures a dual-target gjsify app develops under Vite with the same transforms (gi:// aliasing, Blueprint compilation, platform resolution, Node polyfill aliases) as its production CLI build.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/vite-plugin-gjsify

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/vite-plugin-gjsify
yarn add @gjsify/vite-plugin-gjsify
```

## Usage

### Browser target

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { gjsifyBrowser } from '@gjsify/vite-plugin-gjsify';

export default defineConfig({
    plugins: [...gjsifyBrowser({ reflection: false })],
});
```

### NativeScript target

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import nativescript from '@nativescript/vite';
import { gjsifyNativescript } from '@gjsify/vite-plugin-gjsify';

export default defineConfig({
    plugins: [nativescript(), ...gjsifyNativescript()],
});
```

Both presets resolve `@girs/*` / `gi://` imports to an empty module (those are GJS-only specifiers that leak transitively) and apply the gjsify alias layer for Node built-ins and polyfills.

## License

MIT
