/**
 * Rule `bundle-search-paths` — no image in a runtime bundle may search for a
 * library OUTSIDE the bundle.
 *
 * THE DEFECT (#1536). `@gjsify/gtk-runtime-darwin-x64` ships `libgstsoup.dylib`
 * and it ships `libsoup-3.0.0.dylib`, and on a Homebrew Mac the first one loads
 * the SYSTEM's copy of the second. The plugin does not link libsoup — since 1.18
 * it reaches it through its own loader shim with `g_module_open` by BARE LEAF —
 * so its `LC_LOAD_DYLIB` list is innocent and every existing gate reads clean.
 * What it carries instead is a single `LC_RPATH` naming Homebrew's libsoup keg.
 * Homebrew's libsoup then arrives with Homebrew's glib family in its own link
 * closure, and a process that already loaded the bundle's has TWO GObject type
 * registries — ADR 0023 § 4's invariant, whose symptom is `g_type_name()`
 * answering with GObject's internal qdata quark strings where a class name
 * belongs, and an `https://` stream that fails silently while a bundled file
 * plays.
 *
 * WHY A COUNT OR A FILE LIST CANNOT SEE IT. The bundle passes its "is
 * `souphttpsrc` there" gate — that gate is why this looked fixed. The file IS
 * shipped. The question nobody asked is WHICH libsoup answers, and that is a
 * property of the load commands rather than of the payload's contents.
 *
 * WHAT THIS RULE CAN AND CANNOT SAY — the line matters, and it is the same one
 * `media-capabilities` draws between a plugin FILE and a registry ENTRY.
 *
 *   • A LOAD COMMAND is a fact about the artifact. Any host reads it: these
 *     assertions were written on Linux against a published darwin tarball, which
 *     is the evidence separation ADR 0024 § A3 turns into a required field. That
 *     half is checked HERE.
 *   • WHETHER THE PROCESS ACTUALLY LOADS ONE COPY is not. That is a property of
 *     the loader on the target OS, and no host can answer it about a foreign
 *     one. `DYLD_PRINT_SEARCHING` on a macOS host is where ADR 0057 puts that
 *     question, and it is what established the load-command half is worth
 *     asserting: dyld expands a bare leaf against the calling image's `LC_RPATH`
 *     — its own phrase is `leaf name using rpath` — and reaches it BEFORE the
 *     default fallback, which for a leaf `dlopen` is `/usr/lib` alone.
 *
 * That measurement is what makes this rule's direction load-bearing rather than
 * merely tidy: for the defect it was written on, the image's own search path was
 * not one route among several but the ONLY one. A clean image is still a
 * necessary condition rather than a sufficient one — a payload can be
 * load-command-perfect and broken for reasons no load command records — but an
 * artifact that offers no route out cannot take one.
 *
 * PORTABLE, because it reads only the manifest and files on disk, and because
 * the two predicates it needs are already derived rather than listed —
 * `isBuildHostAbsolutePath` catches MacPorts, a custom `HOMEBREW_PREFIX` and a
 * home directory without anyone having to think of them first.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isBuildHostAbsolutePath, readLibrary } from '../binary.mjs';
import { defineRule } from '../registry.mjs';

/**
 * The payload directory whose presence in `files` makes a package a runtime
 * bundle. A NAME rather than a package list, on `bundled-license`'s precedent: a
 * fourth bundle is caught the day it is added, not the day somebody remembers to
 * extend a set.
 */
const PAYLOAD_DIR = 'gtk';

/**
 * A search path that resolves INSIDE the image's own tree.
 *
 * The three `@`-tokens are relative BY CONSTRUCTION — dyld expands them against
 * the loading image, the main executable and the rpath stack — so none of them
 * can leave the bundle no matter what follows. Everything else is either a
 * system root or a fact about the machine that ran the linker.
 *
 * @param {string} rpath
 */
function isSelfRelative(rpath) {
    return rpath.startsWith('@');
}

