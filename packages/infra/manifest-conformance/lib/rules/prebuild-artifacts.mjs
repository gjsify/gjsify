/**
 * Rule `prebuild-artifacts` — does the promised platform have a loadable body?
 *
 * The platform check that lives in `scripts/` compares three DECLARATIONS: the
 * package's promise (`gjsify.platforms`), the directory names it happens to
 * carry, and the targets a CI job produces. All three can agree while the
 * promise is empty — `@gjsify/oxfmt-native` declared `darwin-arm64` for weeks
 * with no artifact behind it and every one of those checks stayed green, because
 * a target with no `prebuilds/<t>/` directory is simply absent from the
 * "shipped" set it compares against.
 *
 * This rule closes that, in two halves. Only the first is obvious.
 *
 * 1. EXISTENCE — for every package that names a committed prebuild directory
 *    (`gjsify.prebuilds`), every declared target must have that directory,
 *    and the directory must hold the artifacts a consumer needs: a shared
 *    library in the host format for that OS, the GI typelib without which
 *    `GI_TYPELIB_PATH` resolves nothing, and the `.gir` the typelib was
 *    compiled from.
 *
 *    The `.gir` is the newest of the three and the only one that is NOT
 *    runtime-critical, so it says out loud what it is for. Nothing loads a
 *    `.gir`: girepository resolves the `.typelib`, and no path in
 *    `detectNativePackages()` / `buildNativeEnv()` ever opens one. What DOES
 *    read it is everything downstream of the committed artifact — the six
 *    bridges whose `build:gir-types` script points `ts-for-gir
 *    --girDirectories` straight at `<bridge>-linux-x64/prebuilds/linux-x64`,
 *    and the darwin verify step that asserts the recorded `shared-library`
 *    leaf by parsing the GIR. So a missing `.gir` does not break a consumer's
 *    `imports.gi.<Ns>`; it breaks regenerating that bridge's types from the
 *    artifact it ships, and it silently removes a verification input.
 *
 *    It is nevertheless a HARD failure rather than a note, for a reason that is
 *    about provenance: `stage-prebuild.mjs` matches artifacts by EXTENSION and
 *    `.gir` is in its list, so every directory the stager wrote has one. A
 *    committed directory without a `.gir` is therefore a directory some OTHER
 *    mechanism produced — which is exactly what happened, and what nothing
 *    reported: the pre-stager linux `cp` lists for `webgl` and `webrtc-native`
 *    omitted the `.gir` that the darwin lists copied, so ten of the sixty
 *    per-target directories carried a different file shape from the other
 *    fifty for their whole life. The old assertion was DARWIN-ONLY (a shell
 *    loop in `prebuilds.yml`'s macOS job), which is precisely why the ten
 *    linux directories were the ones that got away.
 *
 * 2. LOADABILITY — a directory that exists proves nothing. The macOS lesson
 *    (#832) was that a required job built two bridges for darwin-arm64 and
 *    only COPIED them; the bug that hid there for weeks was a missing sibling
 *    file that read exactly like a broken rpath. So every committed artifact
 *    is verified as far as this host allows:
 *
 *      • ALWAYS, on any host, for any target — STRUCTURAL: the image's own
 *        machine must match the directory it sits in; every `libgjsify*`
 *        sibling it records must be staged beside it and reachable through
 *        `@loader_path`/`$ORIGIN` (`../binary.mjs`, which parses Mach-O and ELF
 *        directly); and every library leaf the typelib names must be present,
 *        because that leaf is what GI hands to `dlopen` the moment a consumer
 *        resolves a class.
 *
 *      • ONLY for the host's own target — FUNCTIONAL: the library is actually
 *        `dlopen`ed, with every library-path environment variable stripped, so
 *        the self-relative sibling hop is proven rather than inferred.
 *
 *    A cross-arch prebuild CANNOT be loaded here and this rule does not
 *    pretend otherwise: it reports, per run, which targets got the functional
 *    probe and which got structure only. Being loud about the boundary is the
 *    point — a check that claims more than it did is worse than no check.
 *
 * 3. NOTHING UNEXPLAINED — the mirror of (1), and the half the write path needs
 *    most. `commit-prebuilds` extracts dozens of downloaded artifacts INTO the
 *    existing `prebuilds/<target>/` without clearing it, `git add` stages no
 *    deletions, and `sync-and-stage.sh` REFUSES a staged deletion on purpose:
 *    that refusal is the one guard stopping the job from unshipping a binary,
 *    so the directory is append-only by design. A library renamed in
 *    `meson.build` therefore lands beside its predecessor and
 *    `files: ["prebuilds"]` publishes both, indefinitely, with nothing saying
 *    so. A file earns its place four ways — it is the `.gir`, it is a
 *    `.typelib`, a typelib NAMES it, or another staged library records it as a
 *    dependency (which is what each Rust cdylib beside a Vala bridge is). That
 *    covers the tree with NO exception list: measured when this landed, two of
 *    the 206 committed files were unexplained, both `.gitkeep` left in a
 *    directory that had since filled with real artifacts, and both were deleted
 *    rather than exempted.
 *
 * The `.gir` half has its own escape, injected by the caller rather than
 * declared in a manifest (`girGaps`, from `ctx.options.prebuildGirGaps`): a
 * per-target-package → reason map for a directory that is known to be missing
 * its `.gir` and cannot be repaired by hand. It is modelled on
 * `platformsUncommitted` and on the unchecked-field ledger, and is awkward to
 * abuse in the same three ways — the reason is mandatory, every entry is
 * PRINTED on every run, and an entry becomes a FAILURE the moment its directory
 * DOES carry a `.gir` (or the package stops being audited at all), so it cannot
 * outlive its cause. It is a caller option and not a manifest field on purpose:
 * the affected manifests are GENERATED by
 * `scripts/generate-platform-packages.mjs` from derived fields only, so a new
 * hand-written key there would be a field the generator has to learn and then
 * keep forever, for a gap whose whole point is to disappear.
 *
 * NO CALLER INJECTS ONE TODAY, and the reason is the good one: the ledger module
 * `scripts/audit-runtimes.mjs` used to import drained to zero once all ten
 * directories received their `.gir` through `commit-prebuilds`, so it was
 * deleted. The option stays because it is the mechanism, not the ledger — it is
 * what a future gap would be recorded through, together with
 * `scripts/clear-satisfied-gir-gaps.mjs`, which auto-retires an entry whose file
 * arrives. Read the branch below as ARMED-BUT-UNFED rather than as live policy:
 * with `stage-prebuild.mjs` refusing to stage a `.typelib` with no `.gir` beside
 * it, the gap class is structurally closed and restaging is the answer.
 *
 * The cost of that choice, stated rather than discovered: a ledger the CALLER
 * injects is invisible to a portable run in someone else's tree, so while an
 * entry stands, a consumer-side check over the published tarball of that target
 * would report the gap the ledger defers. Accepted, because those tarballs
 * already ship without the `.gir` today (this rule did not change what is
 * published, only what is noticed), because the deferral is transient by
 * construction, and because no such consumer entry point exists yet. Should
 * `gjsify manifest-check` ship while an entry is still open, that is the moment
 * to move the deferral into the manifest — not before.
 *
 * The ESCAPE HATCH for the OS axis itself is `gjsify.platformsUncommitted`: a target → reason map for
 * a platform that is genuinely declared and genuinely built by CI, but whose
 * artifact this repo does not commit (today `@gjsify/napi`'s darwin-arm64,
 * which `napi.yml` builds, load-tests and uploads for a release to ship). It
 * makes an honest "promised, not committed here" statable in ONE place that
 * the audit reads, so the alternative — a silent gap — stops being available.
 * It is deliberately awkward to abuse: the reason is mandatory, the target
 * must already be in `gjsify.platforms`, and the entry becomes a FAILURE the
 * moment the directory does appear, so it cannot ossify past its usefulness.
 *
 * PORTABLE: everything above is manifest + filesystem + file headers. Nothing
 * here knows this repository's layout, package names or CI.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { defineRule } from '../registry.mjs';
import { checkPrebuildDir, readLibrary, readTypelibSharedLibraries } from '../binary.mjs';
import { canonicalPlatform, HOST_TARGET, LIB_EXT, PLATFORM_RE } from '../platforms.mjs';
import { prebuildOwnership } from '../platform-packages.mjs';

/**
 * Every package that carries a native build system or ships a prebuild
 * directory. These are the packages whose reach is bounded by what CI builds
 * — the ones `gjsify.platforms` applies to.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function collectNativePackages(ctx) {
    const out = [];
    for (const pkg of ctx.allPackages) {
        const hasMeson = existsSync(join(pkg.dir, 'meson.build'));
        const hasGyp = existsSync(join(pkg.dir, 'binding.gyp'));
        const prebuildField = pkg.gjsify.prebuilds;
        if (!hasMeson && !hasGyp && typeof prebuildField !== 'string') continue;
        const prebuildDir = join(pkg.dir, typeof prebuildField === 'string' ? prebuildField : 'prebuilds');
        let shipped = [];
        if (existsSync(prebuildDir)) {
            shipped = readdirSync(prebuildDir, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => e.name)
                .sort();
        }
        const declared = Array.isArray(pkg.gjsify.platforms) ? [...pkg.gjsify.platforms].sort() : null;
        out.push({
            name: pkg.manifest.name,
            // `pkg.rel`, not a fresh `relative()`: the context spells it with
            // forward slashes on every host, and this value is not only
            // displayed. `platforms-ci` credits a CI job with producing a
            // package when the step text CONTAINS either the package name or
            // this path (`step.includes(id.path_re)` — the `_re` suffix is a
            // misnomer, it is a plain substring test). Workflow YAML writes
            // `working-directory: packages/node-gi/node-gi`, so in the host
            // spelling `packages\node-gi\node-gi` simply never occurs and the
            // match silently fails. `@gjsify/node-gi`'s macOS legs identify
            // themselves by path ALONE, so on Windows its `darwin-x64` was
            // reported as a declared platform CI never builds.
            path: pkg.rel,
            tier: pkg.gjsify.tier,
            builder: hasGyp ? 'node-gyp' : 'meson',
            declared,
            shipped,
            // `gjsify.prebuilds` is what makes a package's artifacts THIS
            // repo's responsibility: it names the committed directory. A
            // native package without it (today `@gjsify/node-gi`, node-gyp)
            // builds its binary at install time or ships it straight from a
            // release artifact, so there is nothing here to hold to a
            // per-target existence contract.
            prebuildsField: typeof prebuildField === 'string' ? prebuildField : null,
            prebuildDir,
            // The escape hatch. Raw on purpose: its own shape is validated
            // below, so a malformed value produces a named failure rather than
            // a crash here.
            uncommitted: pkg.gjsify.platformsUncommitted ?? null,
        });
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return out;
}

/**
 * `dlopen` one library with every library-path variable stripped.
 *
 * Driven through `python3`'s `ctypes` — the same env-free probe the macOS
 * prebuild jobs use (#832), and the only dlopen available to a pure-Node
 * script with no addon of its own. Stripping the environment is the whole
 * point: `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH` from `buildNativeEnv()` only
 * has to find the bare leaf the typelib records, so the library's own hop to
 * its Rust cdylib sibling must need nothing at all.
 *
 * @param {string} file absolute path to the library
 * @returns {{status: 'loaded'|'unavailable'|'failed', detail?: string}}
 *   `unavailable` = no python3 on this host (nothing was tested).
 */
