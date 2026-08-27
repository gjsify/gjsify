#!/usr/bin/env node
// Every story is RENDERED by all three storybook targets.
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
// AND THE CLAIM THIS CHECK ITSELF GOT WRONG
//
// It read a FILENAME. `storyNamesWith(SRC, '.web.ts')` said the browser rendered
// a story because a file with that name sat on disk — while the browser target,
// like the NativeScript one, renders what a hand-written list module imports and
// lists. Deleting `import { CarouselWebStories }` and its array entry from
// `showcases/gtk/adwaita-storybook/src/browser/stories.ts` drops Carousel out of
// the browser storybook AND out of the website embed that mounts the same list,
// and this check printed "41 stories, each rendered by all three targets".
// Measured on `origin/main` at 9d9db9376, exit 0; the NativeScript twin and a
// `*.story.ts` whose story module lost its `export` keyword did the same.
//
// A gate that has never been seen failing has proven nothing, and "rendered by
// all three targets" is precisely the sentence a FOURTH renderer is meant to earn.
//
// WHAT IT CHECKS
//
// For each renderer-agnostic `<name>.meta.ts` in the GTK showcase, every target
// must have a rendering AND reach it:
//   `<name>.story.ts` (GTK) · `<name>.web.ts` (browser) — both alongside the meta
//   `<name>.ns.ts` (NativeScript) — in the NativeScript showcase
// where "reach it" is `storybookRegistration`'s two facts — the registry imports
// the module, and hands it to the controller. Every rendering must have a meta
// behind it, and every meta must leave through the barrel the NativeScript
// renderings import it from, so a story cannot be added to one target alone in
// either direction.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-storybook-story-parity.mjs [--root <dir>]

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADWAITA_NS_STORY_SRC, ADWAITA_STORY_SRC, adwaitaStoryMetas } from './adwaita-elements.mjs';
import { META_BARREL, metaBarrelExports, showPath, storybookRegistration } from './storybook-registration.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/**
 * `<story>@<target id>` a target deliberately does not render, and why.
 *
 * Empty, and the bar for adding to it is high: the three targets exist to be
 * compared, so an entry here is a story the reference storybook shows and one
 * renderer answers for in prose instead. The reason names the file a reader opens
 * to see what that renderer does instead — "would be work" is not one, and a widget
 * only one renderer ships has no meta and never reaches this check at all (that is
 * `check-storybook-widget-coverage.mjs`'s `ONE_RENDERER_ONLY`).
 */
const NOT_ON_THIS_TARGET = {};

/** A floor on length, not on meaning — the same one the widget ledger uses. */
const MIN_REASON = 40;

/** @type {Map<string, {path: string, file: string, titles: string[], source: string}>} */
let metaFiles;
/** @type {Map<string, {label: string, files: Map<string, string>, reachable: Set<string>, live: Set<string>, dangling: string[]}>} */
let registration;
/** @type {Set<string>} */
let barrel;
try {
    metaFiles = adwaitaStoryMetas(ROOT);
    registration = storybookRegistration(ROOT);
    barrel = metaBarrelExports(ROOT);
} catch (error) {
    // The readers throw on a vacuous scan and on a registry they cannot parse, by
    // design: reporting every story as unregistered would present the reader's own
    // limit as the tree's defect. Catch to keep this script's prefix.
    console.error(`check-storybook-story-parity: ${error.message}`);
    process.exit(1);
}

const metas = new Set(metaFiles.keys());
const failures = [];
/** Every `<story>@<target>` key the walk below reached, so a ledger entry can be held to one. */
const visited = new Set();

for (const [id, target] of registration) {
    const registry = target.registry === null ? '`gjsify storybook` (the *.story.ts glob)' : target.registry;

    for (const name of [...metas].sort()) {
        const key = `${name}@${id}`;
        visited.add(key);
        const ledgered = key in NOT_ON_THIS_TARGET;
        const file = target.files.get(name);

        if (file === undefined) {
            if (ledgered) continue;
            failures.push(`${target.label}: no rendering for ${name} — the other targets have one.`);
            continue;
        }
        if (ledgered) {
            failures.push(
                `${key}: ledgered as deliberately not rendered here, and ${showPath(ROOT, file)} exists — ` +
                    'drop the stale entry, or delete the rendering it says nothing renders.',
            );
            continue;
        }
        if (!target.reachable.has(name)) {
            failures.push(
                `${target.label}: ${showPath(ROOT, file)} exists and ${registry} never imports it, so this\n` +
                    `    target renders ${name} nowhere. The file on disk is what this check used to read.`,
            );
            continue;
        }
        if (!target.live.has(name)) {
            failures.push(
                target.registry === null
                    ? `${target.label}: ${showPath(ROOT, file)} is picked up by the glob and exports no story\n` +
                          '    module, so `collectStoryModules` finds nothing in it. Export the `{ stories: [ … ] }`.'
                    : `${target.label}: ${target.registry} imports ${name} and leaves it out of its \`stories\`\n` +
                          '    array, so the module is bundled and the controller is never handed it.',
            );
        }
    }

    for (const name of [...target.files.keys()].sort()) {
        if (metas.has(name)) continue;
        failures.push(`${target.label}: ${name} has no *.meta.ts, so no other target can render it.`);
    }
    // Only where the missing rendering has no meta to be reported against: a story with a
    // meta already gets its "no rendering for X" line above, and one fix reading as two
    // findings sends the author looking for a second defect.
    for (const { name, specifier } of target.dangling) {
        if (metas.has(name)) continue;
        failures.push(`${target.label}: ${registry} imports ${specifier}, and there is no such rendering.`);
    }
}

// The NativeScript renderings reach their meta only through this barrel: they import
// `@gjsify/example-gtk-adwaita-storybook/metas` rather than across the package boundary.
for (const name of [...metas].sort()) {
    if (barrel.has(name)) continue;
    failures.push(
        `${META_BARREL}: ${metaFiles.get(name).file} is not re-exported, and that barrel is the only path\n` +
            '    a NativeScript rendering has to its meta.',
    );
}
for (const name of [...barrel].sort()) {
    if (metas.has(name)) continue;
    failures.push(`${META_BARREL}: re-exports ${name}.meta.js, which is not a *.meta.ts in ${ADWAITA_STORY_SRC}.`);
}

// Against the keys the walk REACHED, the way check-storybook-control-parity holds its
// own ledger: an entry naming a deleted story or a misspelled target id reads as a
// considered decision while covering nothing.
for (const [key, reason] of Object.entries(NOT_ON_THIS_TARGET)) {
    if (!visited.has(key)) {
        failures.push(
            `${key}: ledgered here, and no story of that name reaches that target — check the story name\n` +
                `    and the target id against ${[...registration.keys()].join(', ')}.`,
        );
    } else if (reason.trim().length < MIN_REASON) {
        failures.push(`${key}: ledgered with no real reason — name the file that shows what this target does instead.`);
    }
}

if (failures.length > 0) {
    console.error(`check-storybook-story-parity: ${failures.length} parity break(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nThe three targets exist to be compared. A story on one of them and not the others is the one\n` +
            `state where no comparison is possible — which is exactly what the unimplemented screenshot\n` +
            `harness was claimed to catch (#1052). A story whose FILE is there and whose registration is\n` +
            `not is the same state, and it is the one this check spent its first life calling parity.\n` +
            `  metas: ${ADWAITA_STORY_SRC}    NativeScript: ${ADWAITA_NS_STORY_SRC}`,
    );
    process.exit(1);
}

const ledgered = Object.keys(NOT_ON_THIS_TARGET).length;
// Per target and not a single total, because the totals are what a ledger entry makes
// differ — and a summary that reads "all three" over a set one of them does not render
// is the sentence this check was rewritten for.
const where = [...registration.values()].map((target) => `${target.label} ${target.live.size}`).join(', ');
console.log(
    `check-storybook-story-parity: ${metas.size} stories, each reached by the registration of its ` +
        `targets — ${where}${ledgered > 0 ? `; ${ledgered} ledgered as deliberately not rendered` : ''}.`,
);
