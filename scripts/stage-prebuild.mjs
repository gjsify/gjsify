#!/usr/bin/env node
/**
 * Stage a freshly-built native bridge into `prebuilds/<os>-<arch>/`.
 *
 * Replaces eleven copies of a hand-written one-liner that all looked like
 *
 *     mkdir -p prebuilds/linux-x64 && cp build/libfoo.so build/Foo-1.0.gir … prebuilds/linux-x64/
 *
 * and were therefore wrong in two ways off Linux/x86_64: the target directory
 * was hard-coded, and so was the `.so` suffix — a macOS build produces
 * `.dylib`, so `cp` failed outright. `gjsify workspace <pkg> build:prebuilds`
 * simply could not stage a prebuild on any host but one.
 *
 * Two deliberate choices:
 *
 * 1. **The directory name comes from the package's own `gjsify.platforms`
 *    declaration**, never from a name this script invents. That declaration is
 *    what `scripts/audit-runtimes.mjs --check` audits against the committed
 *    artifacts and the CI that produces them, so deriving from it means a
 *    local build cannot silently create a target nobody declared. A host that
 *    matches no declared target is an error with an actionable message, not a
 *    guess.
 *
 * 2. **Artifacts are matched by extension, not by filename.** The old scripts
 *    listed each file by name, so renaming a library in `meson.build` left the
 *    old name in the copy list and silently shipped a stale or partial set.
 *
 * Usage: node scripts/stage-prebuild.mjs [package-dir] [--build-dir build]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { checkPrebuildDir } from './check-prebuild-loader-path.mjs';

/** Extensions that make up a shipped prebuild. */
const ARTIFACT_EXT = ['.so', '.dylib', '.dll', '.gir', '.typelib'];

/**
 * Pick the declared target that describes this host.
 *
 * There is exactly ONE spelling for a target: `${process.platform}-${process.arch}`
 * (`linux-x64`, `linux-arm64`, `darwin-arm64`, `win32-x64`). The repo used to
 * carry a second, uname-style one (`linux-x86_64`) because the meson jobs named
 * the directory after `uname -m`, and this function then had to accept an alias
 * table to bridge the two. It does not any more: the node spelling is what a
 * running process can compute about itself, so it needs no translation in the
 * resolver's hot path, and a plain equality check here is what keeps a local
 * build from inventing a name CI does not reproduce.
 *
 * A declaration in the old spelling therefore no longer matches — deliberately.
 * `scripts/audit-runtimes.mjs --check` rejects it at the declaration site with
 * a pointed message, so the failure lands on the `package.json` that is wrong
 * rather than on a "typelib not found" hours later.
 *
 * @param {readonly string[]} declared `gjsify.platforms`
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 * @returns {string | null}
 */
export function pickDeclaredTarget(declared, platform, arch) {
    const host = `${platform}-${arch}`;
    return declared.includes(host) ? host : null;
}

function main() {
    const args = process.argv.slice(2);
    const buildFlag = args.indexOf('--build-dir');
    const buildDirName = buildFlag >= 0 ? args[buildFlag + 1] : 'build';
    const pkgDir = resolve(args.find((a) => !a.startsWith('--') && a !== buildDirName) ?? process.cwd());

    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) {
        console.error(`[stage-prebuild] no package.json at ${pkgDir}`);
        process.exit(1);
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const declared = pkg.gjsify?.platforms;
    if (!Array.isArray(declared) || declared.length === 0) {
        console.error(
            `[stage-prebuild] ${pkg.name} declares no \`gjsify.platforms\`.\n` +
                '  Every package with a native build system must declare the <os>-<arch>\n' +
                '  targets it promises a prebuild for — that declaration is what\n' +
                '  `scripts/audit-runtimes.mjs --check` holds CI to.',
        );
        process.exit(1);
    }

    const target = pickDeclaredTarget(declared, process.platform, process.arch);
    if (!target) {
        console.error(
            `[stage-prebuild] ${pkg.name}: this host (${process.platform}-${process.arch}) is not in\n` +
                `  \`gjsify.platforms\` (${declared.join(', ')}).\n` +
                '  Staging it anyway would create an undeclared target that CI does not\n' +
                '  reproduce. Add the target to the declaration AND to the workflow that\n' +
                '  builds it, then re-run.',
        );
        process.exit(1);
    }

    const buildDir = join(pkgDir, buildDirName);
    if (!existsSync(buildDir)) {
        console.error(`[stage-prebuild] ${pkg.name}: no ${buildDirName}/ — run \`gjsify run build:meson\` first.`);
        process.exit(1);
    }

    const artifacts = readdirSync(buildDir).filter((f) => ARTIFACT_EXT.some((ext) => f.endsWith(ext)));
    if (artifacts.length === 0) {
        console.error(
            `[stage-prebuild] ${pkg.name}: ${buildDirName}/ holds none of ${ARTIFACT_EXT.join(', ')}.\n` +
                '  The meson build produced no shippable artifact.',
        );
        process.exit(1);
    }

    const outDir = join(pkgDir, pkg.gjsify?.prebuilds ?? 'prebuilds', target);
    // Replace rather than merge: a stale artifact from a previous build (a
    // renamed library, a dropped typelib) must not survive into the shipped set.
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const file of artifacts) copyFileSync(join(buildDir, file), join(outDir, file));

    console.log(`[stage-prebuild] ${pkg.name} → ${basename(outDir)}/ (${artifacts.sort().join(', ')})`);

    // Staging and verifying belong together: a set that is copied but does not
    // resolve its own siblings is exactly the artifact that builds green and
    // dies at `dlopen` on a user's machine. Matching by extension already means
    // both halves of a Vala+Rust pair are picked up — this asserts it, and
    // asserts the self-relative rpath that makes the pair loadable without any
    // library-path environment variable.
    const problems = checkPrebuildDir(outDir);
    if (problems.length > 0) {
        console.error(`[stage-prebuild] ${pkg.name}: the staged set is not self-contained:`);
        for (const p of problems) console.error(`  ✗ ${p}`);
        process.exit(1);
    }
}

// Only run when invoked directly, so the pure helper stays unit-testable.
if (process.argv[1] && resolve(process.argv[1]).endsWith('stage-prebuild.mjs')) main();
