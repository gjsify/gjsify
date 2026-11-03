# new-gjsify-app

A minimal GTK 4 app — `Gtk.ApplicationWindow` + `Gtk.Label`, no Adwaita — scaffolded from the
gjsify `gtk-minimal` template.

The window is declared in `src/main-window.blp` and `src/main-window.ts` holds only logic.
That split is not decoration: a caption assigned from TypeScript cannot be marked
`translatable`, so `xgettext` never sees it and the interface is untranslatable by
construction.

Blueprint needs **no system tool**. `@gjsify/vite-plugin-blueprint` parses the `.blp` and emits
GtkBuilder XML in process, so `npm run build` asks nothing of your machine beyond GTK 4 itself,
on any of Linux, macOS and Windows. The compiled interface is inlined into `dist/`, so the built
app carries it too. The three `adw-*` templates work the same way.

The parser holds a subset of the language, and a construct outside it fails the build naming the
construct, the file and the line rather than emitting something plausible and wrong.

`src/style.css` is the app's stylesheet: it is imported as a **string** and handed to a
`Gtk.CssProvider` in the `activate` handler, the first point at which a display exists, while
`main-window.blp` names its class. `@gjsify/rolldown-plugin-gjsify/types` in `tsconfig.json` is
what types that import — no hand-written `css.d.ts` needed.

## Install

```bash
npm install          # or: yarn / pnpm install, or `gjsify install`
```

Any of the four works. `gjsify install` is gjsify's own installer and the only
one that works on a host with no Node.js at all; npm, yarn and pnpm are fine
everywhere else. Whichever you use, `@gjsify/rolldown-native` — the bundler
engine the build needs when it runs under GJS — is listed explicitly in
`devDependencies` so it is installed either way.

## Commands

```bash
npm run dev         # watch, rebuild + relaunch on GJS
npm run build       # bundle both targets
npm run build:gjs   # → dist/index.gjs.js
npm run build:node  # → dist/index.node.mjs
npm start           # run on GJS
npm run start:node  # run on Node.js
npm run start:bun   # run on Bun
npm run start:deno  # run on Deno
npm run check       # type-check
npm run clear       # remove build output
npm run ship -- <os>  # package it (see Ship below)
```

## Runtimes

One `src/index.ts` runs on all four runtimes gjsify targets, out of two bundles:

| Bundle | Built with | Runs on | `gi://` resolves through |
|---|---|---|---|
| `dist/index.gjs.js` | `--app gjs` | GJS | the interpreter itself |
| `dist/index.node.mjs` | `--app node` | Node.js, Bun, Deno | [`@gjsify/node-gi`](https://www.npmjs.com/package/@gjsify/node-gi) |

Node, Bun and Deno share the one `--app node` bundle — Node-API is their common
ABI, so none of them needs a target of its own. That is also why
`@gjsify/node-gi` sits in `dependencies` rather than `devDependencies`: the built
bundle imports it while it runs, not while it builds.

Both builds name `--app` explicitly so the target cannot silently follow
whichever runtime happens to invoke the build. `package.json` then declares the
result as `gjsify.example.runtimes`, which is what `gjsify run --runtime <name>`
checks against — asking for a runtime this project has no bundle for fails with a
message instead of crashing somewhere inside one.

Neither build names `--globals`. The default is `auto`, and this source touches
no web API — only `gi://` and `process`, which `auto` shims on GJS and which is
native on the other three. Templates that draw through a Canvas or WebGL request
that surface explicitly (`--globals auto,dom`); asking for it here would inject
registers nothing ever calls.

## Ship

`gjsify ship` wraps the built app into something a stranger can install — a
`.app` on macOS, an `.exe`/`.msi` on Windows, a `.deb`/`.rpm` on Linux:

```bash
npm run ship -- darwin    # → ship/*.app, ship/*.zip
npm run ship -- windows   # → ship/*/ (directory) + .zip
npm run ship -- windows --target msi
npm run ship -- linux     # → .deb + .rpm (needs gjs on the target)
```

`gjsify.ship` in `package.json` is the whole configuration: the application id,
the icon in `data/icons`, and — for macOS and Windows, which have no system GJS —
the `--app node` bundle plus the `@gjsify/node-runtime-*` package for that
platform. Those three packages sit in `optionalDependencies`, so `npm install`
takes the one matching your machine and skips the others instead of refusing the
install; a project shipping for a platform therefore builds it on that platform's
runner, or hands `gjsify` the interpreter through `GJSIFY_NODE_RUNTIME`. The
cross target itself wants GTK for its own architecture, which `gjsify` fetches
into its cache on first use.

Replace the placeholder icon and put your own name and email in `author` before
publishing anything.

## Operating systems

gjsify targets Linux, macOS and Windows. What this project can actually do on
each depends on the GNOME libraries you have installed, not on gjsify — GTK and
libadwaita are packaged for all three, but Linux is where they are best
supported and best tested. See
[Platform support](https://gjsify.org/gjsify/platform-support/).

## Versioning & compatibility

All `@gjsify/*` packages ship as one release train — compatibility between them
is guaranteed only within the same release version, so upgrade them together
rather than bumping individual packages:

```bash
gjsify upgrade --latest --filter @gjsify   # bump every @gjsify/* dep to the newest train
gjsify upgrade --align                     # repair drift back onto one train
gjsify upgrade --check                     # fail if the deps straddle two trains
```

See [Versioning & Compatibility](https://gjsify.org/gjsify/versioning/)
for details.
