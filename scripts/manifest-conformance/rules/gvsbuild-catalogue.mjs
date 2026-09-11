/**
 * Rule `gvsbuild-catalogue` — REPO-SCOPED. A media claim or gap that blames an upstream
 * build system names a library, and the snapshot of that build system's catalogue says the
 * library is there (for a claim) or is not (for a gap). The snapshot is pinned to the same
 * version the workflows build with.
 *
 * WHY THIS EXISTS
 *
 * `@gjsify/gtk-runtime-win32-x64` declares MP3 and FLAC as gaps, and each gap's `why` ends
 * on the same sentence: gvsbuild defines no project for libmpg123 / libFLAC, so the element
 * cannot be built and closing the gap means a project file upstream. ADR 0056 § 1 turns
 * that into the FIRST of three questions any future codec request must pass.
 *
 * Nothing held it. The three mechanisms in this area all compare the declaration to OUR
 * artifact — `media-capabilities` to the shipped plugin files, `missingBundledGstPlugins`
 * to what the builder copied, `gst-elements.test.mjs` to the registry on the target — and
 * all three stay green when the REASON expires. That is #1544 with the sign flipped: there
 * a decoder was absent and nothing said so, here a gap outlives its cause and nothing says
 * so. The expiry is not hypothetical either: `GVSBUILD_VERSION` is a pin, it is spelled in
 * eight `env:` blocks across four workflows, and 2026.8.0 was published while 2026.6.0 was
 * still the pin.
 *
 * WHAT IT READS
 *
 *   • `packages/node-gi/scripts/gvsbuild-catalogue.json` — the project modules gvsbuild
 *     ships at the pinned version, fetched by that file's sibling `--update` and committed,
 *     so this rule needs no network and runs on every PR.
 *   • every `GVSBUILD_VERSION:` in `.github/workflows/` — the pin the snapshot must match,
 *     and which the eight copies must agree on. ADR 0056 § Consequences names that
 *     duplication and declined a guard over the argument LISTS; the VERSION is the half a
 *     cache key is derived from, so two spellings build two prefixes.
 *   • `gjsify.mediaCapabilities`, where a claim or gap may carry
 *     `upstream: { catalogue: 'gvsbuild', library: '<name>' }`.
 *
 * BOTH DIRECTIONS, ON EVERY RUN, WHICH IS WHY THE MATCHER CANNOT GO VACUOUS. A GAP's
 * library must match nothing in the catalogue; a CLAIM's must match something. The win32
 * bundle carries both kinds — Ogg/Vorbis and Opus exist because `libvorbis.py` and
 * `opus.py` do, MP3 and FLAC do not exist because no module answers to them — so a matcher
 * that had silently stopped matching anything would fail on the claims in the same run it
 * passed the gaps. A bundle declaring one direction and not the other is itself a finding.
 *
 * WHY NOT IN `media-capabilities`, which owns the same field. That rule is `portable`: it
 * reads the manifest and files on disk and knows nothing about this repository. A snapshot
 * of one Windows build system's catalogue, held against this repository's own workflow
 * files, is the definition of `repo`. The split is the same one ADR 0055 § 2 draws through
 * the declaration itself — `plugin` is readable by any host, `element` only by the target —
 * applied one level up: the SHAPE of `upstream` is checked portably where the field is
 * validated, and what the value MEANS is checked here.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { matchLibrary, readGvsbuildCatalogue } from '../../../packages/node-gi/scripts/gvsbuild-catalogue.mjs';

/** The build system this rule answers for; the value `upstream.catalogue` must carry. */
export const CATALOGUE = 'gvsbuild';

/** The floor a real catalogue clears. 2026.6.0 has 94; a listing that lost most of them is a parse fault, not news. */
const MIN_MODULES = 40;

