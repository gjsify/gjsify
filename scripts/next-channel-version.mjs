#!/usr/bin/env node
/**
 * The `next` channel's version, and the ONE tree rewrite that produces it.
 *
 * `release.yml`'s `publish-next` job publishes every root-workspace package under
 * dist-tag `next` on every push to `main`. Nothing is committed: this script rewrites
 * the CI CHECKOUT, the sweep publishes it, the checkout is thrown away. `main` never
 * carries a `next` version, so the release train (ADR 0008) and `release-it`'s
 * tag-derived next-version are untouched.
 *
 * WHY A REWRITE AND NOT A PUBLISH FLAG. `npm publish --tag next` only chooses the
 * dist-tag; the VERSION comes from the manifest, and republishing `0.63.0` is refused by
 * the registry. So the version has to be in the tree before the sweep runs — and in the
 * tree before the BUILD runs, because `@gjsify/cli` define-injects
 * `__PACKAGE_VERSION__` from its own `version` field (`gjsify.defineFromPackageJson`),
 * so a rewrite after the build ships a bundle reporting the previous version.
 *
 * WHY THE SPECS ARE REWRITTEN TOO — this is the part a reader will want to delete.
 * `gjsify pack` resolves a `workspace:` range from the sibling's version field
 * (`rewriteWorkspaceDeps`): `workspace:*` becomes the EXACT version, `workspace:^`
 * becomes `^<version>`. Leaving the 622 `workspace:^|~` edges alone would publish
 * `@gjsify/cli@0.63.1-next.42` depending on `^0.63.1-next.42`, and that caret admits
 * every LATER next build and the eventual stable `0.63.1` — so `npm i @gjsify/cli@next`
 * would resolve a mixed closure of packages built from different commits, which is the
 * one thing a prerelease channel exists to rule out. Converting every `workspace:^|~` to
 * `workspace:*` makes pack emit exact pins and the whole closure moves as one commit.
 *
 * WHAT STOPS A REWRITTEN TREE FROM BEING COMMITTED. The root manifest is rewritten too,
 * and that is load-bearing rather than cosmetic: the `release-train` conformance rule
 * (ADR 0008) compares the three workspace-excluded NativeScript apps' literal
 * `@gjsify/*` ranges against the ROOT version, so a committed rewrite fails
 * `audit-runtimes.mjs --check` on the pull request that tries it. `git checkout -- .`
 * undoes everything this writes.
 *
 * WHAT IT REFUSES TO REWRITE, rather than rewriting wrongly:
 *   - a root version that is already a prerelease — `patch + 1` is not the next patch of
 *     `0.63.1-next.42`, and guessing would publish a version lower than `latest`;
 *   - a `workspace:` edge from a published package to one the sweep does NOT publish —
 *     the tarball would pin a version that never existed on the registry, the failure
 *     `scripts/verify-published-closure.mjs` exists for, except unfixable because no
 *     later publish can create it;
 *   - a literal intra-repo pin in a published package (`"@gjsify/x": "0.63.0"`) — it
 *     survives the rewrite untouched and pins a package from OUTSIDE this closure;
 *   - a `workspace:` operator neither pack nor this script models (`workspace:1.2.3`),
 *     which pack passes through verbatim.
 * Measured on 9cc540bb41: 218 packages in the sweep, 699 `workspace:` edges, none
 * leaving the sweep, no literal intra-repo pin inside it — so every refusal above is a
 * guard on a property that holds today, not a known exception.
 *
 * Usage:
 *   node scripts/next-channel-version.mjs                 # print the version
 *   node scripts/next-channel-version.mjs --check          # assert the tree is rewritable
 *   node scripts/next-channel-version.mjs --write          # rewrite the checkout
 *   node scripts/next-channel-version.mjs --json           # machine-readable report
 *     --build <n>        monotonic counter; default $GITHUB_RUN_NUMBER
 *     --github-output    append `version=…` + `base=…` to $GITHUB_OUTPUT
 *
 * `--write` implies `--check`, and re-reads the tree afterwards to assert the rewrite
 * landed: a packer that silently produced a broken tarball is what cost v0.4.20 and
 * v0.4.37, and this script sits one step upstream of the same tarball.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createContext } from '../packages/infra/manifest-conformance/lib/context.mjs';

// EVERY ARGUMENT IS DECLARED, AND AN UNDECLARED ONE IS FATAL — the same contract
// `scripts/verify-published-closure.mjs` states for `--phase`, for the same reason: a
// typo in a CI step must cost a red, not a silently different mode. `--write` typed as
// `--wrote` must not print a version and exit 0 while the job believes it rewrote.
const KNOWN_ARGS = ['--check', '--write', '--json', '--github-output', '--build', '--help', '-h'];

const argv = process.argv.slice(2);
for (const arg of argv) {
    if (arg.startsWith('-') && !KNOWN_ARGS.includes(arg.split('=')[0])) {
        fail(`unknown argument ${JSON.stringify(arg)}; known: ${KNOWN_ARGS.join(', ')}`);
    }
}

function flagValue(name, fallback) {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const at = argv.indexOf(name);
    if (at === -1) return fallback;
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('-')) fail(`${name} needs a value`);
    return value;
}

const has = (name) => argv.includes(name);

if (has('--help') || has('-h')) {
    process.stdout.write(
        readFileSync(new URL(import.meta.url), 'utf8')
            .split('\n')
            .slice(1, 62)
            .join('\n') + '\n',
    );
    process.exit(0);
}

const write = has('--write');
const json = has('--json');

/** Dependency blocks `gjsify pack`'s `rewriteWorkspaceDeps` walks — the same four, deliberately. */
const DEP_BLOCKS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** `workspace:` operators pack resolves against the sibling's version. Anything else is passed through. */
const REWRITABLE_OPERATORS = new Set(['', '*', '^', '~']);

