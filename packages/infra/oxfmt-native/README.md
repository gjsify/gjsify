# @gjsify/oxfmt-native

A native Rust cdylib + Vala/GObject bridge that wraps oxc's formatter ([oxfmt](https://oxc.rs/docs/guide/usage/formatter)) and exposes it to GJS via `gi://`. This is the formatter engine used by `gjsify format` / `gjsify fix` under GJS — npm's `oxfmt` is a Rust N-API binary that cannot load in GJS, so this bridge is how gjsify formats without a Node runtime. The bridge links oxfmt's pure-Rust CLI core, so the full CLI surface runs in-process: `.oxfmtrc(.json)` + `.editorconfig` resolution, ignore handling, parallel file walking, `--write` / `--check` / `--list-different`. Ships prebuilt native libraries + `.gir` + `.typelib` for Linux and macOS — see [Platform coverage](#platform-coverage).

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

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64` | ✅ `.so` + `.gir` + `.typelib` | native runner |
| `linux-arm64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ❌ | not built — the `refs/oxc` crate graph is too slow under QEMU |
| `darwin-arm64` (macOS, Apple silicon) | ✅ `.dylib` + `.gir` + `.typelib` | `macos-latest` runner |
| `darwin-x64` (macOS, Intel) | ❌ | — no runner leg yet |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

All prebuilds are produced by [`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml)
and committed back to the repository.

**Known gap — a `darwin-arm64` prebuild is built and shipped, but the CLI does not
load it yet.** `detectNativePackages()` (`packages/infra/cli/src/utils/detect-native-packages.ts`)
hardcodes a `linux-` directory prefix, and `buildNativeEnv()` exports `LD_LIBRARY_PATH`,
which macOS `dyld` ignores in favour of `DYLD_LIBRARY_PATH`. Both are CLI-side fixes;
until they land, `gjsify format` on macOS falls back to spawning the npm `oxfmt` Node launcher.

## License

MIT
