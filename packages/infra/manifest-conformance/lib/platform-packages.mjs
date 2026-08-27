/**
 * The per-target platform package vocabulary — ADR 0017.
 *
 * WHAT THIS IS
 *
 * A native bridge used to ship every `<os>-<arch>` prebuild it promises inside
 * ONE tarball. Measured on this tree that was 97.3 MB of committed binaries, of
 * which a `linux-x64` consumer could load 31.5 MB — 68 % downloaded and never
 * loadable. ADR 0017 adopts the ecosystem answer (esbuild, napi-rs, rolldown,
 * lightningcss upstream): the bridge keeps its name and API, declares one
 * `optionalDependencies` entry per target, and each target's binary lives in its
 * own package that declares `os`/`cpu` so a package manager installs the one
 * that fits and SILENTLY skips the rest.
 *
 * This module holds the part of that model that more than one caller needs, and
 * it holds it ONCE. Three things had to be shared, and each of them is a place
 * the split could have drifted:
 *
 *   1. `platformPackageName()` — the ONE derivation of a platform package's npm
 *      name from its parent's name plus the target token. Composing that string
 *      a second time anywhere is how the generator and the audit end up
 *      disagreeing about which name is missing, so there is exactly one.
 *
 *   2. `osCpuForTarget()` — the npm `os`/`cpu` pair a token implies. ADR 0017
 *      step 2 requires the audit to verify that a target's
 *      `optionalDependencies` entry has MATCHING `os`/`cpu`, "otherwise we trade
 *      one silent drift for another": an entry whose `os` says `darwin` while
 *      its name says `linux-x64` installs on nobody's machine and reports
 *      nothing.
 *
 *   3. `isPlatformPackageManifest()` — recognising a platform package from its
 *      OWN manifest, with no parent lookup and no repository knowledge. Four
 *      repo-scoped checks need this, because a package that contains no
 *      JavaScript is outside what they audit and INSIDE what they scan:
 *        · `runtimes-drift` would demand a `gjsify.runtimes` quintuplet derived
 *          from source signals, for a package with no source;
 *        · `platforms-ci` would demand a CI job whose name matches the platform
 *          package, when the job that produces the binary is the parent's;
 *        · `status-data` would demand an authored status entry per target — 51
 *          hand-written notes restating a fact the manifest already carries,
 *          which is precisely what that file forbids;
 *        · the platform MATRIX would grow 51 single-cell rows and bury the
 *          twelve bridges it exists to describe.
 *      Making the predicate LOCAL is deliberate: a published platform tarball,
 *      inspected alone in a consumer's tree, must be able to say what it is.
 *
 * WHY THE SPLIT PACKAGE CARRIES `gjsify.platforms` (ADR 0017's open question)
 *
 * The ADR left one decision to implementation: does a split package also declare
 * `gjsify.platforms` (a one-element list, self-describing) or does the parent's
 * list stay the only declaration? Its own criterion decides it — "whichever
 * choice makes a wrong declaration IMPOSSIBLE rather than merely unlikely":
 *
 *   · `gjsify.platforms` + `gjsify.prebuilds` on the child is what puts the
 *     tarball that ACTUALLY CONTAINS THE BINARY under the `prebuild-artifacts`
 *     rule. That rule then holds it to the full contract: the directory exists,
 *     its ELF/Mach-O machine matches the directory name, every library the
 *     typelib records is staged beside it, and on the host's own target it is
 *     really `dlopen`ed. Omit the declaration and the one tarball a consumer
 *     downloads is checked by nothing that reads only that tarball — the
 *     parent's list would remain authoritative for artifacts the parent no
 *     longer contains.
 *   · The redundancy cannot become a second truth, because it is not
 *     maintained: `scripts/generate-platform-packages.mjs` derives it from the
 *     parent's list and `--check` fails if the two disagree. A wrong token would
 *     have to agree simultaneously with the package NAME, with `os`, with `cpu`,
 *     with the prebuild DIRECTORY name and with the machine field inside the
 *     binary — and nobody hand-edits the last one.
 *
 * So: one source of truth (the parent's `gjsify.platforms`), one derived copy
 * per tarball, and a check that re-derives it. That is the same shape this
 * repository already uses for every generated artifact it commits.
 *
 * PORTABLE: manifest fields and string derivation only. Nothing here knows this
 * repository's directory layout, package set or CI.
 */

import { ARCH_ALIASES, PLATFORM_RE } from './platforms.mjs';

/**
 * The npm name of the package carrying `parentName`'s prebuild for `target`.
 *
 * `@gjsify/terminal-native` + `linux-x64` → `@gjsify/terminal-native-linux-x64`.
 *
 * The token is appended VERBATIM — no mapping table, no per-target special
 * case. The ecosystem convention (`@esbuild/linux-x64`,
 * `@rolldown/binding-linux-x64-gnu`, `lightningcss-darwin-arm64`) is exactly
 * this concatenation, and a table would be a second place to be wrong about a
 * target the audit already spells one way.
 *
 * @param {string} parentName npm name of the bridge, e.g. `@gjsify/webgl`.
 * @param {string} target a `gjsify.platforms` entry, e.g. `linux-arm64`.
 * @returns {string}
 */
export function platformPackageName(parentName, target) {
    return `${parentName}-${target}`;
}

