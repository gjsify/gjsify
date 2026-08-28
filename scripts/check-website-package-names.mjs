#!/usr/bin/env node
// Every `@gjsify/*` name the WEBSITE quotes must be a real workspace package.
//
// The website's API-support tables tell readers which package to install. Five rows
// of `website/src/data/web-standards.ts` named `@gjsify/streams` and
// `@gjsify/globals`, neither of which has ever existed — the packages are
// `@gjsify/web-streams` and `@gjsify/node-globals`. A published table is the one
// place a wrong package name reaches someone who cannot check it against the tree,
// and renames land in `packages/` without anything walking the prose that cites them.
//
// Scoped to `website/src` ON PURPOSE. The same check run repo-wide is not worth
// having: source and tests legitimately name ~76 packages that do not exist —
// `@gjsify/a`, `@gjsify/e2e-pub-otp`, `@gjsify/does-not-exist` and the rest are
// fixtures and deliberate negatives — so it would need an allowlist longer than
// itself, growing with every new e2e suite. Under `website/src` there are no
// fixtures, so the allowlist is empty and stays empty.
//
//   node scripts/check-website-package-names.mjs

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { CODE_SOURCE_EXTENSIONS } from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';

const tracked = (glob) =>
    execSync(`git ls-files -- ${glob}`, { maxBuffer: 1 << 28 })
        .toString()
        .trim()
        .split('\n');

const real = new Set();
for (const f of tracked("'**/package.json'").filter((f) => f && !f.includes('node_modules'))) {
    try {
        const { name } = JSON.parse(readFileSync(f, 'utf8'));
        if (name) real.add(name);
    } catch {
        // A package.json this script cannot parse is `gjsify` conformance's problem, not this one.
    }
}

// Quoted only: prose may discuss a package that was renamed or never shipped, and the
// install name a reader copies is always inside quotes in a data file or component —
// or, on a docs page, inside backticks, which this regex already counts as a quote.
const QUOTED = /['"`](@gjsify\/[a-z0-9][a-z0-9._/-]*)['"`]/g;

const bad = [];
// The source half is the shared vocabulary plus the website's own markup and data
// formats. The hand-written list here named neither `.tsx` nor `.vue`, and a Starlight
// site gains `.tsx` islands as a matter of course — an install name a reader copies out
// of one would have been the one name nothing verified.
const WEBSITE_FILE = new RegExp(`\\.(${[...CODE_SOURCE_EXTENSIONS, 'astro', 'vue', 'json', 'md', 'mdx'].join('|')})$`);

for (const file of tracked('website/src').filter((f) => WEBSITE_FILE.test(f))) {
    let src;
    try {
        src = readFileSync(file, 'utf8');
    } catch {
        continue;
    }
    src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(QUOTED)) {
            // `@scope/name/subpath` → the package is the first two segments.
            const pkg = m[1].split('/').slice(0, 2).join('/');
            if (!real.has(pkg)) bad.push({ file, line: i + 1, pkg, text: line.trim().slice(0, 120) });
        }
    });
}

if (bad.length === 0) {
    process.stdout.write('check-website-package-names: every @gjsify/* name the website quotes resolves.\n');
    process.exit(0);
}

process.stderr.write(
    `check-website-package-names: ${bad.length} reference(s) name a package that does not exist in this workspace.\n` +
        '  The website is published, so this is an install command a reader cannot make work.\n' +
        '  Fix the name, or add the package — do not silence the check.\n\n',
);
for (const b of bad) process.stderr.write(`  ${b.file}:${b.line}  ${b.pkg}\n      ${b.text}\n`);
process.exit(1);
