// Single permissive reader for `package.json` files, shared by the CLI's
// workspace- and dependency-discovery paths (`gjsify run`/`workspace`/`foreach`/
// `check`, native-prebuild scanning). Returns `null` when the file is missing
// OR unparseable — discovery must degrade gracefully on a stray or corrupt
// manifest rather than crash the whole command.
//
// The install-save path keeps its own STRICTER reader in `pkg-json-edit.ts`
// (`readPackageJson` there): it returns `null` only when the file is absent but
// THROWS on invalid JSON, so a corrupt manifest is never silently overwritten
// during `gjsify install <pkg>`. That contract is intentional and load-bearing
// — do not fold it into this one.

import { readFileSync } from 'node:fs';
import type { PackageJson } from './pkg-json-edit.js';

/**
 * Read + parse a `package.json` at `pkgPath`. Permissive: any error (missing
 * file, unreadable, invalid JSON) yields `null`.
 */
export function readPackageJson(pkgPath: string): PackageJson | null {
    try {
        return JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
    } catch {
        return null;
    }
}
