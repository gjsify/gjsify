# Adwaita Package Builder

Minimal Adwaita application that demonstrates how to package a GJS app using only `@gjsify/cli`. Three build steps correspond to three CLI commands:

| Step | Command | Produces |
|---|---|---|
| `build:resources` | `gjsify gresource` | `dist/com.gjsify.ShowcasePackageBuilder.data.gresource` (binary bundle with `style.css`) |
| `build:i18n` | `gjsify gettext --format mo` | `dist/locale/<lang>/LC_MESSAGES/com.gjsify.ShowcasePackageBuilder.mo` (runtime translations) |
| `build:metainfo` | `gjsify gettext --format xml --metainfo …` | `dist/metainfo/com.gjsify.ShowcasePackageBuilder.metainfo.xml` (AppStream metadata) |
| `build:app` | `gjsify build --shebang` | `dist/com.gjsify.ShowcasePackageBuilder` (directly executable binary) |

## Run it

```bash
# Build everything
yarn build

# Launch via gjsify run (standard)
yarn start

# OR launch the binary directly — no wrapper needed, the --shebang flag
# prepended `#!/usr/bin/env -S gjs -m` and chmod'd the outfile to 0o755.
./dist/com.gjsify.ShowcasePackageBuilder
```

## See translations

```bash
LANG=de_DE.UTF-8 yarn start        # Hallo von gjsify
LANG=es_ES.UTF-8 yarn start        # Hola desde gjsify
LANG=C yarn start                  # Hello from gjsify (source string)
```

## What to look at

- [src/gjs/main.ts](src/gjs/main.ts) — `Gio.Resource.load` + `Gettext.bindtextdomain` wiring resolved relative to the binary.
- [src/gjs/main-window.ts](src/gjs/main-window.ts) — two CSS loading paths side by side: `Gtk.CssProvider.load_from_resource` (from GResource) and `load_from_string(runtimeStyle)` (from a JS-bundled string).
- [src/gjs/runtime-style.css](src/gjs/runtime-style.css) + [src/gjs/overrides.css](src/gjs/overrides.css) — imported as `import css from './runtime-style.css'`. The `@import "./overrides.css"` statement is resolved at build time by `@gjsify/esbuild-plugin-css`; the bundled string in the binary contains both files concatenated.
- [data/](data/) — the source CSS + GResource descriptor + metainfo template.
- [po/](po/) — `.po` files (one per language) consumed by `msgfmt`.

## Two ways to ship CSS

| | GResource (`data/style.css`) | JS bundle (`src/gjs/runtime-style.css`) |
|---|---|---|
| Build step | `gjsify gresource` → `.gresource` sidecar file | `gjsify build` + `@gjsify/esbuild-plugin-css` → inlined in outfile |
| Runtime API | `CssProvider.load_from_resource(path)` | `CssProvider.load_from_string(importedCss)` |
| `@import` resolution | At runtime via GTK's CSS parser (only resolves `resource://` paths) | At build time via esbuild's own resolver (`node_modules`, workspace paths, `package.json#exports`) |
| Deploy shape | Binary + `.gresource` file | Single self-contained binary |
| When to pick | Large asset sets, many referenced images/icons already in the GResource tree | Theme/component stylesheets imported from `node_modules`, one-file-binary deploys |

Related documentation: [CLI Reference — `gresource` / `gettext` / `build --shebang`](https://gjsify.org/docs/cli-reference/).
