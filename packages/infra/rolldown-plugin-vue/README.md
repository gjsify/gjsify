# @gjsify/rolldown-plugin-vue

A Rolldown (and Rollup/Vite-compatible) plugin that compiles **Vue 3 single-file components** during gjsify builds, for a `@vue/runtime-core` custom renderer — the GTK one in [`@gjsify/gtk-host`](../../framework/gtk-host).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Why this exists

`@gjsify/gtk-host/vue` — the adapter — was complete and tested before this package. But it was tested through `h(...)` calls, which is to say through the renderer calls an SFC template compiles *to*. Nothing in the repository compiled a `.vue` file, so the compile step was unmeasured, and its failure mode is silent in the direction that matters: without `compilerOptions.isCustomElement`, **every** GTK tag compiles to `resolveComponent("gtk-box")`. Vue's resolver misses, warns once per tag — and the warning is `__DEV__`-only, which the production defines this pipeline requires strip.

Measured on one template, without the predicate: 7 of 7 tags became `_resolveComponent(…)` and **zero** element vnodes were emitted. With it: 0 `resolveComponent`, 6 `createElementVNode` plus the root `createElementBlock`.

`@vue/compiler-sfc` is loaded on the first `.vue` module, so a build with no SFC in it never pays for it.

## Installation

```bash
gjsify install @gjsify/rolldown-plugin-vue
```

## Usage

Wire it through `package.json#gjsify`, no JS-form config file needed:

```json
{
    "gjsify": {
        "bundler": {
            "plugins": [{ "name": "@gjsify/rolldown-plugin-vue" }]
        }
    }
}
```

Or directly in a Rolldown / Vite config:

