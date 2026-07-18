// Resolve the GJS entry point of an installed package.
//
// Per the `gjsify` field convention (see CLI reference):
//
//   {
//     "gjsify": {
//       "main": "dist/gjs.js",
//       "bin":  { "name-a": "dist/a.js", "name-b": "dist/b.js" }
//     }
//   }
//
// Resolution order:
//   1. user-supplied bin name + `gjsify.bin[name]`     → that path
//   2. single-entry `gjsify.bin`                       → the only path
//   3. `gjsify.main`                                   → that path
//   4. fallback: `package.json#main`                   → that path (advisory warning)
//   5. otherwise: hard-fail with a fix hint

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface ResolvedEntry {
    bundlePath: string;
    binName: string | null;
    fromFallback: boolean;
}

interface PackageJson {
    name?: string;
    main?: string;
    gjsify?: {
        main?: string;
        bin?: Record<string, string>;
        prebuilds?: string;
        example?: { runtimes?: unknown; node?: string };
    };
}

export function resolveGjsEntry(pkgDir: string, binName: string | null): ResolvedEntry {
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) {
        throw new Error(`dlx: no package.json found at ${pkgDir}`);
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as PackageJson;

    const gjsifyBin = pkg.gjsify?.bin;
    const gjsifyMain = pkg.gjsify?.main;
    const fallbackMain = pkg.main;

    let entry: string | undefined;
    let resolvedBin: string | null = null;
    let fromFallback = false;

    if (binName !== null) {
        if (!gjsifyBin || !gjsifyBin[binName]) {
            const known = gjsifyBin ? Object.keys(gjsifyBin).join(', ') : '(none)';
            throw new Error(`dlx: package "${pkg.name ?? pkgDir}" has no GJS bin named "${binName}" — known: ${known}`);
        }
        entry = gjsifyBin[binName];
        resolvedBin = binName;
    } else if (gjsifyBin && Object.keys(gjsifyBin).length === 1) {
        const onlyBin = Object.keys(gjsifyBin)[0];
        entry = gjsifyBin[onlyBin];
        resolvedBin = onlyBin;
    } else if (gjsifyMain) {
        entry = gjsifyMain;
    } else if (fallbackMain) {
        entry = fallbackMain;
        fromFallback = true;
    }

    if (gjsifyBin && Object.keys(gjsifyBin).length > 1 && binName === null) {
        const names = Object.keys(gjsifyBin).join(', ');
        throw new Error(`dlx: package "${pkg.name ?? pkgDir}" defines multiple GJS bins — pass one of: ${names}`);
    }

    if (!entry) {
        throw new Error(
            `dlx: package "${pkg.name ?? pkgDir}" has no GJS entry — set \`gjsify.main\` (or \`gjsify.bin\`) in its package.json`,
        );
    }

    const bundlePath = resolve(pkgDir, entry);
    if (!existsSync(bundlePath)) {
        throw new Error(`dlx: GJS entry not found: ${bundlePath}`);
    }

    return { bundlePath, binName: resolvedBin, fromFallback };
}

/**
 * Resolve the `--app node` bundle of a package for the non-gjs runtimes
 * (node/bun/deno all consume it). Resolution order:
 *   1. explicit `gjsify.example.node` (a package can name its node bundle)
 *   2. convention: the node twin of the GJS entry — swap the `<name>.gjs.<ext>`
 *      infix to `<name>.node.<ext>` and probe `.node.{mjs,js,cjs}` (gjsify's
 *      `build:node → dist/<name>.node.mjs` convention; the GJS entry is
 *      `dist/<name>.gjs.js`, so the extension can differ).
 * Hard-fails with an actionable hint when neither is found.
 */
export function resolveNodeEntry(pkgDir: string): string {
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) {
        throw new Error(`no package.json found at ${pkgDir}`);
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as PackageJson;

    // 1. Explicit declaration wins.
    const explicit = pkg.gjsify?.example?.node;
    if (explicit) {
        const p = resolve(pkgDir, explicit);
        if (!existsSync(p)) {
            throw new Error(`declared node entry not found: ${p} (gjsify.example.node)`);
        }
        return p;
    }

    // 2. Derive from the GJS entry.
    const gjsEntry = pkg.gjsify?.main ?? (pkg.gjsify?.bin ? Object.values(pkg.gjsify.bin)[0] : undefined) ?? pkg.main;
    if (!gjsEntry) {
        throw new Error(
            `package "${pkg.name ?? pkgDir}" has no entry to derive a node bundle from — ` +
                'set `gjsify.example.node` to its `--app node` bundle path.',
        );
    }

    const stem = gjsEntry.replace(/\.gjs\.(js|mjs|cjs)$/, '').replace(/\.(js|mjs|cjs)$/, '');
    const candidates = [`${stem}.node.mjs`, `${stem}.node.js`, `${stem}.node.cjs`];
    for (const c of candidates) {
        const p = resolve(pkgDir, c);
        if (existsSync(p)) return p;
    }

    throw new Error(
        `package "${pkg.name ?? pkgDir}" has no \`--app node\` bundle — looked for ${candidates.join(', ')}.\n` +
            '  Build one (e.g. `gjsify build src/app.ts --app node --outfile dist/app.node.mjs`) ' +
            'or set `gjsify.example.node` to its path.',
    );
}
