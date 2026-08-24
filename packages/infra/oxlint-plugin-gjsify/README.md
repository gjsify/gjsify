# @gjsify/oxlint-plugin-gjsify

An internal oxlint JS plugin with gjsify-specific lint rules:

- `gjsify/register-class-order` — enforces that static GObject metadata fields (`GTypeName`, `Properties`, `Signals`, etc.) are declared above `GObject.registerClass` static blocks, with autofix to reorder them automatically.
- `gjsify/deferred-process-exit` — a bare `process.exit()` does not halt under GJS (no atexit; the GLib main loop may still be armed): the call returns, the statements after it still run, and the requested exit code can be lost. The rule flags a statement containing a bare `process.exit()` when another statement follows it in the same statement list; tail-position exits are deliberately not flagged, and there is no autofix (the right repair — usually `return process.exit(...)` — is context-dependent, and a wrong one is a syntax error).
- `gjsify/todo-needs-anchor` — a deferral marker (`TODO`, `FIXME`, `HACK`, `XXX`) that OPENS a comment line must name where it is tracked: `#123`, a forge issue URL, `open-todos` for the `status/` ledger, or the `fixed upstream in …` shim note. A bare marker has no owner and no retirement path — nothing fails when the work lands and nothing fails when it is dropped. Markers read from the comment stream rather than the source text, so one inside a string is not a finding; mid-sentence occurrences are prose about markers, not markers. No autofix (only a human knows whether the repair is fixing it, filing an issue, or adding a ledger entry).

- `gjsify/no-css-side-effect-import` — a bare `import '<something that is CSS>';` registers nothing under a gjsify build. `cssAsStringPlugin` emits `export default "<css>"`, a module with no side effect, so the import is tree-shaken and the build exits 0. Measured on 0.41.0: a probe entry whose only statement was `import '@gjsify/adwaita-fonts';` — the line `@gjsify/adwaita-web` carried for its whole life while declaring `font-family: 'Adwaita Sans'` — built to a **0-byte bundle with zero `@font-face`**. The rule resolves the target package's `exports` off disk, so the extensionless shape (`@gjsify/adwaita-fonts` → `index.css`) is caught too; a VALUE import and a JS side-effect import stay silent. No autofix: deleting the line is right where the stylesheet arrives some other way and wrong where the author meant the CSS to arrive, and only the author knows which. Under a real CSS pipeline the side-effect form IS correct — say so with a per-line `// oxlint-disable-next-line gjsify/no-css-side-effect-import -- <reason>`, which `reportUnusedDisableDirectives` retires the day the import goes; this repo has exactly one such site, an Astro component.
- `gjsify/prefer-blueprint-template` — a `Gtk`/`Adw` widget subclass that ASSEMBLES its interface in TypeScript with no Blueprint `Template`. Measured across this workspace 2026-08: Learn6502 carries a whole application in 24 `.blp` files with 8 programmatic constructions and reports zero; two apps that grew the other way report 31 template-free widget classes between them. The cost is not style — a caption assigned from TypeScript carries no `translatable` attribute, so `xgettext` never sees it and no catalogue can hold it: the interface is untranslatABLE while looking merely untranslated, which is why nobody files it. Requires BOTH signals before reporting (constructs a `Gtk`/`Adw` type AND calls a parenting method like `append`/`set_child`/`add_row`), because either alone is ordinary code — a class that only builds a `Gtk.Adjustment` is silent, and so is one that reparents an existing widget. Neither signal can type-check its operand: the rule sees `new Gtk.X` and a method NAME, never a GType. Where a non-widget's own API collides with a parenting name — `Gtk.StringList` filled by `.append()` being the case that occurs — a deny-list of known non-widget constructions keeps it quiet. `add_action` is deliberately NOT a parenting method: it is `Gio.ActionMap.add_action`, and treating it as one reported every widget that registers an action. A template that fills DATA-DRIVEN children at runtime is the intended pattern and is silent too (it has a `Template`). `Gtk.Application`/`Adw.Application` are excluded: an application object is not a widget and legitimately builds its own `Gtk.CssProvider` and `Adw.AboutDialog`. No autofix — writing the `.blp` is the work. Library code that implements widgets FOR others, plus fixtures and demos, are scoped off in `.oxlintrc.json` rather than disabled line by line.
- `gjsify/no-literal-widget-label` — user-visible text hard-coded into a widget from TypeScript: a bare string literal in a prose position (`label`, `title`, `subtitle`, `description`, `heading`, `body`, `tooltip-text`, `placeholder-text`, `secondary-text`) of a `new Gtk.X`/`new Adw.X` constructor object or the matching `set_*` call. This is the half of the problem that survives even after a class HAS a template. Extraction sees `translatable="yes"` from Blueprint and `_("…")` from TypeScript; a bare literal is neither, so the string reaches no catalogue. Two repairs and the rule accepts both: move it into the co-located `.blp` as `title: _("…")`, or wrap it in place as `_("…")` when a runtime value picks it — wrapping is why there is no autofix. Also covers the captions that arrive as a LATER argument — `Adw.AlertDialog`'s `add_response(id, label)` and `set_response_label(id, label)`, which are the only way that dialog gets its buttons: without them a dialog whose `heading` the rule reports would still ship English-only buttons, in the same function (measured: 24 live call sites across two consumer apps). Only PROSE positions are checked: `icon-name`, `css-classes`, `action-name`, a stack page's `name` and an `Adw.EntryRow`'s `text` (user data, not a caption) are deliberately absent, and a literal with no letters (`"—"`, `"%"`, `"3"`) is not reported, because a rule that flags punctuation loses its audience. A default behind a caller override (`options.label ?? 'OK'`) is not a literal in this position and stays silent — that IS the escape hatch for library code with no text domain of its own. The setter half matches on method NAME alone, so a non-GTK object with a `set_title` method is reported too; the message names the Blueprint PROPERTY (`title`), never the setter.
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
        "gjsify/no-css-side-effect-import": "error",
        "gjsify/prefer-blueprint-template": "error",
        "gjsify/no-literal-widget-label": "error"
    }
}
```

Run via `gjsify lint` or `gjsify fix` (which also applies autofix).

## License

MIT
