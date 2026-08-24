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
| `include` | `/\.vue$/` | Which modules to compile. A `g`/`y` flag is stripped: both make `RegExp.test` stateful, and this plugin tests three times per module — measured with `/\.vue$/g`, `resolveId` returned `null` for *every* `.vue` import and `load` alternated between compiling and declining. |
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

**A split SFC is refused with a named error.** Measured: `<template src="./tpl.html"/>` compiled to `function __sfc_render__() { return null }`, and `<script src="./s.js">` to `const __sfc__ = {}` with the external module never imported — a component that renders blank or carries none of its logic, at exit 0. (`<script setup src>` never reaches this plugin: `@vue/compiler-sfc`'s own `parse()` rejects it.) So is a `<template lang>` other than `html`: there is no template preprocessor here, and measured, `lang="pug"` compiled to a render function **returning the pug source as a text node**.

**Every DOM-only template feature is refused with a named error, and this is the largest refusal set.** `compileTemplate` runs on `@vue/compiler-dom` — `@vue/compiler-sfc` ships no other template compiler — so `DOMDirectiveTransforms` and `DOMNodeTransforms` are installed and all of these *compile*. Each then fails in a way that leaves a GTK app running:

| written | emitted | how it fails |
| --- | --- | --- |
| `v-show` | `vShow` + `withDirectives` | `vShow` is absent from `@vue/runtime-core` |
| `v-model` on an element | `vModelText` / `vModelCheckbox` / `vModelDynamic` | all three absent |
| `@x.stop`, `@x.enter` | `withModifiers`, `withKeys` | both absent |
| `<Transition>`, `<TransitionGroup>` (both spellings) | `Transition`, `TransitionGroup` | both absent |
| `v-html`, `v-text` | an `innerHTML` / `textContent` prop | no GTK widget has it |
| `class`, `:class`, `style`, `:style` | a `class` / `style` prop | no GTK widget has it; `cssClasses` is a string **array** |

The absent imports are a rolldown **MISSING_EXPORT warning at exit 0**, and the app then calls `undefined` inside a GLib callback. The dead props are refused by `@gjsify/gtk-host` as `unknown-prop` at *render* time — also inside a GLib callback, where GJS prints `JS ERROR` and the process still exits 0. Neither is a build failure without this refusal.

`v-model` is refused on an **element only**: measured, on a component it compiles to `modelValue` + `onUpdate:modelValue` and imports nothing DOM-shaped, so refusing it there would break legitimate Vue. `v-if`/`v-else`/`v-for`/`v-slot`/`v-once`/`v-cloak` and a plain `@signal` are untouched.

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
- **It must be set in the BASE of the `extends` chain.** Measured, four cells, all four: the base tsconfig's value wins and the child's is ignored outright, in *both* directions — a strict base stays strict under a child that sets `false`, and a lax base stays lax under a child that sets `true`. In a monorepo the shared base config therefore decides this for every package and a per-package override does nothing. `vue-tsc --showConfig` will not tell you either: measured, it prints `compilerOptions`, `files`, `include` and `exclude` and **not** `vueCompilerOptions`. So the config that sets it has to be the one with no `extends` above it — which is what `scripts/check-vue-program.mjs` asserts. This is the load-bearing warning in [`gtk-host/src/vue-components.ts`](../../framework/gtk-host/src/vue-components.ts).
- **`src/**/*.vue` must be in `include` explicitly, for the SFCs nothing imports.** A tsconfig whose `include` lists only `.ts` globs makes `vue-tsc` check **zero** *standalone* SFCs and exit 0. Measured, the limit of that: an SFC a root `.ts` imports is pulled into the program and fully type-checked either way, so the glob is what covers a component that is not wired up yet.
- **`vue-tsc --noEmit` on its own is an exit code and nothing else.** `scripts/check-vue-program.mjs` is what makes it a check: it runs the package's own `vue-tsc` with `--listFiles`, requires every `.vue` on disk to be in the program, and requires the config to carry `strictTemplates` with no `extends` above it. All three are A/B-proven able to fail; a bare `vue-tsc --noEmit` stays green through each.
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

The plugin pins the two `@vue/compiler-sfc` options whose defaults are `__DEV__`, i.e. the *bundler's* `process.env.NODE_ENV`, which no gjsify build sets: `comments: false` (measured, the same SFC emitted 4 `createCommentVNode` calls with NODE_ENV unset and 0 with `NODE_ENV=production`) and `hoistStatic: false`, which the adapter prescribes.

**`comments: false` has to be set TWICE, and pinning it only at parse time made the plugin non-deterministic within one process.** `parse()` LRU-caches the descriptor and `compileTemplate` marks the ast `transformed`, so the second compile of the same file takes `resolveTemplateAST`, which re-parses `inAST.source` using `compilerOptions` as the *parse* options. Measured on one fixture in one process: pass 1 emitted 0 `createCommentVNode` calls, pass 2 emitted 1, and the two modules differed byte-for-byte. So it is pinned in `templateParseOptions` **and** in `compilerOptions`, and a test compiles one fixture twice and asserts byte equality.

`transformHoist: null` used to sit beside `hoistStatic: false` with a comment calling it load-bearing. It was dead: `@vue/compiler-dom`'s `compile()` spreads its own `transformHoist: stringifyStatic` *after* the caller's options, so the `null` never reached `baseCompile`. Measured with `hoistStatic: true`, `null` and `undefined` produced byte-identical output with 1 `createStaticVNode(` each; only `hoistStatic: false` suppresses it. The option is gone and `hoistStatic: false` keeps its two tests.

One residual remains and has no option behind it: the generated code's patch-flag annotations (`8 /* PROPS */` vs `8`) and the `v-if` placeholder's debug text follow `__DEV__`. Neither changes a call or an argument that runs, and minification removes them.

## Source maps

`load` hands rolldown one map over the whole `.vue` file. Both halves of an SFC come with their own map and both already resolve to the *whole* file — measured, `sourcesContent[0]` is the SFC source in both, and the template map's source lines already count from the top of the file rather than from the template block — so only the generated side has to be fixed up, which is where the two halves landed in the joined module.

The two maps are decoded and re-encoded rather than spliced: the generated column resets per line, but the source index, source line, source column and name index are deltas carried across the entire map, so concatenating two `mappings` strings reads the second half's first segment relative to the first half's last and puts every remaining mapping somewhere else in the file. Tests resolve a position through the merged map (line **and** column) instead of asserting the `mappings` string, which would only pin the encoder against itself.

Note that gjsify's own build presets set `output.sourcemap: false` *after* spreading the caller's output options, so under `gjsify build --app <target>` the map is not written; it reaches a consumer through a plain Rolldown/Vite config.

## License

MIT