/**
 * The directory a platform package lives in, given the parent's directory name.
 *
 * A SIBLING of the parent, not a child of it, and that is forced rather than
 * chosen: the root manifest's `workspaces` globs are `packages/<pillar>/*`, so a
 * nested `packages/<pillar>/<parent>/platforms/<target>` would not be a
 * workspace member — it could not be packed, published or version-bumped with
 * the train. The sibling shape also keeps the two-level
 * `packages/<a>/<b>/prebuilds/` path that `.github/prebuild-toolchain/
 * changed-packages.mjs` and the `platforms-ci` rule both parse out of the
 * workflows.
 *
 * @param {string} parentDirName basename of the parent package's directory.
 * @param {string} target
 * @returns {string}
 */
export function platformPackageDirName(parentDirName, target) {
    return `${parentDirName}-${target}`;
}

/**
 * The npm `os`/`cpu` filter a target token implies, or `null` when the token is
 * not a target at all.
 *
 * Arch aliases are folded onto the node spelling so a legacy `linux-x86_64`
 * declaration cannot produce `cpu: ["x86_64"]` — a value npm matches against
 * nothing, which would make the package silently uninstallable everywhere
 * instead of loudly wrong once.
 *
 * @param {string} target
 * @returns {{os: string[], cpu: string[]} | null}
 */
export function osCpuForTarget(target) {
    if (!PLATFORM_RE.test(String(target))) return null;
    const dash = String(target).indexOf('-');
    const os = String(target).slice(0, dash);
    const arch = String(target).slice(dash + 1);
    return { os: [os], cpu: [ARCH_ALIASES[arch] ?? arch] };
}

/**
 * Is this manifest a per-target platform package?
 *
 * Recognised from the manifest ALONE — no parent, no workspace, no repository
 * knowledge — by the four properties that together describe nothing else:
 *
 *   1. it names a committed prebuild directory (`gjsify.prebuilds`);
 *   2. it promises EXACTLY ONE target (`gjsify.platforms.length === 1`);
 *   3. it declares the `os`/`cpu` that target implies — the whole point of the
 *      split, and the reason a package manager can skip it;
 *   4. its NAME ends with `-<that target>`.
 *
 * A bridge that ships its own prebuilds fails (2) as soon as it promises more
 * than one target, and fails (3) always — no bridge declares `os`/`cpu`, because
 * that would make the JavaScript half uninstallable off its build host. A
 * single-target bridge (none today, but the shape is legal) fails (4) unless it
 * is literally named after the target, which is the naming rule this module
 * defines.
 *
 * Deliberately NOT part of the signature: the absence of `main`/`exports`. A
 * platform package must not declare an entry point it does not ship — the
 * `package-outputs` rule would fail it — but that is a consequence to be
 * CHECKED, not a fact to recognise the package by. Keying identification on an
 * absence would make a platform package that wrongly grew an entry point stop
 * being seen as one, and it would then be graded as a normal package by four
 * other rules at once.
 *
 * @param {Record<string, any> | null | undefined} manifest a parsed package.json
 * @returns {boolean}
 */
export function isPlatformPackageManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') return false;
    const gjsify = manifest.gjsify;
    if (!gjsify || typeof gjsify !== 'object') return false;
    if (typeof gjsify.prebuilds !== 'string') return false;
    if (!Array.isArray(gjsify.platforms) || gjsify.platforms.length !== 1) return false;
    const target = gjsify.platforms[0];
    const expected = osCpuForTarget(target);
    if (!expected) return false;
    if (!Array.isArray(manifest.os) || !Array.isArray(manifest.cpu)) return false;
    if (typeof manifest.name !== 'string' || !manifest.name.endsWith(`-${target}`)) return false;
    return true;
}

/**
 * Which of a native package's declared targets are SPLIT OUT, and which are
 * still this package's own responsibility.
 *
 * The split state is DERIVED, not declared, and that is the point. A marker
 * field (`gjsify.platformPackages: true`) would have to be added by hand to
 * every bridge and would be silently forgettable — a bridge that lost its
 * marker would look like an install-time-built package and drop out of the
 * committed-artifact contract with nothing to notice, which is the exact failure
 * shape ADR 0017 step 2 warns about ("we trade one silent drift for another").
 *
 * The two states are distinguishable without a marker because they are
 * MUTUALLY EXCLUSIVE by construction:
 *
 *   · `gjsify.prebuilds` present → the artifacts are in THIS tarball. The
 *     `prebuild-artifacts` rule already holds every declared target to a
 *     committed directory here.
 *   · `gjsify.prebuilds` absent, but the package carries a native build system
 *     whose output this repository commits (`meson.build`) → the artifacts left
 *     for per-target packages. Every declared target must have one.
 *
 * The third state is the one that must NOT be mistaken for either:
 * `@gjsify/node-gi` builds with node-gyp at install time (or ships its binary
 * straight from a release artifact) and legitimately declares platforms with no
 * committed directory anywhere. `prebuild-artifacts` already exempts it on the
 * same signal, in the same words, so the two rules cannot disagree about it.
 *
 * @param {object} nativePkg a row from `collectNativePackages()`
 * @returns {'committed-here'|'split'|'install-time'}
 */
export function prebuildOwnership(nativePkg) {
    if (nativePkg.prebuildsField != null) return 'committed-here';
    return nativePkg.builder === 'meson' ? 'split' : 'install-time';
}