function fail(message) {
    process.stderr.write(`next-channel-version: ${message}\n`);
    process.exit(1);
}

/**
 * `<next patch of the root version>-next.<build>`.
 *
 * The base is the next PATCH, never the current version: `0.63.0-next.42` sorts BELOW
 * the published `0.63.0` (semver §11 — a prerelease precedes its release), so a consumer
 * on `next` would be offered older code than `latest` for a whole release cycle.
 * `0.63.1-next.42` sorts above `0.63.0` and below the `0.63.1` that will eventually
 * carry it.
 */
export function nextChannelVersion(rootVersion, build) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(rootVersion);
    if (!m) {
        fail(
            `the root version is ${JSON.stringify(rootVersion)}, which is not a plain <major>.<minor>.<patch>. ` +
                'The next-patch base cannot be derived from a prerelease or a build-metadata version without ' +
                'guessing, and a wrong guess publishes `next` below `latest`. If the release train has legitimately ' +
                'moved to a prerelease, decide the base here explicitly.',
        );
    }
    if (!/^\d+$/.test(String(build))) {
        fail(
            `--build must be a non-negative integer, got ${JSON.stringify(String(build))}. It is the only thing ` +
                'making one `next` version sort above the last; a non-numeric build would publish an unordered channel.',
        );
    }
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}-next.${build}`;
}

/** Indentation of an existing manifest, so a rewrite is a one-field diff and not a reformat. */
function indentOf(source) {
    const m = source.match(/\n([ \t]+)"/);
    return m ? m[1] : '    ';
}

/**
 * The packages the `next` sweep publishes: the root-workspace set, minus `private`, minus
 * `@girs/*` — EXACTLY what `gjsify foreach --no-private --exclude '@girs/*'` selects in
 * `release.yml`'s publish step, derived from the same manifests rather than listed here.
 *
 * The twelve dedicated-job packages (`@gjsify/node-gi`, `@gjsify/napi` and their
 * platform children, the `gtk`/`gl`/`node`/`gi-runtime-*` bundles) are absent for free:
 * they are not workspace members at all, which is why `release-only-plan.mjs` has to
 * plan them separately. They stay on `latest` — see the ADR.
 */
function sweepPackages(ctx) {
    return ctx.packages.filter((p) => !p.private && !p.name.startsWith('@girs/'));
}

function plan(root, version) {
    const ctx = createContext({ root });
    const sweep = sweepPackages(ctx);
    const published = new Set(sweep.map((p) => p.name));
    const failures = [];
    const edits = [];
    let edgeCount = 0;

    for (const pkg of sweep) {
        const specEdits = [];
        for (const block of DEP_BLOCKS) {
            const deps = pkg.manifest[block];
            if (!deps || typeof deps !== 'object') continue;
            for (const [name, range] of Object.entries(deps)) {
                if (typeof range !== 'string') continue;
                if (range.startsWith('workspace:')) {
                    edgeCount += 1;
                    const operator = range.slice('workspace:'.length);
                    if (!REWRITABLE_OPERATORS.has(operator)) {
                        failures.push(
                            `${pkg.name} (${block}) declares ${name} as ${JSON.stringify(range)}. ` +
                                '`gjsify pack` passes an operator it does not model through VERBATIM, so this would ' +
                                'publish that literal range instead of a pin into this closure. Spell it ' +
                                '`workspace:*`, `workspace:^` or `workspace:~`.',
                        );
                        continue;
                    }
                    if (!published.has(name)) {
                        failures.push(
                            `${pkg.name} (${block}) depends on ${name} via ${JSON.stringify(range)}, but ${name} is ` +
                                'not in the `next` sweep (private, `@girs/*`, or not a workspace member). pack would ' +
                                `pin it at ${version}, a version that will never exist on the registry — and unlike ` +
                                'the ordering hazard `verify-published-closure.mjs` detects, no later publish can ' +
                                'repair it. Either bring the dependency into the sweep or make the edge a real range.',
                        );
                        continue;
                    }
                    if (operator === '^' || operator === '~') specEdits.push({ block, name, from: range });
                    continue;
                }
                // A literal intra-repo pin survives the rewrite untouched and therefore points
                // OUT of this closure, at a version built from a different commit. The one
                // package in the repository that carries these (`@gjsify/napi`, pinning its two
                // platform children) is a dedicated-job package and not in the sweep.
                if (published.has(name)) {
                    failures.push(
                        `${pkg.name} (${block}) pins the sibling ${name} literally as ${JSON.stringify(range)}. ` +
                            'The rewrite only touches `workspace:` specs, so this edge would leave the published ' +
                            `closure pointing at ${range} while every other edge points at ${version}. Use ` +
                            '`workspace:^`.',
                    );
                }
            }
        }
        edits.push({ name: pkg.name, dir: pkg.dir, rel: pkg.rel, from: pkg.manifest.version, specEdits });
    }

    return { ctx, sweep, published, failures, edits, edgeCount };
}

