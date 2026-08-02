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
 *    library in the host format for that OS, and the GI typelib without which
 *    `GI_TYPELIB_PATH` resolves nothing.
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
 * The ESCAPE HATCH is `gjsify.platformsUncommitted`: a target → reason map for
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
import { join } from 'node:path';

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
 * @returns {{failures: string[], notes: string[], stats: object}}
 */
export function auditPrebuildArtifacts(nativePkgs) {
    /** @type {string[]} */ const failures = [];
    /** @type {string[]} */ const notes = [];
    const stats = { dirs: 0, packages: 0, loaded: 0, structuralOnly: 0, uncommitted: 0, hostSkipped: 0 };
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

            // ── Half 2a: structural loadability (any host, any target) ────
            let structurallySound = true;
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
                const ownLeaves = new Set([...present].filter((f) => f.endsWith(ext)));
                const blamesOwn = [...ownLeaves].some((f) => probe.detail?.includes(f));
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
    if (pythonUnavailable) {
        notes.push(
            'no `python3` on this host, so NO artifact was actually loaded — every committed prebuild was verified structurally only. The functional half runs wherever python3 exists (every CI runner, every Fedora/Debian developer machine).',
        );
    }
    return { failures, notes, stats };
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
            `(machine matches the directory, typelib-named libraries staged, self-relative sibling resolution recorded).`,
        `  functional load (env-free \`dlopen\`, proving the sibling hop for real): ${stats.loaded} librar(y|ies) on this host's own target \`${HOST_TARGET}\`` +
            `; ${stats.structuralOnly} director(y|ies) are for OTHER targets and CANNOT be loaded here — a cross-arch prebuild is verifiable only from its file headers, and this audit does not pretend otherwise.` +
            (stats.hostSkipped > 0 ? ` ${stats.hostSkipped} host-target load(s) skipped (see notes).` : ''),
    ];
    if (stats.uncommitted > 0) {
        lines.push(
            `  ${stats.uncommitted} declared target(s) are exempt via \`gjsify.platformsUncommitted\` — promised, but with no artifact committed here. Each states its own reason:`,
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
        const result = auditPrebuildArtifacts(nativePkgs);
        return {
            failures: result.failures,
            notes: result.notes,
            stats: result.stats,
            summary: renderPrebuildSummary(result),
            nativePkgs,
        };
    },
});
