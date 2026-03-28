# @gjsify/cli

CLI tool for building and running GJS applications. Bundles TypeScript/JavaScript using esbuild with automatic Node.js to GJS module aliasing.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/cli
# or
yarn add @gjsify/cli
```

## Usage

```bash
# Build a GJS application
npx @gjsify/cli build src/index.ts

# Run a built GJS application (sets up LD_LIBRARY_PATH, GI_TYPELIB_PATH, etc.)
npx @gjsify/cli run dist/index.js

# Show environment info for a bundle
npx @gjsify/cli info dist/index.js
```

## License

MIT
