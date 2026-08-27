#!/usr/bin/env node
/**
 * Generate the per-target platform packages of every native bridge — ADR 0017.
 *
 * A native bridge used to ship every `<os>-<arch>` prebuild it promises in ONE
 * tarball. Measured here: 97.3 MB of committed binaries, of which a `linux-x64`
 * consumer could load 31.5 MB — 68 % downloaded and never loadable, growing with
 * every emulated architecture and taxing the 95 % of users not on it.
 *
 * ADR 0017 adopts the ecosystem answer (esbuild ships 26 of these; napi-rs,
 * rolldown, oxc, lightningcss the same): the bridge keeps its name, API and loader
 * contract and declares one `optionalDependencies` entry per target, each holding
 * that target's binary behind `os`/`cpu`. A package manager installs the one that
 * fits and SILENTLY skips the rest — silently, because a platform mismatch on an
 * OPTIONAL dependency is not an error (on a required one it is `EBADPLATFORM`).
 *
 * GENERATED, NOT WRITTEN. 51 manifests × 12 fields is not a review surface a human
 * holds correct, and every field is DERIVABLE (name from parent + token, `os`/`cpu`
 * from the token, version and tier from the parent, glibc floor from the ELF). A
 * hand-written set would drift on the first release bump and on every new target,
 * in the worst shape: a bridge searching at runtime for a sibling that was never
 * published, reporting "typelib not found". So one function emits the set and
 * `--check` re-emits and compares. `audit-runtimes.mjs --check` runs that as the
 * `platform-packages` rule, which also holds ADR 0017 step 2 — every declared
 * target has a package AND an `optionalDependencies` entry whose `os`/`cpu` match
 * the token, "otherwise we trade one silent drift for another".
 *
 * WHAT A GENERATED PACKAGE DELIBERATELY LACKS
 *
 *   · No `main`/`types`/`module`/`exports`. These are DATA packages; the loader
 *     (`detectNativePackages()`) finds them by scanning node_modules for
 *     `gjsify.prebuilds` + `prebuilds/<target>/` — the same mechanism that found
 *     the bundled directory before the split, which is why ADR 0017 needs no new
 *     runtime code path. A declared-but-absent entry point would (correctly) fail
 *     the `package-outputs` rule.
 *   · No `gjsify.runtimes`: that quintuplet describes an API's cross-runtime reach
 *     and a package with no JavaScript has none. `runtimes-drift` skips them on the
 *     same signal the generator writes — see `isPlatformPackageManifest()`.
 *   · No sources, build or tests. The four lifecycle scripts are no-ops so
 *     `gjsify foreach {build,check,clear,test}` — which derives its set from the
 *     workspace, not a list — walks them without special-casing.
 *
 * THE LIBC AXIS IS MEASURED. `libc` and `gjsify.glibcRequires` are read out of the
 * ELF by the `prebuild-libc` rule's OWN reader (`measurePrebuildLibc`), never a copy
 * living here — {@link measureLibcFields} holds the incident. A guessed
 * `libc: ["glibc"]` would make every package manager refuse the install on musl
 * hosts where six of these bridges provably load, so the field is written only where
 * a glibc dynamic loader is actually recorded.
 *
 * The split IMPROVES that axis: npm's `libc` is one package-level filter while the
 * requirement is per TARGET. `@gjsify/tls-native` records no libc soname on
 * x64/arm64/ppc64/s390x and DOES record the glibc interpreter on riscv64, because
 * Fedora's riscv64 toolchain links it explicitly — one tarball cannot state that,
 * and only `@gjsify/tls-native-linux-riscv64` declares the restriction. Same for the
 * floor: a one-entry map per package instead of a whole-tree maximum every consumer
 * inherits.
 *
 * Usage:
 *   node scripts/generate-platform-packages.mjs            # --check (default)
 *   node scripts/generate-platform-packages.mjs --check
 *   node scripts/generate-platform-packages.mjs --write
 *   node scripts/generate-platform-packages.mjs --write --only @gjsify/webgl
 *
 * `--write` MOVES the committed prebuild directories with `git mv`, so their
 * history follows them, and patches the parent manifest (drops `gjsify.prebuilds`
 * and the `prebuilds` entry from `files`, adds the `optionalDependencies`). It is
 * idempotent: a second run reports nothing to do.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    canonicalPlatform,
    collectNativePackages,
    createContext,
    isPlatformPackageManifest,
    measurePrebuildLibc,
    osCpuForTarget,
    platformPackageDirName,
    platformPackageName,
    posixRelative,
    prebuildOwnership,
} from '../packages/infra/manifest-conformance/lib/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** JSON written the way every manifest in this repo is written: 4 spaces, trailing newline. */
const stringifyManifest = (obj) => `${JSON.stringify(obj, null, 4)}\n`;

// ─── the generated content ──────────────────────────────────────────────────

/**
 * The npm `libc` + `gjsify.glibcRequires` values MEASURED from the committed
 * artifacts of one target.
 *
 * Both describe the BINARY, so both are read out of it — the same reason
 * `prebuild-artifacts` reads `e_machine` instead of trusting a directory name.
 *
 * The measurement is NOT reimplemented here: `measurePrebuildLibc()` is the
 * `prebuild-libc` rule's own reader, and the rule GRADES the field this function
 * WRITES, so a second opinion about the same bytes can only make `--write` emit a
 * manifest `--check` rejects. Not hypothetical — a hand-rolled copy of the loader
 * predicate did exactly that on its first run. It tested
 * `/^ld-linux[\w.-]*\.so(\.\d+)?$/`, the loader's name on x86-64, arm64 and riscv64
 * but NOT on ppc64le or s390x, where glibc calls it `ld64.so.2` / `ld64.so.1`: the
 * generator wrote no `libc` for those two targets of `@gjsify/lightningcss-native`
 * and the rule failed them for the omission. `libcFlavourOfNeeded` /
 * `muslVerdictOfNeeded` match all five spellings.
 *
 * The generator decides only the POLICY, and only where it is a direct read:
 * `musl: 'incompatible'` — a recorded glibc dynamic loader — means the image cannot
 * load under musl's loader, so the filter is required. `'undetermined'` is NOT the
 * opposite: musl treats a `DT_NEEDED` of `libc.so.6` as a request for itself and
 * loads such an image happily, confirmed on `alpine:3.24.1` for six of this repo's
 * bridges. Declaring `libc: ["glibc"]` there would refuse the install on exactly the
 * platform the axis exists to support, so nothing is declared and the three-tier
 * judgement stays with the rule.
 *
 * @param {string} dir absolute path to the target's prebuild directory
 * @param {string} target the `<os>-<arch>` token
 * @returns {{available: boolean, libc: string[] | null, glibcRequires: string | null, why?: string}}
 */