```typescript
import { vuePlugin } from '@gjsify/rolldown-plugin-vue';

export default {
    plugins: [vuePlugin()],
};
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `isCustomElement` | `isGtkHostTag` | Which tags compile to an element vnode instead of a component lookup. |
| `include` | `/\.vue$/` | Which modules to compile. |
| `runtimeModuleName` | `@vue/runtime-core` | Module the generated code imports Vue's runtime from. `vue` — the compiler's own default — drags `@vue/runtime-dom` and the DOM renderer into a bundle with no DOM. |

### The default tag rule, and where its authority is

`isGtkHostTag` accepts `gtk-`/`adw-` kebab **and** `Gtk`/`Adw` + a capital. Both spellings are required: `isCustomElement` is consulted for PascalCase tags too (measured — it was asked about `GtkLabel`, `GtkBox` and `GtkGLArea` as well as the kebab forms), and one `GlobalComponents` key answers both spellings, so a kebab-only predicate leaves `<GtkBox>` type-checking and then resolving as a missing component.

It is a **prefix rule** on purpose. It decides "element vnode or component lookup", never whether the widget exists. An unknown tag is refused by name twice, and neither place is here:

- at render time, `@gjsify/gtk-host`'s registry throws `unknown-tag`;
- at type-check time, `GlobalComponents` + `strictTemplates` refuses it.

Encoding the widget list in this plugin would be a third copy of a generated table, and the first one to drift. The rule does cover that table exactly: all 164 GType keys in `gtk-host/src/generated/props.ts` match `^(Gtk|Adw)[A-Z]`.

## What it refuses, and what it ignores

**`<style>` is refused with a named error.** GTK styling is a `Gtk.CssProvider` concern — there is no element a CSS rule could attach to, and `<style scoped>` compiles to an attribute selector GTK4 CSS does not have. Compiling the rest and saying nothing would build an app that renders unstyled with nothing anywhere to read about it. Load the CSS yourself with `Gtk.CssProvider.load_from_string()` plus `Gtk.StyleContext.add_provider_for_display()`, and put the selector on the widget with `cssClasses`.

**`<script lang="jsx">` / `lang="tsx">` is refused with a named error.** The module id's extension is what selects rolldown's parser, and it is chosen before anything has read the file (see below), so it cannot depend on the block's `lang`. Write JSX in a `.tsx` file and compile it with [`@gjsify/rolldown-plugin-solid`](../rolldown-plugin-solid).

**Out of scope, and not attempted:** `<style>` including `scoped`, HMR, asset-URL rewriting (`transformAssetUrls` is off), custom blocks, SSR, `?query` suffixes on a `.vue` import, and watch-mode dependency registration. Custom blocks are the one thing that is neither compiled nor refused — they carry no runtime semantics of their own, so nothing in the bundle reads them and nothing renders differently.

## How a `.vue` id gets parsed

Rolldown picks a parser from the id's extension, and `.vue` is not one it knows: hand it TypeScript on a `.vue` id and the build dies with `[PARSE_ERROR] Missing initializer in const declaration` pointing into the `.vue` file. Three mechanisms were measured on the same fixture:

| mechanism | node engine | GJS engine |
| --- | --- | --- |
| `transform` returning `moduleType: 'ts'` | exit 0 | **exit 1** — `rolldown: unsupported moduleType 'ts'` |
| `moduleTypes: { '.vue': 'ts' }` input option | exit 0 | not reachable — the CLI has no passthrough |
| `resolveId` renaming to `App.vue.ts` + `load` | exit 0 | exit 0 |

So this plugin renames. `resolveId` resolves `./App.vue` normally (`skipSelf`) and appends `.ts` to the absolute path; `load` strips the suffix, reads the real file and compiles it. The real path stays the id's prefix, so a diagnostic still names the file.

`moduleType` is not an undocumented field — rolldown 1.1.4 ships it in `SourceDescription`, and it is the *designed* mechanism. It is unavailable here because `@gjsify/rolldown-native`'s `plugin_proxy.rs::parse_module_type` accepts `js`/`ecmascript`/`json`/`text` and rejects everything else, which makes it unusable on the primary target. That gap is recorded in `status/open-todos.md`; closing it is a prebuild-cycle change and this plugin does not depend on it.

One suffix and not four is why `lang="jsx"`/`"tsx"` is refused. A `<script>` with no `lang` is therefore parsed as TypeScript — harmless except for the handful of JS/TS syntactic ambiguities, and `lang="ts"` is what a project using this type surface writes anyway.

## TypeScript — both halves are required

The compile step above is one half. The other is `vue-tsc`, and it has a trap that produces a green check which verified nothing.

```json
{
    "compilerOptions": { "strict": true, "module": "NodeNext", "moduleResolution": "NodeNext" },
    "vueCompilerOptions": { "strictTemplates": true },
    "include": ["src/**/*.ts", "src/**/*.vue"]
}
```

- **`strictTemplates: true` is load-bearing.** Measured on `vue-tsc@3.3.11` against the `vue-host-counter` showcase: with it, an unknown prop, an unknown tag, an unknown event, a wrong value type and a bad enum nick all fail. Without it, the unknown prop and the unknown *tag* are silently accepted while wrong value types still error — so a project without it sees type errors appear and concludes the surface is working.
- **It must be set in the BASE of the `extends` chain.** Measured, four cells, all four: the base tsconfig's value wins and the child's is ignored outright, in *both* directions — a strict base stays strict under a child that sets `false`, and a lax base stays lax under a child that sets `true`. In a monorepo the shared base config therefore decides this for every package and a per-package override does nothing. Check the value with `vue-tsc --showConfig`, never by reading the nearest tsconfig. This is the load-bearing warning in [`gtk-host/src/vue-components.ts`](../../framework/gtk-host/src/vue-components.ts).
- **`src/**/*.vue` must be in `include` explicitly.** A tsconfig whose `include` lists only `.ts` globs makes `vue-tsc` check **zero** SFCs and exit 0.
- The `GlobalComponents` augmentation only applies to a program that loads it, so the project needs `import '@gjsify/gtk-host/vue-components';` somewhere — best in a `.d.ts`, since the module carries no runtime value.

## The build recipe

`@vue/runtime-core` is DOM-free in fact, but `--globals auto` is a static scan and injects a polyfill per identifier it sees in a dev-only branch. Four defines are required, or the bundle grows `gi://Gdk`, `GdkPixbuf`, `Pango` and `PangoCairo`:

```
--define '__VUE_OPTIONS_API__=false'
--define '__VUE_PROD_DEVTOOLS__=false'
--define '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__=false'
--define 'process.env.NODE_ENV="production"'
```

`showcases/gtk/vue-host-counter` asserts `globalThis.document` is `undefined` on every launch, so losing the recipe fails the showcase rather than silently growing four typelib dependencies. The full measurement, including the one import the recipe cannot save (`Suspense`), is in [`gtk-host`'s README](../../framework/gtk-host/README.md).

## Determinism

The plugin pins the two `@vue/compiler-sfc` options whose defaults are `__DEV__`, i.e. the *bundler's* `process.env.NODE_ENV`, which no gjsify build sets: `comments: false` at parse time (measured, the same SFC emitted 4 `createCommentVNode` calls with NODE_ENV unset and 0 with `NODE_ENV=production`) and `hoistStatic: false` / `transformHoist: null`, which the adapter prescribes.

One residual remains and has no option behind it: the generated code's patch-flag annotations (`8 /* PROPS */` vs `8`) and the `v-if` placeholder's debug text follow `__DEV__`. Neither changes a call or an argument that runs, and minification removes them.

## License

MIT
