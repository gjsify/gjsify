#!/usr/bin/env node
// Decode an icon the bundle has just shipped, using the bundle's OWN GTK stack, and
// record the measured pixel dimensions so the release gate can assert a DECODE rather
// than a file count.
//
// WHY THIS EXISTS (#996). `windowingData.verified` records how many files each declared
// data set contains, and the gate passed on `files > 0`. Measured on the published
// darwin-x64 0.28.0 bundle: `iconFiles: 860`, `verified icons: 863`, and ZERO of those
// files decode — `Pixbuf.new_from_file()` on the bundle's own Adwaita SVG returned
// −1×−1. A count of files is not a capability, and the gate could not see the
// difference. Same class ADR 0018 names: do not let a file count stand in for a load.
//
// The gate is deliberately a pure MANIFEST READER ("the build log is not shipped"), so
// the decode has to happen where the target platform is — in the builder — and travel
// to the gate as a RECORD. `decodeProbeProblems()` below is that record's one
// definition of "passed", imported by BOTH the builder (which fails the build) and
// verify-bundle-manifest.mjs (which fails the publish), so the two cannot drift.
//
// The record carries `Pixbuf.get_formats()` too, but nothing asserts it: on win32 that
// list contained `svg` while every svg decode failed. It is context for a human reading
// a failure, never the check.
//
// Two things the record must prove BESIDES the pixel sizes, because the builder runs in
// a CI job that has the host GTK within reach: that the child did not inherit the job's
// GTK environment (`probeChildEnv`), and that the GTK which answered was the BUNDLE
// (`gtkSource` + `bundleIsProbeTarget`) — the host decoding a file that merely SITS at
// the bundle's path records a perfect pass.
//
// Usage (the builders spawn this as a CHILD process — on darwin activating a bundle
// re-execs the process, so the result is handed back through --json, not stdout):
//   node packages/node-gi/scripts/decode-probe.mjs --bundle <dir> --addon <node_gi.node>
//                                                  --json <out.json>

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** The node-gi package this probe loads the addon and the `gi://` bridge from. */
export const NODE_GI_ROOT = join(here, '..', 'node-gi');

/**
 * The two decodes the record must carry. SVG because the whole 0.28.0 darwin defect was
 * an icon theme of 715 SVGs with no working librsvg loader; PNG because it is the other
 * loader every GTK app reaches for, and because a bundle can lose one and keep the
 * other (win32 ships exactly ONE loader module, the svg one).
 */
export const PROBE_KINDS = ['svg', 'png'];

/**
 * Environment the probe child must NOT inherit. Every one of these lets the HOST's GTK
 * answer a question the BUNDLE was asked, and every one is set by something in this
 * repo: node-gi.yml's macOS legs export `DYLD_FALLBACK_LIBRARY_PATH=$BREW_PREFIX/lib`
 * BY HAND — the incident docs/node-gi-platform-notes.md records as "CI's own YAML was
 * the reason no test could catch it" — and `maybeWireGtkWindowingEnv()` sets the
 * GDK_PIXBUF / GSETTINGS / FONTCONFIG / GST variables only when they are UNSET, so an
 * inherited value beats the bundle's own data instead of being overridden by it.
 *
 * Scrubbed HERE and not per workflow: one place covers both builders, and a job that
 * re-adds an export as a convenience cannot silently re-open the hole. A bundle that
 * then fails to decode is reporting the defect this probe exists to find.
 */
export const HOST_GTK_ENV = [
    'DYLD_FALLBACK_LIBRARY_PATH',
    'DYLD_LIBRARY_PATH',
    'GI_TYPELIB_PATH',
    'GDK_PIXBUF_MODULE_FILE',
    'GDK_PIXBUF_MODULEDIR',
    'GSETTINGS_SCHEMA_DIR',
    'XDG_DATA_DIRS',
    'FONTCONFIG_PATH',
    'FONTCONFIG_FILE',
    'GST_PLUGIN_SYSTEM_PATH',
    'GST_PLUGIN_PATH',
    'GST_PLUGIN_SCANNER',
    'GIO_MODULE_DIR',
    'GIO_EXTRA_MODULES',
];

