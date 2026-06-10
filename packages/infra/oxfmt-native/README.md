# @gjsify/oxfmt-native

A native Rust cdylib + Vala/GObject bridge that wraps oxc's formatter ([oxfmt](https://oxc.rs/docs/guide/usage/formatter)) and exposes it to GJS via `gi://`. This is the formatter engine used by `gjsify format` / `gjsify fix` under GJS — npm's `oxfmt` is a Rust N-API binary that cannot load in GJS, so this bridge is how gjsify formats without a Node runtime. The bridge links oxfmt's pure-Rust CLI core, so the full CLI surface runs in-process: `.oxfmtrc(.json)` + `.editorconfig` resolution, ignore handling, parallel file walking, `--write` / `--check` / `--list-different`. Ships prebuilt `.so` + `.gir` + `.typelib` for Linux.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/oxfmt-native
```

## Usage

```typescript
import { hasNativeOxfmt, format, runOxfmt } from '@gjsify/oxfmt-native';

if (hasNativeOxfmt()) {
    // Single-shot in-memory format (Prettier-compatible defaults)
    console.log(format('const   x:number=1', 'input.ts'));
    // => "const x: number = 1;\n"

    // Full oxfmt CLI in-process (argv WITHOUT the program name).
    // Honors .oxfmtrc(.json) / .editorconfig, prints to stdout/stderr,
    // returns the process exit code.
    const code = runOxfmt(['--check', '--config', '/abs/.oxfmtrc.json', 'src']);
}
```

Not covered (requires oxfmt's Node-API host by design): the embedded CSS/HTML/Vue/Markdown Prettier `ExternalFormatter`, JS/TS config files (`.oxfmtrc.ts`), `--init` / `--migrate`, LSP and stdin mode.

Under normal usage `@gjsify/oxfmt-native` is consumed automatically by the gjsify CLI (`gjsify format`, `gjsify fix`) — direct use is only needed when embedding the formatter in custom tooling.

## Building from source

The Rust shim path-deps into the `refs/oxc` submodule (pinned to the `oxfmt_v*` tag matching the workspace's npm `oxfmt` devDependency — `oxc_formatter` is yanked on crates.io, the formatter lives in-tree only):

```bash
git submodule update --init refs/oxc
gjsify workspace @gjsify/oxfmt-native build:prebuilds   # needs meson + vala + cargo
```

## License

MIT
