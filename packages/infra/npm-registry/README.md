# @gjsify/npm-registry

A small npm registry client used by `gjsify install` to resolve and download packages on GJS. Provides packument fetching with ETag revalidation, tarball download with SRI integrity verification, `.npmrc` parsing with Bearer/Basic auth, and exponential-backoff retry for transient failures. Cross-platform — runs on both GJS and Node using only `globalThis.fetch` and `SubtleCrypto`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/npm-registry
```

## Usage

```typescript
import {
    fetchPackument,
    fetchTarball,
    parseNpmrc,
    verifyIntegrity,
    whoami,
    DEFAULT_REGISTRY,
} from '@gjsify/npm-registry';

// Fetch a packument (package metadata)
const packument = await fetchPackument('lodash');
const latest = packument['dist-tags'].latest;
const tarballUrl = packument.versions[latest].dist.tarball;

// Download the tarball and verify its integrity
const bytes = await fetchTarball(tarballUrl, {
    integrity: packument.versions[latest].dist.integrity,
});

// Parse ~/.npmrc for auth
import { readFileSync } from 'node:fs';
const npmrc = parseNpmrc(readFileSync('/home/user/.npmrc', 'utf8'));

// Verify the current auth token
const { username } = await whoami(DEFAULT_REGISTRY, npmrc);
console.log('Logged in as:', username);
```

## License

MIT