export function dlopenProbe(file) {
    const env = { ...process.env };
    for (const key of ['LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH']) delete env[key];
    const res = spawnSync('python3', ['-c', 'import ctypes,sys; ctypes.CDLL(sys.argv[1])', file], {
        env,
        encoding: 'utf8',
        timeout: 60_000,
    });
    if (res.error) return { status: 'unavailable', detail: String(res.error.message ?? res.error) };
    if (res.status === 0) return { status: 'loaded' };
    const detail = String(res.stderr ?? '')
        .trim()
        .split('\n')
        .filter((l) => !/^\s*(File "|  |Traceback)/.test(l))
        .join(' ')
        .trim();
    return { status: 'failed', detail: detail || `python3 exited ${res.status}` };
}

/**
 * Hold the existence + loadability invariant over every committed prebuild.
 *
 * Kept as a standalone export (rather than only reachable through the rule) so
 * the e2e suite can drive it against SYNTHETIC packages in a temp directory:
 * proving that a MISSING prebuild directory fails means removing one, and the
 * e2e suites run four-at-a-time against a single shared checkout.
 *
 * @param {Array<object>} nativePkgs rows from `collectNativePackages()`
 * @param {object} [opts]
 * @param {Record<string, string>} [opts.girGaps] package name → why its
 *   committed prebuild directory has no `.gir` yet. See the header.
 * @returns {{failures: string[], notes: string[], stats: object, girGapsUsed: Set<string>}}
 */
export function auditPrebuildArtifacts(nativePkgs, { girGaps = {} } = {}) {
    /** @type {string[]} */ const failures = [];
    /** @type {string[]} */ const notes = [];
    const stats = {
        dirs: 0,
        packages: 0,
        loaded: 0,
        structuralOnly: 0,
        uncommitted: 0,
        hostSkipped: 0,
        girDeferred: 0,
    };
    // Which ledger entries this run actually matched. The "stale entry" half of
    // the contract needs the WHOLE population to be sound, and this function is
    // also driven against single synthetic rows by the e2e suite — so it reports
    // what it consumed and leaves the comparison to the rule, which is the only
    // caller that sees every package.
    /** @type {Set<string>} */ const girGapsUsed = new Set();
    // Grouped by REASON for the same reason the `platformsUncommitted` notes are:
    // ten paraphrases of one cause bury the one entry that says something else.
    /** @type {Map<string, string[]>} reason → the directories deferred for it */
    const girDeferByReason = new Map();
    let pythonUnavailable = false;

    for (const pkg of nativePkgs) {
        if (!pkg.declared) continue; // already a failure in the platform rule
        const declaredCanon = pkg.declared.map(canonicalPlatform);

        // ── The escape hatch, validated before it is honoured ──────────────
        const uncommitted = new Set();
        /** @type {Map<string, string[]>} reason → the targets deferred for it */
        const exemptByReason = new Map();
        if (pkg.uncommitted != null) {
            const isPlainObject =
                typeof pkg.uncommitted === 'object' && !Array.isArray(pkg.uncommitted) && pkg.uncommitted !== null;
            if (!isPlainObject) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` must be an object mapping each not-committed \`<os>-<arch>\` target to the REASON it is not committed, e.g. {"darwin-arm64": "built + load-tested by napi.yml; a release ships it from the uploaded artifact"}.`,
                );
            } else if (prebuildOwnership(pkg) === 'install-time') {
                // NOT keyed on `gjsify.prebuilds` any more, and the distinction
                // is load-bearing since ADR 0017. A SPLIT bridge has no prebuild
                // directory of its own — its artifacts live in per-target
                // packages — but it is still very much under the
                // committed-artifact contract, held there by the
                // `platform-packages` rule. Keying the refusal on the absent
                // field would have made "declared, deliberately not committed"
                // unstatable for exactly the packages that need it (today
                // `@gjsify/napi`'s darwin-arm64), forcing the honest note out of
                // the one place the audit reads it. What genuinely is out of
                // scope is a package whose binary is BUILT AT INSTALL TIME
                // (`@gjsify/node-gi`, node-gyp): nothing here is ever committed
                // for it, so an exemption from committing describes nothing.
                failures.push(
                    `${pkg.name} (${pkg.path}): declares \`gjsify.platformsUncommitted\` but builds its binary at install time (node-gyp, no committed prebuild directory and no per-target platform packages) — the field exempts a target from the committed-artifact contract, and this package is not under that contract at all. Remove it.`,
                );
            } else {
                for (const [target, reason] of Object.entries(pkg.uncommitted)) {
                    if (!PLATFORM_RE.test(target)) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` key \`${target}\` is not a valid \`\${process.platform}-\${process.arch}\` target.`,
                        );
                        continue;
                    }
                    if (typeof reason !== 'string' || reason.trim() === '') {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted["${target}"]\` needs a non-empty reason. An unexplained exemption is the silent gap this field exists to replace.`,
                        );
                        continue;
                    }
                    if (!declaredCanon.includes(canonicalPlatform(target))) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` exempts \`${target}\`, which \`gjsify.platforms\` (${pkg.declared.join(', ')}) does not declare — you can only defer shipping something you promise. Add it to \`platforms\` or drop the exemption.`,
                        );
                        continue;
                    }
                    if (pkg.shipped.some((s) => canonicalPlatform(s) === canonicalPlatform(target))) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` still exempts \`${target}\`, but \`${pkg.prebuildsField}/${target}/\` IS committed now. Delete the exemption so the artifact is held to the full contract.`,
                        );
                        continue;
                    }
                    uncommitted.add(canonicalPlatform(target));
                    stats.uncommitted++;
                    exemptByReason.set(reason.trim(), [...(exemptByReason.get(reason.trim()) ?? []), target]);
                }
                // One note per REASON, not per target: the packages that defer
                // a whole emulated matrix defer it for one cause, and 24
                // identical lines bury the one entry that says something else.
                for (const [reason, targets] of exemptByReason) {
                    notes.push(`${pkg.name}: \`${targets.join('`, `')}\` declared but not committed — ${reason}`);
                }
            }
        }

        // A package that does not name a committed prebuild directory
        // (`@gjsify/node-gi`: node-gyp, built on install / shipped from a
        // release artifact) is out of scope for everything below.
        if (!pkg.prebuildsField) continue;
        stats.packages++;

        for (const target of pkg.declared) {
            const canon = canonicalPlatform(target);
            if (uncommitted.has(canon)) continue;
            const [os, arch] = canon.split('-');
            const dir = join(pkg.prebuildDir, target);

            // ── Half 1: existence ─────────────────────────────────────────
            if (!existsSync(dir)) {
                failures.push(
                    `${pkg.name} (${pkg.path}): declares \`${target}\` but ships no \`${pkg.prebuildsField}/${target}/\` — a promised platform with no artifact behind it. Either commit the prebuild (\`gjsify workspace ${pkg.name} build:prebuilds\` on that target, or the workflow that produces it), or record the gap honestly in \`gjsify.platformsUncommitted\` with the reason.`,
                );
                continue;
            }
            stats.dirs++;
            const files = readdirSync(dir);
            const ext = LIB_EXT[os];
            const libs = files.filter((f) => f.endsWith(ext));
            const typelibs = files.filter((f) => f.endsWith('.typelib'));
            if (libs.length === 0) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` holds no \`${ext}\` — a ${os} consumer has nothing to load (present: ${files.join(', ') || 'nothing'}).`,
                );
                continue;
            }
            if (typelibs.length === 0) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` holds no \`.typelib\` — every package under this contract is a GI bridge reached through \`GI_TYPELIB_PATH\`, so a shared library alone is unreachable (present: ${files.join(', ')}).`,
                );
                continue;
            }
            // The `.gir` the typelib was compiled from. PLATFORM-AGNOSTIC on
            // purpose: the assertion that existed before this one was a shell
            // loop in `prebuilds.yml`'s macOS job, so it held for the 16 darwin
            // directories and for none of the other 44 — which is exactly why the
            // ten that were missing a `.gir` were all linux.
            // Deliberately checked per DIRECTORY rather than per package: the
            // shape that went wrong was one bridge shipping two different file
            // sets, so a package-level "has a gir somewhere" would have passed it.
            const girs = files.filter((f) => f.endsWith('.gir'));
            if (girs.length === 0) {
                const reason = girGaps[pkg.name];
                if (typeof reason === 'string' && reason.trim() !== '') {
                    girGapsUsed.add(pkg.name);
                    stats.girDeferred++;
                    const key = reason.trim();
                    girDeferByReason.set(key, [...(girDeferByReason.get(key) ?? []), `${pkg.name} (${target})`]);
                } else if (pkg.name in girGaps) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): listed in the missing-\`.gir\` ledger with no reason. An unexplained deferral is the silent gap the ledger exists to replace — write one sentence saying why the file is not there and what will put it there.`,
                    );
                } else {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` holds no \`.gir\` (present: ${files.join(', ')}). Nothing LOADS a \`.gir\` — girepository resolves the \`.typelib\` — so this is not a broken runtime; what it breaks is everything downstream of the committed artifact: \`ts-for-gir --girDirectories\` regenerating this bridge's types from the directory it ships (six bridges' \`build:gir-types\` scripts point at exactly this path), and the GIR-parsing \`shared-library\`-leaf assertion. It is a hard failure because \`scripts/stage-prebuild.mjs\` matches \`.gir\` by extension: every directory the shared stager wrote has one, so a directory without one was produced by something else, and the pre-stager \`cp\` lists that omitted it are the reason ten of sixty directories had a different file shape from the other fifty. Fix by letting \`prebuilds.yml\` restage this target: the stager copies the \`.gir\` with no change needed, and it now REFUSES to stage a \`.typelib\` without one, so restaging is the whole answer. Deferring is still EXPRESSIBLE — the caller may inject a package → reason map as \`prebuildGirGaps\` — but nothing feeds one today, because the ledger module that did drained to zero and was deleted. Recreate it only for a directory that genuinely cannot be restaged.`,
                    );
                }
            }

            // ── Half 2a: structural loadability (any host, any target) ────
            let structurallySound = true;
            // Every dependency leaf any staged library records, for the
            // nothing-unexplained check below. Collected here rather than in a
            // second pass because `readLibrary` has already parsed the file.
            /** @type {Set<string>} */ const neededLeaves = new Set();
            for (const lib of libs.sort()) {
                const path = join(dir, lib);
                let info = null;
                try {
                    info = readLibrary(path);
                } catch (err) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${lib}\` is not a readable shared library — ${err instanceof Error ? err.message : String(err)}.`,
                    );
                    structurallySound = false;
                    continue;
                }
                if (!info) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${lib}\` has a \`${ext}\` name but is neither ELF, Mach-O nor PE — a stray or truncated file in a prebuild directory is what a consumer will try to load.`,
                    );
                    structurallySound = false;
                    continue;
                }
                for (const dep of info.needed) neededLeaves.add(basename(dep));
                if (info.os !== os || (info.arch !== null && info.arch !== arch)) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${lib}\` is a ${info.os}/${info.arch ?? 'unknown'} image in a \`${target}\` directory — it can never load on the platform it is published for. This is the one prebuild defect a cross-arch target CAN be caught for from any host, because the machine is in the file header; a build that silently ran on the runner's own architecture instead of the emulated one produces exactly this.`,
                    );
                    structurallySound = false;
                }
            }
            const loaderProblems = checkPrebuildDir(dir, { verbose: false });
            if (loaderProblems.length > 0) {
                structurallySound = false;
                for (const p of loaderProblems) failures.push(`${pkg.name} (${pkg.path}): ${p}`);
            }
            // The leaf GI itself will ask the loader for.
            const present = new Set(files);
            /** @type {Set<string>} */ const recorded = new Set();
            for (const tl of typelibs) {
                let leaves = null;
                try {
                    leaves = readTypelibSharedLibraries(join(dir, tl));
                } catch (err) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${tl}\` is not a readable typelib — ${err instanceof Error ? err.message : String(err)}.`,
                    );
                    structurallySound = false;
                    continue;
                }
                if (leaves === null) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${tl}\` does not carry the GI typelib magic — it is not a typelib, whatever its name says.`,
                    );
                    structurallySound = false;
                    continue;
                }
                for (const leaf of leaves) {
                    recorded.add(leaf);
                    if (!present.has(leaf)) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${tl}\` records shared library \`${leaf}\`, which is NOT staged in that directory (present: ${files.join(', ')}). GI hands that exact leaf to the loader as soon as a consumer resolves a class in the namespace, so the typelib resolves and the class access throws.`,
                        );
                        structurallySound = false;
                    }
                }
            }

            // ── Half 1b: nothing unexplained ──────────────────────────────
            // Every check above asks whether a file that SHOULD be here is. The
            // opposite question had no owner, and the write path is built to
            // accumulate: `commit-prebuilds` runs dozens of `download-artifact`
            // steps that extract INTO the existing `prebuilds/<target>/` without
            // clearing it, `git add` only ever adds, and `sync-and-stage.sh`
            // refuses staged DELETIONS by design (that refusal is the one guard
            // stopping the job from unshipping a binary, so it must stay). A
            // library renamed in `meson.build` therefore lands beside its
            // predecessor, and `files: ["prebuilds"]` publishes both. Nothing
            // anywhere said so.
            //
            // Four ways a file earns its place, and they cover the tree with no
            // exception list: it is the `.gir`, it is a `.typelib`, a typelib
            // NAMES it, or another staged library records it as a dependency
            // (which is what the Rust cdylibs beside each Vala bridge are).
            // Measured across every committed directory when this landed: two
            // files were unexplained, both `.gitkeep` left behind in a directory
            // that had since filled with real artifacts — deleted in the same
            // change rather than exempted, which is what an exception list would
            // have made permanent.
            for (const file of files.sort()) {
                if (file.endsWith('.gir') || file.endsWith('.typelib')) continue;
                if (recorded.has(file) || neededLeaves.has(file)) continue;
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${file}\` is in a committed prebuild directory and nothing explains it — no typelib records it, no staged library needs it, and it is neither the \`.gir\` nor a \`.typelib\`. This directory is only ever ADDED to (the downloads extract into it, \`git add\` stages no deletions, and the staging script refuses them), so a renamed or dropped library stays here forever and \`files: ["prebuilds"]\` keeps publishing it. If it is dead, delete it in this change; if a consumer really needs it, make the typelib or a sibling library record it so the next rename takes it along.`,
                );
                structurallySound = false;
            }

            // ── Half 2b: functional loadability (host target only) ────────
            if (canon !== HOST_TARGET) {
                stats.structuralOnly++;
                continue;
            }
            if (!structurallySound) {
                // Loading a directory already known to be malformed adds a
                // second, derivative error message and no information.
                stats.hostSkipped++;
                continue;
            }
            for (const leaf of [...recorded].sort()) {
                const probe = dlopenProbe(join(dir, leaf));
                if (probe.status === 'loaded') {
                    stats.loaded++;
                    continue;
                }
                if (probe.status === 'unavailable') {
                    pythonUnavailable = true;
                    stats.hostSkipped++;
                    continue;
                }
                // A dependency of OUR OWN is a defect in the prebuild. A
                // third-party one the host does not have is a fact about the
                // host — this audit runs on a bare Node runner that has glib
                // but not libsoup/GStreamer/libgda, and failing there would
                // make the guard report the runner's package list rather than
                // anything about the artifact.
                //
                // Match on the UNRESOLVED object only. dyld names BOTH the
                // library it opened and the one it could not find:
                //
                //   dlopen(…/prebuilds/darwin-arm64/libgjsifyhttpsoupbridge.dylib, 0x0006):
                //     Library not loaded: /opt/homebrew/opt/libsoup/lib/libsoup-3.0.0.dylib
                //
                // so a raw substring test finds the probed leaf in its own error
                // and blames the artifact for existing. glibc names only the
                // missing library, which is why Linux never saw this and why
                // the first macOS run of this audit reported all three darwin
                // prebuilds as staging defects — for Homebrew libraries none of
                // them stages and the runner does not install. Dropping the
                // probed path first leaves exactly the dependency, so a real
                // sibling-resolution defect (an unresolved `libgjsify*` that IS
                // staged beside it) still fails as before.
                const ownLeaves = new Set([...present].filter((f) => f.endsWith(ext)));
                const unresolved = (probe.detail ?? '').split(join(dir, leaf)).join('');
                const blamesOwn = [...ownLeaves].some((f) => unresolved.includes(f));
                if (blamesOwn) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${leaf}\` fails to load on this host with no library-path variable set — ${probe.detail}. The unresolved object is one this package stages itself, so the prebuild cannot resolve its own siblings from its own directory (\`$ORIGIN\`/\`@loader_path\`).`,
                    );
                    stats.hostSkipped++;
                } else {
                    stats.hostSkipped++;
                    notes.push(
                        `${pkg.name}: \`${target}/${leaf}\` not load-tested — this host lacks a system dependency it links against (${probe.detail}). Structure was verified; the functional load was not.`,
                    );
                }
            }
        }
    }
    for (const [reason, dirs] of girDeferByReason) {
        notes.push(`no \`.gir\` in ${dirs.join(', ')} — ${reason}`);
    }
    if (pythonUnavailable) {
        notes.push(
            'no `python3` on this host, so NO artifact was actually loaded — every committed prebuild was verified structurally only. The functional half runs wherever python3 exists (every CI runner, every Fedora/Debian developer machine).',
        );
    }
    return { failures, notes, stats, girGapsUsed };
}