export function measureLibcFields(dir, target) {
    const os = target.slice(0, target.indexOf('-'));
    // npm defines `libc` as Linux-only and glibc symbol versioning is an
    // ELF/Linux concept: a darwin or win32 directory is out of scope, not
    // unverified. Saying otherwise would imply a check that cannot exist.
    if (os !== 'linux') return { available: true, libc: null, glibcRequires: null };

    const measured = measurePrebuildLibc(dir);
    // An unreadable `.so` makes the whole measurement untrustworthy — the same
    // verdict `auditPrebuildLibc` reaches, and for the same reason: "records no
    // glibc loader", derived from a file nobody parsed, is the check claiming
    // more than it did. Writing a field from it would bake that claim into a
    // published manifest.
    if (measured.unreadable.length > 0) {
        return {
            available: false,
            libc: null,
            glibcRequires: null,
            why:
                `${posixRelative(ROOT, dir)} holds ${measured.unreadable.length} shared librar(y|ies) ` +
                `whose ELF could not be read (${measured.unreadable.join(', ')}). No \`libc\` / \`gjsify.glibcRequires\` ` +
                'is written from an unread file; `prebuild-artifacts` owns the underlying failure.',
        };
    }
    return {
        available: true,
        libc: measured.musl === 'incompatible' ? ['glibc'] : null,
        glibcRequires: measured.glibcRequires,
    };
}

/**
 * The complete manifest of one platform package.
 *
 * Every value is derived from the parent plus the target — there is nothing here
 * a human is expected to keep in sync, which is the point.
 *
 * @param {object} parent `{ name, version, dir, tier, description }` of the bridge
 * @param {string} target the `<os>-<arch>` token, VERBATIM as `gjsify.platforms` spells it
 * @param {{libc: string[]|null, glibcRequires: string|null}} measured see {@link measureLibcFields}
 * @param {string|null} [exemption] the parent's `gjsify.platformsUncommitted` reason for this
 *   target, inherited verbatim. See {@link planPlatformPackages} for why an exempt target gets a
 *   package at all.
 * @returns {Record<string, unknown>}
 */
export function platformManifest(parent, target, measured, exemption = null) {
    const osCpu = osCpuForTarget(target);
    if (!osCpu) throw new Error(`generate-platform-packages: ${parent.name} declares an invalid target \`${target}\``);
    const name = platformPackageName(parent.name, target);
    const dirName = platformPackageDirName(basename(parent.dir), target);
    // Relative to the CONTEXT's root, not the module-level one: the emitters are
    // also driven against a temp-root fixture (see
    // tests/e2e/platform-exemption-clearing), where closing over `ROOT` computes
    // a `../../../tmp/…` traversal. An equality-only test would then compare
    // garbage to garbage and notice nothing.
    const repoDir = `${posixRelative(parent.root ?? ROOT, dirname(parent.dir))}/${dirName}`;

    /** @type {Record<string, unknown>} */
    const manifest = {
        name,
        version: parent.version,
        description:
            `${target} prebuilt native library + GObject-Introspection typelib for ${parent.name}. ` +
            `Installed automatically on ${osCpu.os[0]}/${osCpu.cpu[0]} as an optionalDependency of that package ` +
            '(ADR 0017) and skipped everywhere else. Contains no JavaScript.',
        license: 'MIT',
        os: osCpu.os,
        cpu: osCpu.cpu,
    };
    // npm's `libc` is a Linux-only install filter, honoured by npm, yarn and
    // pnpm. Present ONLY when measurement proved the artifact cannot load under
    // musl — see `measureLibcFields`.
    if (measured.libc) manifest.libc = measured.libc;
    // No `main`/`module`/`types`/`exports`: see the header. The prebuild
    // directory is the entire payload, so it is the entire `files` list.
    manifest.files = ['prebuilds'];
    manifest.gjsify = {
        // Per-target, even though this package has exactly one target: the
        // `prebuild-libc` rule's own vocabulary is a target → floor map, and a
        // bare string here would need translating at every comparison.
        ...(measured.glibcRequires ? { glibcRequires: { [target]: measured.glibcRequires } } : {}),
        // Inherited VERBATIM from the parent, and it is what keeps the exemption
        // enforceable after the split: `prebuild-artifacts` fails the moment
        // `prebuilds/<target>/` appears next to a live exemption, and that
        // directory now appears HERE, not in the bridge. The parent drops its own
        // copy for the same reason it drops `gjsify.prebuilds` — it is out of
        // that rule's scope and could no longer trip.
        ...(exemption ? { platformsUncommitted: { [target]: exemption } } : {}),
        // The one-element list is what puts THIS tarball under the
        // `prebuild-artifacts` contract — existence, machine-matches-directory,
        // typelib-named siblings staged, host `dlopen`. See ADR 0017's resolved
        // open question and `lib/platform-packages.mjs` for why the redundancy
        // is not a second source of truth.
        platforms: [target],
        prebuilds: 'prebuilds',
        // Inherited, never chosen: the stability this artifact promises IS the
        // stability of the bridge it belongs to (ADR 0003). A different tier here
        // would let the tier rule's dependency-direction check pass on an edge
        // that is really a downgrade.
        tier: parent.tier,
    };
    manifest.scripts = {
        // `gjsify foreach {build,check,clear,test}` derives its package set from
        // the workspace, not from a list. No-ops keep a data package walkable
        // without teaching four call sites about a special case.
        clear: "echo 'nothing to do'",
        check: "echo 'nothing to do'",
        build: "echo 'nothing to do'",
        test: "echo 'nothing to do'",
    };
    manifest.repository = {
        type: 'git',
        url: 'git+https://github.com/gjsify/gjsify.git',
        directory: repoDir,
    };
    manifest.bugs = { url: 'https://github.com/gjsify/gjsify/issues' };
    manifest.homepage = `https://github.com/gjsify/gjsify/tree/main/${repoDir}#readme`;
    return manifest;
}

