// `gjsify.webext` — the declared browser extension exists on disk (ADR 0077).
//
// What `gjsify webext build` would refuse at its first step, checked without
// building: the targets are in the vocabulary, and every file and directory the
// block names exists. A misspelled entry otherwise surfaces only when someone
// runs the build, and CI builds examples only when an example is in the
// affected closure.
//
// The target vocabulary mirrors `packages/infra/cli/src/utils/webext/targets.ts`
// (this package is plain `.mjs` and imports nothing from the CLI). The two must
// agree, or the rule passes a target the command refuses — the exact failure it
// exists to prevent. Only the shape is checked here; the CLI's own validation
// (output-name collisions, icon ceilings) runs on every build.
//
// WHY `portable`: it reads the package's own block and paths relative to the
// package directory, nothing else — true in any consumer tree.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../registry.mjs';

const BROWSERS = ['chrome', 'edge', 'firefox', 'safari'];
/** Chromium-based browsers have removed Manifest V2. */
const MV2_REMOVED = ['chrome', 'edge'];

/**
 * Why a target name would be refused, or null.
 *
 * @param {unknown} id
 * @returns {string | null}
 */
export function webextTargetProblem(id) {
    const match = typeof id === 'string' ? /^([a-z]+)-mv([23])$/.exec(id) : null;
    if (!match || !BROWSERS.includes(match[1])) {
        return `unknown target ${JSON.stringify(id)} (a target is <browser>-mv<2|3>, browser one of ${BROWSERS.join(', ')})`;
    }
    if (match[2] === '2' && MV2_REMOVED.includes(match[1]))
        return `target "${id}": ${match[1]} has removed Manifest V2`;
    return null;
}

/**
 * @param {string} path
 * @param {'file' | 'dir'} kind
 */
function isKind(path, kind) {
    if (!existsSync(path)) return false;
    const stat = statSync(path);
    return kind === 'dir' ? stat.isDirectory() : stat.isFile();
}

/**
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function auditWebext(ctx) {
    const failures = [];
    let declared = 0;
    let files = 0;

    for (const pkg of ctx.packages) {
        const block = pkg.manifest.gjsify?.webext;
        if (block === undefined) continue;
        declared++;
        const where = `${pkg.rel}/package.json: \`gjsify.webext\``;
        if (typeof block !== 'object' || block === null || Array.isArray(block)) {
            failures.push(`${where} must be an object.`);
            continue;
        }
        for (const id of block.targets ?? []) {
            const problem = webextTargetProblem(id);
            if (problem) failures.push(`${where}: ${problem}.`);
        }
        /** @type {[string, unknown, 'file' | 'dir'][]} */
        const named = [
            ['manifest', block.manifest, 'file'],
            ['public', block.public, 'dir'],
            ['locales', block.locales, 'dir'],
        ];
        for (const key of ['scripts', 'pages']) {
            for (const [name, path] of Object.entries(block[key] ?? {})) named.push([`${key}.${name}`, path, 'file']);
        }
        for (const [name, source] of Object.entries(block.icons?.sources ?? {})) {
            const paths = typeof source === 'string' ? [source] : Object.values(source ?? {});
            for (const path of paths) named.push([`icons.sources.${name}`, path, 'file']);
        }
        for (const [key, path, kind] of named) {
            if (path === undefined) continue;
            files++;
            if (typeof path !== 'string' || !isKind(join(pkg.dir, path), kind)) {
                failures.push(
                    `${where}.${key} names ${JSON.stringify(path)}, which is not a ${kind === 'dir' ? 'directory' : 'file'} ` +
                        `in this package. \`gjsify webext build\` refuses the package at its first step.`,
                );
            }
        }
    }
    return { failures, stats: { declared, files } };
}

export const webextRule = defineRule({
    id: 'webext',
    scope: 'portable',
    fields: ['gjsify.webext'],
    description: 'every declared `gjsify.webext` names known targets and files that exist',
    run(ctx) {
        const { failures, stats } = auditWebext(ctx);
        return {
            failures,
            stats,
            summary:
                stats.declared === 0
                    ? 'webext: no package declares `gjsify.webext`'
                    : `webext: ${stats.declared} extension(s), ${stats.files} declared path(s)`,
        };
    },
});