/**
 * Every `GVSBUILD_VERSION:` in the workflow directory, as `{workflow, version}` rows.
 *
 * DISCOVERED, not listed. `workflow-rev-pin` keeps an explicit pairing table because a
 * sha-shaped env value is not by itself a claim about a submodule; this env name is
 * unambiguous, and a table would miss the ninth `env:` block — which is the failure mode the
 * duplication already has.
 */
export function readGvsbuildPins(repoRoot) {
    const dir = join(repoRoot, '.github', 'workflows');
    if (!existsSync(dir)) return [];
    const rows = [];
    for (const entry of readdirSync(dir).sort()) {
        if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
        const text = readFileSync(join(dir, entry), 'utf8');
        // A CRLF workflow file is read correctly and NOT because of anything written here:
        // ECMAScript counts CR as a line terminator, so `$` under `/m` matches before the
        // `\r` as well as before the `\n`. Measured, because the opposite is the obvious
        // guess and a `[ \t\r]*` was briefly added against it — on a Windows clone
        // (`core.autocrlf=true` is Git for Windows' installer default, and
        // `.gitattributes` deliberately does not cover `*.yml`) both spellings find the
        // pin. The property is pinned by a test rather than left to this comment, because
        // a rewrite that split on `\n` would silently lose it.
        for (const match of text.matchAll(/^[ \t]*GVSBUILD_VERSION:[ \t]*['"]?([^'"\s#]+)['"]?[ \t]*$/gm)) {
            rows.push({ workflow: `.github/workflows/${entry}`, version: match[1] });
        }
    }
    return rows;
}

/** The `upstream` declarations of one bundle, flattened with the direction each implies. */
export function upstreamEntries(capabilities) {
    const rows = [];
    for (const [kind, list] of [
        ['audioDecode', capabilities?.audioDecode],
        ['gaps', capabilities?.gaps],
    ]) {
        if (!Array.isArray(list)) continue;
        for (const [index, entry] of list.entries()) {
            const upstream = entry?.upstream;
            if (upstream === undefined) continue;
            rows.push({
                kind,
                index,
                // `expect: 'present'` on a claim, `'absent'` on a gap. The direction is NOT a
                // field: it follows from which array the entry is in, and a field would let a
                // gap declare that its library is present — a sentence with no meaning that
                // the writer of the next entry would have to interpret.
                expect: kind === 'audioDecode' ? 'present' : 'absent',
                label: entry.format ?? entry.plugin ?? `${kind}[${index}]`,
                upstream,
            });
        }
    }
    return rows;
}

/**
 * Hold the snapshot against the pin, and every `upstream` declaration against the snapshot.
 *
 * @param {object} input
 * @param {{version: string, modules: string[], source?: string}} input.catalogue
 * @param {{workflow: string, version: string}[]} input.pins
 * @param {{name: string, path: string, capabilities: unknown}[]} input.bundles
 * @returns {{problems: string[], notes: string[], stats: object}}
 */
