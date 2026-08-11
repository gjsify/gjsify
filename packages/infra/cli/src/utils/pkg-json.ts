// Permissive `package.json` reader for the CLI's workspace- and
// dependency-discovery paths: `null` when the file is missing OR unparseable, so
// discovery degrades gracefully on a stray or corrupt manifest instead of
// crashing the whole command.
//
// The install-save path deliberately keeps a STRICTER reader in
// `pkg-json-edit.ts` — `null` only when absent, THROWS on invalid JSON — so
// `gjsify install <pkg>` never silently overwrites a corrupt manifest. Do not
// fold the two together.

import { readFileSync } from 'node:fs';
import type { PackageJson } from './pkg-json-edit.js';

/**
 * Drop a leading UTF-8 BOM (`U+FEFF`).
 *
 * `JSON.parse` rejects a BOM — it is not whitespace — yet Windows PowerShell 5.1
 * writes one for `-Encoding utf8`, its DEFAULT for `Out-File`/`Set-Content`, and
 * npm reads such a manifest without complaint. The file is valid to the
 * ecosystem, so gjsify must not be the strict one.
 *
 * Only a LEADING BOM: `U+FEFF` elsewhere is a zero-width no-break space inside a
 * string value, and stripping it would corrupt the data.
 */
export function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read + parse a `package.json` at `pkgPath`. Permissive: any error (missing
 * file, unreadable, invalid JSON) yields `null`.
 *
 * The BOM strip matters more here than in a throwing reader, because callers
 * read `null` as "no package.json": on Windows a BOM produced no error at all,
 * it made the package look manifest-less, so `gjsify check` found no `check`
 * script, discovery skipped the package, and nothing said why.
 */
export function readPackageJson(pkgPath: string): PackageJson | null {
    try {
        return JSON.parse(stripBom(readFileSync(pkgPath, 'utf-8'))) as PackageJson;
    } catch {
        return null;
    }
}