function applyEdits(root, version, edits) {
    // The root manifest first: it is what `release-train` grades a committed rewrite
    // against, and what `nextChannelVersion` derived the base from.
    const targets = [{ rel: '.', dir: root, specEdits: [] }, ...edits];
    let versionsWritten = 0;
    let specsWritten = 0;
    for (const target of targets) {
        const path = join(target.dir, 'package.json');
        const source = readFileSync(path, 'utf8');
        const manifest = JSON.parse(source);
        manifest.version = version;
        versionsWritten += 1;
        for (const edit of target.specEdits) {
            manifest[edit.block][edit.name] = 'workspace:*';
            specsWritten += 1;
        }
        writeFileSync(path, `${JSON.stringify(manifest, null, indentOf(source))}\n`);
    }
    return { versionsWritten, specsWritten };
}

const root = process.cwd();
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const build = flagValue('--build', process.env.GITHUB_RUN_NUMBER ?? '0');
const version = nextChannelVersion(rootManifest.version, build);

const report = { base: rootManifest.version, version, build: String(build) };

if (has('--check') || write) {
    const { sweep, failures, edits, edgeCount } = plan(root, version);
    report.packages = sweep.length;
    report.workspaceEdges = edgeCount;
    report.specRewrites = edits.reduce((n, e) => n + e.specEdits.length, 0);
    if (failures.length > 0) {
        process.stderr.write(
            `next-channel-version: the tree cannot be rewritten for the \`next\` channel ` +
                `(${failures.length} finding(s)).\n\n`,
        );
        for (const f of failures) process.stderr.write(`  - ${f}\n`);
        process.stderr.write('\n');
        process.exit(1);
    }

    if (write) {
        const written = applyEdits(root, version, edits);
        // Re-read from disk rather than trusting the writes: the whole point of the
        // closure is a property of the FILES the sweep will pack, and the only way to
        // claim it is to look at them again.
        const after = plan(root, version);
        const wrongVersion = after.sweep.filter((p) => p.manifest.version !== version);
        const leftover = after.edits.reduce((n, e) => n + e.specEdits.length, 0);
        if (after.failures.length > 0 || wrongVersion.length > 0 || leftover > 0) {
            fail(
                `the rewrite did not land. ${wrongVersion.length} package(s) still carry another version ` +
                    `(${wrongVersion
                        .slice(0, 5)
                        .map((p) => `${p.name}@${p.manifest.version}`)
                        .join(', ')}), ` +
                    `${leftover} \`workspace:^|~\` spec(s) remain, ${after.failures.length} finding(s) appeared. ` +
                    'Nothing may be published from this checkout.',
            );
        }
        report.versionsWritten = written.versionsWritten;
        report.specsRewritten = written.specsWritten;
    }
}

if (has('--github-output')) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) fail('--github-output needs $GITHUB_OUTPUT');
    appendFileSync(out, `version=${version}\nbase=${rootManifest.version}\n`);
}

if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (write) {
    process.stdout.write(
        `next-channel-version: rewrote ${report.versionsWritten} manifest version(s) to ${version} and ` +
            `${report.specsRewritten} workspace spec(s) to \`workspace:*\` across ${report.packages} published ` +
            `package(s).\nThis checkout must NOT be committed — \`git checkout -- .\` undoes it.\n`,
    );
} else if (has('--check')) {
    process.stdout.write(
        `next-channel-version: ${version} — ${report.packages} package(s), ${report.workspaceEdges} ` +
            `workspace edge(s), ${report.specRewrites} to pin exactly. Rewritable.\n`,
    );
} else {
    process.stdout.write(`${version}\n`);
}
