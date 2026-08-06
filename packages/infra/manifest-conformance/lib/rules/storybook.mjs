// `gjsify.storybook` — the declared story directory holds stories.
//
// THE GAP THIS CLOSES. `gjsify storybook` resolves its story directory as
// `resolve(cwd, args.stories ?? gjsify.storybook.stories ?? 'src')` and globs it
// recursively for `*.story.{ts,js,mts,mjs}`. Nothing anywhere compared that
// declared path against the disk without RUNNING the command — and running it is
// not something CI reliably does: the only job that executes `gjsify storybook`
// is path-filtered to `packages/node-gi/**`, which makes it advisory per the
// required-checks rule, and `tests/e2e/storybook-no-stories` skips outright when
// `gjs` is absent. A typo in `stories` therefore reached a user before it
// reached a check.
//
// THE INCIDENT, carried here from the deferral ledger this rule retires, because
// a rule without its reason gets simplified back into the bug. The failure used
// to be worse than a bad message: before #879 a bare `process.exit(1)` did not
// halt under GJS (no atexit, the GLib loop may still be armed), so the no-stories
// path printed its complaint, FELL THROUGH into the build, and exited 0. The
// command reported the problem and succeeded at the same time. That half is
// fixed — `storybook.ts` now returns `process.exit(1)` and
// `tests/e2e/storybook-no-stories` holds it — but the fix turned a silent empty
// browser into a loud runtime failure, not into a check. This rule is the check.
//
// WHY `portable`, per the scope criterion (would the rule still be TRUE in
// another tree): it reads exactly two things — the package's own
// `gjsify.storybook` block, and files under a path resolved relative to that
// package's directory. No pillar path taxonomy, no curated name list, no
// workflow YAML, no `refs/`. It is also the ONE `gjsify.*` field this repo
// shares with downstream consumers today (buchhaltung declares a nested
// `src/frontends/desktop/widgets`; pixel-rpg/map-editor declares the block with
// no `stories` key at all and relies on the `src` default), so both of those
// shapes have to keep working: a multi-segment path, and an absent key.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../registry.mjs';

/** The default `gjsify storybook` uses when `stories` is not declared. */
const DEFAULT_STORIES_DIR = 'src';

/** String-typed members of the block. A non-string here cannot reach the CLI intact. */
const STRING_KEYS = ['applicationId', 'title', 'stories', 'globals', 'runtime'];

/**
 * Recursively count `*.story.{ts,js,mts,mjs}` files under `dir`.
 *
 * Deliberately mirrors `findStoryFiles` in `packages/infra/cli/src/commands/storybook.ts`
 * — same extensions, same `node_modules` and dot-directory skips. The two must
 * agree or the rule would pass a directory the command then rejects, which is
 * the exact failure it exists to prevent. Counting rather than collecting: the
 * rule only needs "is it zero".
 *
 * @param {string} dir
 * @returns {number}
 */
export function countStoryFiles(dir) {
    let found = 0;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found += countStoryFiles(full);
        else if (/\.story\.(ts|js|mts|mjs)$/.test(entry.name)) found++;
    }
    return found;
}

/**
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function auditStorybook(ctx) {
    const failures = [];
    let declared = 0;
    let stories = 0;

    for (const pkg of ctx.packages) {
        const block = pkg.manifest.gjsify?.storybook;
        if (block === undefined) continue;
        declared++;

        if (typeof block !== 'object' || block === null || Array.isArray(block)) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.storybook\` must be an object (got ${
                    Array.isArray(block) ? 'an array' : typeof block
                }). \`gjsify storybook\` reads \`applicationId\`/\`title\`/\`stories\`/\`globals\` off it.`,
            );
            continue;
        }

        for (const key of STRING_KEYS) {
            if (key in block && typeof block[key] !== 'string') {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.storybook.${key}\` must be a string (got ${typeof block[key]}).`,
                );
            }
        }

        // The load-bearing check. An absent key is legal and means `src` — that
        // is a shape a downstream consumer actually relies on, so it must not be
        // reported as a missing declaration.
        const declaredDir = typeof block.stories === 'string' && block.stories.length > 0 ? block.stories : null;
        const rel = declaredDir ?? DEFAULT_STORIES_DIR;
        const abs = join(pkg.dir, rel);
        const named = declaredDir === null ? `the default \`${DEFAULT_STORIES_DIR}\`` : `\`${declaredDir}\``;

        if (!existsSync(abs) || !statSync(abs).isDirectory()) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.storybook\` points its story directory at ${named}, which is not a ` +
                    `directory in this package (${pkg.rel}/${rel}). \`gjsify storybook\` resolves exactly this path and ` +
                    `then exits 1 with "no stories found", so the declaration promises a component browser that cannot ` +
                    `start.`,
            );
            continue;
        }

        const count = countStoryFiles(abs);
        stories += count;
        if (count === 0) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.storybook\` names ${named}, which exists but holds no ` +
                    `\`*.story.{ts,js,mts,mjs}\` file. \`gjsify storybook\` globs it recursively and exits 1 on an empty ` +
                    `result — either point \`stories\` at the directory that has them, or drop the declaration until ` +
                    `there is one to browse.`,
            );
        }
    }

    return { failures, stats: { declared, stories } };
}

export const storybookRule = defineRule({
    id: 'storybook',
    scope: 'portable',
    fields: ['gjsify.storybook'],
    description: 'every declared `gjsify.storybook` story directory exists and holds at least one story',
    run(ctx) {
        const { failures, stats } = auditStorybook(ctx);
        return {
            failures,
            stats,
            summary:
                stats.declared === 0
                    ? 'storybook: no package declares `gjsify.storybook`'
                    : `storybook: ${stats.declared} declared story director(y|ies), ${stats.stories} story file(s)`,
        };
    },
});
