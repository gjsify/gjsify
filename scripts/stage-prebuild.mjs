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
// The target GRAMMAR lives with the rule that validates it. That is deliberate
// rather than convenient: this script WRITES the directory name `prebuild-libc`
// then reads back and checks, so the two agreeing by construction is worth more
// than the two being independent. (Its eventual home is `lib/platforms.mjs`,
// which today is libc-blind — see `canonicalPrebuildTarget`'s follow-up note.)
import { hostPrebuildTarget } from '../packages/infra/manifest-conformance/lib/rules/prebuild-libc.mjs';
import { platformPackageDirName } from '../packages/infra/manifest-conformance/lib/platform-packages.mjs';

/** Extensions that make up a shipped prebuild. */
const ARTIFACT_EXT = ['.so', '.dylib', '.dll', '.gir', '.typelib'];

/**
 * Pick the declared target that describes this host.
 *
 * There is exactly ONE spelling for a target: `${process.platform}-${process.arch}`
 * plus a `-musl` suffix on a musl Linux host (`linux-x64`, `linux-x64-musl`,
 * `darwin-arm64`, `win32-x64`). The repo used to carry a second, uname-style one
 * (`linux-x86_64`) because the meson jobs named the directory after `uname -m`,
 * and this function then had to accept an alias table to bridge the two. It does
 * not any more: the node spelling is what a running process can compute about
 * itself, so it needs no translation in the resolver's hot path, and a plain
 * equality check here is what keeps a local build from inventing a name CI does
 * not reproduce.
 *
 * A declaration in the old spelling therefore no longer matches — deliberately.
 * `scripts/audit-runtimes.mjs --check` rejects it at the declaration site with
 * a pointed message, so the failure lands on the `package.json` that is wrong
 * rather than on a "typelib not found" hours later.
 *
 * THE LIBC HALF DOES NOT FALL BACK. On a musl host this returns null unless
 * `<os>-<arch>-musl` is declared — it does not settle for `<os>-<arch>`, even
 * though that token IS declared by every package here. The unsuffixed directory
 * is the DEFAULT build, which is what a glibc host resolves; staging a
 * musl-linked library into it produces an artifact that cannot load on the
 * platform it is published for, which is precisely what the `prebuild-libc` rule
 * fails on. So the same hard error the undeclared-host case already gets is the
 * right answer here, and its message names the token to add.
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
 * Decide the host C library from independently-gathered facts. PURE.
 *
 * The twin of `resolveHostLibc()` in
 * `packages/infra/cli/src/utils/detect-native-packages.ts`, and it exists twice
 * for the same reason `ARCH_ALIASES` does: that one is TypeScript inside the CLI
 * bundle, this one is a zero-dependency `.mjs` script a meson build runs directly.
 * Keep them in lockstep — a divergence stages into one directory and resolves
 * another.
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
 * `process.report` is present on every Node that runs this script, so the first
 * probe normally answers; the musl-loader probe is what makes the answer correct
 * on a musl host, where `glibcVersionRuntime` is simply absent.
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
 * Exported so nothing has to recompose it. `status/open-todos.md` records that
 * nine e2e fixtures build the prebuild-target name themselves rather than
 * importing it, and that the last vocabulary change had to sweep all nine by
 * hand — missing one, because a composed string never appears as a literal to
 * grep for. The libc suffix makes that worse (a fixture on Alpine would compose
 * the wrong name), so the token gets a single callable definition here.
 */
export function hostStagingTarget() {
    return hostPrebuildTarget(process.platform, process.arch, detectHostLibc());
}

