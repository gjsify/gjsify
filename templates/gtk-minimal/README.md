# new-gjsify-app

A minimal GTK 4 app — `Gtk.Window` + `Gtk.Label`, no Adwaita, no Blueprint — scaffolded from the gjsify `gtk-minimal` template.

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

## Operating systems

gjsify targets Linux, macOS and Windows. What this project can actually do on
each depends on the GNOME libraries you have installed, not on gjsify — GTK and
libadwaita are packaged for all three, but Linux is where they are best
supported and best tested. See
[Platform support](https://gjsify.github.io/gjsify/platform-support/).

## Versioning & compatibility

All `@gjsify/*` packages ship as one release train — compatibility between them
is guaranteed only within the same release version, so upgrade them together
rather than bumping individual packages:

```bash
gjsify upgrade --latest --filter @gjsify   # bump every @gjsify/* dep to the newest train
gjsify upgrade --align                     # repair drift back onto one train
gjsify upgrade --check                     # fail if the deps straddle two trains
```

See [Versioning & Compatibility](https://gjsify.github.io/gjsify/versioning/)
for details.
