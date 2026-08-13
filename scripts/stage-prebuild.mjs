#!/usr/bin/env node
/**
 * Stage a freshly-built native bridge into `prebuilds/<os>-<arch>/`.
 *
 * Three deliberate choices:
 *
 * 1. **The directory name comes from the package's own `gjsify.platforms`
 *    declaration**, never from a name this script invents. That declaration is
 *    what `scripts/audit-runtimes.mjs --check` audits against the committed
 *    artifacts and the CI that produces them, so a local build cannot silently
 *    create a target nobody declared. A host matching no declared target is an
 *    error with an actionable message, not a guess.
 *
 * 2. **Artifacts are matched by extension, not by filename** — a per-file copy
 *    list leaves the old name behind when `meson.build` renames a library, and
 *    silently ships a stale or partial set.
 *
 * 3. **The target name carries the host's libc**, so a build on Alpine stages
 *    into `linux-x64-musl/` and never into `linux-x64/`. See
 *    {@link pickDeclaredTarget}.
 *
 * Usage: node scripts/stage-prebuild.mjs [package-dir] [--build-dir build]
 *                                        [--scratch | --dest <dir> --allow-undeclared]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { checkPrebuildDir } from './check-prebuild-loader-path.mjs';
import { relocateDarwinPrebuildDir } from './relocate-macho.mjs';
// The target GRAMMAR lives with the rule that validates it: this script WRITES
// the directory name `prebuild-libc` then reads back and checks, so the two
// agreeing by construction beats the two being independent. (`lib/platforms.mjs`
// is libc-blind — see `canonicalPrebuildTarget`'s follow-up note.)
import { hostPrebuildTarget } from '../packages/infra/manifest-conformance/lib/rules/prebuild-libc.mjs';
import { platformPackageDirName } from '../packages/infra/manifest-conformance/lib/platform-packages.mjs';

/** Extensions that make up a shipped prebuild. */
const ARTIFACT_EXT = ['.so', '.dylib', '.dll', '.gir', '.typelib'];

/**
 * Pick the declared target that describes this host.
 *
 * ONE spelling for a target: `${process.platform}-${process.arch}` plus a `-musl`
 * suffix on a musl Linux host. The retired uname spelling (`linux-x86_64`)
 * deliberately no longer matches — `audit-runtimes --check` rejects it at the
 * declaration site, so the failure lands on the wrong `package.json` rather than on
 * a "typelib not found" hours later.
 *
 * THE LIBC HALF DOES NOT FALL BACK: on a musl host this returns null unless
 * `<os>-<arch>-musl` is declared, though every package here declares the unsuffixed
 * token. That directory is the DEFAULT build a glibc host resolves, so a
 * musl-linked library staged there cannot load on the platform it would be
 * published for — what the `prebuild-libc` rule fails on.
 *
 * @param {readonly string[]} declared `gjsify.platforms`
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 * @param {'glibc'|'musl'|null} [libc] host C library; omitted = the default build
 * @returns {string | null}
 */
export function pickDeclaredTarget(declared, platform, arch, libc = null) {
    const host = hostPrebuildTarget(platform, arch, libc);
    return declared.includes(host) ? host : null;
}

/**
 * Decide the host C library from independently-gathered facts.
 *
 * The twin of `resolveHostLibc()` in
 * `packages/infra/cli/src/utils/detect-native-packages.ts`, duplicated for the
 * same reason `ARCH_ALIASES` is: that one is TypeScript inside the CLI bundle,
 * this one a zero-dependency `.mjs` a meson build runs directly. Keep them in
 * lockstep — a divergence stages into one directory and resolves another.
 *
 * @param {{platform: string, glibcVersionRuntime?: string, muslLoaderPresent?: boolean}} input
 * @returns {'glibc'|'musl'|null} null off Linux, where the axis does not exist
 */
export function resolveHostLibc(input) {
    if (input.platform !== 'linux') return null;
    if (typeof input.glibcVersionRuntime === 'string' && input.glibcVersionRuntime.length > 0) return 'glibc';
    return input.muslLoaderPresent ? 'musl' : 'glibc';
}