export function inspectGvsbuildCatalogue({ catalogue, pins, bundles }) {
    const problems = [];
    const notes = [];

    if (catalogue.modules.length < MIN_MODULES) {
        // Before anything is compared. A short list answers "absent" to every gap and
        // "absent" to every claim, so the gaps would pass and only the claims would fail —
        // half a signal, pointing at the declarations rather than at the snapshot.
        problems.push(
            `the committed gvsbuild catalogue lists ${catalogue.modules.length} project module(s), fewer than the ` +
                `${MIN_MODULES} any real gvsbuild carries. Every "this library is absent upstream" assertion below ` +
                'would pass over it. Re-read it with `node packages/node-gi/scripts/gvsbuild-catalogue.mjs --update`.',
        );
    }

    // ── the pin the snapshot claims to describe ──────────────────────────────
    if (pins.length === 0) {
        problems.push(
            'no `GVSBUILD_VERSION:` is set in any `.github/workflows/*.yml`, so the committed gvsbuild catalogue ' +
                'describes a version nothing builds with. Either the env was renamed — point this rule at the new ' +
                'name in the same change — or the Windows GStreamer build is gone and ' +
                '`packages/node-gi/scripts/gvsbuild-catalogue.json` goes with it.',
        );
    }
    const spellings = [...new Set(pins.map((pin) => pin.version))];
    if (spellings.length > 1) {
        problems.push(
            `\`GVSBUILD_VERSION\` is spelled ${spellings.length} different ways across the workflows: ` +
                `${spellings.join(', ')}.\n` +
                pins.map((pin) => `    ${pin.version}  ${pin.workflow}`).join('\n') +
                '\n    The prefix cache key is derived from this value, so two spellings build two prefixes and the ' +
                'leg\n    that proves the payload stops being the leg that ships it (ADR 0056 § Consequences).',
        );
    }
    for (const pin of pins) {
        if (pin.version === catalogue.version) continue;
        problems.push(
            `\`${pin.workflow}\` builds with gvsbuild ${pin.version} and the committed catalogue was read at ` +
                `${catalogue.version}. Every declared MP3/FLAC gap says "gvsbuild defines no project for this ` +
                'library", which is a statement about a VERSION — a pin that moves without the snapshot moving ' +
                'leaves that sentence describing a release nobody builds with. Run ' +
                `\`node packages/node-gi/scripts/gvsbuild-catalogue.mjs --update ${pin.version}\` and read the diff: ` +
                'a module that ARRIVED is a gap that can close (ADR 0056 § 1).',
        );
    }

    // ── every declaration that blames the catalogue ──────────────────────────
    let present = 0;
    let absent = 0;
    let bundlesWithUpstream = 0;

    for (const bundle of bundles) {
        const entries = upstreamEntries(bundle.capabilities);
        if (entries.length === 0) continue;
        bundlesWithUpstream++;
        const directions = new Set();

        for (const row of entries) {
            const where = `${bundle.name} (${bundle.path}) ${row.kind}[${row.index}] — ${row.label}`;
            const { catalogue: named, library } = row.upstream ?? {};
            if (named !== CATALOGUE) {
                notes.push(
                    `${where}: \`upstream.catalogue\` is "${named}", which this rule does not answer for — only ` +
                        `"${CATALOGUE}". Nothing checked it.`,
                );
                continue;
            }
            if (typeof library !== 'string' || library.trim().length === 0) {
                problems.push(
                    `${where}: \`upstream.catalogue\` is "${CATALOGUE}" and \`upstream.library\` names nothing, so ` +
                        'there is no question to put to the catalogue.',
                );
                continue;
            }

            const hits = matchLibrary(catalogue.modules, library);
            directions.add(row.expect);

            if (row.expect === 'present') {
                if (hits.length > 0) {
                    present++;
                    continue;
                }
                problems.push(
                    `${where}: this bundle CLAIMS the format, and gvsbuild ${catalogue.version} defines no project ` +
                        `module matching "${library}" (${catalogue.modules.length} module(s) read). The plugin behind ` +
                        'the claim is built from a library the prefix has no way to produce, so either the library ' +
                        'name is wrong here or the format belongs in `gaps`.',
                );
                continue;
            }

            if (hits.length === 0) {
                absent++;
                continue;
            }
            problems.push(
                `${where}: this gap's reason is that gvsbuild has no project for "${library}", and gvsbuild ` +
                    `${catalogue.version} defines ${hits.join(', ')}. ADR 0056 § 1 step 1 now answers YES for this ` +
                    'format: name the project in the `gvsbuild build` invocations of `node-gi.yml` AND `release.yml` ' +
                    '(both, in one commit), move the cache key, add the plugin to the named prefix assertion, and ' +
                    'move the format out of `gaps`. Step 1 is necessary and not sufficient — a project in the ' +
                    'catalogue can still fail to build with the toolchain the catalogue ships, which is what ' +
                    'libvorbis did.',
            );
        }

        if (entries.length > 0 && directions.size < 2) {
            problems.push(
                `${bundle.name} (${bundle.path}): every \`upstream\` declaration points the same way ` +
                    `(${[...directions].join(', ') || 'none'}). This rule's matcher is only honest because the same ` +
                    'bundle asserts a library that IS in the catalogue and one that is NOT — drop either side and a ' +
                    'matcher that had stopped matching anything would still pass. Keep one claim and one gap ' +
                    'carrying `upstream`, or remove the field from this bundle entirely.',
            );
        }
    }

    if (bundlesWithUpstream === 0) {
        problems.push(
            'no bundle declares `gjsify.mediaCapabilities.….upstream`, so this rule compared nothing and passed. ' +
                "The win32 bundle is bounded by gvsbuild's project list (ADR 0056) and says so in prose in every " +
                'gap `why`; if the field is gone, that prose is unheld again. Restore it, or delete this rule with ' +
                'the last declaration that used it.',
        );
    }

    return {
        problems,
        notes,
        stats: {
            version: catalogue.version,
            modules: catalogue.modules.length,
            pins: pins.length,
            present,
            absent,
        },
    };
}

