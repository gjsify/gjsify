#!/usr/bin/env node
// A module that registers a GType when it LOADS must be listed in its package's `sideEffects`.
//
// THE INCIDENT
//
// `@gjsify/canvas2d` pins `sideEffects` to `["./lib/esm/register.js"]`, but
// `lib/esm/canvas2d-bridge.js` runs `GObject.registerClass({ GTypeName:
// 'GjsifyCanvas2DBridge' }, …)` at the top level. Learn6502's `Display` template names
// `<object class="GjsifyCanvas2DBridge">` and imports the class only to pass it to a no-op
// (the usual "keep the registration" idiom). The bundler treated the module as
// side-effect-free, dropped it, and GTK failed at startup with
// `Invalid object type 'GjsifyCanvas2DBridge'` — a crash that shows only on screen.
// `@gjsify/webgl` and `@gjsify/iframe` carried the same gap.
//
// WHAT THIS CHECKS
//
// For every workspace package whose `package.json` declares `sideEffects` (`false` or a list),
// each non-spec source file with a top-level `registerClass(` call must map to a
// `lib/esm/<file>.js` that the field covers. `false` therefore fails for such a package.
//
// Usage: node scripts/check-register-class-side-effects.mjs [--root <dir>]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const rootIndex = process.argv.indexOf('--root');
const ROOT = rootIndex === -1 ? '.' : process.argv[rootIndex + 1];

const TOP_LEVEL_REGISTER = /^(?:export\s+)?(?:(?:const|let|var)\s+\w+\s*=\s*)?[\w.]*registerClass\(/m;

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'lib') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else if (/\.(ts|js|mts)$/.test(entry.name) && !/\.(spec|d)\.|\/test\./.test(path)) out.push(path);
    }
    return out;
}

/** `./lib/esm/*.js` style globs, enough for what `sideEffects` fields use. */
function globToRegExp(glob) {
    const body = glob
        .replace(/^\.\//, '')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\0')
        .replace(/\*/g, '[^/]*')
        .replace(/\0/g, '.*');
    return new RegExp(`^${body}$`);
}

const problems = [];
let scanned = 0;
let registering = 0;

for (const group of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const pkg of readdirSync(join(ROOT, 'packages', group.name), { withFileTypes: true })) {
        const dir = join(ROOT, 'packages', group.name, pkg.name);
        const manifestPath = join(dir, 'package.json');
        if (!pkg.isDirectory() || !existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.sideEffects === undefined || manifest.sideEffects === true) continue;
        scanned++;

        // `--library 'src/ts/**'` builds drop the `ts/` segment from `lib/esm`.
        const srcRoot = existsSync(join(dir, 'src', 'ts')) ? join(dir, 'src', 'ts') : join(dir, 'src');
        if (!existsSync(srcRoot)) continue;
        const patterns = Array.isArray(manifest.sideEffects) ? manifest.sideEffects.map(globToRegExp) : [];

        for (const file of walk(srcRoot)) {
            if (!TOP_LEVEL_REGISTER.test(readFileSync(file, 'utf8'))) continue;
            registering++;
            const lib = `lib/esm/${relative(srcRoot, file).replace(/\.(ts|mts)$/, '.js')}`;
            if (!patterns.some((re) => re.test(lib))) {
                problems.push(
                    `${manifest.name}: ${relative(ROOT, file)} registers a GType at load but "./${lib}" is not in ` +
                        '`sideEffects` — a bundle that only references the class drops the module and the ' +
                        'GType never exists at runtime. Add it to `sideEffects`.',
                );
            }
        }
    }
}

if (!scanned) {
    console.error('::error::no package with a `sideEffects` field was found — the scan stopped matching.');
    process.exit(1);
}

console.log(
    `register-class-side-effects: ${scanned} package(s) with \`sideEffects\` scanned, ` +
        `${registering} module(s) registering a GType checked.`,
);
for (const p of problems) console.error(`  ✗ ${p}`);
if (problems.length) {
    console.error(`register-class-side-effects: ${problems.length} problem(s).`);
    process.exit(1);
}
