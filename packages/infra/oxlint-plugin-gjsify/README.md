# @gjsify/oxlint-plugin-gjsify

An internal oxlint JS plugin that exposes the `gjsify/register-class-order` lint rule. The rule enforces that static GObject metadata fields (`GTypeName`, `Properties`, `Signals`, etc.) are declared above `GObject.registerClass` static blocks, and provides autofix to reorder them automatically.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

This is an internal workspace package — installed automatically as part of gjsify, not separately.

## Usage

The plugin is wired via `.oxlintrc.json` in the gjsify workspace root:

```json
{
    "jsPlugins": ["./packages/infra/oxlint-plugin-gjsify/src/index.ts"],
    "rules": {
        "gjsify/register-class-order": "error"
    }
}
```

Run via `gjsify lint` or `gjsify fix` (which also applies autofix).

## License

MIT
