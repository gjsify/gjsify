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
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'dist', 'refs', 'types-dev', 'types-release']);

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
        }
    }
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

console.log(`check-girs-exact-pins: OK. ${declarations} @girs declaration(s), every one exact.`);
