/**
 * Rule `repository-directory` — a published package's `repository` must name
 * ITS OWN subdirectory, not just the monorepo it lives in.
 *
 * THE DEFECT. npm renders a package page's "Repository" link, and `npm repo
 * <pkg>` opens a browser, from `repository.url` plus `repository.directory`.
 * Every package here shares one `url` (`github.com/gjsify/gjsify`), because
 * every package lives in the same monorepo — so `directory` is the ONLY part
 * of the field that tells a reader, or the tool, which of ~190 packages they
 * are actually looking at. Omit it and the link still resolves: it lands on
 * the repo ROOT instead of `packages/<pillar>/<name>`, which is wrong but not
 * obviously so — a working link that opens the wrong page is not something a
 * user reports, they just read the wrong README and move on. That is the
 * failure mode this rule exists to catch: not a broken link, a *believable*
 * one. Eleven packages shipped that way, discovered only because two of them
 * (`@gjsify/rolldown-plugin-solid`, `@gjsify/rolldown-plugin-vue`) were about
 * to be published to npm for the FIRST time — their npm page would have been
 * every reader's first and only signpost, pointing at the wrong place from
 * day one.
 *
 * THE HARDER HALF. A `directory` that is PRESENT but wrong is worse than one
 * that is absent — it reads as authoritative and is a specific false claim
 * instead of a missing one (the same shape `bundled-license` draws between a
 * guessed SPDX expression and an honest gap). A package moved between
 * pillars, copy-pasted from a sibling's manifest, or renamed on disk without
 * its `repository` block following along would all produce exactly this: a
 * value that looks correct and resolves to somebody else's package. So the
 * check does not stop at "is `directory` present" — it recomputes the
 * package's actual repo-relative path and compares.
 *
 * PORTABLE: reads only the manifest and the path `createContext()` already
 * resolved for each package (`pkg.rel`, POSIX, relative to the tree root).
 * Any repository with a git remote and a `directory` convention hits the same
 * failure mode the same way, so this holds in a consumer's tree exactly as it
 * does here.
 */

import { defineRule } from '../registry.mjs';

/**
 * The `directory` value a package's own manifest OWES — its own path,
 * relative to the tree root, POSIX-separated. `pkg.rel` already is that value
 * (see `context.mjs#toRecord`); named here so the comparison in
 * {@link auditRepositoryDirectory} reads as a check against a computed fact,
 * not a restatement of `pkg.rel`.
 *
 * @param {import('../context.mjs').PackageRecord} pkg
 * @returns {string}
 */
export function expectedDirectory(pkg) {
    return pkg.rel;
}

/**
 * @param {import('../context.mjs').ConformanceContext} ctx
 * @returns {{failures: string[], stats: Record<string, number>}}
 */