/**
 * The bundles this rule answers for, in the shape {@link inspectGvsbuildCatalogue} takes.
 *
 * Keyed on the DECLARATION rather than on `files` shipping a `gtk/` payload, which is what
 * `collectMediaBundles` keys on: that trigger exists to catch a bundle declaring nothing,
 * and this rule has nothing to say about one. A package carrying `upstream` without the
 * payload is already a `media-capabilities` failure by name.
 */
function mediaBundles(ctx) {
    const out = [];
    for (const pkg of ctx.allPackages) {
        const capabilities = pkg.gjsify.mediaCapabilities;
        if (capabilities === undefined) continue;
        out.push({ name: pkg.manifest.name ?? pkg.rel, path: pkg.rel, capabilities });
    }
    return out;
}

export const gvsbuildCatalogueRule = defineRule({
    id: 'gvsbuild-catalogue',
    scope: 'repo',
    // The same field `media-capabilities` governs, and deliberately so: that rule owns the
    // shape of `upstream`, this one owns what the value says about the world. Both claim it,
    // because `field-coverage` asks who checks a key and the honest answer is both.
    fields: ['gjsify.mediaCapabilities'],
    description: "a declared upstream-bounded media gap still matches gvsbuild's project list at the pinned version",
    run(ctx) {
        let catalogue;
        try {
            catalogue = readGvsbuildCatalogue();
        } catch (error) {
            // Kept, and for `workflow-rev-pin`'s reason one file over: the snapshot is the
            // only side of this comparison that is not derived from the tree, and an
            // unreadable one must not degrade to "not applicable" — that is a pass that
            // measured nothing. The registry's throw-to-failure net would already make it a
            // FAILURE; catching puts the reader's own message under this rule's print block
            // instead of delivering it as a stack trace.
            return {
                failures: [
                    'the committed gvsbuild catalogue could not be read, so no declared upstream bound was ' +
                        `compared to anything: ${error instanceof Error ? error.message : String(error)}. Re-read ` +
                        'it with `node packages/node-gi/scripts/gvsbuild-catalogue.mjs --update`.',
                ],
            };
        }
        const result = inspectGvsbuildCatalogue({
            catalogue,
            pins: readGvsbuildPins(ctx.root),
            bundles: mediaBundles(ctx),
        });
        return {
            failures: result.problems,
            notes: result.notes,
            stats: result.stats,
            summary:
                `gvsbuild-catalogue: OK. gvsbuild ${result.stats.version} — ${result.stats.modules} project ` +
                `module(s), ${result.stats.pins} workflow pin(s) agreeing, ${result.stats.present} claimed ` +
                `library(s) present and ${result.stats.absent} declared gap(s) still absent upstream.`,
        };
    },
});
