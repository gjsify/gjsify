# @gjsify/oxlint-plugin-gjsify

An internal oxlint JS plugin with gjsify-specific lint rules:

- `gjsify/register-class-order` — enforces that static GObject metadata fields (`GTypeName`, `Properties`, `Signals`, etc.) are declared above `GObject.registerClass` static blocks, with autofix to reorder them automatically.
- `gjsify/deferred-process-exit` — a bare `process.exit()` does not halt under GJS (no atexit; the GLib main loop may still be armed): the call returns, the statements after it still run, and the requested exit code can be lost. The rule flags a statement containing a bare `process.exit()` when another statement follows it in the same statement list; tail-position exits are deliberately not flagged, and there is no autofix (the right repair — usually `return process.exit(...)` — is context-dependent, and a wrong one is a syntax error).

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
        "gjsify/deferred-process-exit": "error"
    }
}
```

Run via `gjsify lint` or `gjsify fix` (which also applies autofix).

## License

MIT
