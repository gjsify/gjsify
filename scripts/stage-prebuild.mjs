#!/usr/bin/env node
/**
 * Stage a freshly-built native bridge into `prebuilds/<os>-<arch>/`.
 *
 * Replaces eleven copies of a hand-written one-liner that all looked like
 *
 *     mkdir -p prebuilds/linux-x86_64 && cp build/libfoo.so build/Foo-1.0.gir … prebuilds/linux-x86_64/
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

/** Extensions that make up a shipped prebuild. */
const ARTIFACT_EXT = ['.so', '.dylib', '.dll', '.gir', '.typelib'];

/**
 * Alias table for the two spellings the repo uses for the same target.
 *
 * gjsify names Linux targets with the `uname -m` machine (`linux-x86_64`) but
 * Darwin targets with Node's arch (`darwin-arm64`). Both spellings resolve at
 * runtime (`resolvePrebuildDirName` probes a candidate list), so this is
 * cosmetic rather than broken — but it does mean a name cannot be computed
 * from `process.arch` alone, which is exactly why we read the declaration
 * instead. Unifying on the Node spelling is tracked in STATUS.md.
 *
 * @type {Record<string, string[]>}
 */
const ARCH_SPELLINGS = {
    x64: ['x64', 'x86_64', 'amd64'],
    arm64: ['arm64', 'aarch64'],
    ia32: ['ia32', 'i686', 'i386'],
    arm: ['arm', 'armv7l', 'armv6l'],
    ppc64: ['ppc64', 'ppc64le'],
    s390x: ['s390x'],
    riscv64: ['riscv64'],
    loong64: ['loong64', 'loongarch64'],
};

/**
 * Pick the declared target that describes this host.
 *
 * @param {readonly string[]} declared `gjsify.platforms`
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 * @returns {string | null}
 */
export function pickDeclaredTarget(declared, platform, arch) {
    const spellings = ARCH_SPELLINGS[arch] ?? [arch];
    for (const target of declared) {
        const sep = target.indexOf('-');
        if (sep < 0) continue;
        if (target.slice(0, sep) !== platform) continue;
        if (spellings.includes(target.slice(sep + 1))) return target;
    }
    return null;
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
}

// Only run when invoked directly, so the pure helper stays unit-testable.
if (process.argv[1] && resolve(process.argv[1]).endsWith('stage-prebuild.mjs')) main();