/** Does this `files` list ship the payload directory itself? */
function shipsPayload(files) {
    return files.some((f) => String(f).replace(/\/+$/, '') === PAYLOAD_DIR);
}

/**
 * Every package this rule answers for: one whose `files` ship a `gtk/` payload.
 *
 * `files` and not the filesystem, for `bundled-license`'s reason: the payload is
 * gitignored and assembled on a runner, so the directory is absent in a checkout
 * and present in the tarball — and it is the TARBALL whose load commands decide
 * what a user's loader does. Whether the payload happens to be reachable HERE is
 * a separate question, asked per package below and reported either way.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function collectRuntimeBundles(ctx) {
    const out = [];
    for (const pkg of ctx.allPackages) {
        const files = Array.isArray(pkg.manifest.files) ? pkg.manifest.files : [];
        if (!shipsPayload(files)) continue;
        out.push({ name: pkg.manifest.name ?? pkg.rel, path: pkg.rel, dir: pkg.dir, files });
    }
    return out;
}

/**
 * Every regular file under `dir`, recursively. `null` when `dir` is not here.
 *
 * ABSENCE IS ANSWERED BY `existsSync` AND NOTHING ELSE, and the first draft of
 * this function got it wrong in the direction that matters. It wrapped the walk
 * in a `try/catch` returning `null`, which conflates "there is no payload here"
 * — the ordinary state of a checkout — with "the payload could not be read".
 * The GJS leg of this rule's own suite is what found it: `readdirSync` behaved
 * differently there, the catch swallowed it, and the rule reported a bundle it
 * had never opened as NOT INSPECTED. That is the failure this whole file exists
 * against, one level up, so a read that goes wrong THROWS and the registry turns
 * it into a rule failure with the stack attached.
 *
 * `statSync` is not consulted either: a `gtk` that exists and is not a directory
 * makes `readdirSync` throw, which is the honest answer rather than a silent
 * "no payload".
 */
function filesUnder(dir) {
    if (!existsSync(dir)) return null;
    const out = [];
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...(filesUnder(p) ?? []));
        else out.push(p);
    }
    return out;
}

/**
 * Hold every Mach-O image in a payload against the two ways it can reach out of
 * the bundle.
 *
 * @param {string} root the directory the payload's `gtk/` sits in
 * @returns {{images: number, findings: {file: string, kind: 'escape'|'unresolvable', detail: string[]}[]} | null}
 */
export function auditPayloadSearchPaths(root) {
    const files = filesUnder(join(root, PAYLOAD_DIR));
    if (files === null) return null;
    let images = 0;
    const findings = [];
    for (const file of files) {
        /** @type {import('../binary.mjs').LibInfo} */
        let info;
        try {
            info = readLibrary(file);
        } catch {
            // Every payload carries icons, schemas, locale data and typelibs.
            // A file this parser cannot read is data, not a defective image —
            // and a fat Mach-O, which it refuses BY DESIGN, is reported by the
            // readers that own that question rather than smuggled in here.
            continue;
        }
        if (!info || info.format !== 'macho') continue;
        images++;
        const rel = file.slice(root.length + 1);

        // ── the route out ────────────────────────────────────────────────────
        const escapes = info.searchPaths.filter(isBuildHostAbsolutePath);
        if (escapes.length > 0) findings.push({ file: rel, kind: 'escape', detail: escapes });

        // ── and the route that leads nowhere ─────────────────────────────────
        //
        // The complementary half, and it exists because the fix for the first
        // half is a full-list REPLACE: an image whose dependencies are written
        // `@rpath/<leaf>` needs a search path to resolve them, and stripping its
        // rpaths would turn a bundle that loads the wrong library into one that
        // loads none. Failing both directions is what keeps the repair from
        // being an over-correction nobody measured.
        const rpathDeps = info.needed.filter((d) => d.startsWith('@rpath/'));
        if (rpathDeps.length > 0 && !info.searchPaths.some(isSelfRelative)) {
            findings.push({ file: rel, kind: 'unresolvable', detail: rpathDeps });
        }
    }
    return { images, findings };
}