/**
 * What the prebuild audit actually verified, and — the load-bearing half —
 * what it did NOT.
 *
 * Printed on success as well as failure, on purpose. "Structure verified on
 * 47 directories, 11 of them actually loaded" is a different claim from "47
 * prebuilds work", and a reader who is never told the difference will assume
 * the second one. The cross-arch boundary is not an apology, it is the result.
 *
 * @param {{failures: string[], notes: string[], stats: object}} result
 */
export function renderPrebuildSummary({ notes, stats }) {
    const lines = [
        `prebuild-artifact audit: ${stats.dirs} committed prebuild director(y|ies) across ${stats.packages} package(s) verified STRUCTURALLY ` +
            `(machine matches the directory, library + typelib + \`.gir\` present, typelib-named libraries staged, self-relative sibling resolution recorded, nothing unexplained).`,
        `  functional load (env-free \`dlopen\`, proving the sibling hop for real): ${stats.loaded} librar(y|ies) on this host's own target \`${HOST_TARGET}\`` +
            `; ${stats.structuralOnly} director(y|ies) are for OTHER targets and CANNOT be loaded here — a cross-arch prebuild is verifiable only from its file headers, and this audit does not pretend otherwise.` +
            (stats.hostSkipped > 0 ? ` ${stats.hostSkipped} host-target load(s) skipped (see notes).` : ''),
    ];
    if (stats.uncommitted > 0) {
        lines.push(
            `  ${stats.uncommitted} declared target(s) are exempt via \`gjsify.platformsUncommitted\` — promised, but with no artifact committed here. Each states its own reason:`,
        );
    }
    if (stats.girDeferred > 0) {
        lines.push(
            `  ${stats.girDeferred} committed director(y|ies) are missing their \`.gir\` under a caller-injected \`prebuildGirGaps\` entry — each states its own reason, and each becomes a FAILURE the moment the file lands:`,
        );
    }
    for (const n of notes) lines.push(`  · ${n}`);
    return lines.join('\n');
}

