#!/usr/bin/env node
// Pull the workspace-EXCLUDED apps onto the release train being cut.
//
// Invoked from `.release-it.json` as:
//   node scripts/bump-release-train-ranges.mjs ${latestVersion} ${version}
//
// WHY IT EXISTS. `@release-it/bumper` globs `showcases/*/*/package.json` and
// `examples/*/*/package.json`, but it rewrites exactly one thing in each: the
// `version` field. Dependency RANGES it never touches — and three apps under
// `showcases/` are `!`-negated out of the root `workspaces` globs
// (`adwaita-storybook-nativescript`, `adwaita-widgets-nativescript`,
// `three-geometry-teapot-nativescript`: they carry their own `node_modules` and
// their own NS toolchain), so their `@gjsify/*` deps are ordinary npm ranges
// that resolve through the registry. Nothing kept those current, so the instant
// release-it bumped the workspace to the next version they all named the
// previous one, and the `release-train` conformance rule failed inside the same
// `after:bump` hook. That rule was therefore unsatisfiable DURING a cut from the
// day it landed; the v0.32.0 attempt was the first cut since, and it died there
// with 11 findings. This script is the half that was missing.
//
// WHY NOT `workspace:^` IN THOSE THREE MANIFESTS, which would hand the problem
// to machinery that already exists (`gjsify pack` substitutes `workspace:`
// ranges). Because nothing ever packs them — they are apps, not packages. That
// substitution happens in the TARBALL and leaves the source at `workspace:^`;
// here the COMMITTED manifest is what `npm install` reads in a user's clone, so
// it has to carry a concrete version. `findWorkspaceRoot()` is also deliberately
// strict about members, and these three are non-members on purpose.
//
// WHY NOT REUSE `rewriteWorkspaceDeps` FROM `commands/pack.ts`. Its contract is
// adopted here verbatim (see below); its code cannot be. It is module-private
// (pack.ts exports only `packCommand`/`packWorkspace`/`collectPackedFiles`/
// `collectTypeDeclarationRefs`); its input domain is the `workspace:` protocol,
// which is precisely the set `release-train` EXCLUDES, so pointed at these
// manifests it would return them unchanged; it resolves versions from
// `discoverWorkspaces()`, i.e. workspace MEMBERS, and these apps are negated out;
// and it lives in TypeScript compiled to `packages/infra/cli/lib`, a BUILD
// OUTPUT, whereas every other `after:bump` hook script is pure Node with no
// dependency beyond builtins. Generalising a private packer function from
// `workspace:` ranges to arbitrary ones, exporting it, and making a release hook
// depend on the CLI's build output is a risky refactor of the code path that
// produces every tarball, in service of a different problem.
//
// WHAT IS REUSED IS THE RULE. `pack`'s contract — "a `workspace:` range is
// either substituted correctly or the pack FAILS; it is never silently
// published" — is the whole point, because the failure this rule exists to
// prevent is a manifest that LOOKS authoritative and is not. So this script
// never skips-and-continues. It collects every problem, writes NOTHING, and
// exits 1 on: a manifest that does not parse, a governed range that is not the
// version being replaced, a `@gjsify/*` dependency that names no package in this
// monorepo, or one whose own manifest was not bumped. The write pass runs only
// once every edge has been proven substitutable, so a failure leaves the tree
// untouched instead of half-rewritten.
//
// WHY "a governed range that is not `^${latestVersion}`" IS A FAILURE rather
// than something to repair. `main` is branch-protected and the audit that runs
// `release-train` is a required check, so on the pre-bump tree EVERY governed
// range has already been proven to equal `^${latestVersion}` — it is the only
// value that passes. A different one means the bump ran on a tree that never
// passed that gate, and quietly rewriting it would publish a release whose
// provenance nobody checked. `^${nextVersion}` is the one exception: that is a
// re-run of the hook, and it is a no-op.
//
// WHY IT TAKES THE VERSION AS AN ARGUMENT, in the shape
// `bump-docs-version.mjs` already uses. At `after:bump` time the root
// package.json has been rewritten, so the target version could be read from
// disk — but a release hook that infers what it is releasing is a hook that
// breaks the first time the inference is wrong, silently and inside the few
// seconds the bumped tree exists. release-it knows both numbers; it passes both.
//
// WHY IT SHARES ITS SELECTION WITH THE RULE rather than restating it. The rule
// deliberately does NOT govern `workspace:`/`file:`/`link:` (already pinned to
// this checkout) nor `*`/`latest` (loose about the future, never stale about the
// past — `examples/*` uses that on purpose for dev-only tooling). A rewriter
// with its own copy of that list would eventually "fix" an edge the rule allows,
// or skip one it does not, and the disagreement would only ever surface as a
// failed release. So the set comes from `trainEdges()` in the rule module: ONE
// definition, two consumers.
//
// WHAT IT DOES NOT DO: verify itself. `audit-runtimes --check --strict` runs
// immediately after in the same hook and is the gate; a second check here would
// be a guard watching a guard.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectStandaloneApps, trainEdges, trainRange } from './manifest-conformance/rules/release-train.mjs';

const [, , latestVersion, nextVersion] = process.argv;

if (!latestVersion || !nextVersion) {
    console.error('usage: bump-release-train-ranges.mjs <latestVersion> <nextVersion>');
    process.exit(1);
}

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const wanted = trainRange(nextVersion);
const previous = trainRange(latestVersion);

/** Directory groups that hold this monorepo's `<group>/<x>/<y>` packages. */
const PACKAGE_GROUPS = ['packages', 'showcases', 'examples'];

