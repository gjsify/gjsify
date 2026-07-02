# new-gjsify-app

An Adwaita game shell using Excalibur.js with WebGL → Canvas2D fallback, scaffolded from the gjsify `adw-game` template.

## Commands

```bash
npm install       # or: gjsify install
npm run dev       # build + run
npm run build     # bundle for GJS
npm start         # run the built bundle
npm run check     # type-check
```

## Versioning & compatibility

All `@gjsify/*` packages ship as one release train — compatibility between them
is guaranteed only within the same release version. Upgrade them together
instead of bumping individual packages:

```bash
gjsify upgrade --latest --filter @gjsify   # bump all @gjsify/* deps to the same train
```

See [Versioning & Compatibility](https://gjsify.github.io/gjsify/versioning/)
for details.
