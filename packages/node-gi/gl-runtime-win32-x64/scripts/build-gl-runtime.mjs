// SPDX-License-Identifier: MIT
// Populate `bin/` of @gjsify/gl-runtime-win32-x64: the pinned Mesa DLLs, the licence texts
// that must travel with them, and the notice `package.json#license` points at.
//
//   node scripts/build-gl-runtime.mjs
//
// Runs on any OS — it downloads and copies, it never executes the DLLs.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESA_DIST_WIN, fetchGlImplementation, mesaDistWinUrl } from '../../scripts/fetch-gl-implementation.mjs';
import { GL_IMPLEMENTATION_FILES } from '../../scripts/gl-implementation.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(pkgRoot, 'bin');
const licensesSrc = join(pkgRoot, 'licenses');

await fetchGlImplementation({ out: bin });

const provenance = JSON.parse(readFileSync(join(licensesSrc, 'provenance.json'), 'utf8'));
if (provenance.mesaDistWin !== MESA_DIST_WIN.version) {
    console.error(
        `build-gl-runtime: licences were taken for mesa-dist-win ${provenance.mesaDistWin}, the pin is ` +
            `${MESA_DIST_WIN.version} — re-take them before building`,
    );
    process.exit(1);
}
const texts = [];
for (const component of Object.keys(provenance.components)) {
    const dir = join(licensesSrc, component);
    mkdirSync(join(bin, 'licenses', component), { recursive: true });
    for (const file of readdirSync(dir)) {
        copyFileSync(join(dir, file), join(bin, 'licenses', component, file));
        texts.push(`licenses/${component}/${file}`);
    }
}

const mib = (leaf) => (statSync(join(bin, leaf)).size / 1048576).toFixed(1);
writeFileSync(
    join(bin, 'THIRD-PARTY-NOTICES.md'),
    [
        '# Third-party notices — @gjsify/gl-runtime-win32-x64',
        '',
        'This package is MIT (its two JavaScript files). The binaries in this directory are NOT:',
        '',
        ...GL_IMPLEMENTATION_FILES.map((leaf) => `- \`${leaf}\` (${mib(leaf)} MiB)`),
        '',
        `They are Mesa ${provenance.components.mesa}, byte-identical from the mesa-dist-win ` +
            `${MESA_DIST_WIN.version} MSVC release (${mesaDistWinUrl()}, sha256 ${MESA_DIST_WIN.sha256}). ` +
            `\`libgallium_wgl.dll\` links LLVM ${provenance.components.llvm} statically (llvmpipe).`,
        '',
        "Mesa's terms are per source file (SPDX); its own summary and the permissive licence texts it uses, " +
            "LLVM's Apache-2.0 WITH LLVM-exception, and the notices of third-party code compiled into " +
            '`libgallium_wgl.dll` (`NOTICE-*`: SoftFloat, xxHash, Henry Spencer regex) are in:',
        '',
        ...texts.sort().map((t) => `- \`${t}\``),
        '',
    ].join('\n'),
);
console.log(`build-gl-runtime: ${GL_IMPLEMENTATION_FILES.join(' + ')} + ${texts.length} licence text(s) -> ${bin}`);
