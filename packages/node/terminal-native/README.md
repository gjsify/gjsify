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

Ships as a prebuilt `.so` + `.typelib` for `linux-x86_64`.

## License

MIT
