# @gjsify/vite-plugin-blueprint

Vite/Rollup/Rolldown plugin that compiles GNOME Blueprint (`.blp`) UI files to GtkBuilder XML strings. Import a `.blp` file and receive its compiled XML as a JavaScript string, ready for `Gtk.Builder`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/vite-plugin-blueprint

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/vite-plugin-blueprint
yarn add @gjsify/vite-plugin-blueprint
```

**No `blueprint-compiler` needed, and none is spawned.** The plugin parses and emits in process through
[`@gjsify/blueprint`](https://github.com/gjsify/gjsify/tree/main/packages/infra/blueprint), which reads the
introspection it needs out of pinned `@girs` packages rather than an installed typelib — so a build works
on macOS and Windows, and in a cold bootstrap, where the GNOME tool is not installable in one line. See
[ADR 0053](https://github.com/gjsify/gjsify/blob/main/docs/adr/0053-blueprint-parsed-in-repo.md).

**What it does NOT accept.** The parser holds a documented subset of the language, and anything outside it
is a build error naming the construct, the file and the line — never a silent pass-through, because output
that is plausible and wrong is discovered in a shipped program. Today that means an `[internal-child]`
bracket, a file-level `translation-domain`, an inline `menu` as a property value, a response flag, a
multi-step lookup chain with no cast (`bind a.b.c`), a closure with no `as <Type>`, and a type from a
namespace `@girs` publishes no vocabulary for (`Gio`, `Gdk` and `GObject` today) — for that last one the
extern form is the way through: `Gio.ListStore` is refused and `$GListStore` is not, because it writes the
GType name out and needs no vocabulary. Every refusal names the construct, the file, the line and one thing
to do next, and says that `blueprint-compiler` is not involved, so a file it accepts can still stop here.
The two error classes are `BlueprintSyntaxError` and `BlueprintEmitError` from `@gjsify/blueprint`, and both
carry `file` and `line` as fields, so a tool wrapping this plugin does not have to read them out of a
sentence. The package ships `corpus/refused/`, one named fixture per refused construct.

## Usage

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';

export default defineConfig({
    plugins: [blueprintPlugin({ minify: false })],
});
```

```typescript
// In your GJS app source
import windowXml from './window.blp';

const builder = Gtk.Builder.new_from_string(windowXml, -1);
```

Add type declarations by including `"@gjsify/vite-plugin-blueprint/types"` in your `tsconfig.json` `compilerOptions.types`.

## License

MIT
