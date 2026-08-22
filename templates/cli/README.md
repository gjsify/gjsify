# new-gjsify-app

A command-line tool using yargs, scaffolded from the gjsify `cli` template.

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
npm run dev            # watch, rebuild + relaunch on GJS
npm run build          # bundle for every runtime (dist/index.gjs.js + dist/index.node.mjs)
npm start              # run on GJS
npm run start:node     # run on Node.js
npm run start:bun      # run on Bun
npm run start:deno     # run on Deno
npm run check          # type-check
npm run clear          # remove build output
```

## Runtimes

This template runs on **GJS, Node.js, Bun and Deno**, declared in `package.json`
as `gjsify.example.runtimes`. Two bundles cover all four: `--app gjs` produces
`dist/index.gjs.js`, and `--app node` produces `dist/index.node.mjs`, which
Node, Bun and Deno all consume (Node-API is their common ABI).

The build names its target explicitly. Without `--app`, `gjsify build` follows
the runtime that happens to be invoking it, so the same `npm run build` would
produce a different artifact on a contributor's machine than in CI.

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
