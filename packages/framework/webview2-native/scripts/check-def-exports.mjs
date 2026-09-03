// SPDX-License-Identifier: MIT
//
// Holds `gjsifywebview2.def` to `gjsify-webview2.h`.
//
// The `.def` is a second copy of the header's function list, and it exists
// because MSVC's linker exports nothing from a DLL on its own. A second copy is
// the thing this repository refuses to trust, so this is the mechanism that makes
// it a derivation instead: the header is the source, and a symbol that appears in
// one and not the other fails HERE — on Linux, on every pull request — rather
// than on Windows as `getGType` returning null for one type out of five.
//
// It runs on the FEDORA job on purpose. The failure it prevents is a Windows-only
// runtime failure, but its cause is two text files disagreeing, and that is
// readable anywhere.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const header = readFileSync(join(pkgDir, 'src/c/gjsify-webview2.h'), 'utf8');
const def = readFileSync(join(pkgDir, 'gjsifywebview2.def'), 'utf8');

// Block comments carry prose that mentions function names; stripping them is what
// keeps a doc comment from inventing a symbol nobody declared.
const code = header.replace(/\/\*[\s\S]*?\*\//g, '');

const declared = new Set();
for (const m of code.matchAll(/\b(gjsify_webview2_[a-z0-9_]+)\s*\(/g)) {
    declared.add(m[1]);
}
// `G_DECLARE_FINAL_TYPE` / `G_DECLARE_DERIVABLE_TYPE` declare `<prefix>_get_type`
// through a macro, so it is not in the source as a call-shaped token — and it is
// the single most important symbol to export, because GI calls it to force the
// DLL to load at all.
for (const m of code.matchAll(/G_DECLARE_(?:FINAL|DERIVABLE)_TYPE\(\s*\w+,\s*(\w+)/g)) {
    declared.add(`${m[1]}_get_type`);
}

const exported = new Set();
for (const m of def.matchAll(/^ {4}(gjsify_webview2_\w+)$/gm)) {
    exported.add(m[1]);
}

const missing = [...declared].filter((name) => !exported.has(name)).sort();
const extra = [...exported].filter((name) => !declared.has(name)).sort();

if (missing.length > 0) {
    console.error(
        `::error::gjsifywebview2.def does not export ${missing.length} symbol(s) the header ` +
            `declares: ${missing.join(', ')}. On win32 each one is absent from the DLL, so GI ` +
            'resolves the namespace and then answers null for whatever needs it.',
    );
}
if (extra.length > 0) {
    console.error(
        `::error::gjsifywebview2.def exports ${extra.length} symbol(s) the header does not ` +
            `declare: ${extra.join(', ')}. The link will fail with an unresolved external.`,
    );
}

if (missing.length > 0 || extra.length > 0) {
    process.exit(1);
}

console.log(`gjsifywebview2.def exports exactly the ${declared.size} symbols the header declares.`);