/** Is `dir` the prefix itself, or below it? Case- and separator-folded like the OS. */
function isUnderPrefix(dir, prefix, platform) {
    const norm = (p) => {
        const trimmed = p.replace(/[\\/]+$/, '');
        return platform === 'win32' ? trimmed.toLowerCase().split('/').join('\\') : trimmed;
    };
    const sep = platform === 'win32' ? '\\' : '/';
    const [a, b] = [norm(dir), norm(prefix)];
    return a === b || a.startsWith(b + sep);
}

/**
 * The environment for the probe child: `env` minus {@link HOST_GTK_ENV}, minus every
 * PATH entry at or below a build prefix.
 *
 * The PATH half is win32's version of the same hazard, and it is not hypothetical:
 * node-gi.yml's windowing-bundle job appends `<gvsbuild prefix>\bin` to GITHUB_PATH one
 * step before the build, and Windows resolves a DLL by SEARCH PATH — so a DLL missing
 * from the bundle loads from the prefix and the probe records a pass. It also makes the
 * PR leg and the release leg measure the same thing: only one of them has that PATH.
 *
 * PURE, and `platform` is a parameter rather than `process.platform`, so both OSes'
 * branches are executable from any host — the same rule `decideGtkSource()` follows.
 * @param {Record<string, string | undefined>} env
 * @param {{ hostPrefixes?: readonly string[], platform?: NodeJS.Platform | string }} [options]
 * @returns {Record<string, string | undefined>}
 */
export function probeChildEnv(env, { hostPrefixes = [], platform = process.platform } = {}) {
    const banned = new Set(HOST_GTK_ENV.map((name) => name.toLowerCase()));
    const scrubbed = {};
    for (const [name, value] of Object.entries(env)) {
        if (!banned.has(name.toLowerCase())) scrubbed[name] = value;
    }
    // Windows env names are case-insensitive and the OS spells this one `Path`.
    const pathKey = Object.keys(scrubbed).find((name) => name.toLowerCase() === 'path');
    const prefixes = hostPrefixes.filter(Boolean);
    if (!pathKey || prefixes.length === 0) return scrubbed;
    const listSep = platform === 'win32' ? ';' : ':';
    scrubbed[pathKey] = (scrubbed[pathKey] ?? '')
        .split(listSep)
        .filter((entry) => entry && !prefixes.some((prefix) => isUnderPrefix(entry, prefix, platform)))
        .join(listSep);
    return scrubbed;
}

/** Where the loader cache lives inside a bundle, both platforms. */
const LOADER_CACHE = join('lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders.cache');
const LOADER_DIR = join('lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders');

/** Record a path the way a manifest reader on any OS can compare it. */
const posix = (p) => p.split(sep).join('/');

/**
 * Every regular file under `dir`, relative to it, in a deterministic order.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    const stack = [''];
    while (stack.length) {
        const rel = stack.pop();
        const entries = readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        // Push directories in reverse so the sorted order survives the LIFO stack.
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry.isDirectory()) stack.push(join(rel, entry.name));
        }
        for (const entry of entries) if (entry.isFile()) out.push(join(rel, entry.name));
    }
    return out.sort();
}

/**
 * Pick the icon files to decode: the first `.svg` and the first `.png` the bundle ships,
 * in sorted order so two builds of the same tree probe the same file.
 *
 * The whole bundle is searched, not only `share/icons`, because "which theme dir" is a
 * detail of whichever prefix built it — and a probe that hard-codes a path fails a
 * correct bundle that laid its icons out differently, which is how a check gets
 * switched off.
 * @param {string} bundleDir
 * @returns {{ svg: string | null, png: string | null }} bundle-relative posix paths
 */
export function selectProbeImages(bundleDir) {
    const files = walk(bundleDir);
    const pick = (ext) => {
        const hit = files.find((f) => f.toLowerCase().endsWith(ext));
        return hit ? posix(hit) : null;
    };
    return { svg: pick('.svg'), png: pick('.png') };
}

/** The platforms that ship a bundle — where "the host GTK answered" is a FAILED probe. */
const BUNDLE_PLATFORMS = new Set(['darwin', 'win32']);

/**
 * The ONE definition of a passing decode probe — the builder's gate and the release
 * gate call this same function on the same record.
 *
 * `ok` alone is not trusted: the dimensions are re-derived here, so a builder that
 * stamped `ok: true` over a −1×−1 result still fails. A MISSING record fails too, which
 * is the point of requiring it at all — a bundle built by an older builder, or with the
 * probe bypassed, cannot publish. It does not degrade to "unverified".
 * @param {unknown} probe the `windowingData.decodeProbe` record
 * @returns {string[]} empty iff the probe passed
 */
