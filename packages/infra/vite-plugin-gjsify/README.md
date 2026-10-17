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

Both presets also embed `*.gresource.xml` imports ([ADR 0116](../../../docs/adr/0116-app-gresources-are-embedded-at-build-time-for-web-and-nativescript.md) §§ 1, 7): `import bytes from './data/app.data.gresource.xml'` yields the `Uint8Array` that `gjsify build` yields, ready for `Gio.resources_register(Gio.Resource.new_from_data(bytes))`. `glib-compile-resources` must be on the build host, `compressed="true"` is dropped (the web and NativeScript cannot inflate synchronously), and the dev server reloads the module when the XML or a file it lists changes. Type the import with `@gjsify/rolldown-plugin-gjsify/types`.

## License

MIT