/**
 * The README a platform package ships.
 *
 * npm always includes README, LICENSE and package.json regardless of `files`, so
 * this is the page a human lands on when a lockfile or an install log points them
 * at a package name they have never heard of. Saying "this is not the package you
 * want, here is the one that is" costs four paragraphs and saves the confusion
 * ADR 0017 predicts: "a consumer whose platform package genuinely failed to
 * install now gets a missing sibling rather than a missing directory".
 *
 * @param {object} parent
 * @param {string} target
 * @param {PlannedTarget} [planned] when the target is exempt, its reason is
 *   reproduced here — the README is the ONE page a consumer sees when they
 *   wonder why an installed package holds no binary, and "not shipped yet,
 *   because <reason>" is the answer an empty directory cannot give.
 */
export function platformReadme(parent, target, planned) {
    const name = platformPackageName(parent.name, target);
    const osCpu = /** @type {{os: string[], cpu: string[]}} */ (osCpuForTarget(target));
    const deferred =
        planned && planned.state === 'uncommitted'
            ? `
> **No artifact in this tarball yet.** \`${target}\` is declared by
> \`${parent.name}\` and built by CI, but not committed to the repository:
> ${planned.why}
>
> The package exists so the artifact has somewhere to land — and so its npm name
> is claimed before the release that first ships it. Until then installing it is
> harmless and does nothing: \`${parent.name}\` finds no typelib and takes its
> no-native path, exactly as if this package were absent.
`
            : '';
    return `# ${name}
${deferred}

The **${target}** native artifacts of [\`${parent.name}\`](https://www.npmjs.com/package/${parent.name}) — a shared
library plus its GObject-Introspection typelib, and nothing else. There is no
JavaScript in this package and nothing to import from it.

You do not install this directly. \`${parent.name}\` declares it as an
\`optionalDependencies\` entry and this package declares \`os: ["${osCpu.os[0]}"]\`,
\`cpu: ["${osCpu.cpu[0]}"]\`, so your package manager installs the one build that fits your
machine and silently skips the rest — the same model \`esbuild\`, \`rolldown\` and
\`lightningcss\` use. Before this split every consumer downloaded every platform's
binary: 97.3 MB of which a linux-x64 machine could load 31.5 MB.

\`@gjsify/cli\` finds the artifacts at run time by scanning \`node_modules\` for
packages declaring \`gjsify.prebuilds\`, and puts this directory on
\`GI_TYPELIB_PATH\` plus the host loader's own search path. If a \`gi://Gjsify…\`
import fails with "typelib not found", check that this package is present in
\`node_modules\` — an optional dependency that failed to install is skipped without
an error, by design.

Generated by \`scripts/generate-platform-packages.mjs\`; see
[ADR 0017](https://github.com/gjsify/gjsify/blob/main/docs/adr/0017-native-package-distribution.md).

License: MIT
`;
}

/**
 * The parent manifest as it must look after the split, given the targets that
 * were split out.
 *
 * Four edits, and each one is load-bearing:
 *
 *   1. `gjsify.prebuilds` is REMOVED. It names a committed prebuild directory
 *      that this package no longer has, and it is the field
 *      `prebuild-artifacts` uses to decide whether a package is under the
 *      committed-artifact contract. Leaving it would fail that rule for every
 *      declared target — correctly, since the directory really is gone.
 *   2. `prebuilds` is dropped from `files`. This is the byte saving; without it
 *      the tarball is unchanged and the whole exercise buys nothing.
 *   3. The npm `libc` filter and `gjsify.glibcRequires` are REMOVED: both describe
 *      a BINARY this tarball no longer holds. Leaving `libc` is not cosmetic but
 *      an install-time REGRESSION — npm, yarn and pnpm all honour it, so
 *      `@gjsify/lightningcss-native`'s inherited `libc: ["glibc"]` would refuse the
 *      pure-TypeScript half on every musl host, where it runs fine (the bridge
 *      degrades when no native engine loads, which on Alpine is the right
 *      outcome). The constraint now belongs to the package carrying the
 *      constrained bytes — only `@gjsify/tls-native-linux-riscv64` declares
 *      `libc`, not all five of that bridge's Linux targets. `glibcRequires` moves
 *      for that reason plus one more: as a parent-level map it describes
 *      directories the parent can no longer see, so nothing could keep it true.
 *   4. `optionalDependencies` gains one entry per split target, ranged
 *      `workspace:*` for a workspace member — the repo convention (283 of 285
 *      sibling runtime edges) which resolves to the EXACT sibling version at pack
 *      time, the pin the esbuild model needs and no release bump can forget.
 *      `@gjsify/napi` and `@gjsify/node-gi` are deliberately NOT members (own CI,
 *      own carve-outs) and `gjsify pack` throws on a `workspace:` range it cannot
 *      resolve, so those get the literal version — held by the audit rule rather
 *      than by memory.
 *
 * `gjsify.platforms` is untouched: ADR 0017 step 2 keeps it as the single
 * declaration, and every child's one-element list is derived from it.
 *
 * @param {Record<string, any>} manifest the parent's current manifest
 * @param {{name: string, range: string}[]} optionalDeps sorted
 * @returns {Record<string, unknown>}
 */
