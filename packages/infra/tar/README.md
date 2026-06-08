# @gjsify/tar

Node-free `.tar` / `.tar.gz` reader and writer used by `gjsify install` to unpack npm tarballs on GJS. Decompression uses the Web Compression API (`DecompressionStream`); extraction writes via `node:fs` (polyfilled by `@gjsify/fs` on GJS). Runs on both Node.js and GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/tar
```

## Usage

```typescript
import { extractTarball, parseTar, createTarball } from '@gjsify/tar';

// Extract a .tgz buffer (e.g. a downloaded npm tarball) into a directory
const tgzBuffer = await fetch('https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz')
    .then(r => r.arrayBuffer());

const result = await extractTarball(tgzBuffer, '/tmp/lodash', { strip: 1 });
console.log(result.files);     // list of extracted file paths
console.log(result.symlinks);  // list of created symlinks

// Parse individual tar entries without writing to disk
for (const entry of parseTar(tarBytes)) {
    console.log(entry.name, entry.type, entry.size);
}
```

## License

MIT
