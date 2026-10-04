#!/usr/bin/env node
// Which of Learn6502's shared `.blp` templates project through `?shared-tree` without a loss,
// and which tags of each still have no member in the NativeScript barrels.
//
// A MEASUREMENT, NOT A GATE: the Learn6502 sources live in a sibling repository
// (`../easy6502`), which CI here does not check out, so nothing can fail on it. Run it where
// both are present; without the sibling it says so and exits 0.
//
//   node scripts/measure-learn6502-projection.mjs [<dir>] [--json]
//
// The projection is asked through the SAME seam the bundler plugin uses (`gtypeName`), and a
// file counts as "projects" under the plugin's own rule: `lost` is empty. The barrel members
// are read off the `export { Class as Member }` lines of `src/namespace/*.ts`, which is the
// list `elementFor` resolves against.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gtypeName, parseBlueprint, projectToSharedNode } from '../packages/infra/blueprint/src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dir = resolve(args.find((arg) => !arg.startsWith('--')) ?? join(root, '../easy6502/packages/app-gnome/src'));

if (!existsSync(dir)) {
    console.log(
        `measure-learn6502-projection: ${dir} is absent (the easy6502 sibling is not checked out) — nothing measured.`,
    );
    process.exit(0);
}

const blueprintFiles = (from) =>
    readdirSync(from).flatMap((name) => {
        const path = join(from, name);
        if (statSync(path).isDirectory()) return blueprintFiles(path);
        return name.endsWith('.blp') ? [path] : [];
    });

const barrelClasses = new Set();
const namespaceDir = join(root, 'packages/nativescript-bridge/adwaita/src/namespace');
for (const name of readdirSync(namespaceDir)) {
    if (!name.endsWith('.ts')) continue;
    for (const match of readFileSync(join(namespaceDir, name), 'utf8').matchAll(/export \{\s*(\w+)\s+as\s+\w+\s*\}/g)) {
        barrelClasses.add(match[1]);
    }
}

const tagsOf = (node, into = new Set()) => {
    into.add(node.tag);
    for (const child of node.children ?? []) tagsOf(child, into);
    return into;
};

const rows = [];
for (const file of blueprintFiles(dir).sort()) {
    const row = { file: relative(dir, file) };
    try {
        const { node, lost } = projectToSharedNode(parseBlueprint(readFileSync(file, 'utf8'), file), { gtypeName });
        const tags = [...tagsOf(node)];
        // A `$Name` extern is a registered template class, not a barrel member (ADR 0093).
        const missing = tags.filter((tag) => !barrelClasses.has(tag));
        Object.assign(row, {
            projects: lost.length === 0,
            lost: [...new Set(lost.map((loss) => loss.kind))].sort(),
            missing: missing.sort(),
        });
    } catch (error) {
        Object.assign(row, { projects: false, error: String(error.message).split('\n')[0], lost: [], missing: [] });
    }
    rows.push(row);
}

if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
} else {
    for (const row of rows) {
        const detail =
            row.error ??
            [
                row.lost.length ? `lost: ${row.lost.join(',')}` : '',
                row.missing.length ? `no barrel member: ${row.missing.join(',')}` : '',
            ]
                .filter(Boolean)
                .join(' | ');
        console.log(`${row.projects ? 'PROJECTS' : 'refused '}  ${row.file}${detail ? `  — ${detail}` : ''}`);
    }
    const projecting = rows.filter((row) => row.projects).length;
    const lostKinds = {};
    const missingTags = {};
    for (const row of rows) {
        for (const kind of row.lost) lostKinds[kind] = (lostKinds[kind] ?? 0) + 1;
        for (const tag of row.missing) missingTags[tag] = (missingTags[tag] ?? 0) + 1;
    }
    console.log(`\n${projecting}/${rows.length} project without a loss`);
    console.log(`remaining loss kinds (files): ${JSON.stringify(lostKinds)}`);
    console.log(`tags with no NS barrel member (files): ${JSON.stringify(missingTags)}`);
}