export function patchedParentManifest(manifest, optionalDeps) {
    const out = JSON.parse(JSON.stringify(manifest));
    if (Array.isArray(out.files)) out.files = out.files.filter((f) => f !== 'prebuilds');
    if (out.gjsify && typeof out.gjsify === 'object') {
        delete out.gjsify.prebuilds;
        delete out.gjsify.glibcRequires;
        // The exemption travels to the child with the directory it describes.
        // Leaving a copy here is not merely redundant, it is UNCLEARABLE:
        // `scripts/clear-committed-platform-exemptions.mjs` runs in
        // `commit-prebuilds` and drops an entry the moment
        // `<pkg>/<gjsify.prebuilds>/<target>/` appears — which is what keeps an
        // honest deferral from outliving its cause and turning `main` red on the
        // very run that resolves it. A split parent has no `gjsify.prebuilds`,
        // so that script skips it and its copy would sit there for good, saying
        // something no rule can any longer contradict.
        delete out.gjsify.platformsUncommitted;
    }
    delete out.libc;

    const existing = out.optionalDependencies ?? {};
    /** @type {Record<string, string>} */
    const merged = {};
    // Sorted, and platform entries first: 51 generated lines are diff noise if
    // their order can float, and a stable order is what makes a hand edit to one
    // of them visible in review.
    for (const { name, range } of optionalDeps) merged[name] = range;
    for (const [name, range] of Object.entries(existing)) {
        if (name in merged) continue;
        merged[name] = range;
    }
    out.optionalDependencies = merged;

    return out;
}

/**
 * Rewrite a parent's own `./prebuilds/<target>` script references to the sibling
 * package the directory moved into.
 *
 * Kept separate from {@link patchedParentManifest} because it needs the parent's
 * DIRECTORY name, and because it is a string rewrite rather than a structural
 * edit — the audit asserts the absence of the old form instead of re-deriving
 * the new one, so a hand-written variant that also points somewhere valid is
 * not fought over.
 *
 * @param {Record<string, any>} manifest patched parent manifest (mutated)
 * @param {string} parentDirName
 * @param {readonly string[]} targets
 */
export function rewriteParentPrebuildPaths(manifest, parentDirName, targets) {
    if (!manifest.scripts || typeof manifest.scripts !== 'object') return manifest;
    for (const [key, value] of Object.entries(manifest.scripts)) {
        if (typeof value !== 'string') continue;
        let next = value;
        for (const target of targets) {
            next = next.replaceAll(
                `./prebuilds/${target}`,
                `../${platformPackageDirName(parentDirName, target)}/prebuilds/${target}`,
            );
        }
        manifest.scripts[key] = next;
    }
    return manifest;
}

// ─── the plan ───────────────────────────────────────────────────────────────

/**
 * What the split looks like for one native bridge.
 *
 * @typedef {object} PlannedTarget
 * @property {string} target
 * @property {string} name expected platform package name
 * @property {string} dir expected absolute directory
 * @property {string} rel repo-relative directory
 * @property {string} range the `optionalDependencies` range the parent must carry
 * @property {'plan'|'uncommitted'|'missing-artifact'} state
 * @property {string} [why] why a non-`plan` target is not generated
 */

