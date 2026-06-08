# @gjsify/vite-plugin-gettext

Vite/Rollup/Rolldown plugin for gettext-based i18n in gjsify web and GJS apps. Compiles `.po` translation files to binary `.mo` format via `msgfmt`, extracts translatable strings via `xgettext`, and converts `.po` files to JSON for browser targets.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/vite-plugin-gettext

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/vite-plugin-gettext
yarn add @gjsify/vite-plugin-gettext
```

Requires `gettext` tools (`msgfmt`, `xgettext`) to be installed on the system.

## Usage

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { gettextPlugin, xgettextPlugin, po2jsonPlugin } from '@gjsify/vite-plugin-gettext';

export default defineConfig({
    plugins: [
        // Compile .po files → .mo (for GJS/GTK apps using Gettext.bindtextdomain)
        gettextPlugin({
            poDirectory: 'po',
            moDirectory: 'dist/locale',
        }),

        // Convert .po → JSON (for browser targets)
        po2jsonPlugin({
            poDirectory: 'po',
            outputDirectory: 'dist/i18n',
        }),
    ],
});
```

## License

MIT