export function auditRepositoryDirectory(ctx) {
    const failures = [];
    let checked = 0;
    let ok = 0;

    for (const pkg of ctx.allPackages) {
        // A private package makes no promise to a reader outside the tree —
        // same carve-out as `os-axis` and `package-outputs`'s showcase check.
        if (pkg.private) continue;
        checked++;

        const repo = pkg.manifest.repository;
        const expected = expectedDirectory(pkg);

        if (repo === undefined || repo === null) {
            failures.push(
                `${pkg.name} (${pkg.rel}): declares no \`repository\` at all. Without it npm has nothing to link a ` +
                    `reader to, and \`npm repo ${pkg.name}\` has nowhere to open. Add ` +
                    `{"type":"git","url":"git+https://github.com/gjsify/gjsify.git","directory":"${expected}"}.`,
            );
            continue;
        }
        if (typeof repo !== 'object' || Array.isArray(repo)) {
            // npm's shorthand string form (`"github:owner/repo"`) has no room for a
            // `directory`, so it is exactly the shape this rule exists to reject —
            // not a different, acceptable spelling.
            failures.push(
                `${pkg.name} (${pkg.rel}): \`repository\` is ${JSON.stringify(repo)}, not an object. The shorthand ` +
                    `string form has no \`directory\` field to hold, which is what a monorepo package needs to ` +
                    `distinguish itself from the other ~190 sharing one \`url\`. Use ` +
                    `{"type":"git","url":"git+https://github.com/gjsify/gjsify.git","directory":"${expected}"}.`,
            );
            continue;
        }

        const directory = repo.directory;
        if (directory === undefined) {
            failures.push(
                `${pkg.name} (${pkg.rel}): \`repository\` names no \`directory\`. Every package in this monorepo ` +
                    `shares one \`repository.url\`, so without \`directory\` npm's "Repository" link on this ` +
                    `package's page — and \`npm repo ${pkg.name}\` — lands on the tree ROOT instead of this ` +
                    `package: a link that resolves, and is wrong. Add "directory": "${expected}".`,
            );
            continue;
        }
        if (typeof directory !== 'string' || directory !== expected) {
            failures.push(
                `${pkg.name} (${pkg.rel}): \`repository.directory\` is ${JSON.stringify(directory)}, but this ` +
                    `package's actual path is "${expected}". A directory that is present but WRONG is a worse ` +
                    `defect than a missing one — it reads as authoritative and points a reader at a package that ` +
                    `is not this one. Set "directory": "${expected}".`,
            );
            continue;
        }
        ok++;
    }

    // ONE TREE, ONE URL. `directory` is a path INSIDE the repo that `url` names,
    // so the two are a single claim and checking them separately checks neither.
    // A package carrying a foreign `url` plus a local `directory` describes a path
    // in somebody else's repository — and it renders on npm as an ordinary,
    // confident link.
    //
    // MEASURED: `@gjsify/unit` shipped `git+https://github.com/gjsify/unit.git`,
    // a repo whose last push was 2020-02-18, while the package is developed here
    // in `packages/gjs/unit`. Published npm metadata carried it as far as 0.42.0.
    // Adding `directory` to that manifest — which the first half of this rule
    // demands — would have MANUFACTURED the exact defect the rest of it rejects.
    //
    // Deciding by disagreement rather than by a majority vote is deliberate: a
    // tie needs no arbiter, and a rule that silently anoints the more popular URL
    // would ratify a mass copy-paste. Every distinct value is reported.
    const byUrl = new Map();
    for (const pkg of ctx.allPackages) {
        if (pkg.private) continue;
        const repo = pkg.manifest.repository;
        if (typeof repo !== 'object' || repo === null || Array.isArray(repo)) continue;
        if (typeof repo.url !== 'string') continue;
        const group = byUrl.get(repo.url);
        if (group) group.push(pkg.name);
        else byUrl.set(repo.url, [pkg.name]);
    }
    if (byUrl.size > 1) {
        const groups = [...byUrl.entries()].sort((a, b) => b[1].length - a[1].length);
        const rendered = groups
            .map(([url, names]) => {
                const shown = names.slice(0, 4).join(', ');
                const more = names.length > 4 ? `, +${names.length - 4} more` : '';
                return `    ${url}  —  ${names.length} package(s): ${shown}${more}`;
            })
            .join('\n');
        failures.push(
            'packages in one tree declare ' +
                `${byUrl.size} different \`repository.url\` values. Every package here lives in ONE repository, ` +
                'so one of these names a repo the package is not in — and its `directory` then points at a path ' +
                'inside that other repo:\n' +
                rendered,
        );
    }

    return { failures, stats: { checked, ok, urls: byUrl.size } };
}

export const repositoryDirectoryRule = defineRule({
    id: 'repository-directory',
    scope: 'portable',
    fields: ['repository'],
    description:
        "every non-private package's `repository.directory` is present and equals its own repo-relative path",
    run(ctx) {
        const { failures, stats } = auditRepositoryDirectory(ctx);
        return {
            failures,
            stats,
            summary:
                `repository-directory: OK. ${stats.checked} non-private package(s) checked; every declared ` +
                `\`repository.directory\` matches its own path, under ${stats.urls} shared \`repository.url\`.`,
        };
    },
});
