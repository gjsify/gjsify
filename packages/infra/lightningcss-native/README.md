# @gjsify/lightningcss-native

A native Rust cdylib + Vala/GObject bridge that exposes the Rust `lightningcss` CSS transformer and minifier to GJS via `gi://`. Ships prebuilt `.so` + `.typelib` for Linux and is loaded lazily at runtime — the consuming package (`@gjsify/rolldown-plugin-gjsify`'s `cssAsStringPlugin`) falls back to the npm `lightningcss` package when the prebuild is unavailable.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/lightningcss-native
```

## Usage

```typescript
import { hasNativeLightningcss, transform, bundle } from '@gjsify/lightningcss-native';

if (hasNativeLightningcss()) {
    // Transform a CSS string with GTK4-compatible lowering
    const result = transform({
        filename: 'app.css',
        code: 'a { color: oklch(50% 0.2 270); }',
        targets: 'firefox >= 60',
        minify: true,
    });
    console.log(new TextDecoder().decode(result.code));

    // Bundle a CSS entry file (resolves @import chains)
    const bundled = bundle({ filename: '/path/to/app.css', targets: 'firefox >= 60' });
}
```

The native bridge is consumed automatically by `gjsify build --app gjs` via `@gjsify/rolldown-plugin-gjsify`. Direct use is only needed when calling the CSS pipeline outside of a gjsify build.

## License

MIT
