# @gjsify/cli

CLI tool for building and running GJS applications. Bundles TypeScript/JavaScript using esbuild with automatic Node.js to GJS module aliasing.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/cli

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/cli
yarn add @gjsify/cli
```

## Usage

```bash
# Build a GJS application
npx @gjsify/cli build src/index.ts

# Run a built GJS application (sets up the native-prebuild environment)
npx @gjsify/cli run dist/index.js

# Show environment info for a bundle
npx @gjsify/cli info dist/index.js
```

## Native prebuilds

Packages that ship compiled artifacts declare them with
`"gjsify": { "prebuilds": "prebuilds", "platforms": ["linux-x86_64", "darwin-arm64", …] }`
and stage them under `prebuilds/<os>-<arch>/`. `run`, `info`, `tsc` and the bin launchers
`install` writes all resolve that directory for the running host, accepting both spellings
in use — uname-style (`linux-x86_64`, staged by the Vala/meson bridges) and node-style
(`linux-x64`, `darwin-arm64`, `win32-x64`, staged by `@gjsify/node-gi` and `@gjsify/napi`) —
and prefer whatever the package declares in `gjsify.platforms`.

The environment they export is `GI_TYPELIB_PATH` plus the library-search variable the host's
dynamic loader actually reads:

| host | variable | separator |
|---|---|---|
| Linux | `LD_LIBRARY_PATH` | `:` |
| macOS | `DYLD_LIBRARY_PATH` (`dyld` ignores `LD_LIBRARY_PATH`) | `:` |
| Windows | `PATH` (`LoadLibrary` has no dedicated variable) | `;` |

A package with no artifact for your host is skipped — every native bridge is optional at
runtime. Which artifacts exist per package is tracked in
[Platform Support](https://gjsify.github.io/gjsify/platform-support/).

## License

MIT