export function decodeProbeProblems(probe) {
    if (!probe || typeof probe !== 'object') {
        return [
            'manifest records no windowingData.decodeProbe — the bundle was built by a builder that ' +
                'does not decode one of its own icons, so nothing here has proven the icon theme is ' +
                'loadable (0.28.0 shipped 860 icon files of which zero decoded)',
        ];
    }
    const problems = [];
    if (probe.ok !== true) {
        problems.push(`decode probe did not pass: ${probe.error ?? '(the builder recorded no reason)'}`);
    }
    // WHICH GTK answered, not just what it returned. Pointing node-gi at a bundle does
    // not make it load one: `activateBundledGtkRuntime()` returns null whenever the
    // policy did not pick `bundle`, index.js wraps that call in a never-fatal try/catch,
    // and `resolveGtkRuntimeBundle()` falls through to three other candidates when the
    // named dir does not look like a bundle. In every one of those the HOST GTK decodes
    // the file sitting at the bundle's path and every other check here still passes. So
    // this fails closed on the record's own account of the running process, exactly as
    // the missing record above does. linux stays permissive — no linux bundle exists by
    // design, and the unit test's real-decode leg probes the system stack on purpose.
    if (typeof probe.platform !== 'string') {
        problems.push(
            'decode probe records no platform, so nothing says WHICH GTK decoded the file — a record ' +
                'from a builder that predates the check, or from a probe that never ran',
        );
    } else if (BUNDLE_PLATFORMS.has(probe.platform)) {
        if (probe.gtkSource !== 'bundle') {
            problems.push(
                `decode probe ran with gtkSource=${probe.gtkSource ?? '(unrecorded)'} on ${probe.platform} — ` +
                    'the HOST GTK decoded the file, so the bundle itself is unproven',
            );
        } else if (probe.bundleIsProbeTarget !== true) {
            problems.push(
                'decode probe activated a DIFFERENT bundle than the directory it decoded from — node-gi ' +
                    'resolved one of its other candidates (prebuilds/, the sibling package, the installed ' +
                    'optional dep), so the directory being published is unproven',
            );
        }
    }
    for (const kind of PROBE_KINDS) {
        const result = probe[kind];
        if (!result || typeof result !== 'object') {
            problems.push(`decode probe carries no ${kind} result`);
            continue;
        }
        if (!(result.width > 0) || !(result.height > 0)) {
            problems.push(
                `decode probe decoded ${kind} ${result.file ?? '(unnamed file)'} to ` +
                    `${result.width}x${result.height} — a failed load, not an image`,
            );
        }
    }
    return problems;
}

/**
 * Same directory on disk? realpath'd because a macOS temp dir reaches its target through
 * `/var` → `/private/var`, so two honest spellings of the staged bundle differ as strings.
 */
