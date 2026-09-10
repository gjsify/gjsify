/**
 * Rule `media-capabilities` — a runtime bundle that promises to decode a format
 * ships the plugin behind it, and a format it does NOT decode is written down.
 *
 * THE DEFECT. `@gjsify/gtk-runtime-win32-x64` ships a GStreamer payload whose
 * audio path resolves `decodebin3`, `playbin3`, `filesrc` and `souphttpsrc` and
 * decodes no MP3, because the plugin that would (`mpg123`) is not in it. Its
 * darwin siblings carry it. Nothing anywhere said so: the shipped
 * `gtk/manifest.json` records `windowingData.gstPlugins`, a COUNT, and a count
 * cannot be wrong about WHICH. The gap was found by a person running an
 * application on Windows, which is the expensive way to find out that a
 * per-platform artifact is per-platform.
 *
 * WHAT A DECLARATION BUYS THAT A BUILD SCRIPT DOES NOT. The absence has been
 * DECLARED since #1562, in `packages/node-gi/scripts/gst-plugins.mjs`, and that
 * closed the builder's blind spot — a plugin the source archive never contained
 * is no longer silently absent. It did nothing for the person CHOOSING the
 * package: a build script is not published, and `npm view` answers nothing about
 * what the bundle can play. So the claim moved into the manifest, where the
 * artifact carries it, and this rule is what keeps it from becoming decoration.
 *
 * WHAT THIS RULE CAN AND CANNOT SAY — the line is the point, and it is drawn the
 * way ADR 0024 § A3 draws host-boundness: as data, in the declaration, rather
 * than as prose somewhere else.
 *
 *   • `plugin` is a FILE. Any host can read the file list of any bundle — a
 *     Linux workstation reads the win32 payload without a Windows machine, which
 *     is how the asymmetry above was measured. That half is checked HERE.
 *   • `element` is a REGISTRY ENTRY. Whether `mpg123audiodec` actually registers
 *     depends on the plugin loading, on its own dependencies resolving, and on
 *     GStreamer being told where the directory is. No host can answer that about
 *     a foreign target, and this rule does not pretend to: the element name is
 *     validated as a name and asked of the running registry by
 *     `packages/node-gi/node-gi/test/gst-elements.test.mjs`, on the operating
 *     system the bundle is for.
 *
 * A file that is present is therefore a NECESSARY condition and not a sufficient
 * one, and the notes say so on every run. The direction still matters: every
 * failure this rule has to catch is an ABSENT file, because a declared format
 * whose plugin never shipped is precisely the defect above.
 *
 * PORTABLE, because it reads only the manifest and files on disk. The
 * format→plugin→element mapping lives in the DECLARATION rather than in a table
 * here, which is what keeps it so: a bundle says what it can play and names the
 * evidence, and this rule checks the evidence without knowing anything about
 * GStreamer's catalogue or about this repository.
 */

import { isAbsolute, join, resolve } from 'node:path';

import { isGstElementName, readGstPluginDir } from '../gst-payload.mjs';
import { defineRule } from '../registry.mjs';

/**
 * The payload directory whose presence in `files` makes a package a runtime
 * bundle. A NAME rather than a package list, on `bundled-license`'s precedent:
 * a fourth bundle is caught the day it is added, not the day somebody remembers
 * to extend a set.
 */
const PAYLOAD_DIR = 'gtk';

/**
 * Every package whose `files` ship a `gtk/` payload, with its media declaration.
 *
 * `files` and not the filesystem, for `bundled-license`'s reason: the payload is
 * gitignored and assembled on a runner, so the directory is absent in a checkout
 * and present in the tarball — and it is the TARBALL the declaration describes.
 * Whether the payload happens to be reachable HERE is a separate question, asked
 * once per package below and reported either way.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function collectMediaBundles(ctx) {
    const out = [];
    for (const pkg of ctx.allPackages) {
        const files = Array.isArray(pkg.manifest.files) ? pkg.manifest.files : [];
        if (!files.some((f) => String(f).replace(/\/+$/, '') === PAYLOAD_DIR)) continue;
        out.push({
            name: pkg.manifest.name ?? pkg.rel,
            path: pkg.rel,
            dir: pkg.dir,
            files,
            capabilities: pkg.gjsify.mediaCapabilities,
        });
    }
    return out;
}

/** A non-empty string, which is what every field of this declaration must be. */
const filled = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * @typedef {object} MediaAuditOptions
 * @property {Record<string, string>} [payloads] Package name → a directory that
 *   stands in for the package ROOT, so `gstPluginDir` resolves under it. This is
 *   how a bundle that was STAGED from npm is audited (`stage-published-gtk-runtime.mjs`
 *   writes `<dest>/gtk`, so `<dest>` is what belongs here) rather than only one
 *   that a builder just wrote into its own package directory.
 */

