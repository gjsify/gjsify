# @gjsify/vite-plugin-blueprint

Vite/Rollup/Rolldown plugin that compiles GNOME Blueprint (`.blp`) UI files to GTK XML strings via `blueprint-compiler`. Import a `.blp` file and receive its compiled XML as a JavaScript string, ready for `Gtk.Builder`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/vite-plugin-blueprint

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/vite-plugin-blueprint
yarn add @gjsify/vite-plugin-blueprint
```

Requires `blueprint-compiler` to be installed on the system (e.g. `sudo dnf install blueprint-compiler`).

## Usage

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';

export default defineConfig({
    plugins: [blueprintPlugin({ minify: false })],
});
```

```typescript
// In your GJS app source
import windowXml from './window.blp';

const builder = Gtk.Builder.new_from_string(windowXml, -1);
```

Add type declarations by including `"@gjsify/vite-plugin-blueprint/types"` in your `tsconfig.json` `compilerOptions.types`.

## License

MIT
