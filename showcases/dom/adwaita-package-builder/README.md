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
- [src/gjs/main-window.ts](src/gjs/main-window.ts) — `Gtk.CssProvider.load_from_resource` and `Gettext.gettext` wrapping translated strings.
- [data/](data/) — the source CSS + GResource descriptor + metainfo template.
- [po/](po/) — `.po` files (one per language) consumed by `msgfmt`.

Related documentation: [CLI Reference — `gresource` / `gettext` / `build --shebang`](https://gjsify.org/docs/cli-reference/).
