# @gjsify/oxlint-plugin-gjsify

An internal oxlint JS plugin with gjsify-specific lint rules:

- `gjsify/register-class-order` — enforces that static GObject metadata fields (`GTypeName`, `Properties`, `Signals`, etc.) are declared above `GObject.registerClass` static blocks, with autofix to reorder them automatically.
- `gjsify/deferred-process-exit` — a bare `process.exit()` does not halt under GJS (no atexit; the GLib main loop may still be armed): the call returns, the statements after it still run, and the requested exit code can be lost. The rule flags a statement containing a bare `process.exit()` when another statement follows it in the same statement list; tail-position exits are deliberately not flagged, and there is no autofix (the right repair — usually `return process.exit(...)` — is context-dependent, and a wrong one is a syntax error).
- `gjsify/todo-needs-anchor` — a deferral marker (`TODO`, `FIXME`, `HACK`, `XXX`) that OPENS a comment line must name where it is tracked: `#123`, a forge issue URL, `open-todos` for the `status/` ledger, or the `fixed upstream in …` shim note. A bare marker has no owner and no retirement path — nothing fails when the work lands and nothing fails when it is dropped. Markers read from the comment stream rather than the source text, so one inside a string is not a finding; mid-sentence occurrences are prose about markers, not markers. No autofix (only a human knows whether the repair is fixing it, filing an issue, or adding a ledger entry).

- `gjsify/no-css-side-effect-import` — a bare `import '<something that is CSS>';` registers nothing under a gjsify build. `cssAsStringPlugin` emits `export default "<css>"`, a module with no side effect, so the import is tree-shaken and the build exits 0. Measured on 0.41.0: a probe entry whose only statement was `import '@gjsify/adwaita-fonts';` — the line `@gjsify/adwaita-web` carried for its whole life while declaring `font-family: 'Adwaita Sans'` — built to a **0-byte bundle with zero `@font-face`**. The rule resolves the target package's `exports` off disk, so the extensionless shape (`@gjsify/adwaita-fonts` → `index.css`) is caught too; a VALUE import and a JS side-effect import stay silent. No autofix: deleting the line is right where the stylesheet arrives some other way and wrong where the author meant the CSS to arrive, and only the author knows which. Under a real CSS pipeline the side-effect form IS correct — say so with a per-line `// oxlint-disable-next-line gjsify/no-css-side-effect-import -- <reason>`, which `reportUnusedDisableDirectives` retires the day the import goes; this repo has exactly one such site, an Astro component.
- `gjsify/spawn-node-binary` — `spawn(process.execPath, …)` means "start the current runtime again", which is right in a Node program and wrong in a DUAL-HOST one: under `dist/cli.gjs.mjs` that path is `gjs-console`, so the spawn hands a Node script to GJS, which runs it and dies inside the payload. Use `nodeBinary()` from `utils/run-node.ts`. Scoped to `packages/infra/cli/src/**`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

This is an internal workspace package — installed automatically as part of gjsify, not separately.

## Usage

The plugin is wired via `.oxlintrc.json` in the gjsify workspace root:

```json
{
    "jsPlugins": ["./packages/infra/oxlint-plugin-gjsify/src/index.ts"],
    "rules": {
        "gjsify/register-class-order": "error",
        "gjsify/deferred-process-exit": "error",
        "gjsify/todo-needs-anchor": "error",
        "gjsify/spawn-node-binary": "error",
        "gjsify/no-css-side-effect-import": "error"
    }
}
```

Run via `gjsify lint` or `gjsify fix` (which also applies autofix).

## License

MIT