function samePath(a, b) {
    const real = (p) => {
        try {
            return realpathSync(p);
        } catch {
            // realpathSync throws on a path that is gone or unreadable. "Not the same
            // directory" is the right answer then, and it must not abort the probe.
            return p;
        }
    };
    const [x, y] = [real(a), real(b)];
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** What the bundle's loader cache and module dir look like, for the record. */
function describeLoaders(bundleDir) {
    const cache = join(bundleDir, LOADER_CACHE);
    const dir = join(bundleDir, LOADER_DIR);
    return {
        loaderCache: existsSync(cache) ? posix(LOADER_CACHE) : null,
        loaderDir: existsSync(dir) ? posix(LOADER_DIR) : null,
        loaderModules: existsSync(dir) ? readdirSync(dir).filter((f) => /\.(so|dylib|dll)$/i.test(f)).length : 0,
    };
}

/**
 * Decode one file and report what came back.
 *
 * The `instanceof`-free shape check is not defensive noise: in the two-GObject-registry
 * state #996 measured on darwin, `new_from_file()` returned a NON-null NON-pixbuf
 * instead of throwing, and `get_width()` on it is what surfaced the −1. A record that
 * only asked "did it throw" would have said yes-it-decoded.
 * @param {{ new_from_file: (file: string) => unknown }} Pixbuf
 * @param {string} absolute
 * @param {string} relPath bundle-relative, for the record
 */
function decodeOne(Pixbuf, absolute, relPath) {
    try {
        const pixbuf = Pixbuf.new_from_file(absolute);
        if (!pixbuf || typeof pixbuf.get_width !== 'function' || typeof pixbuf.get_height !== 'function') {
            return { file: relPath, width: 0, height: 0, error: 'new_from_file returned a non-pixbuf' };
        }
        return { file: relPath, width: pixbuf.get_width(), height: pixbuf.get_height() };
    } catch (error) {
        // gdk_pixbuf_new_from_file is `throws="1"` in the GIR — a GError for an
        // undecodable file is the EXPECTED failure here, and it is the answer the
        // record must carry rather than a crashed builder.
        return { file: relPath, width: 0, height: 0, error: error?.message ?? String(error) };
    }
}

/**
 * Run the probe. Returns the record the builder embeds in the manifest.
 * @param {{ bundleDir: string, addon: string }} options
 */
export async function runDecodeProbe({ bundleDir: bundleArg, addon: addonArg }) {
    // ABSOLUTE from here down. Both paths arrive from a builder's argv and both leave
    // again as ENV — `NODE_GI_NATIVE` into a `require()`, `GJSIFY_GTK_RUNTIME` into a
    // lookup that on darwin RE-EXECS the process — and a relative one survives every
    // existence check on the way (they read it against the cwd) while meaning something
    // else at the far end. node-gi.yml passes the darwin builder a repo-relative
    // `--stage`, which is how all four darwin legs died at addon load; the loader half is
    // fixed in native-paths.js, and this half is here because a probe whose meaning
    // depends on its caller's cwd is measuring the caller.
    const bundleDir = resolve(bundleArg);
    const addon = resolve(addonArg);
    const images = selectProbeImages(bundleDir);
    // The addon by NAME only: the manifest ships to consumers, and a build-host path
    // in it is the thing every other record here is careful not to carry.
    const record = { ok: false, platform: process.platform, addon: basename(addon), ...describeLoaders(bundleDir) };
    if (!images.svg) {
        return { ...record, error: `the bundle at ${bundleDir} ships no .svg to decode` };
    }

    // Point node-gi at THIS bundle and at THIS addon before importing it: the bundle is
    // activated at import time (on darwin by re-exec'ing the process), so nothing set
    // afterwards would be seen.
    process.env.GJSIFY_GTK_RUNTIME = bundleDir;
    process.env.GJSIFY_GTK_PREFER = 'bundle';
    process.env.NODE_GI_NATIVE = addon;

    const { requireGi } = await import(pathToFileURL(join(NODE_GI_ROOT, 'gi.js')).href);
    const GdkPixbuf = requireGi('GdkPixbuf', '2.0');
    const Pixbuf = GdkPixbuf.Pixbuf;

    // WHICH GTK this process ended up on — read AFTER the addon loaded, from the same
    // module instance index.js used, so this is the memoized decision the decode below
    // actually ran under and not a second opinion. Why the gate needs it:
    // `decodeProbeProblems()`.
    const { gtkSource, resolveGtkRuntimeBundle } = await import(
        pathToFileURL(join(NODE_GI_ROOT, 'gtk-runtime.js')).href
    );
    const resolvedBundle = resolveGtkRuntimeBundle();
    const runtime = {
        gtkSource: gtkSource(),
        // Compared HERE rather than in the gate: the comparison needs two build-host
        // paths, and this record ships to consumers inside the manifest — which is why
        // the addon travels as a bare basename a few lines above.
        bundleIsProbeTarget: resolvedBundle ? samePath(resolvedBundle.dir, bundleDir) : false,
    };

    const svg = decodeOne(Pixbuf, join(bundleDir, images.svg), images.svg);

    // A bundle that ships no .png of its own still has to prove its PNG loader: save the
    // decoded SVG out as PNG and read it back. Both halves go through the bundle's
    // gdk-pixbuf module, so this cannot pass without a working png loader — and it
    // cannot fail a correct bundle merely for shipping an SVG-only icon theme.
    let png;
    if (images.png) {
        png = { ...decodeOne(Pixbuf, join(bundleDir, images.png), images.png), source: 'bundled' };
    } else if (svg.width > 0) {
        const scratch = join(mkdtempSync(join(tmpdir(), 'gjsify-decode-probe-')), 'roundtrip.png');
        try {
            Pixbuf.new_from_file(join(bundleDir, images.svg)).savev(scratch, 'png', [], []);
            png = { ...decodeOne(Pixbuf, scratch, 'roundtrip.png'), source: 'saved-from-svg' };
        } catch (error) {
            // savev is `throws="1"`: no png saver in the bundle is exactly the gap this
            // branch exists to report, and it must be a failed record, not a crash.
            png = { file: 'roundtrip.png', width: 0, height: 0, source: 'saved-from-svg', error: String(error) };
        }
    } else {
        png = { file: null, width: 0, height: 0, error: 'skipped — the svg decode already failed' };
    }

    let formats = [];
    try {
        formats = Pixbuf.get_formats().map((f) => f.get_name());
    } catch (error) {
        // Context for a human, never a check — see the header. In the two-registry state
        // this very call threw "no method 'get_name' on GIRepository".
        formats = [`<unavailable: ${error?.message ?? String(error)}>`];
    }

    const filled = { ...record, ...runtime, svg, png, formats };
    // `ok: true` forced, so this call asks only about the DIMENSIONS — the one question
    // the gate will re-ask of the shipped record.
    const problems = decodeProbeProblems({ ...filled, ok: true });
    return { ...filled, ok: problems.length === 0, ...(problems.length ? { error: problems.join('; ') } : {}) };
}

/**
 * Run the probe in a CHILD process and return its record — what the builders call.
 *
 * A child and not an in-process call, for two measured reasons: activating a bundle
 * RE-EXECS the process on darwin (gtk-runtime.js), which would restart the builder
 * mid-build; and the two-registry state #996 measured is exactly the kind that aborts
 * a process rather than throwing, which must fail the build with a record, not with a
 * stack. The record travels through a FILE for the same re-exec reason — stdout does
 * not survive it.
 *
 * The child's environment is SCRUBBED ({@link probeChildEnv}) rather than inherited:
 * the builder runs in a job that has the host GTK on PATH and, on macOS, has exported
 * `DYLD_FALLBACK_LIBRARY_PATH` by hand. A probe that inherits those measures the
 * runner. `hostPrefixes` is the build prefix each builder already knows (brew prefix /
 * gvsbuild prefix).
 * @param {{ bundleDir: string, addon: string, hostPrefixes?: readonly string[] }} options
 */
export function spawnDecodeProbe({ bundleDir, addon, hostPrefixes = [] }) {
    const json = join(mkdtempSync(join(tmpdir(), 'gjsify-decode-probe-')), 'decode-probe.json');
    // Resolved in the PARENT, whose cwd is the builder's, so the child is never asked to
    // reinterpret a relative path against a cwd nobody promised it. `runDecodeProbe`
    // resolves again for its own callers; both are cheap and neither is the other's
    // precondition.
    const result = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--bundle', resolve(bundleDir), '--addon', resolve(addon), '--json', json],
        { stdio: 'inherit', env: probeChildEnv(process.env, { hostPrefixes }) },
    );
    if (!existsSync(json)) {
        return {
            ok: false,
            error:
                `the decode probe wrote no record (exit ${result.status}` +
                `${result.error ? `, ${result.error.message}` : ''}) — the addon or the bundle could not ` +
                'even be loaded',
        };
    }
    return JSON.parse(readFileSync(json, 'utf8'));
}