/**
 * Hold every bundle's media declaration against its shape, against the other
 * bundles' claims, and — where the payload is reachable — against the files.
 *
 * @param {ReturnType<typeof collectMediaBundles>} bundles
 * @param {MediaAuditOptions} [options]
 */
export function auditMediaCapabilities(bundles, options = {}) {
    const failures = [];
    const notes = [];
    const payloads = options.payloads ?? {};
    let claims = 0;
    let gaps = 0;
    let inspected = 0;

    /** format → the bundles that say something about it, used for the coverage pass. */
    const spoken = new Map();
    /** Per bundle, the formats it has an answer for. */
    const answered = new Map();

    for (const bundle of bundles) {
        const caps = bundle.capabilities;
        if (caps === undefined) {
            failures.push(
                `${bundle.name} (${bundle.path}): ships a \`${PAYLOAD_DIR}/\` runtime payload and declares no ` +
                    '`gjsify.mediaCapabilities`. What a bundle can DECODE differs per platform — the same audio ' +
                    'path that plays an mp3 on one target silently plays nothing on another — and a difference ' +
                    'nobody declared is one a consumer finds by running the application. Declare ' +
                    '`{ gstPluginDir, audioDecode: [{format, plugin, element}], gaps: [{plugin?, format?, element?, why}] }`.',
            );
            continue;
        }
        if (typeof caps !== 'object' || Array.isArray(caps)) {
            failures.push(`${bundle.name} (${bundle.path}): \`gjsify.mediaCapabilities\` is not an object.`);
            continue;
        }

        const decode = Array.isArray(caps.audioDecode) ? caps.audioDecode : undefined;
        const declaredGaps = Array.isArray(caps.gaps) ? caps.gaps : undefined;
        if (decode === undefined || declaredGaps === undefined) {
            failures.push(
                `${bundle.name} (${bundle.path}): \`gjsify.mediaCapabilities\` needs both an \`audioDecode\` and a ` +
                    '`gaps` array. Both, and an empty one is a legitimate answer: a bundle that decodes nothing ' +
                    'still owes the reason, and a bundle with no gaps is claiming there are none.',
            );
            continue;
        }
        if (decode.length === 0 && declaredGaps.length === 0) {
            failures.push(
                `${bundle.name} (${bundle.path}): \`gjsify.mediaCapabilities\` claims nothing and declares no gap. ` +
                    'An empty declaration is indistinguishable from an absent one for every reader, and it is what ' +
                    'a check iterating it would report as clean.',
            );
        }

        // The directory the claim's evidence lives in must be one the tarball
        // carries, or the declaration points at nothing for every consumer — the
        // failure `bundled-license` closes for the licence field, one field over.
        if (!filled(caps.gstPluginDir)) {
            failures.push(
                `${bundle.name} (${bundle.path}): \`gjsify.mediaCapabilities.gstPluginDir\` is missing. It names the ` +
                    'directory the declared plugins are in, relative to the package root, and without it nothing ' +
                    'can check the claim against the payload.',
            );
        } else if (isAbsolute(caps.gstPluginDir) || caps.gstPluginDir.split(/[\\/]/).includes('..')) {
            failures.push(
                `${bundle.name} (${bundle.path}): \`gstPluginDir\` is "${caps.gstPluginDir}", which is not a path ` +
                    'inside the package. It is read relative to the package root on every host that inspects the ' +
                    'tarball, so an absolute or escaping path is a claim about the checking machine.',
            );
        } else if (
            // Segment-wise, never a bare `startsWith`: `files: ["gtkfoo"]` would otherwise ship
            // `gtkfoobar/plugins`. Same comparison `bundled-license` makes about the notice file.
            !bundle.files.some((f) => {
                const entry = String(f).replace(/\/+$/, '');
                return caps.gstPluginDir === entry || caps.gstPluginDir.startsWith(`${entry}/`);
            })
        ) {
            failures.push(
                `${bundle.name} (${bundle.path}): \`gstPluginDir\` is "${caps.gstPluginDir}", which no \`files\` entry ` +
                    `ships (\`files\`: ${bundle.files.join(', ')}). A consumer receives a declaration pointing into ` +
                    'a directory that is not in the tarball.',
            );
        }

        const seen = new Map();
        const claim = (entry, kind, index) => {
            const where = `${bundle.name} (${bundle.path}) ${kind}[${index}]`;
            if (typeof entry !== 'object' || entry === null) {
                failures.push(`${where}: not an object.`);
                return undefined;
            }
            if (entry.format !== undefined && !filled(entry.format)) {
                failures.push(`${where}: \`format\` is present but empty.`);
                return undefined;
            }
            if (entry.element !== undefined && !isGstElementName(entry.element)) {
                failures.push(
                    `${where}: \`element\` is "${entry.element}", which is not a GStreamer element-factory name. ` +
                        'It is the name the running registry is asked for on the target OS; a name no factory can ' +
                        'have makes that question unanswerable rather than false.',
                );
            }
            if (entry.plugin !== undefined && !/^[a-z0-9_]+$/.test(String(entry.plugin))) {
                failures.push(
                    `${where}: \`plugin\` is "${entry.plugin}", which is not a GStreamer plugin name. It is matched ` +
                        `against the file names in \`${caps.gstPluginDir}\`, where a plugin is spelled ` +
                        '`libgst<name>.dylib`, `gst<name>.dll` or `libgst<name>.so`.',
                );
            }
            if (filled(entry.format)) {
                const previous = seen.get(entry.format);
                if (previous !== undefined) {
                    failures.push(
                        `${where}: the format "${entry.format}" is already declared in \`${previous}\`. A format is ` +
                            'either taken or not taken; declaring both leaves the reader to guess which sentence wins.',
                    );
                } else {
                    seen.set(entry.format, kind);
                }
            }
            return entry;
        };

        for (const [index, entry] of decode.entries()) {
            if (claim(entry, 'audioDecode', index) === undefined) continue;
            for (const key of ['format', 'plugin', 'element']) {
                if (!filled(entry[key])) {
                    failures.push(
                        `${bundle.name} (${bundle.path}) audioDecode[${index}]: \`${key}\` is missing. A claim to ` +
                            'decode a format names the format, the plugin FILE that backs it (checkable from any ' +
                            'host) and the ELEMENT that decodes it (checkable only on the target). Two of the three ' +
                            'is a claim with half an oracle.',
                    );
                }
            }
            claims++;
        }

        for (const [index, entry] of declaredGaps.entries()) {
            if (claim(entry, 'gaps', index) === undefined) continue;
            if (!filled(entry.why)) {
                failures.push(
                    `${bundle.name} (${bundle.path}) gaps[${index}]: no \`why\`. A gap is a promise NOT made and the ` +
                        'reason is the whole of it — an unexplained one is the silent absence it replaces, written ' +
                        'down. Same shape as `gjsify.platformsUncommitted`.',
                );
            }
            if (!filled(entry.plugin) && !filled(entry.format)) {
                failures.push(
                    `${bundle.name} (${bundle.path}) gaps[${index}]: names neither a \`plugin\` nor a \`format\`, so ` +
                        'it excuses nothing and nothing can ever retire it.',
                );
            }
            gaps++;
        }

        const mine = new Set();
        for (const entry of [...decode, ...declaredGaps]) {
            if (filled(entry?.format)) mine.add(entry.format);
        }
        answered.set(bundle.name, mine);
        for (const format of mine) spoken.set(format, [...(spoken.get(format) ?? []), bundle.name]);

        // ── the payload, where it is reachable ───────────────────────────────
        if (!filled(caps.gstPluginDir)) continue;
        const rootOverride = payloads[bundle.name];
        const root = rootOverride === undefined ? bundle.dir : resolve(rootOverride);
        const pluginDir = join(root, caps.gstPluginDir);
        const payload = readGstPluginDir(pluginDir);
        if (payload === null) {
            notes.push(
                `${bundle.name}: payload NOT INSPECTED — ${pluginDir} is not here. The declaration's shape and its ` +
                    'agreement with the other bundles were checked; its agreement with the artifact was not. The ' +
                    'payload is gitignored and assembled on a runner, so this is the ordinary state of a checkout; ' +
                    'point the audit at a built or staged bundle to close it.',
            );
            continue;
        }
        inspected++;
        if (payload.files.length === 0) {
            failures.push(
                `${bundle.name} (${bundle.path}): ${pluginDir} exists and holds no GStreamer plugin at all. ` +
                    'An empty payload satisfies every count-shaped gate and decodes nothing.',
            );
        }

        for (const entry of decode) {
            if (!filled(entry.plugin)) continue;
            if (payload.plugins.has(String(entry.plugin).toLowerCase())) continue;
            failures.push(
                `${bundle.name} (${bundle.path}): declares it decodes ${entry.format}, and the plugin behind it ` +
                    `(\`${entry.plugin}\`) is not in ${caps.gstPluginDir} — ${payload.files.length} plugin file(s) ` +
                    `are, none of them it. An application asking for ${entry.format} gets "missing a plug-in" for a ` +
                    'local file and "Internal data stream error" for a stream, the second of which reads like a ' +
                    'network fault. Either ship the plugin or move the format into `gaps` with what its absence costs.',
            );
        }

        for (const entry of declaredGaps) {
            if (!filled(entry.plugin)) continue;
            if (!payload.plugins.has(String(entry.plugin).toLowerCase())) continue;
            failures.push(
                `${bundle.name} (${bundle.path}): declares a gap for \`${entry.plugin}\`${
                    filled(entry.format) ? ` (${entry.format})` : ''
                }, and the payload carries it. Delete the entry — a gap that outlives its cause is a promise the ` +
                    'bundle now keeps and its own declaration still refuses, which is the direction nobody looks in.',
            );
        }

        notes.push(
            `${bundle.name}: payload inspected — ${payload.files.length} plugin file(s) in ${caps.gstPluginDir}, ` +
                `${decode.length} declared format(s) backed, ${declaredGaps.length} declared gap(s) still absent. ` +
                'A plugin FILE is a necessary condition and not a sufficient one: whether the element registers ' +
                'is a question for the running GStreamer on the target OS, which `gst-elements.test.mjs` asks.',
        );
    }

    // ── every bundle answers for every format any bundle speaks about ────────
    //
    // The pass that would have caught #1544 at declaration time. A format one
    // target claims and another neither claims nor excuses is the per-platform
    // asymmetry itself, and the ONLY reason nobody noticed for a release cycle is
    // that no artifact was obliged to answer for the other's claims.
    for (const [name, mine] of answered) {
        for (const [format, speakers] of spoken) {
            if (mine.has(format)) continue;
            failures.push(
                `${name}: says nothing about ${format}, which ${speakers.join(', ')} declare${
                    speakers.length === 1 ? 's' : ''
                } an answer for. A format is per-platform or it is not; silence here is the asymmetry that ships. ` +
                    'Add it to `audioDecode` if this bundle carries the decoder, or to `gaps` with what it costs.',
            );
        }
    }

    return {
        failures,
        notes,
        stats: { bundles: bundles.length, claims, gaps, inspected },
    };
}

export const mediaCapabilitiesRule = defineRule({
    id: 'media-capabilities',
    scope: 'portable',
    fields: ['gjsify.mediaCapabilities'],
    description: 'a runtime bundle declares which media formats it decodes, and the payload backs every claim',
    run(ctx) {
        const bundles = collectMediaBundles(ctx);
        const result = auditMediaCapabilities(bundles, { payloads: ctx.options?.mediaPayloads ?? {} });
        return {
            failures: result.failures,
            notes: result.notes,
            stats: result.stats,
            summary:
                bundles.length === 0
                    ? 'media-capabilities: no package ships a runtime payload'
                    : `media-capabilities: ${bundles.length} bundle(s) — ${result.stats.claims} declared format(s), ` +
                      `${result.stats.gaps} declared gap(s), ${result.stats.inspected} payload(s) inspected here`,
        };
    },
});
