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
 * Drop a leading UTF-8 BOM (`U+FEFF`, the decoded form of `EF BB BF`).
 *
 * `JSON.parse` rejects a BOM — it is not whitespace — so a manifest carrying
 * one is "invalid JSON" to every reader here. That is not a hypothetical file
 * shape on Windows: Windows PowerShell 5.1 writes a BOM for `-Encoding utf8`,
 * which is its DEFAULT for `Out-File`/`Set-Content`, so any script that edits a
 * manifest produces one. Notepad offers "UTF-8 with BOM" too.
 *
 * npm reads such a file without complaint (`npm pkg get name` on a BOM'd
 * manifest returns the name), so the file is valid as far as the ecosystem is
 * concerned and gjsify was the strict one. Stripping matches npm, VS Code and
 * `parse-json`'s own guidance; nothing downstream wants the character.
 *
 * Only a LEADING BOM: `U+FEFF` elsewhere is a zero-width no-break space inside
 * a string value, and removing it would corrupt the data.
 */
export function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read + parse a `package.json` at `pkgPath`. Permissive: any error (missing
 * file, unreadable, invalid JSON) yields `null`.
 *
 * The BOM strip matters MORE here than in a throwing reader: this one reports
 * an unparseable manifest as `null`, which every caller reads as "no
 * package.json". On Windows a BOM therefore did not produce an error — it made
 * a package look like it had no manifest at all, so `gjsify check` found no
 * `check` script, discovery skipped the package, and nothing said why.
 */
export function readPackageJson(pkgPath: string): PackageJson | null {
    try {
        return JSON.parse(stripBom(readFileSync(pkgPath, 'utf-8'))) as PackageJson;
    } catch {
        return null;
    }
}
