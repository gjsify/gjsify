# new-gjsify-app

An Adwaita game shell built on Excalibur.js, WebGL with a Canvas 2D fallback, scaffolded from the gjsify `adw-game` template.

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
npm run dev       # build + run
npm run build     # bundle for GJS  → dist/index.gjs.js
npm start         # run the built bundle on GJS
npm run check     # type-check
npm run clear     # remove build output
```

## Runtimes

This template targets **GJS**. It drives GTK/libadwaita through `gi://`, so GJS
is where it belongs — `package.json` declares that as
`gjsify.example.runtimes: ["gjs"]`, and the build passes `--app gjs` explicitly
so the target does not silently follow whichever runtime happens to invoke it.

gjsify itself also targets Node.js, Bun and Deno; the `cli`, `web-server-hono`
and `web-server-express` templates are the ones that ship bundles for all four.

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