/**
 * Gather the two host facts {@link resolveHostLibc} decides from.
 *
 * The `process.report` probe normally answers; the musl-loader probe is what
 * makes it correct on a musl host, where `glibcVersionRuntime` is absent.
 */
function detectHostLibc() {
    if (process.platform !== 'linux') return null;
    const header = process.report?.getReport()?.header;
    const glibcVersionRuntime =
        typeof header?.glibcVersionRuntime === 'string' ? header.glibcVersionRuntime : undefined;
    const muslLoaderPresent = existsSync('/lib') && readdirSync('/lib').some((f) => f.startsWith('ld-musl-'));
    return resolveHostLibc({ platform: process.platform, glibcVersionRuntime, muslLoaderPresent });
}

/**
 * The exact target name a build on THIS host stages into.
 *
 * Exported so nothing has to recompose it: nine e2e fixtures still build the
 * name themselves (`status/open-todos.md`), and the last vocabulary change swept
 * eight of them by hand — a composed string never appears as a literal to grep
 * for. The libc suffix makes that worse, so the token gets one definition here.
 */
export function hostStagingTarget() {
    return hostPrebuildTarget(process.platform, process.arch, detectHostLibc());
}

/**
 * Where a target's artifacts belong — since ADR 0017 usually NOT inside the
 * package being built: each `<os>-<arch>` target lives in a sibling package
 * (`<pkg>-<target>/prebuilds/<target>/`) declaring `os`/`cpu`, so a consumer
 * downloads only the binary their machine can load.
 *
 * A bridge therefore has no `gjsify.prebuilds`, and a `?? 'prebuilds'` default
 * would recreate a directory INSIDE it — untracked, absent from `files`,
 * invisible to every conformance rule (they key on `gjsify.prebuilds`), and yet
 * exactly where `build:prebuilds` would appear to succeed. So the destination is
 * RESOLVED rather than defaulted:
 *
 *   · `gjsify.prebuilds` present → the package owns its artifacts (a platform
 *     package staging its own target, or a bridge before the split).
 *   · absent → the sibling platform package must exist; if it does not, that is
 *     an error naming the command that creates it, never a fallback.
 *
 * @param {string} pkgDir absolute package directory being built
 * @param {Record<string, any>} pkg its manifest
 * @param {string} target the `<os>-<arch>` token being staged
 * @returns {{dir: string} | {error: string}}
 */
export function resolveStageDir(pkgDir, pkg, target) {
    const own = pkg.gjsify?.prebuilds;
    if (typeof own === 'string') return { dir: join(pkgDir, own, target) };

    const siblingDir = join(dirname(pkgDir), platformPackageDirName(basename(pkgDir), target));
    if (!existsSync(join(siblingDir, 'package.json'))) {
        return {
            error:
                `${pkg.name} declares no \`gjsify.prebuilds\`, so its artifacts belong in the per-target platform\n` +
                `  package for \`${target}\` (ADR 0017) — but ${basename(siblingDir)}/ does not exist.\n` +
                '  Staging into this package instead would create a directory that `files` does not\n' +
                '  ship and no conformance rule can see. Generate the platform packages first:\n' +
                '      node scripts/generate-platform-packages.mjs --write',
        };
    }
    return { dir: join(siblingDir, 'prebuilds', target) };
}

