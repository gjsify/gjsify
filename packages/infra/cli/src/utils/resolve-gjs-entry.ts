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
    };
}

export function resolveGjsEntry(
    pkgDir: string,
    binName: string | null,
): ResolvedEntry {
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
            throw new Error(
                `dlx: package "${pkg.name ?? pkgDir}" has no GJS bin named "${binName}" — known: ${known}`,
            );
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
        throw new Error(
            `dlx: package "${pkg.name ?? pkgDir}" defines multiple GJS bins — pass one of: ${names}`,
        );
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