/**
 * Which bridges are in scope, and what each one's platform packages must be.
 *
 * Scope is DERIVED from the same two signals `prebuild-artifacts` uses, so the
 * two rules cannot disagree about a package: a bridge is in scope when it
 * declares `gjsify.platforms` and its artifacts are this repository's to commit
 * — either still in its own tarball (`gjsify.prebuilds`, the pre-split state) or
 * already split out (a native build system in-tree and no prebuild directory).
 * `@gjsify/node-gi` builds with node-gyp at install time and is out of scope on
 * exactly the signal that exempts it there too.
 *
 * @param {import('../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export function planPlatformPackages(ctx) {
    const native = collectNativePackages(ctx);
    const parents = [];
    /** @type {string[]} */ const notes = [];
    let measurementUnavailable = null;

    for (const row of native) {
        const pkg = ctx.get(row.name);
        // Never `continue` on a miss. `collectNativePackages()` iterates
        // `ctx.allPackages`, so every row it produced HAS a record; a lookup that
        // came back empty means the context's index and its iteration disagree,
        // and skipping quietly is how this generator once audited ten of eleven
        // bridges and printed OK (`@gjsify/napi` is not a workspace member, and
        // `byName` used to index only the workspace globs).
        if (!pkg) {
            throw new Error(
                `generate-platform-packages: \`${row.name}\` (${row.path}) is a native package the context cannot look up by ` +
                    'name. That means `createContext`’s index no longer covers everything `collectNativePackages` iterates — ' +
                    'fix the context, do not skip the package.',
            );
        }
        if (isPlatformPackageManifest(pkg.manifest)) continue; // a child, not a bridge
        const ownership = prebuildOwnership(row);
        if (ownership === 'install-time') continue;
        if (!row.declared) continue; // `platforms-ci` already fails a missing/invalid declaration

        const isWorkspaceMember = ctx.packages.some((p) => p.name === row.name);
        const uncommitted =
            row.uncommitted && typeof row.uncommitted === 'object' && !Array.isArray(row.uncommitted)
                ? row.uncommitted
                : {};
        const shippedCanon = new Set(row.shipped.map(canonicalPlatform));

        /** @type {PlannedTarget[]} */
        const targets = [];
        for (const target of row.declared) {
            const name = platformPackageName(row.name, target);
            const dirName = platformPackageDirName(basename(row.dir ?? pkg.dir), target);
            const dir = join(dirname(pkg.dir), dirName);
            const rel = posixRelative(ctx.root, dir);
            const range = isWorkspaceMember ? 'workspace:*' : pkg.manifest.version;
            // Read the exemption from WHEREVER it currently lives, because the
            // split moves it: before, it is on the bridge; after, on the child
            // that owns the directory it describes. The child WINS, since that
            // is the copy `clear-committed-platform-exemptions.mjs` maintains —
            // it drops the entry the moment the artifact lands, and reading the
            // bridge's stale copy in preference would resurrect a deferral that
            // job had just retired. Accepting both is what lets `--write`
            // perform the move at all: on the pre-split tree only the bridge has
            // it, and a plan that could not see it there would regenerate every
            // exempt child as if its artifact existed.
            const childUncommitted = ctx.get(name)?.manifest?.gjsify?.platformsUncommitted;
            const effective =
                childUncommitted && typeof childUncommitted === 'object' && !Array.isArray(childUncommitted)
                    ? childUncommitted
                    : uncommitted;
            const exemption = Object.entries(effective).find(
                ([t]) => canonicalPlatform(t) === canonicalPlatform(target),
            );
            // An exempt target still gets a PACKAGE — only its artifact is
            // deferred. Three reasons, and the first one is a shipped bug:
            //
            //  · `@gjsify/napi`'s darwin-arm64 is not committed here because a
            //    RELEASE ships it: `release.yml`'s `napi-prebuild-darwin-arm64`
            //    job builds it and `publish-napi` stages it into the tarball at
            //    pack time. Take `prebuilds` out of the bridge's `files` — which
            //    the split does — and that staging silently packs nothing. Every
            //    macOS consumer of `@gjsify/napi` loses its prebuild, with no
            //    error anywhere. The artifact needs a package to be shipped FROM.
            //  · It restores the tripwire the split would otherwise remove.
            //    `gjsify.platformsUncommitted` is held honest by
            //    `prebuild-artifacts`: the moment the directory appears, the rule
            //    fails and says "delete the exemption". After the split the
            //    parent leaves that rule's scope, and the directory appears in
            //    the child — so the exemption has to travel with it or the seven
            //    `darwin-x64` entries become permanently unfalsifiable.
            //  · It makes the npm name exist when the target is DECLARED rather
            //    than when its artifact lands. ADR 0017 names the serialised
            //    first-publish bootstrap as the split's main cost; paying it once
            //    per declaration, in the `gjsify onboard` sweep that has to
            //    happen anyway, is strictly cheaper than a second sweep later —
            //    and a forgotten one stalls the publish loop for every
            //    alphabetically-later package (the v0.4.20 incident).
            //
            // The tarball is README + package.json until the artifact arrives,
            // which costs a consumer ~2 KB and behaves exactly like the package
            // being absent: the bridge finds no typelib and takes its no-native
            // path, which is what it does today.
            const state = exemption ? 'uncommitted' : 'plan';
            const why = exemption ? String(exemption[1]) : undefined;
            if (exemption) {
                targets.push({ target, name, dir, rel, range, state, why });
                continue;
            }
            // Pre-split bridge with a declared target and no directory: a
            // promised platform with no artifact behind it. `prebuild-artifacts`
            // fails that with an actionable message; inventing an empty package
            // for it here would turn a caught gap into a published one.
            //
            // The child probe is what makes a HALF-MIGRATED tree resumable, and
            // it is not hypothetical: `--write` moves the directories with
            // `git mv` and patches the parent manifest afterwards, so an
            // interrupted run — or a rebase that takes the parent's side of a
            // conflict while the moves are already in the tree — leaves a parent
            // that still declares `gjsify.prebuilds` over a directory that is
            // gone. Judging that state by the PARENT's `shipped` set alone reads
            // every target as "promised with nothing behind it" and the run
            // reports `0 committed target(s) into ` — a degenerate instruction
            // to re-run the command that just refused to do anything.
            // {@link artifactDir} has always looked in both places; the plan has
            // to ask the same question or the two disagree about the same tree.
            const alreadySplit = existsSync(join(dir, 'prebuilds', target));
            if (ownership === 'committed-here' && !alreadySplit && !shippedCanon.has(canonicalPlatform(target))) {
                targets.push({
                    target,
                    name,
                    dir,
                    rel,
                    range,
                    state: 'missing-artifact',
                    why: 'declared, no committed prebuild directory and no `gjsify.platformsUncommitted` exemption',
                });
                continue;
            }
            targets.push({ target, name, dir, rel, range, state: 'plan' });
        }

        parents.push({
            name: row.name,
            path: row.path,
            dir: pkg.dir,
            // The root this plan was built against, so every emitter derives
            // repo-relative paths from it rather than from the module-level ROOT.
            root: ctx.root ?? ROOT,
            version: pkg.manifest.version,
            tier: row.tier,
            manifest: pkg.manifest,
            ownership,
            isWorkspaceMember,
            prebuildDir: row.prebuildDir,
            prebuildsField: row.prebuildsField,
            targets,
        });
    }

    // One note for the whole run rather than one per package: the libc axis is
    // absent or present for the tree, not per bridge, and 51 identical lines
    // would bury everything else.
    for (const parent of parents) {
        for (const t of parent.targets) {
            if (t.state !== 'plan' || measurementUnavailable) continue;
            const dir = artifactDir(parent, t);
            if (!dir) continue;
            const m = measureLibcFields(dir, t.target);
            if (!m.available) measurementUnavailable = m.why;
        }
    }
    if (measurementUnavailable) notes.push(`libc axis NOT measured — ${measurementUnavailable}`);

    return { parents, notes };
}

/**
 * The directory holding a target's artifacts, wherever it currently lives.
 *
 * Before the split that is `<parent>/prebuilds/<target>`; after it,
 * `<parent>-<target>/prebuilds/<target>`. Both are checked because the generator
 * has to work on a half-migrated tree — a `--write` interrupted between two
 * packages must be resumable, and `--check` must describe what is actually there.
 *
 * @param {object} parent a row from {@link planPlatformPackages}
 * @param {PlannedTarget} planned
 * @returns {string | null}
 */
function artifactDir(parent, planned) {
    const inChild = join(planned.dir, 'prebuilds', planned.target);
    if (existsSync(inChild)) return inChild;
    if (parent.prebuildDir) {
        const inParent = join(parent.prebuildDir, planned.target);
        if (existsSync(inParent)) return inParent;
    }
    return null;
}

