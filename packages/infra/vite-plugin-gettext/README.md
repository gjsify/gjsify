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

- **Every `sources` pattern must match at least one file**, and the run as a whole must find at
  least one. A pattern that matches nothing is almost always a build-order or path mistake —
  typically it points at a build artifact of another package that has not been built yet — and
  extracting anyway drops that whole group of strings. A group that really is optional is named in
  `optionalSources`, one pattern at a time. Negated patterns (`!plugins/**/*.ui`) are exclusions
  over the whole set, not groups of their own, so they are never required to match.
- **`autoUpdatePo` will not prune a catalog set beyond `maxCatalogEntryLoss`** (default `1/3`).
  What is compared is the *set of msgids* the new POT still carries against the largest catalog's,
  because that is what `msgmerge` acts on: it moves every entry the POT no longer has into `#~`
  comments, which `msgfmt` ignores. A POT that came out short costs real translations, and so does
  one that is the same length but re-worded — `msgmerge` fuzzy-matches those, and `msgfmt` leaves
  fuzzy entries out of the `.mo`. A run that really does replace that many strings raises the
  option.

## One catalog, three namespaces

A catalog is called one thing in the repository and has to be spelled three different ways
downstream. They disagree, so the `.po` basename is not passed through unchanged:

| Target | Namespace | `zh_Hans.po` | `pt_BR.po` |
|---|---|---|---|
| `.mo` directory (`gettextPlugin`, `msgfmtPlugin`) | POSIX locale | `locale/zh_CN/`, `locale/zh_SG/` | `locale/pt_BR/` |
| JSON file (`po2jsonPlugin`) | Android qualifier | `zh.json` | `pt-BR.json` |
| the `.po` in the repo | BCP-47-ish (Weblate) | `zh_Hans` | `pt_BR` |

Weblate names simplified Chinese `zh_Hans`, which is BCP-47 and **not** a POSIX locale — glibc
never probes it, so a catalog compiled under that name ships complete and renders in English for
every Chinese user while the build exits 0. The compiled catalog is therefore installed under the
locale directories real users actually resolve, keeping the original name alongside them so
nothing that already worked stops.

On the JSON side the filename becomes an Android resource qualifier
(`values-<lang>[-r<REGION>]`), where an underscore is illegal: `pt_BR.json` would yield
`values-pt_BR`, a directory Android never consults.

**A catalog whose script subtag maps to no known name fails the build**, naming every such
catalog at once. A build that cannot say where a catalog goes must not quietly put it somewhere —
"somewhere" is indistinguishable from "correct" until a user of that language complains. Map it
explicitly with `localeNames`, one catalog at a time, so mapping one language does not disarm the
check for the rest:

```typescript
gettextPlugin({
    poDirectory: 'po',
    moDirectory: 'dist',
    localeNames: { az_Arab: ['az_IR'] },
});
```

Two catalogs that would land on one output name (a Weblate `zh_Hans.po` beside a hand-made
`zh_CN.po`) fail the same way, rather than letting one overwrite the other.

```typescript
xgettextPlugin({
    sources: ['src/**/*.blp', 'data/**/*.desktop.in', '!src/**/*.generated.blp'],
    output: 'po/messages.pot',
    autoUpdatePo: true,
    // optionalSources: ['plugins/**/*.ui'],
    // maxCatalogEntryLoss: 0.5, // a FRACTION, not a percentage; 1 turns the check off
});
```

Both guards throw. `xgettext`, `msgcat` and `msgmerge` failures are no longer reported to the
console beside a zero exit code either — a build that could not write the catalogs it was asked to
write fails.

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
