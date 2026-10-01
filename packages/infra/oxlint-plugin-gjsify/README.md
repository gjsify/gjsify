# @gjsify/oxlint-plugin-gjsify

An [oxlint](https://oxc.rs/docs/guide/usage/linter/linter.html) JS plugin carrying the lint
rules gjsify needs for GJS and GTK code — and that oxlint's own Rust rule set cannot have,
because each one is a claim about a HOST (GJS's exit semantics, `xgettext`'s view of a
Blueprint file) rather than about JavaScript.

## Installation

```bash
npm install --save-dev @gjsify/oxlint-plugin-gjsify oxlint
```

`oxlint` is a peer dependency: the plugin runs inside oxlint's JavaScript plugin host, so the
two versions have to be the ones you actually run.

## Usage

Add the package to `jsPlugins` in `.oxlintrc.json` and switch on the rules you want. The
rules are namespaced `gjsify/<rule>`, from the plugin's `meta.name`:

```json
{
    "jsPlugins": ["@gjsify/oxlint-plugin-gjsify"],
    "rules": {
        "gjsify/prefer-blueprint-template": "error",
        "gjsify/no-literal-widget-label": "error"
    }
}
```

Then run `npx oxlint .`, or `gjsify lint` if your project uses the gjsify CLI (which spawns
the same oxlint). `gjsify fix` applies the autofixes below.

> **A missing plugin is a hard failure, not a silent skip.** oxlint reports
> `Failed to load JS plugin` and exits non-zero rather than linting without the rules, so a
> scaffolded project that names the plugin but has not installed it fails loudly at the
> config step. If you see that message, run the install above.

### Which rules to enable

Not all seven suit every project. Two are about GTK application interface and are the reason
this package exists for most gjsify apps; the rest are narrower.

| Rule | Reports | Autofix |
|---|---|---|
| `prefer-blueprint-template` | a widget subclass that assembles its interface in TypeScript instead of declaring it in a Blueprint `.blp` | no — writing the `.blp` is the work |
| `no-literal-widget-label` | user-visible text hard-coded into a widget, where no catalogue can ever hold it | no — the repair is context-dependent |
| `register-class-order` | static GObject metadata declared below the `GObject.registerClass` static block | **yes** — hoists the fields |
| `deferred-process-exit` | a bare `process.exit()` with statements after it, which does not halt under GJS | no — usually `return process.exit(...)` |
| `todo-needs-anchor` | a `TODO`/`FIXME`/`HACK`/`XXX` that names nothing to track it | no |
| `no-css-side-effect-import` | a bare `import '<something that is CSS>'`, which tree-shakes away to nothing under a gjsify build | no |
| `spawn-node-binary` | `spawn(process.execPath, …)` under the GJS bundle, where that path is `gjs-console` | no |

Two of them are aimed at this repository rather than at consumers, and are listed here only
because they ship in the same plugin: `spawn-node-binary` fires on `spawn(process.execPath, …)`,
which this repo scopes to its own CLI sources in `.oxlintrc.json` and a consumer has to scope
itself (or leave off), and `no-css-side-effect-import` depends on how YOUR build treats CSS —
under a real CSS pipeline the side-effect form is correct. Enable what you have measured.

### Scope-outs

Library code that implements widgets FOR others — renderers, storybook fixtures, component
catalogues — legitimately builds widgets at runtime, and `prefer-blueprint-template` reports
every one. Scope those directories off in `.oxlintrc.json` rather than disabling line by line
(the paths below are examples, not paths of yours):

```json
{
    "overrides": [
        {
            "files": ["packages/web/adwaita-app/**", "**/*.story.ts"],
            "rules": { "gjsify/prefer-blueprint-template": "off" }
        }
    ]
}
```

With `reportUnusedDisableDirectives` on — which `gjsify format --init` writes — a directive that
suppresses nothing is itself an error, so a scope-out that stops applying retires itself.

## Rules

Each rule's own trade-offs — what it deliberately does NOT report, and why — are documented
with its implementation:

- `gjsify/register-class-order` — enforces that static GObject metadata fields (`GTypeName`, `Properties`, `Signals`, etc.) are declared above `GObject.registerClass` static blocks, with autofix to reorder them automatically.
- `gjsify/deferred-process-exit` — a bare `process.exit()` does not halt under GJS (no atexit; the GLib main loop may still be armed): the call returns, the statements after it still run, and the requested exit code can be lost. The rule flags a statement containing a bare `process.exit()` when another statement follows it in the same statement list; tail-position exits are deliberately not flagged, and there is no autofix (the right repair — usually `return process.exit(...)` — is context-dependent, and a wrong one is a syntax error).
- `gjsify/todo-needs-anchor` — a deferral marker (`TODO`, `FIXME`, `HACK`, `XXX`) that OPENS a comment line must name where it is tracked: `#123`, a forge issue URL, `open-todos` for the `status/` ledger, or the `fixed upstream in …` shim note. A bare marker has no owner and no retirement path — nothing fails when the work lands and nothing fails when it is dropped. Markers read from the comment stream rather than the source text, so one inside a string is not a finding; mid-sentence occurrences are prose about markers, not markers. No autofix (only a human knows whether the repair is fixing it, filing an issue, or adding a ledger entry).

- `gjsify/no-css-side-effect-import` — a bare `import '<something that is CSS>';` registers nothing under a gjsify build. `cssAsStringPlugin` emits `export default "<css>"`, a module with no side effect, so the import is tree-shaken and the build exits 0. Measured on 0.41.0: a probe entry whose only statement was `import '@gjsify/adwaita-fonts';` — the line `@gjsify/adwaita-web` carried for its whole life while declaring `font-family: 'Adwaita Sans'` — built to a **0-byte bundle with zero `@font-face`**. The rule resolves the target package's `exports` off disk, so the extensionless shape (`@gjsify/adwaita-fonts` → `index.css`) is caught too; a VALUE import and a JS side-effect import stay silent. No autofix: deleting the line is right where the stylesheet arrives some other way and wrong where the author meant the CSS to arrive, and only the author knows which. Under a real CSS pipeline the side-effect form IS correct — say so with a per-line `// oxlint-disable-next-line gjsify/no-css-side-effect-import -- <reason>`, which `reportUnusedDisableDirectives` retires the day the import goes; this repo has exactly one such site, an Astro component.
- `gjsify/prefer-blueprint-template` — a `Gtk`/`Adw` widget subclass that ASSEMBLES its interface in TypeScript with no Blueprint `Template`. Measured across this workspace 2026-08: Learn6502 carries a whole application in 24 `.blp` files with 8 programmatic constructions and reports zero; two apps that grew the other way report 31 template-free widget classes between them. The cost is not style — a caption assigned from TypeScript carries no `translatable` attribute, so `xgettext` never sees it and no catalogue can hold it: the interface is untranslatABLE while looking merely untranslated, which is why nobody files it. Requires BOTH signals before reporting (constructs a `Gtk`/`Adw` type AND calls a parenting method like `append`/`set_child`/`add_row`), because either alone is ordinary code — a class that only builds a `Gtk.Adjustment` is silent, and so is one that reparents an existing widget. Neither signal can type-check its operand: the rule sees `new Gtk.X` and a method NAME, never a GType. Where a non-widget's own API collides with a parenting name — `Gtk.StringList` filled by `.append()` being the case that occurs — a deny-list of known non-widget constructions keeps it quiet. `add_action` is deliberately NOT a parenting method: it is `Gio.ActionMap.add_action`, and treating it as one reported every widget that registers an action. A template that fills DATA-DRIVEN children at runtime is the intended pattern and is silent too (it has a `Template`). `Gtk.Application`/`Adw.Application` are excluded: an application object is not a widget and legitimately builds its own `Gtk.CssProvider` and `Adw.AboutDialog`. No autofix — writing the `.blp` is the work. Library code that implements widgets FOR others, plus fixtures and demos, are scoped off in `.oxlintrc.json` rather than disabled line by line.
- `gjsify/no-literal-widget-label` — user-visible text hard-coded into a widget from TypeScript: a bare string literal in a prose position (`label`, `title`, `subtitle`, `description`, `heading`, `body`, `tooltip-text`, `placeholder-text`, `secondary-text`) of a `new Gtk.X`/`new Adw.X` constructor object or the matching `set_*` call. This is the half of the problem that survives even after a class HAS a template. Extraction sees `translatable="yes"` from Blueprint and `_("…")` from TypeScript; a bare literal is neither, so the string reaches no catalogue. Two repairs and the rule accepts both: move it into the co-located `.blp` as `title: _("…")`, or wrap it in place as `_("…")` when a runtime value picks it — wrapping is why there is no autofix. Also covers the captions that arrive as a LATER argument — `Adw.AlertDialog`'s `add_response(id, label)` and `set_response_label(id, label)`, which are the only way that dialog gets its buttons: without them a dialog whose `heading` the rule reports would still ship English-only buttons, in the same function (measured: 24 live call sites across two consumer apps). Only PROSE positions are checked: `icon-name`, `css-classes`, `action-name`, a stack page's `name` and an `Adw.EntryRow`'s `text` (user data, not a caption) are deliberately absent, and a literal with no letters (`"—"`, `"%"`, `"3"`) is not reported, because a rule that flags punctuation loses its audience. A default behind a caller override (`options.label ?? 'OK'`) is not a literal in this position and stays silent — that IS the escape hatch for library code with no text domain of its own. The setter half matches on method NAME alone, so a non-GTK object with a `set_title` method is reported too; the message names the Blueprint PROPERTY (`title`), never the setter.
- `gjsify/spawn-node-binary` — `spawn(process.execPath, …)` means "start the current runtime again", which is right in a Node program and wrong in a DUAL-HOST one: under `dist/cli.gjs.mjs` that path is `gjs-console`, so the spawn hands a Node script to GJS, which runs it and dies inside the payload. Use `nodeBinary()` from `utils/run-node.ts`. Scoped to `packages/infra/cli/src/**`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

### How gjsify itself wires it

The gjsify repository runs all seven rules. Its root `.oxlintrc.json` names the SOURCE path
(`./packages/infra/oxlint-plugin-gjsify/src/index.ts`) rather than the package name, because
oxlint `import()`s a `.ts` file directly through Node's type-stripping and `gjsify lint` must
work on an unbuilt checkout — the same rules, loaded without a build step:

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

## License

MIT