/**
 * @param {ReturnType<typeof collectRuntimeBundles>} bundles
 * @param {{payloads?: Record<string, string>}} [options] package name → a
 *   directory standing in for the package ROOT, so a bundle STAGED from npm is
 *   auditable and not only one a builder just wrote into its own tree.
 */
export function auditRuntimeBundles(bundles, options = {}) {
    const failures = [];
    const notes = [];
    const payloads = options.payloads ?? {};
    let inspected = 0;
    let images = 0;

    for (const bundle of bundles) {
        const override = payloads[bundle.name];
        const root = override === undefined ? bundle.dir : resolve(override);
        const audit = auditPayloadSearchPaths(root);
        if (audit === null) {
            notes.push(
                `${bundle.name}: payload NOT INSPECTED — ${join(root, PAYLOAD_DIR)} is not here. The payload is ` +
                    'gitignored and assembled on a runner, so this is the ordinary state of a checkout; point the ' +
                    'audit at a built or staged bundle to close it.',
            );
            continue;
        }
        inspected++;
        images += audit.images;
        if (audit.images === 0) {
            failures.push(
                `${bundle.name} (${bundle.path}): ${join(root, PAYLOAD_DIR)} exists and holds no Mach-O image at ` +
                    'all. An empty payload satisfies every count-shaped gate and loads nothing.',
            );
            continue;
        }

        for (const finding of audit.findings) {
            if (finding.kind === 'escape') {
                failures.push(
                    `${bundle.name} (${bundle.path}): \`${finding.file}\` carries a search path that leaves the ` +
                        `bundle — ${finding.detail.join(', ')}. Inside a runtime bundle this is not a fallback: it ` +
                        'is a SECOND source for a library the payload already ships, and for a type-registering ' +
                        'library a second copy is two GObject type registries in one process (ADR 0023 § 4), whose ' +
                        'symptom is a property or signal missing from an object that plainly has it. Replace the ' +
                        "image's whole rpath list at relocation time: a payload-relative entry where it resolves " +
                        'something (a plugin reaching a sibling by leaf name needs one), none where it does not. ' +
                        'See ADR 0057 § 1.',
                );
            } else {
                failures.push(
                    `${bundle.name} (${bundle.path}): \`${finding.file}\` depends on ${finding.detail.join(', ')} ` +
                        'and carries no `@loader_path`/`@executable_path` search path to resolve it. dyld has ' +
                        'nowhere to look, so this fails at load with "Library not loaded" on every host — ' +
                        'including the one that built it. Give the image the payload-relative rpath its ' +
                        'dependencies are written against.',
                );
            }
        }

        notes.push(
            `${bundle.name}: payload inspected — ${audit.images} Mach-O image(s), ${audit.findings.length} ` +
                'finding(s). Load commands only: whether the running process ends up with ONE copy of each library ' +
                'is a question for the loader on the target OS, which `DYLD_PRINT_SEARCHING` answers there and this ' +
                'rule does not ask (ADR 0057).',
        );
    }

    return { failures, notes, stats: { bundles: bundles.length, inspected, images } };
}

export const bundleSearchPathsRule = defineRule({
    id: 'bundle-search-paths',
    scope: 'portable',
    fields: ['files'],
    description: "no image in a runtime bundle's payload searches for a library outside the bundle",
    run(ctx) {
        const bundles = collectRuntimeBundles(ctx);
        const result = auditRuntimeBundles(bundles, { payloads: ctx.options?.bundlePayloads ?? {} });
        return {
            failures: result.failures,
            notes: result.notes,
            stats: result.stats,
            summary:
                bundles.length === 0
                    ? 'bundle-search-paths: no package ships a runtime payload'
                    : `bundle-search-paths: ${bundles.length} bundle(s) — ${result.stats.inspected} payload(s) ` +
                      `inspected here, ${result.stats.images} Mach-O image(s) read`,
        };
    },
});