/**
 * `@gjsify/<name>` → the manifest that DEFINES it, so a range can be checked
 * against a package that provably exists here rather than assumed.
 *
 * This is the half `release-train` cannot see: the rule proves a range names the
 * current version, this proves the thing it names is a real member of the train
 * whose own manifest the bumper reached. A name that resolves to nothing would
 * get `^${nextVersion}` written against a package that is never published under
 * it — the ETARGET failure again, arrived at from the other side.
 *
 * @returns {Map<string, {rel: string, version: unknown}>}
 */
function indexMonorepoPackages() {
    const index = new Map();
    for (const group of PACKAGE_GROUPS) {
        const groupDir = join(repoRoot, group);
        if (!existsSync(groupDir)) continue;
        for (const pillar of readdirSync(groupDir, { withFileTypes: true })) {
            if (!pillar.isDirectory()) continue;
            for (const pkg of readdirSync(join(groupDir, pillar.name), { withFileTypes: true })) {
                if (!pkg.isDirectory()) continue;
                const rel = `${group}/${pillar.name}/${pkg.name}`;
                const path = join(repoRoot, rel, 'package.json');
                if (!existsSync(path)) continue;
                let manifest;
                try {
                    manifest = JSON.parse(readFileSync(path, 'utf8'));
                } catch {
                    // Reported by the `unreadable` pass below, which sees the
                    // same file — failing here would report it twice.
                    continue;
                }
                if (typeof manifest.name === 'string') index.set(manifest.name, { rel, version: manifest.version });
            }
        }
    }
    return index;
}

/**
 * The manifest's own indentation, so a rewrite is a value change and not a
 * reformat of the whole file. `@release-it/bumper` writes these files the same
 * way (detected indent, `JSON.stringify`), which is why the round trip is
 * lossless here — measured across all 76 standalone-app manifests under
 * `showcases` and `examples`, none of which re-serialises differently.
 *
 * @param {string} raw
 * @returns {string}
 */
function detectIndent(raw) {
    const match = /\n([ \t]+)"/.exec(raw);
    return match ? match[1] : '  ';
}

const { apps, unreadable } = collectStandaloneApps(repoRoot);
const index = indexMonorepoPackages();

/** Everything that stops the cut. Collected in full — one run, one verdict. */
const failures = unreadable.map(
    (rel) =>
        `${rel}/package.json does not parse, so its \`@gjsify/*\` ranges can be neither read nor rewritten. ` +
        `A manifest that cannot be parsed is invisible to \`release-train\` too, which is the exact shape ` +
        `this hook exists to prevent: a file that looks authoritative and is not.`,
);
/** Proven-substitutable edits, applied only once nothing failed. */
const planned = [];

for (const { rel, manifest } of apps) {
    const edits = [];
    for (const { block, name, range } of trainEdges(manifest)) {
        if (range === wanted) continue;
        if (range !== previous) {
            failures.push(
                `${rel}/package.json: \`${block}.${name}\` is \`${range}\`, which is neither the version being ` +
                    `replaced (\`${previous}\`) nor the one being cut (\`${wanted}\`). \`main\` is gated by the same ` +
                    `\`release-train\` rule as a required check, so every governed range on the pre-bump tree has ` +
                    `already been proven to equal \`${previous}\`. Rewriting this one anyway would put a release ` +
                    `behind a manifest nothing verified.`,
            );
            continue;
        }
        const target = index.get(name);
        if (!target) {
            failures.push(
                `${rel}/package.json: \`${block}.${name}\` names no package in this monorepo, so \`${wanted}\` ` +
                    `cannot be substituted for it — the range would promise a publish that will never happen. ` +
                    `This is how \`adwaita-storybook-nativescript\` came to request a version that was never ` +
                    `published, failing every install there with ETARGET and nothing to notice it.`,
            );
            continue;
        }
        if (target.version !== nextVersion) {
            failures.push(
                `${rel}/package.json: \`${block}.${name}\` resolves to ${target.rel}, whose own \`version\` is ` +
                    `\`${String(target.version)}\` and not \`${nextVersion}\`. \`@release-it/bumper\` did not reach ` +
                    `that manifest, so \`${wanted}\` would name a version this release never publishes — the shape ` +
                    `that cut v0.27.0 with \`@gjsify/napi\`'s children pinned a release behind.`,
            );
            continue;
        }
        edits.push({ block, name });
    }
    if (edits.length > 0) planned.push({ rel, edits });
}

if (failures.length > 0) {
    console.error(`[bump-release-train-ranges] REFUSING to rewrite — ${failures.length} unsubstitutable range(s):`);
    for (const line of failures) console.error(`  - ${line}`);
    console.error('');
    console.error(
        'Nothing was written: the release train (ADR 0008) guarantees compatibility only WITHIN a release, and an ' +
            'app outside the workspace gets that guarantee only if every range it names is a package this cut ' +
            'actually publishes. Fix the manifest on `main` and re-dispatch the cut.',
    );
    process.exit(1);
}

let changedRanges = 0;
for (const { rel, edits } of planned) {
    const path = join(repoRoot, rel, 'package.json');
    const raw = readFileSync(path, 'utf8');
    const manifest = JSON.parse(raw);
    for (const { block, name } of edits) manifest[block][name] = wanted;
    writeFileSync(path, `${JSON.stringify(manifest, null, detectIndent(raw))}\n`);
    changedRanges += edits.length;
    console.log(`[bump-release-train-ranges] ${rel}/package.json: ${edits.length} range(s) ${previous} -> ${wanted}`);
}

console.log(
    changedRanges === 0
        ? `[bump-release-train-ranges] every standalone app already names ${wanted}`
        : `[bump-release-train-ranges] updated ${changedRanges} range(s) across ${planned.length} app(s) to ${wanted}`,
);
