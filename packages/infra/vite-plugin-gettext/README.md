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

## Extraction refuses to destroy translations

`xgettextPlugin` fails the build instead of writing a POT that would silently gut the catalogs:

- **Every `sources` pattern must match at least one file.** A pattern that matches nothing is
  almost always a build-order or path mistake — typically it points at a build artifact of another
  package that has not been built yet — and extracting anyway drops that whole group of strings.
  A group that really is optional is named in `optionalSources`, one pattern at a time.
- **`autoUpdatePo` will not prune a catalog set beyond `maxCatalogEntryLoss`** (default `1/3`).
  `msgmerge` moves every entry the POT lost into `#~` comments, which `msgfmt` ignores, so a POT
  that came out short costs real translations. A run that really does delete that many strings
  raises the option.

```typescript
xgettextPlugin({
    sources: ['src/**/*.blp', 'data/**/*.desktop.in'],
    output: 'po/messages.pot',
    autoUpdatePo: true,
    // optionalSources: ['plugins/**/*.ui'],
    // maxCatalogEntryLoss: 0.5,
});
```

### A `sources` pattern reaching into a sibling package is a build dependency

`sources` is read at extraction time, so a pattern like `../learn/dist/**/*.ui` requires that the
sibling package has already been built. Declaring it in `dependencies` is not enough on its own:
building the one package (`gjsify workspace <name> build`) does not build what it depends on.
Either run the extracting package with `-t`, which pre-builds its workspace dependencies in
topological order:

```bash
gjsify workspace @scope/translations build -t
```

or make the dependency's build an explicit step of the script that needs it. Without one of the
two, the artifact is whatever the last run left behind, which is the state the pattern guard above
exists to catch.

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
