// SPDX-License-Identifier: MIT
// Download the pinned Mesa win32 build the windowing GTK bundle ships as its GL implementation
// (#1097), verify it, and extract the files `build-gtk-runtime.mjs --gl-implementation` copies.
//
//   node packages/node-gi/scripts/fetch-gl-implementation.mjs --out <dir>
//
// The pin lives HERE and nowhere else: the release and the CI build both run this script, and
// licenses-not-in-prefix/provenance.json is held against MESA_DIST_WIN by
// gtk-runtime-bundle-gates.test.mjs, so the mesa/llvm texts cannot silently describe another
// release. The digest is what makes the pin a pin — a re-uploaded asset under the same tag
// would otherwise land in a published tarball unnoticed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GL_IMPLEMENTATION_FILES } from './gl-implementation.mjs';

/** pal1000/mesa-dist-win, MSVC release build: Mesa 26.1.8 with LLVM 23.1.1 inside libgallium_wgl. */
export const MESA_DIST_WIN = Object.freeze({
    version: '26.1.8',
    asset: 'mesa3d-26.1.8-release-msvc.7z',
    sha256: '4c6d32e653e0ff9ad07796e40c0bcfabf2764d849e3ce4f3b1590112c87e42f9',
});

export function mesaDistWinUrl({ version, asset } = MESA_DIST_WIN) {
    return `https://github.com/pal1000/mesa-dist-win/releases/download/${version}/${asset}`;
}

async function main() {
    const i = process.argv.indexOf('--out');
    const out = i >= 0 ? process.argv[i + 1] : undefined;
    if (!out) {
        console.error('usage: fetch-gl-implementation.mjs --out <dir>');
        process.exit(2);
    }
    if (GL_IMPLEMENTATION_FILES.every((leaf) => existsSync(join(out, leaf)))) {
        console.log(`fetch-gl-implementation: ${out} already holds ${GL_IMPLEMENTATION_FILES.join(' + ')}`);
        return;
    }
    const url = mesaDistWinUrl();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch-gl-implementation: GET ${url} -> ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== MESA_DIST_WIN.sha256) {
        throw new Error(
            `fetch-gl-implementation: ${MESA_DIST_WIN.asset} is sha256 ${digest}, pinned ${MESA_DIST_WIN.sha256} — ` +
                'the asset under this tag changed; re-verify it before moving the pin',
        );
    }
    const work = mkdtempSync(join(tmpdir(), 'mesa-dist-win-'));
    const archive = join(work, MESA_DIST_WIN.asset);
    writeFileSync(archive, bytes);
    // 7-Zip is on every GitHub Windows image; x64/ is the only architecture the bundle needs.
    execFileSync('7z', ['x', '-y', `-o${work}`, archive, ...GL_IMPLEMENTATION_FILES.map((f) => `x64/${f}`)], {
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    mkdirSync(out, { recursive: true });
    for (const leaf of GL_IMPLEMENTATION_FILES) {
        copyFileSync(join(work, 'x64', leaf), join(out, leaf));
        console.log(`fetch-gl-implementation: ${leaf} (${(statSync(join(out, leaf)).size / 1048576).toFixed(1)} MiB)`);
    }
    writeFileSync(join(out, 'mesa-dist-win.json'), `${JSON.stringify({ ...MESA_DIST_WIN, url }, null, 2)}\n`);
    rmSync(work, { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
