// Every `@girs/*` declaration in this repository must name an exact version.
//
// WHY EXACTNESS AND NOT CONSISTENCY. `gjsify upgrade --check` already holds that every
// manifest declares a dependency at the SAME range, and that is a different question: a
// tree where every declaration agrees on `^4.1.0` is perfectly consistent, our lockfile
// pins it, and none of that reaches a consumer. What a stranger installs against is the
// DECLARATION in a published package, with no lockfile of ours — and `@gjsify/gtk-host`
// consumes the `@girs/<ns>/vocabulary` subpath. A minor `@girs` release moving that subpath
// under such an install is the hazard ADR 0029 § Risks 1 names.
//
// WHY A SCRIPT AND NOT `gjsify upgrade --check --exact`. That option exists and answers
// the same question for a user of the CLI. It cannot answer it HERE: this job reaches the
// CLI through the PUBLISHED bootstrap (ADR 0002 — a tree that is installed but not built
// has no other), so a check written against a flag added in the same commit fails with
// `Unknown argument` until the next release. Measured, on this very change. Reading
// package.json files needs no CLI at all, which is also what the job's own header says it
// is for.
//
// The two are not a duplicated rule: this walks files, the CLI walks its dependency
// groups, and only this one runs on every PR.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
// Generated and vendored trees. `dist-templates` is spelled out because the set is
// matched by EXACT name: it holds `create-gjsify`'s templates rendered at build time,
// is gitignored, and its copies of a manifest are therefore whatever the last build
// left behind. The uniformity rule below tripped over exactly that — CI carried a
// stale 4.4.0 rendering while every tracked manifest already said 4.5.0, so the gate
// reported a mixed tree that does not exist in the repository.
//
// A name-by-name list is the weak part of this: the next generated directory will need
// the same edit. Asking git what is ignored would be the honest question, at the cost
// of a process call per candidate.
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'lib',
    'dist',
    'dist-templates',
    'refs',
    'types-dev',
    'types-release',
]);

/** Every package.json in the tree, including the ones outside the workspace set. */
function manifests(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        let s;
        try {
            s = statSync(full);
        } catch {
            continue;
        }
        if (s.isDirectory()) manifests(full, out);
        else if (entry === 'package.json') out.push(full);
    }
    return out;
}

/** A range is exact when it is a bare version — no operator, no range syntax. */
const isExact = (range) => /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(range);

/**
 * `@girs/*` packages the current release train does not publish.
 *
 * Both still carry the namespace-version-as-release form ADR 0019 Decision 3 removed
 * (`0.1.0-4.0.0-rc.5` = library version + the ts-for-gir that built it), and
 * `npm view <pkg> version` confirms nothing newer exists — they stopped being cut long
 * before 4.x. Holding them to the train's version would demand a version that cannot be
 * installed, so they are exempt from the uniformity rule and NOT from the exactness one.
 *
 * That they are stale is a real finding, not a settled state; it belongs in a release
 * question, not in this gate.
 */
const OFF_THE_RELEASE_TRAIN = new Set(['@girs/gwebgl-0.1', '@girs/gjsifywebrtc-0.1']);

const byVersion = new Map();
const offenders = [];
let declarations = 0;

for (const file of manifests(root)) {
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        continue;
    }
    for (const field of DEP_FIELDS) {
        const map = pkg[field];
        if (!map || typeof map !== 'object') continue;
        for (const [name, range] of Object.entries(map)) {
            if (!name.startsWith('@girs/')) continue;
            // Workspace links are resolved locally and carry no registry range.
            if (typeof range !== 'string' || range.startsWith('workspace:')) continue;
            declarations++;
            if (!isExact(range)) offenders.push({ file: relative(root, file), field, name, range });
            else if (!OFF_THE_RELEASE_TRAIN.has(name))
                (byVersion.get(range) ?? byVersion.set(range, []).get(range)).push(`${relative(root, file)}  ${name}`);
        }
    }
}

// EXACT is not enough — they must all name the SAME version.
//
// Every `@girs/*` package requires its siblings at its own exact version, so a tree
// where one manifest says 4.4.0 and another 4.5.0 cannot be installed from scratch at
// all. The failure hides on a developer machine, where `node_modules` is already
// populated and nothing re-resolves, and surfaces only where CI installs cold — which
// on 2026-09-01 meant three green Linux legs and red darwin-x64, win32-x64 node legs
// off fourteen declarations left behind by an upgrade.
//
// That those fourteen were missed is structural rather than careless: `gjsify upgrade`
// walks the WORKSPACE, and `packages/napi/*` and `packages/node-gi/*` are not in its
// globs. This script walks the tree and sees 471 declarations where the CLI sees 451 —
// so it is the only place that can ask this question.
if (offenders.length === 0 && byVersion.size > 1) {
    const versions = [...byVersion.entries()].sort((a, b) => b[1].length - a[1].length);
    console.error(
        `check-girs-exact-pins: FAIL. ${declarations} @girs declaration(s) name ${byVersion.size} different versions.\n`,
    );
    for (const [version, sites] of versions) {
        console.error(`  ${version} — ${sites.length} declaration(s)`);
        for (const site of sites.slice(0, 8)) console.error(`      ${site}`);
        if (sites.length > 8) console.error(`      … and ${sites.length - 8} more`);
    }
    console.error(
        `\nA @girs package requires its siblings at its own exact version, so a mixed tree\n` +
            `cannot be installed cold. Raise the minority: \`gjsify upgrade --latest --exact --filter @girs\`\n` +
            `covers the workspace, and packages/napi + packages/node-gi are edited by hand.`,
    );
    process.exit(1);
}

if (offenders.length > 0) {
    console.error(
        `check-girs-exact-pins: FAIL. ${offenders.length} of ${declarations} @girs declaration(s) are not exact:\n`,
    );
    for (const o of offenders) console.error(`  ${o.file}  ${o.field}.${o.name}  ${o.range}`);
    console.error(
        `\nFix: \`gjsify upgrade --latest --exact --filter @girs\` covers the workspace set;\n` +
            `packages/napi and packages/node-gi sit outside it and are pinned by hand.`,
    );
    process.exit(1);
}

console.log(
    `check-girs-exact-pins: OK. ${declarations} @girs declaration(s), every one exact, all at ${[...byVersion.keys()][0] ?? 'n/a'}.`,
);