function main() {
    const args = process.argv.slice(2);
    const buildFlag = args.indexOf('--build-dir');
    const buildDirName = buildFlag >= 0 ? args[buildFlag + 1] : 'build';
    const destFlag = args.indexOf('--dest');
    const destArg = destFlag >= 0 ? args[destFlag + 1] : null;
    const scratch = args.includes('--scratch');
    // A flag VALUE does not start with `--`, so it would otherwise be taken for
    // the package directory.
    const pkgDir = resolve(
        args.find((a) => !a.startsWith('--') && a !== buildDirName && a !== destArg) ?? process.cwd(),
    );

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

    const libc = detectHostLibc();
    const allowUndeclared = args.includes('--allow-undeclared');
    let target = pickDeclaredTarget(declared, process.platform, process.arch, libc);
    if (!target && allowUndeclared) {
        // EXPLORATORY STAGING on a host the package does not promise — rather than
        // "just add the target to `gjsify.platforms`", because that declaration is a
        // promise to CONSUMERS which `audit-runtimes --check` holds to a CI job
        // reproducing it, so declaring a target nobody can receive an artifact for
        // trades a build-time refusal for a published falsehood in the
        // platform-support matrix. The concrete case is `darwin-x64`: every macOS
        // job runs on `macos-latest` (arm64), so an Intel Mac can BUILD the bridges
        // where CI cannot reproduce them, and the declaration plus the CI leg land
        // together later with the declared-vs-built symmetry intact.
        target = hostPrebuildTarget(process.platform, process.arch, libc);
        console.error(
            `[stage-prebuild] ${pkg.name}: staging UNDECLARED target \`${target}\` (--allow-undeclared).\n` +
                `  \`gjsify.platforms\` promises ${declared.join(', ')} — not this host.\n` +
                '  Nothing in CI reproduces this artifact, so do NOT commit it: the\n' +
                '  `prebuild-artifacts` rule fails a committed directory no declaration\n' +
                '  covers, which is the invariant that keeps a hand-built binary from\n' +
                '  drifting from its sources unnoticed. Local build + local test only.',
        );
    }
    if (!target) {
        const wanted = hostPrebuildTarget(process.platform, process.arch, libc);
        console.error(
            `[stage-prebuild] ${pkg.name}: this host (${wanted}) is not in\n` +
                `  \`gjsify.platforms\` (${declared.join(', ')}).\n` +
                '  Staging it anyway would create an undeclared target that CI does not\n' +
                '  reproduce. Add the target to the declaration AND to the workflow that\n' +
                '  builds it, then re-run — or pass `--allow-undeclared` to stage it for a\n' +
                '  LOCAL build+test without promising it to consumers.' +
                (libc === 'musl'
                    ? `\n  NB this host runs musl, so the target it needs is \`${wanted}\`, not\n` +
                      `  \`${process.platform}-${process.arch}\`. The unsuffixed directory is the DEFAULT\n` +
                      '  build that a glibc host resolves — a musl-linked library staged there\n' +
                      '  cannot load on the platform it would be published for, which is what\n' +
                      "  `audit-runtimes --check`'s `prebuild-libc` rule fails on."
                    : ''),
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

    // A `.typelib` WITHOUT the `.gir` it was compiled from is a broken build.
    // `g-ir-compiler` takes a `.gir` as INPUT from this same build directory, so a
    // `.typelib` here proves one WAS here; its absence is a build defect.
    //
    // Enforced at staging time, not only on the committed tree, because
    // `prebuild-artifacts` can DEFER a `.gir`-less directory on the promise that
    // "the next `prebuilds.yml` run lands the file" — and this is the only moment
    // that promise is falsifiable. Otherwise a build that stopped emitting a `.gir`
    // stages two of three files, the deferral never clears, and a deferral the tree
    // calls TRANSIENT is permanent with nothing saying so. A deferral ledger is
    // deliberately NOT consulted here — the rebuild is where its claim gets checked,
    // not excused — and this refusal is why there is no longer one to consult: it
    // closes the gap class structurally, so `PREBUILD_GIR_GAPS` could drain to zero
    // and be deleted rather than be maintained forever.
    if (artifacts.some((f) => f.endsWith('.typelib')) && !artifacts.some((f) => f.endsWith('.gir'))) {
        console.error(
            `[stage-prebuild] ${pkg.name}: ${buildDirName}/ holds a \`.typelib\` but no \`.gir\`\n` +
                `  (found: ${artifacts.sort().join(', ')}).\n` +
                '  `g-ir-compiler` compiles the typelib FROM a `.gir` in this directory, so one was here.\n' +
                '  Staging the pair without it is how ten committed prebuild directories ended up\n' +
                '  missing theirs — invisibly, because nothing loads a `.gir` and everything that\n' +
                '  regenerates types from the shipped artifact needs it. Refusing here rather than\n' +
                '  shipping an incomplete set: check the `vala_gir:`/`gnome.generate_gir()` output\n' +
                '  name in meson.build, and whether anything cleans it before this step runs.',
        );
        process.exit(1);
    }

    if (scratch && destArg !== null) {
        console.error(
            '[stage-prebuild] `--scratch` and `--dest` are mutually exclusive — `--scratch` IS a destination\n' +
                "  (this package's own `prebuilds/<target>/`). Pass one.",
        );
        process.exit(1);
    }

    let outDir;
    if (scratch) {
        // THE CI BUILD-LEG DESTINATION: this package's own `prebuilds/<target>/` as
        // SCRATCH SPACE for a job that uploads the artifact and commits nothing —
        // the one directory `resolveStageDir` refuses to default to. What makes the
        // same path correct here is ownership of the bytes, a property of the JOB:
        // `prebuilds.yml`'s build legs never commit (a separate `commit-prebuilds`
        // job downloads their artifacts into the per-target packages), and writing
        // the per-target package from a build leg would overwrite checked-out bytes
        // before the verify steps read them — the shape #960 removed for
        // `@gjsify/napi`. Hence a NAMED flag, not a fallback: `resolveStageDir`
        // keeps its refusal for everyone else and `--allow-undeclared` keeps meaning
        // what it says instead of being borrowed to unlock a destination.
        outDir = join(pkgDir, 'prebuilds', target);
    } else if (destArg !== null) {
        // AN EXPLICIT DESTINATION OUTSIDE ANY PACKAGE, for a target undeclared BY
        // DESIGN. `resolveStageDir`'s refusal makes `prebuilds.yml`'s musl leg
        // unstageable (after ADR 0017 it fails with `sab-native-linux-x64-musl/ does
        // not exist`, while the musl build itself succeeds), and that is not an
        // oversight: the leg builds targets NO package declares yet, so there is no
        // platform package to stage into and generating one would publish a promise
        // CI must reproduce and commit. So the escape is a NAMED destination that
        // also requires `--allow-undeclared` — together, "this host is not a
        // promised target AND these bytes are not going into a package". Everything
        // after this point (replace-not-merge, the extension match,
        // `checkPrebuildDir()`) runs unchanged, which is the point of routing a CI
        // leg through this script instead of a `cp`.
        if (!allowUndeclared) {
            console.error(
                '[stage-prebuild] `--dest` requires `--allow-undeclared`.\n' +
                    '  A destination outside the package tree is only meaningful for a target this\n' +
                    '  package does not promise. For a DECLARED target the destination is resolved,\n' +
                    '  never chosen: that is what keeps a shipped artifact in the one directory\n' +
                    '  `files` ships and the conformance rules can see.',
            );
            process.exit(1);
        }
        outDir = join(resolve(destArg), target);
    } else {
        const staged = resolveStageDir(pkgDir, pkg, target);
        if ('error' in staged) {
            console.error(`[stage-prebuild] ${staged.error}`);
            process.exit(1);
        }
        outDir = staged.dir;
    }
    // Replace rather than merge: a stale artifact from a previous build (a
    // renamed library, a dropped typelib) must not survive into the shipped set.
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const file of artifacts) copyFileSync(join(buildDir, file), join(outDir, file));

    // RELOCATE BEFORE VERIFYING (darwin only) — a freshly-linked Mach-O names the
    // build host's Homebrew prefix; `relocate-macho.mjs` has why that is a defect
    // and the rpath order it writes.
    //
    // On the copy in the destination rather than in each `meson.build`: this is
    // the one place every darwin target passes through, and the next statement is
    // the check that fails on a leftover. Per-bridge would be twelve copies of a
    // rule with nothing left for the check to catch.
    if (process.platform === 'darwin' && target.startsWith('darwin-')) {
        relocateDarwinPrebuildDir(outDir, target);
    }

    // The whole PATH, not just the target directory name: the destination is
    // usually a sibling package, and "→ linux-x64/" would read as if the bytes had
    // landed in the package that was built.
    console.log(
        `[stage-prebuild] ${pkg.name} → ${relative(pkgDir, outDir)}/${scratch ? ' [scratch]' : ''}` +
            ` (${artifacts.sort().join(', ')})`,
    );

    // Staging and verifying belong together: a set that copies but does not
    // resolve its own siblings is the artifact that builds green and dies at
    // `dlopen` on a user's machine. Asserts both halves of a Vala+Rust pair are
    // present AND the self-relative rpath that makes them loadable with no
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