/**
 * The files a platform package must contain, as strings, ready to compare or write.
 *
 * @param {object} parent
 * @param {PlannedTarget} planned
 */
export function expectedFiles(parent, planned) {
    const dir = artifactDir(parent, planned);
    const measured = dir
        ? measureLibcFields(dir, planned.target)
        : { available: true, libc: null, glibcRequires: null };
    return {
        'package.json': stringifyManifest(
            platformManifest(
                {
                    name: parent.name,
                    version: parent.version,
                    dir: parent.dir,
                    root: parent.root,
                    tier: parent.tier,
                },
                planned.target,
                measured,
                planned.state === 'uncommitted' ? (planned.why ?? null) : null,
            ),
        ),
        'README.md': platformReadme({ name: parent.name }, planned.target, planned),
    };
}

// ─── the audit ──────────────────────────────────────────────────────────────

/**
 * Hold the generated set to what the generator would emit now, and hold the
 * parents to ADR 0017 step 2.
 *
 * Exported so the `platform-packages` conformance rule is a thin wrapper: the
 * check that runs in CI and the check `--check` prints are the same code, which
 * is the only way "the generator and the audit agree" is a fact rather than a
 * hope.
 *
 * @param {import('../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export function auditPlatformPackages(ctx) {
    const { parents, notes } = planPlatformPackages(ctx);
    /** @type {string[]} */ const failures = [];
    const stats = { parents: parents.length, packages: 0, targets: 0, uncommitted: 0, unsplitParents: 0 };

    for (const parent of parents) {
        if (parent.ownership === 'committed-here') {
            stats.unsplitParents++;
            failures.push(
                `${parent.name} (${parent.path}): still ships its prebuilds in its own tarball (\`gjsify.prebuilds\`), but ADR 0017 ` +
                    `splits every native package into per-target packages. Run \`node scripts/generate-platform-packages.mjs --write\` ` +
                    `to move ${parent.targets.filter((t) => t.state === 'plan').length} committed target(s) into ` +
                    `${parent.targets
                        .filter((t) => t.state === 'plan')
                        .map((t) => `\`${t.name}\``)
                        .join(', ')}.`,
            );
            continue;
        }

        // Binary facts on a package that no longer holds a binary. Both are
        // stripped by `patchedParentManifest`, and both are checked here rather
        // than left to the generator's own byte comparison, because that
        // comparison only covers the GENERATED children — a parent manifest is
        // PATCHED, so a hand edit to it is invisible to `--check` unless a rule
        // names the field. `libc` is the one that bites: npm, yarn and pnpm all
        // honour it, so a leftover `["glibc"]` refuses to install the bridge's
        // pure-TypeScript half on musl hosts where it runs fine. The constraint
        // now lives on the one child whose bytes carry it.
        if (Array.isArray(parent.manifest.libc)) {
            failures.push(
                `${parent.name} (${parent.path}): still declares \`libc: ${JSON.stringify(parent.manifest.libc)}\`, but its prebuilds ` +
                    'moved into per-target packages and this tarball holds no binary. npm, yarn and pnpm all honour the field, so it ' +
                    'now refuses to install the JavaScript half on a host that could run it perfectly well (the bridge degrades ' +
                    'gracefully with no native engine). The constraint belongs to the platform package whose bytes carry it, which ' +
                    'measures it from its own ELF. Run `node scripts/generate-platform-packages.mjs --write`.',
            );
        }
        if (parent.manifest.gjsify?.glibcRequires != null) {
            failures.push(
                `${parent.name} (${parent.path}): still declares \`gjsify.glibcRequires\`, a per-target floor for prebuild directories ` +
                    'this package no longer contains — nothing can keep it true, and `prebuild-libc` no longer grades it here. Each ' +
                    'platform package measures its own floor. Run `node scripts/generate-platform-packages.mjs --write`.',
            );
        }
        if (parent.manifest.gjsify?.platformsUncommitted != null) {
            failures.push(
                `${parent.name} (${parent.path}): still declares \`gjsify.platformsUncommitted\`. The exemption belongs to the platform ` +
                    'package that will hold the artifact — here it is UNCLEARABLE: ' +
                    '`scripts/clear-committed-platform-exemptions.mjs` drops an entry the moment ' +
                    '`<pkg>/<gjsify.prebuilds>/<target>/` appears, which is what stops an honest deferral from outliving its cause and ' +
                    'reddening `main` on the very run that resolves it — and a split bridge has no `gjsify.prebuilds` for it to look ' +
                    'under. Run `node scripts/generate-platform-packages.mjs --write`.',
            );
        }

        const optional = parent.manifest.optionalDependencies ?? {};
        for (const planned of parent.targets) {
            stats.targets++;
            if (planned.state === 'uncommitted') {
                stats.uncommitted++;
                notes.push(
                    `${parent.name}: \`${planned.target}\` packaged as \`${planned.name}\`, artifact deferred — ${planned.why}. ` +
                        'The exemption travels with the package, so `prebuild-artifacts` fails there the moment the directory appears.',
                );
                // NOT `continue`: an exempt target has a package like every other
                // declared target, and it is held to the same three checks below
                // (it exists, its files match the generator, the parent points at
                // it). Only the ARTIFACT is deferred, and that deferral is graded
                // by `prebuild-artifacts` against the child's inherited
                // `gjsify.platformsUncommitted`.
            }
            if (planned.state === 'missing-artifact') {
                failures.push(
                    `${parent.name} (${parent.path}): declares \`${planned.target}\` with no committed artifact and no ` +
                        '`gjsify.platformsUncommitted` exemption, so no platform package can be generated for it. ' +
                        '`prebuild-artifacts` reports the same gap with the command that fixes it.',
                );
                continue;
            }

            // ── the package itself ────────────────────────────────────────
            const child = ctx.get(planned.name);
            if (!child) {
                failures.push(
                    `${parent.name} (${parent.path}): declares \`${planned.target}\` but there is no \`${planned.name}\` package ` +
                        `(expected at \`${planned.rel}/\`). Every declared target needs one — run ` +
                        '`node scripts/generate-platform-packages.mjs --write`.',
                );
                continue;
            }
            stats.packages++;
            const expected = expectedFiles(parent, planned);
            for (const [file, want] of Object.entries(expected)) {
                const path = join(child.dir, file);
                const have = existsSync(path) ? readFileSync(path, 'utf8') : null;
                if (have === want) continue;
                failures.push(
                    `${planned.name} (${planned.rel}): \`${file}\` is not what the generator emits now` +
                        `${have === null ? ' (the file is missing)' : ''}. Every field in it is derived from ` +
                        `\`${parent.name}\` plus the target — a hand edit here is a value nothing keeps true. ` +
                        'Run `node scripts/generate-platform-packages.mjs --write`.' +
                        (have === null ? '' : `\n${firstDifference(have, want)}`),
                );
            }

            // ── ADR 0017 step 2: the entry, and its os/cpu ────────────────
            const range = optional[planned.name];
            if (range === undefined) {
                failures.push(
                    `${parent.name} (${parent.path}): \`${planned.name}\` exists but is not in \`optionalDependencies\`. ` +
                        'Without the entry no package manager ever installs it, and the bridge fails at run time looking ' +
                        'for a sibling that is not there — the hardest-to-diagnose shape ADR 0017 step 4 warns about.',
                );
            } else if (range !== planned.range) {
                failures.push(
                    `${parent.name} (${parent.path}): \`optionalDependencies["${planned.name}"]\` is \`${range}\`, expected ` +
                        `\`${planned.range}\`. ${
                            parent.isWorkspaceMember
                                ? 'The workspace protocol is what pins the published range to the EXACT sibling version at pack ' +
                                  'time, so a version bump cannot leave a 0.26.0 binary paired with a 0.27.0 bridge.'
                                : 'This package is not a workspace member (its own CI, its own carve-out), so `gjsify pack` cannot ' +
                                  'resolve a `workspace:` range for it and the literal version is the only pin available. It must be ' +
                                  'the parent version, and this check is what keeps a release bump from forgetting it.'
                        }`,
                );
            }
            const osCpu = osCpuForTarget(planned.target);
            const childOs = child.manifest.os;
            const childCpu = child.manifest.cpu;
            if (
                !osCpu ||
                !Array.isArray(childOs) ||
                !Array.isArray(childCpu) ||
                childOs.join() !== osCpu.os.join() ||
                childCpu.join() !== osCpu.cpu.join()
            ) {
                failures.push(
                    `${planned.name} (${planned.rel}): declares os=${JSON.stringify(childOs)} cpu=${JSON.stringify(childCpu)}, but its ` +
                        `target \`${planned.target}\` means os=${JSON.stringify(osCpu?.os)} cpu=${JSON.stringify(osCpu?.cpu)}. ` +
                        'ADR 0017 step 2 requires these to match the token: a mismatch installs the package on machines that ' +
                        'cannot load it and skips the machines that can, and neither shows up as an error.',
                );
            }
            const childTargets = child.manifest.gjsify?.platforms;
            if (!Array.isArray(childTargets) || childTargets.length !== 1 || childTargets[0] !== planned.target) {
                failures.push(
                    `${planned.name} (${planned.rel}): \`gjsify.platforms\` is ${JSON.stringify(childTargets)}, expected exactly ` +
                        `\`["${planned.target}"]\`. The one-element list is what puts this tarball under the \`prebuild-artifacts\` ` +
                        'contract (machine matches directory, typelib siblings staged, host dlopen) — see ADR 0017’s resolved ' +
                        'open question.',
                );
            }
        }

        // ── the parent's own post-split shape ─────────────────────────────
        if (Array.isArray(parent.manifest.files) && parent.manifest.files.includes('prebuilds')) {
            failures.push(
                `${parent.name} (${parent.path}): \`files\` still lists \`prebuilds\`, but the directory moved into the platform ` +
                    'packages. The whole saving of ADR 0017 is that this entry is gone; with it the tarball is unchanged.',
            );
        }
        for (const [key, value] of Object.entries(parent.manifest.scripts ?? {})) {
            if (typeof value === 'string' && value.includes('./prebuilds/')) {
                failures.push(
                    `${parent.name} (${parent.path}): script \`${key}\` still points at \`./prebuilds/…\`, a directory this package no ` +
                        'longer has. Point it at the platform package that now owns the artifacts ' +
                        `(\`../${basename(parent.dir)}-<target>/prebuilds/<target>\`).`,
                );
            }
        }
        // An optionalDependencies entry naming a platform package of THIS parent
        // that no declared target asks for: the reverse drift — a target dropped
        // from `gjsify.platforms` while its package (and its entry) stayed.
        const wanted = new Set(
            parent.targets.filter((t) => t.state === 'plan' || t.state === 'uncommitted').map((t) => t.name),
        );
        for (const name of Object.keys(parent.manifest.optionalDependencies ?? {})) {
            if (!name.startsWith(`${parent.name}-`)) continue;
            if (wanted.has(name)) continue;
            failures.push(
                `${parent.name} (${parent.path}): \`optionalDependencies["${name}"]\` names a platform package of this bridge, but ` +
                    `\`gjsify.platforms\` (${(parent.manifest.gjsify?.platforms ?? []).join(', ')}) does not ask for that target. ` +
                    'Either declare the target or delete the entry and the package — an installed artifact nothing promises is ' +
                    'exactly the drift ADR 0017 step 2 exists to prevent.',
            );
        }
    }

    return {
        failures,
        notes,
        stats,
        summary:
            `platform packages (ADR 0017): OK. ${stats.packages} per-target package(s) across ${stats.parents} native ` +
            `bridge(s) match what the generator emits, each with an \`optionalDependencies\` entry whose \`os\`/\`cpu\` match its ` +
            `token${
                stats.uncommitted > 0
                    ? `; ${stats.uncommitted} of them carry an inherited \`gjsify.platformsUncommitted\` exemption and ship no artifact yet (see notes)`
                    : ''
            }.`,
    };
}

/** The first differing line of two strings, so a mismatch names itself. */
export function firstDifference(have, want) {
    const a = have.split('\n');
    const b = want.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === b[i]) continue;
        return `    line ${i + 1}: have ${JSON.stringify(a[i] ?? null)}\n    line ${i + 1}: want ${JSON.stringify(b[i] ?? null)}`;
    }
    return '    (files differ only in trailing content)';
}

// ─── --write ────────────────────────────────────────────────────────────────

/** `git mv`, so the binaries' history follows them into their new package. */
function gitMv(from, to) {
    execFileSync('git', ['mv', relative(ROOT, from), relative(ROOT, to)], { cwd: ROOT, stdio: 'pipe' });
}

/**
 * Perform the split.
 *
 * @param {import('../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 * @param {string[]} only package names to narrow to, empty = all
 */
function write(ctx, only) {
    const { parents, notes } = planPlatformPackages(ctx);
    const actions = [];

    for (const parent of parents) {
        if (only.length > 0 && !only.includes(parent.name)) continue;
        /** @type {{name: string, range: string}[]} */ const optionalDeps = [];
        const movedTargets = [];

        for (const planned of parent.targets) {
            // `uncommitted` is written like any other target — see
            // `planPlatformPackages` for why an exempt target gets a package.
            // Only `missing-artifact` is skipped: there is nothing to package and
            // nothing to defer, and inventing a package for it would turn a gap
            // `prebuild-artifacts` catches into a published one.
            if (planned.state === 'missing-artifact') continue;
            optionalDeps.push({ name: planned.name, range: planned.range });
            // No empty `prebuilds/` for an exempt target: git cannot carry an
            // empty directory anyway, and its PRESENCE is precisely what
            // `prebuild-artifacts` reads as "the artifact landed, drop the
            // exemption".
            mkdirSync(planned.state === 'plan' ? join(planned.dir, 'prebuilds') : planned.dir, { recursive: true });

            const inParent = parent.prebuildDir ? join(parent.prebuildDir, planned.target) : null;
            const inChild = join(planned.dir, 'prebuilds', planned.target);
            if (inParent && existsSync(inParent) && !existsSync(inChild)) {
                gitMv(inParent, inChild);
                actions.push(`moved ${relative(ROOT, inParent)} → ${relative(ROOT, inChild)}`);
                movedTargets.push(planned.target);
            }

            for (const [file, content] of Object.entries(expectedFiles(parent, planned))) {
                const path = join(planned.dir, file);
                if (existsSync(path) && readFileSync(path, 'utf8') === content) continue;
                writeFileSync(path, content);
                actions.push(`${existsSync(path) ? 'updated' : 'wrote'} ${relative(ROOT, path)}`);
            }
        }

        if (optionalDeps.length === 0) continue;
        const patched = rewriteParentPrebuildPaths(
            patchedParentManifest(parent.manifest, optionalDeps),
            basename(parent.dir),
            parent.targets.map((t) => t.target),
        );
        const parentPath = join(parent.dir, 'package.json');
        const before = readFileSync(parentPath, 'utf8');
        const after = stringifyManifest(patched);
        if (before !== after) {
            writeFileSync(parentPath, after);
            actions.push(`patched ${relative(ROOT, parentPath)}`);
        }
        // The now-empty `prebuilds/` in the parent. Empty directories are not
        // tracked by git, so this is a working-tree tidy-up, not a commit —
        // but leaving it invites the next local build to stage into a directory
        // nothing ships.
        if (parent.prebuildDir && existsSync(parent.prebuildDir) && readdirSync(parent.prebuildDir).length === 0) {
            rmdirSync(parent.prebuildDir);
            actions.push(`removed empty ${relative(ROOT, parent.prebuildDir)}/`);
        }
    }

    for (const note of notes) console.log(`  · ${note}`);
    if (actions.length === 0) {
        console.log('generate-platform-packages --write: nothing to do (already split).');
        return;
    }
    for (const a of actions) console.log(`  ${a}`);
    console.log(
        `generate-platform-packages --write: ${actions.length} change(s). Re-run \`--check\` and \`node scripts/audit-runtimes.mjs --check\`.`,
    );
}

