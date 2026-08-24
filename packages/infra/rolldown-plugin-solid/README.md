# @gjsify/rolldown-plugin-solid

A Rolldown (and Rollup/Vite-compatible) plugin that compiles **SolidJS JSX** during gjsify builds, in `universal` generate mode — the only mode whose output contains no DOM.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Why a Babel plugin in an oxc toolchain

Solid's JSX is a *compiler*, not a runtime: `babel-plugin-jsx-dom-expressions` turns markup into straight-line calls against a renderer, and no oxc/SWC port of it exists. Rolldown's own transformer cannot stand in — pointed at a `.tsx` with no JSX configuration it defaults to the automatic React runtime and emits `import { jsx } from "react/jsx-runtime"`, which resolves to nothing under GJS.

Babel is loaded on the first matching module, so a build with no JSX in it never pays for it.

## Installation

```bash
gjsify install @gjsify/rolldown-plugin-solid
```

## Usage

Wire it through `package.json#gjsify`, no JS-form config file needed:

```json
{
    "gjsify": {
        "bundler": {
            "plugins": [{ "name": "@gjsify/rolldown-plugin-solid" }]
        }
    }
}
```

Or directly in a Rolldown / Vite config:

```typescript
import { solidPlugin } from '@gjsify/rolldown-plugin-solid';

export default {
    plugins: [solidPlugin({ moduleName: '@gjsify/gtk-host/solid' })],
};
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `moduleName` | `@gjsify/gtk-host/solid` | Module the compiler imports the renderer ops from. |
| `generate` | `universal` | `babel-preset-solid` mode. `dom` emits `document.createElement`, which does not exist on GJS. |
| `include` | `/\.(m\|c)?[jt]sx$/` | Which modules to compile. A `.ts` file cannot contain JSX. |

The target module must re-export **every** member of Solid's `Renderer<NodeType>` under its contract name — `createElement`, `createTextNode`, `insertNode`, `insert`, `spread`, `setProp`, `mergeProps`, `effect`, `memo`, `createComponent`, `render`, `use`. The compiler emits those names literally, so a renderer that exports eleven of the twelve builds fine and fails with `MISSING_EXPORT` on the twelfth — only for the JSX that happens to need it.

## TypeScript

The type side is configured separately, and both halves are required:

```json
{
    "compilerOptions": {
        "jsx": "preserve",
        "jsxImportSource": "@gjsify/gtk-host",
        "noImplicitAny": true,
        "strictFunctionTypes": true
    }
}
```

`jsx: "preserve"` is what this plugin needs (`"react"` is refused outright with `jsxImportSource`). Without `noImplicitAny` every JSX element is implicitly `any` and `tsc` exits 0 having checked nothing.

## License

MIT