/**
 * Where a target's artifacts belong — and since ADR 0017 that is usually NOT
 * inside the package being built.
 *
 * A native bridge no longer carries its own `prebuilds/`: each `<os>-<arch>`
 * target lives in a sibling package (`<pkg>-<target>/prebuilds/<target>/`) that
 * declares `os`/`cpu`, so a consumer downloads only the binary their machine can
 * load. The bridge's manifest therefore has no `gjsify.prebuilds` field, and the
 * old `pkg.gjsify?.prebuilds ?? 'prebuilds'` default would quietly recreate a
 * directory INSIDE the bridge — untracked, absent from `files`, invisible to
 * every conformance rule (they key on `gjsify.prebuilds`), and yet exactly where
 * a developer's `gjsify workspace <pkg> build:prebuilds` would appear to succeed.
 * A local build that stages into a directory nothing ships is the quietest
 * possible failure, so the destination is RESOLVED rather than defaulted:
 *
 *   · `gjsify.prebuilds` present → the package still owns its artifacts (a
 *     platform package staging its own target, or a bridge before the split).
 *   · absent → the sibling platform package must exist. If it does not, that is
 *     an error with the command that creates it, never a fallback.
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
    // Excluded from the positional scan for the same reason `buildDirName` is: a
    // flag VALUE does not start with `--`, so without this it would be taken for
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
        // EXPLORATORY STAGING on a host the package does not promise. The reason
        // this exists rather than "just add the target to `gjsify.platforms`":
        // that declaration is a promise to CONSUMERS, and `audit-runtimes --check`
        // holds it to a CI job that reproduces it. A platform nobody can receive
        // an artifact for renders as supported in the platform-support matrix, so
        // declaring one to unblock a local build trades a build-time refusal for
        // a published falsehood.
        //
        // The concrete case: `darwin-x64`. Every macOS job in this repo runs on
        // `macos-latest`, which is arm64, so an Intel Mac (or a Hackintosh) can
        // BUILD the bridges but CI cannot reproduce them. With this flag that
        // host stages into `prebuilds/darwin-x64/` and can test locally; the
        // declaration and the CI leg land together later, keeping the
        // declared-vs-built symmetry intact instead of admitting an exception to
        // it.
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

    // A `.typelib` WITHOUT the `.gir` it was compiled from is a broken build, and
    // this is the one place that can say so while a human is looking at the build
    // log.
    //
    // It is not a taste rule. `g-ir-compiler` takes a `.gir` as its INPUT, and
    // every meson build here invokes it on a path inside this same build
    // directory — so a `.typelib` in `build/` is proof that a `.gir` was in
    // `build/` when it was produced. If it is not there now, either the build
    // stopped emitting it or something removed it, and both are defects of the
    // build rather than of the staging.
    //
    // WHY IT IS ENFORCED HERE, and not only on the committed tree:
    // `prebuild-artifacts` fails a committed directory with no `.gir`, and ten
    // directories are DEFERRED from that failure with the promise that "the next
    // `prebuilds.yml` run that rebuilds this target lands the file". That promise
    // is only falsifiable at this exact moment. Without this check, a build that
    // silently stopped producing a `.gir` would stage two of three files, the
    // deferral would never clear, the ledger would keep passing, and a deferral
    // the tree calls TRANSIENT would be permanent with nothing anywhere saying so.
    // Which is the failure class the ledger itself exists to replace.
    //
    // Deliberately NOT consulting the ledger: an entry claims the next rebuild
    // lands the file, so the rebuild is precisely where the claim must be checked,
    // not excused. Verified safe for every leg that runs today — all 60 committed
    // directories hold a `.typelib`, and the 50 that were staged by this script
    // hold a `.gir` as well; the ten that do not are exactly the pre-stager `cp`
    // lists this replaced.
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
        // THE CI BUILD-LEG DESTINATION: this package's own `prebuilds/<target>/`,
        // as SCRATCH SPACE for a job that uploads the artifact and commits
        // nothing.
        //
        // This is the directory `resolveStageDir` deliberately refuses to
        // default to, and the refusal is right: a developer whose
        // `build:prebuilds` quietly filled a bridge-local `prebuilds/` would be
        // looking at a directory `files` does not ship and no conformance rule
        // can see. What makes the same path CORRECT here is ownership of the
        // bytes, which is a property of the JOB, not of the path:
        // `prebuilds.yml`'s build legs never commit — a separate
        // `commit-prebuilds` job downloads their artifacts into the per-target
        // packages — and writing the per-target package from a build leg would
        // overwrite checked-out bytes before the verify steps read them, which
        // is exactly the shape #960 removed for `@gjsify/napi`.
        //
        // So it is a NAMED flag rather than a fallback: the workflow says
        // "scratch" out loud, `resolveStageDir` keeps its refusal for everyone
        // else, and `--allow-undeclared` keeps meaning what it says (this host is
        // not a promised target) instead of being borrowed to unlock a
        // destination.
        outDir = join(pkgDir, 'prebuilds', target);
    } else if (destArg !== null) {
        // AN EXPLICIT DESTINATION OUTSIDE ANY PACKAGE, for a target that is
        // undeclared BY DESIGN.
        //
        // `resolveStageDir` refuses when a bridge has no `gjsify.prebuilds` and no
        // sibling platform package, and that refusal is correct — staging into the
        // bridge would create a directory `files` does not ship and no conformance
        // rule can see. But it makes `prebuilds.yml`'s musl leg unstageable, and
        // not by oversight: that leg exists to build targets NO package declares
        // yet ("it proves itself before the declaration exists"), so by
        // construction there is no platform package to stage into, and generating
        // one would publish a promise CI must then reproduce and commit.
        //
        // Measured: after ADR 0017 that leg's `stage-prebuild . --allow-undeclared`
        // fails with `sab-native-linux-x64-musl/ does not exist` — the musl build
        // itself succeeds. Reproduced locally in `alpine:3.24`.
        //
        // So the escape is a NAMED destination rather than a relaxed default, and
        // it requires `--allow-undeclared` as well: the two together say "this
        // host is not a promised target AND these bytes are not going into a
        // package". Everything after this point — the replace-not-merge, the
        // extension match, `checkPrebuildDir()` — runs unchanged, which is the
        // whole point of routing a CI leg through this script instead of a `cp`.
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

    // The whole PATH, not just the target directory name: after the split the
    // destination is usually a sibling package, and "→ linux-x64/" would read as
    // if it had landed in the package that was built.
    console.log(
        `[stage-prebuild] ${pkg.name} → ${relative(pkgDir, outDir)}/${scratch ? ' [scratch]' : ''}` +
            ` (${artifacts.sort().join(', ')})`,
    );

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
