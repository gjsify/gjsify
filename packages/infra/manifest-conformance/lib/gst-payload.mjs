/**
 * Reading a GStreamer plugin payload: what a plugin FILE is called, what a
 * directory of them holds, and what an element-factory NAME may look like.
 *
 * A MODULE AND NOT A RULE, on `binary.mjs`'s precedent. Three readers share this
 * parser — the `media-capabilities` rule, `packages/node-gi/scripts/gst-plugins.mjs`
 * (both bundle builders and the on-target probe go through it) and the bundle-gate
 * tests — and a builder importing a RULE registers that rule into the conformance
 * registry as a side effect of asking what a file is called. The parser is the
 * shared thing; the rule is one of its callers.
 *
 * The parser lived in the builder script first and was wrong twice in the same
 * way, which is why there is exactly one copy of it: the extension strip carried
 * `/i` while the prefix strip did not, so `LIBGSTAPP.DLL` — an archive's spelling,
 * not ours — kept its prefix and read as an unknown plugin, as did a versioned
 * `libgstapp.so.0`. A second copy is a second place for the same bug, and the
 * builders and the audit must not disagree about what a file is.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';

/**
 * A plugin FILE name in the spelling every declaration and every seed list uses:
 * no `libgst`/`gst` prefix, no extension, lower-cased.
 *
 * CASE-INSENSITIVE AND PREFIX-OPTIONAL, because both bit already. GStreamer names
 * a plugin `libgstcoreelements.dylib` on darwin and `gstcoreelements.dll` on
 * Windows, so a `^libgst` strip leaves the Windows leaf as `gstcoreelements` —
 * which matched nothing and skipped all 83 plugins of a bundle at exit 0. A
 * versioned `libgstapp.so.0` is the third spelling.
 *
 * @param {string} fileName
 * @returns {string}
 */
export function gstPluginBaseName(fileName) {
    return fileName
        .replace(/^.*[\\/]/, '')
        .replace(/^(lib)?gst/i, '')
        .replace(/\.(dylib|dll)$/i, '')
        .replace(/\.so(\.\d+)*$/i, '')
        .toLowerCase();
}

/** Is this file name a GStreamer plugin at all, in any of the three spellings? */
export function isGstPluginFile(fileName) {
    return /^(lib)?gst.+\.(dylib|dll|so(\.\d+)*)$/i.test(fileName.replace(/^.*[\\/]/, ''));
}

/**
 * Could this be a GStreamer element-factory name?
 *
 * ONE predicate, because two disagreeing ones are worse than none: the conformance
 * rule validates every declared `element` and the bundle-gate test asserted the
 * same thing with a stricter regex of its own, under which `avdec_aac` — the
 * element ADR 0053 names as the one that would close the AAC gap — was legal in
 * the manifest and illegal in the test.
 *
 * Underscore included for that reason; no dot and no dash, which no factory in
 * the audio path carries.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isGstElementName(name) {
    return typeof name === 'string' && /^[a-z0-9_]+$/.test(name);
}

/**
 * Read the plugin base names present in a payload directory.
 *
 * `null` when the directory is not here — deliberately distinguished from an
 * EMPTY directory, which is a finding. The two read alike from a `length === 0`
 * test, and conflating them is how a check over an absent artifact reports a
 * clean bundle.
 *
 * @param {string} dir
 * @returns {{ plugins: Set<string>, files: string[] } | null}
 */
export function readGstPluginDir(dir) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    const files = readdirSync(dir).filter(isGstPluginFile);
    return { plugins: new Set(files.map(gstPluginBaseName)), files };
}
