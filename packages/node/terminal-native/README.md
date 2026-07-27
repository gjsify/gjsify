# @gjsify/terminal-native

Optional native Vala bridge for real terminal support on GJS: `isatty` via `Posix.isatty`, terminal size via `ioctl(TIOCGWINSZ)`, raw mode via `termios`, and `SIGWINCH` resize events via `GjsifyTerminal.ResizeWatcher`. When installed, this package enhances `@gjsify/tty` and `@gjsify/process` with correct terminal behaviour; without it those packages fall back to environment variables and GLib defaults.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

This package is loaded automatically by `@gjsify/tty` and `@gjsify/process` when present. Install it to enable accurate terminal detection and raw mode in your GJS CLI app:

```bash
gjsify install @gjsify/terminal-native

# npm or yarn also work:
npm install @gjsify/terminal-native
yarn add @gjsify/terminal-native
```

## Usage

```typescript
// Consumed via @gjsify/tty / @gjsify/process — no direct use needed.
// For low-level access:
import { hasNativeTerminal, nativeTerminal } from '@gjsify/terminal-native';

if (hasNativeTerminal()) {
    const term = nativeTerminal!.Terminal;
    console.log('stdout is tty:', term.is_tty(1));
    const [ok, rows, cols] = term.get_size(1);
    if (ok) console.log(`${cols}x${rows}`);
}
```

See [Platform coverage](#platform-coverage) for the prebuilt platforms.

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64` | ✅ `.so` + `.gir` + `.typelib` | native runner |
| `linux-arm64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ✅ | QEMU emulation |
| `darwin-arm64` (macOS, Apple silicon) | ✅ `.dylib` + `.gir` + `.typelib` | `macos-latest` runner |
| `darwin-x64` (macOS, Intel) | ❌ | — no runner leg yet |
| Windows | ❌ | — the bridge is POSIX-only (termios, `ioctl`, `SIGWINCH`) |

All prebuilds are produced by [`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml)
and committed back to the repository.

Despite the historic wording, nothing here is Linux-specific: `isatty(3)`, `termios` and the
`TIOCGWINSZ` `ioctl` are POSIX/BSD, and GLib supports `SIGWINCH` via `g_unix_signal_add()` on
every UNIX platform. The one Linux dependency — Vala's bundled `linux.vapi`, used only for
`Linux.winsize` and `Linux.Termios.TIOCGWINSZ` — has been replaced by the portable sibling
[`src/vala/terminal-compat.vapi`](src/vala/terminal-compat.vapi), which declares both against
`<sys/ioctl.h>` + `<termios.h>` so the include set is correct on Linux, macOS and the BSDs alike.

**Known gap — a `darwin-arm64` prebuild is built and shipped, but the CLI does not
load it yet.** `detectNativePackages()` (`packages/infra/cli/src/utils/detect-native-packages.ts`)
hardcodes a `linux-` directory prefix, and `buildNativeEnv()` exports `LD_LIBRARY_PATH`,
which macOS `dyld` ignores in favour of `DYLD_LIBRARY_PATH`. Until those CLI-side fixes land,
`@gjsify/tty` and `@gjsify/process` keep using their env/GLib fallbacks on macOS.

## License

MIT
