// Copies showcase assets into public/demos/ so Astro serves them as static files.
// Three.js loads textures via fetch() at runtime, so they must be in public/.

import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Resolve a package-relative path (works for both files and directories). */
function resolveAsset(specifier) {
    // Resolve the package root via package.json, then join the subpath
    const parts = specifier.split('/');
    const scope = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    const subpath = parts.slice(scope.includes('/') ? 2 : 1).join('/');
    const pkgJson = require.resolve(`${scope}/package.json`);
    return join(dirname(pkgJson), 'src', subpath);
}

const showcases = [
    {
        dest: 'public/demos/pixel',
        assets: [
            { src: '@gjsify/example-dom-three-postprocessing-pixel/assets/checker.png', dest: 'assets/checker.png' },
        ],
    },
    {
        dest: 'public/demos/teapot',
        assets: [
            { src: '@gjsify/example-dom-three-geometry-teapot/assets/uv_grid_opengl.jpg', dest: 'assets/uv_grid_opengl.jpg' },
            { src: '@gjsify/example-dom-three-geometry-teapot/assets/pisa', dest: 'assets/pisa', recursive: true },
        ],
    },
    {
        dest: 'public/demos/jelly-jumper',
        assets: [
            { src: '@gjsify/example-dom-excalibur-jelly-jumper/assets', dest: 'res', recursive: true },
        ],
    },
];

for (const showcase of showcases) {
    mkdirSync(showcase.dest, { recursive: true });
    for (const asset of showcase.assets) {
        const src = resolveAsset(asset.src);
        const dest = `${showcase.dest}/${asset.dest}`;
        mkdirSync(dest.replace(/\/[^/]+$/, ''), { recursive: true });
        cpSync(src, dest, { recursive: asset.recursive ?? false });
    }
}
