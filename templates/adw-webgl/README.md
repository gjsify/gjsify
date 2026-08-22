# new-gjsify-app

An Adwaita app rendering with WebGL and three.js (Blueprint UI), scaffolded from the gjsify `adw-webgl` template.

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
npm run build       # both bundles: dist/index.gjs.js and dist/index.node.mjs
npm start           # run the built bundle on GJS
npm run start:node  # …on Node.js   ┐
npm run start:bun   # …on Bun       ├ all three share dist/index.node.mjs
npm run start:deno  # …on Deno      ┘
npm run check       # type-check
npm run clear       # remove build output
```

## Runtimes

This app runs on all four runtimes gjsify targets — **GJS, Node.js, Bun and
Deno** — and opens the same GTK/libadwaita window with the same three.js scene on
each. `package.json` declares that as
`gjsify.example.runtimes: ["gjs", "node", "bun", "deno"]`.

Two bundles, not four. `--app gjs` produces the native GJS bundle; `--app node`
produces one bundle that Node, Bun and Deno all run, with `gi://` served by
`@gjsify/node-gi`. It is a **runtime** dependency, not a build-time one: the node
bundle does not inline it, it keeps `import … from '@gjsify/node-gi/cairo'` (and
`/system`, `/gi`) as live imports, so the package has to be there when the app
runs, not only when it builds. That is why it sits in `dependencies` — move it to
`devDependencies` and the app still builds and still runs from a dev checkout,
then dies with `Cannot find module '@gjsify/node-gi/gi'` the first time someone
installs without dev deps.

`--globals auto,dom` on the `--app node` build is not decoration. Auto-detection
runs on the GJS target only; a node bundle routes the `@gjsify/*` register
subpaths to `@gjsify/empty` unless the DOM surface is requested by name. Drop
`dom` and the window still opens, but `canvas.getContext('webgl2')` throws
`WebGL2RenderingContext is not a constructor` and the canvas stays empty.

The entry point uses `await app.runAsync([])` rather than the synchronous
`app.run([])`. It is the recommended `Gio.Application` lifecycle and the form the
multi-runtime showcases use: a sync `run()` blocks the thread inside the GLib main
loop, which hangs any startup that awaits something. This scene awaits nothing, so
the sync form happens to work here too — the async one is what keeps working once
you add a step that does.

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
