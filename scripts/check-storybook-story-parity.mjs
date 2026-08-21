#!/usr/bin/env node
// Every story exists on ALL THREE storybook targets.
//
// THE CLAIM THIS REPLACES
//
// Three READMEs and a package description said the three targets "can be
// compared 1:1 by screenshot" (#1052). No such harness existed, and the
// documentation asserted a guarantee nothing provided — the avatar divergence
// that a parity harness is supposed to catch (single-word names rendering `AD`
// on the web and `A` on NativeScript) survived the whole life of both ports.
//
// The harness was not built, and the reason is worth keeping: "1:1 by
// screenshot" is not achievable across GTK, a browser and Android — three
// rasterisers, three font stacks — and the NativeScript leg needs a device that
// CI does not have. What DOES hold, and what a screenshot run would really have
// surfaced first, is that the three targets render the same SET of stories from
// the same `*.meta.ts`. A story present on one target and missing on another
// cannot be compared at all, and nothing noticed that either.
//
// So: behaviour parity is held by `@gjsify/adwaita-core/conformance` (vectors
// both renderer suites drive their real widgets with), and story-set parity is
// held here.
//
// WHAT IT CHECKS
//
// For each renderer-agnostic `<name>.meta.ts` in the GTK showcase, all three
// renderings must exist:
//   `<name>.story.ts` (GTK) · `<name>.web.ts` (browser) — both alongside the meta
//   `<name>.ns.ts` (NativeScript) — in the NativeScript showcase
// and every rendering must have a meta behind it, so a story cannot be added to
// one target alone in either direction.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-storybook-story-parity.mjs [--root <dir>]

import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADWAITA_NS_STORY_SRC, ADWAITA_STORY_SRC, adwaitaStoryMetas, storyNamesWith } from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/** The GTK showcase owns the metas and both the GTK and browser renderings. */
const GTK_SRC = join(ROOT, ADWAITA_STORY_SRC);
/** The NativeScript showcase imports those metas and adds its own rendering. */
const NS_SRC = join(ROOT, ADWAITA_NS_STORY_SRC);

/** @type {Map<string, {path: string, file: string, titles: string[], source: string}>} */
let metaFiles;
try {
    metaFiles = adwaitaStoryMetas(ROOT);
} catch (error) {
    // The reader throws on a vacuous scan by design; catch to keep this script's prefix.
    console.error(`check-storybook-story-parity: ${error.message}`);
    process.exit(1);
}

const metas = new Set(metaFiles.keys());
const targets = [
    { label: 'GTK (*.story.ts)', names: storyNamesWith(GTK_SRC, '.story.ts') },
    { label: 'browser (*.web.ts)', names: storyNamesWith(GTK_SRC, '.web.ts') },
    { label: 'NativeScript (*.ns.ts)', names: storyNamesWith(NS_SRC, '.ns.ts') },
];

const failures = [];
for (const target of targets) {
    const missing = [...metas].filter((name) => !target.names.has(name)).sort();
    const orphaned = [...target.names].filter((name) => !metas.has(name)).sort();

    if (missing.length > 0) {
        failures.push(`${target.label}: no rendering for ${missing.join(', ')} — the other targets have one.`);
    }
    if (orphaned.length > 0) {
        failures.push(`${target.label}: ${orphaned.join(', ')} has no *.meta.ts, so no other target can render it.`);
    }
}

if (failures.length > 0) {
    console.error(`check-storybook-story-parity: ${failures.length} parity break(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nThe three targets exist to be compared. A story on one of them and not the others is the one\n` +
            `state where no comparison is possible — which is exactly what the unimplemented screenshot\n` +
            `harness was claimed to catch (#1052).\n` +
            `  metas: ${relative(ROOT, GTK_SRC)}    NativeScript: ${relative(ROOT, NS_SRC)}`,
    );
    process.exit(1);
}

console.log(`check-storybook-story-parity: ${metas.size} stories, each rendered by all three targets.`);
