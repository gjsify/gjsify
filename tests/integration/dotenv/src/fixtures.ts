// Resolves absolute paths to the fixture tree relative to the bundle.
// After `gjsify build` the bundle lives at dist/test.{node,gjs}.mjs and
// the fixtures/ tree sits one directory up from there. We resolve via
// `new URL(...)` so the path follows the bundle, not the source layout.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const fixture = (name: string): string => join(FIXTURES_DIR, name);

// Path to the canonical .env, .env.local, .env.multiline files.
export const ENV_PATH = fixture('.env');
export const ENV_LOCAL_PATH = fixture('.env.local');
export const ENV_MULTILINE_PATH = fixture('.env.multiline');