// ─── entry ──────────────────────────────────────────────────────────────────

const IS_ENTRY = Boolean(process.argv[1]) && resolve(process.argv[1]).endsWith('generate-platform-packages.mjs');

/** The context the generator and the rule both read. */
export function generatorContext(root = ROOT) {
    return createContext({
        root,
        // `packages/napi/*` and `packages/node-gi/*` are deliberately not
        // workspace members, yet `@gjsify/napi` is a native bridge with declared
        // platforms. Narrowing to the workspace globs would silently drop it.
        discoveryRoots: ['packages'],
    });
}

if (IS_ENTRY) {
    const argv = process.argv.slice(2);
    const WRITE = argv.includes('--write');
    const only = argv.flatMap((a, i) => (a === '--only' && argv[i + 1] ? [argv[i + 1]] : []));
    const unknown = argv.filter(
        (a, i) => a.startsWith('--') && !['--write', '--check', '--only'].includes(a) && argv[i - 1] !== '--only',
    );
    if (unknown.length > 0) {
        console.error(`generate-platform-packages: unknown argument(s) ${unknown.join(', ')}`);
        process.exit(2);
    }

    const ctx = generatorContext();
    if (WRITE) {
        write(ctx, only);
    } else {
        const { failures, notes, summary } = auditPlatformPackages(ctx);
        for (const note of notes) console.log(`  · ${note}`);
        if (failures.length === 0) {
            console.log(summary);
            process.exit(0);
        }
        console.error(`generate-platform-packages --check: ${failures.length} problem(s).\n`);
        for (const f of failures) console.error(`  ✗ ${f}\n`);
        console.error('Fix with `node scripts/generate-platform-packages.mjs --write` (see ADR 0017).');
        process.exit(1);
    }
}