export const prebuildArtifactsRule = defineRule({
    id: 'prebuild-artifacts',
    scope: 'portable',
    fields: ['gjsify.prebuilds', 'gjsify.platforms', 'gjsify.platformsUncommitted'],
    description:
        'every declared `<os>-<arch>` target has a committed, structurally loadable library + typelib behind it',
    run(ctx) {
        const nativePkgs = collectNativePackages(ctx);
        /** @type {Record<string, string>} */
        const girGaps = ctx.options?.prebuildGirGaps ?? {};
        const result = auditPrebuildArtifacts(nativePkgs, { girGaps });
        const failures = [...result.failures];
        // The other direction of the ledger contract, and the only place it can
        // be checked: this is the caller that sees every package, so an entry
        // nothing matched is an entry that has outlived its cause — either the
        // `.gir` landed (which is the whole point of the deferral) or the
        // package it names is gone. Both make the ledger misinformation.
        for (const name of Object.keys(girGaps)) {
            if (result.girGapsUsed.has(name)) continue;
            failures.push(
                `the missing-\`.gir\` ledger defers \`${name}\`, but nothing in this tree matched it — either its committed prebuild directory now HAS a \`.gir\` (delete the entry; that is what the deferral was waiting for) or no audited package carries that name any more. A ledger describing a gap that is closed tells the next reader something false.`,
            );
        }
        return {
            failures,
            notes: result.notes,
            stats: result.stats,
            summary: renderPrebuildSummary(result),
            nativePkgs,
        };
    },
});