// --- CLI --------------------------------------------------------------------

function flag(args, name) {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const value = args[i + 1];
    return value === undefined || value.startsWith('--') ? undefined : value;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const args = process.argv.slice(2);
    const bundleDir = flag(args, '--bundle');
    const addon = flag(args, '--addon');
    const jsonOut = flag(args, '--json');
    if (!bundleDir || !addon || !jsonOut) {
        console.error('decode-probe: --bundle <dir> --addon <node_gi.node> --json <out.json> are all required');
        process.exit(2);
    }
    let record;
    try {
        record = await runDecodeProbe({ bundleDir, addon });
    } catch (error) {
        // Loading the addon, resolving the GdkPixbuf typelib or activating the bundle can
        // all fail outright — that is a bundle that cannot decode anything, so it belongs
        // in the record as a failure rather than as an unreadable stack trace.
        record = { ok: false, error: `probe aborted: ${error?.stack ?? error}` };
    }
    writeFileSync(jsonOut, JSON.stringify(record, null, 2));
    const problems = decodeProbeProblems(record);
    for (const problem of problems) console.error(`decode-probe: ${problem}`);
    console.log(`decode-probe: ${problems.length ? 'FAILED' : 'passed'} → ${jsonOut}`);
    process.exit(problems.length ? 1 : 0);
}
