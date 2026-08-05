# @gjsify/oxlint-plugin-gjsify

An internal oxlint JS plugin with gjsify-specific lint rules:

- `gjsify/register-class-order` — enforces that static GObject metadata fields (`GTypeName`, `Properties`, `Signals`, etc.) are declared above `GObject.registerClass` static blocks, with autofix to reorder them automatically.
- `gjsify/deferred-process-exit` — a bare `process.exit()` does not halt under GJS (no atexit; the GLib main loop may still be armed): the call returns, the statements after it still run, and the requested exit code can be lost. The rule flags a statement containing a bare `process.exit()` when another statement follows it in the same statement list; tail-position exits are deliberately not flagged, and there is no autofix (the right repair — usually `return process.exit(...)` — is context-dependent, and a wrong one is a syntax error).
- `gjsify/todo-needs-anchor` — a deferral marker (`TODO`, `FIXME`, `HACK`, `XXX`) that OPENS a comment line must name where it is tracked: `#123`, a forge issue URL, `open-todos` for the `status/` ledger, or the `fixed upstream in …` shim note. A bare marker has no owner and no retirement path — nothing fails when the work lands and nothing fails when it is dropped. Markers read from the comment stream rather than the source text, so one inside a string is not a finding; mid-sentence occurrences are prose about markers, not markers. No autofix (only a human knows whether the repair is fixing it, filing an issue, or adding a ledger entry).

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
        "gjsify/todo-needs-anchor": "error"
    }
}
```

Run via `gjsify lint` or `gjsify fix` (which also applies autofix).

## License

MIT
