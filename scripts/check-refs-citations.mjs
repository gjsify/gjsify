#!/usr/bin/env node
// Every `refs/<submodule>/<path>` cited as provenance is a path that exists.
//
// THE INCIDENT
//
// ADR 0004's core-first arrangement and every "core-backed" claim in the Adwaita
// tree rest on citations: a header says which upstream file a behaviour was ported
// from, and a reader is expected to open it. 180 of those coordinates name the
// Adwaita family alone. NINETEEN of them named a file that has never existed — not
// in the pinned commit, and not in any of libadwaita's 5325 commits.
//
// They are not bump rot. They are the file names a reader would GUESS: libadwaita
// spells its partials by widget FAMILY, so `_lists.scss` holds AdwActionRow,
// AdwComboRow and AdwExpanderRow, and `_misc.scss` holds toasts, the status page
// and the two split views — but the citations said `_action-row.scss`,
// `_combo-row.scss`, `_expander-row.scss`, `_status-page.scss`, `_toast.scss`,
// `_dialog.scss`, `_tab-bar.scss`, `_carousel.scss`, `_banner.scss`. One named
// `adw-menu-button.c` for a type libadwaita does not have at all (it is
// `GtkMenuButton`), and one pointed at a top-level `scss/` directory of the
// vendored adwaita-web tree, which keeps its partials one level deeper.
//
// That last one is why no wrong spelling appears here in full: written out, it is
// a citation, and this check flags its own explanation. It did. The same edge runs
// the other way and was missed there — a ledger entry that spells the coordinate it
// excuses becomes that coordinate's last citer, so the "nothing cites this any more"
// arm can never fire for it. Hence {@link SELF}: this file explains coordinates, it
// does not vouch for them.
//
// `status/sections/adwaita-web-roadmap.md` ALREADY warned about this in prose, and
// named the right spellings. It happened nineteen times anyway, because prose
// cannot fail.
//
// WHAT IT CHECKS
//
//   1. Every coordinate inside a submodule that IS checked out resolves to a file
//      or a directory on disk.
//   2. Every coordinate names a submodule `.gitmodules` DECLARES, so a reader can
//      run `git submodule update --init` and get it. One that does not is
//      unfollowable by construction — worse than a wrong path, because there is
//      nothing to init — and needs an entry in {@link UNDECLARED_SUBMODULES}.
//
// A DECLARED submodule with an empty directory SKIPS: most jobs check out none of
// them, and a skip is honest where a hard failure would only teach people to stop
// citing. The Adwaita job initialises `refs/libadwaita` precisely so this gate has
// something to check on every PR — see `audit-runtimes.yml`.
//
// WHAT IT DOES NOT CHECK: `docs/attribution.md` also asks that provenance be
// spelled as a `refs/` path rather than an upstream URL. This gate only holds the
// paths that ARE spelled; a header citing a URL instead has nothing here to fail,
// and it stays a convention.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-refs-citations.mjs [--root <dir>]

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/**
 * Citations this gate cannot follow because the submodule was never declared, and
 * what it would take. The bar is the same as everywhere else: "it would be work"
 * is not a reason — a coordinate a reader cannot init is a coordinate to fix.
 */
const UNDECLARED_SUBMODULES = {
    'mcp-typescript-sdk':
        '13 ported-test headers in tests/integration/mcp-typescript-sdk/ (attribution template C) cite the upstream suite the specs were rewritten from. The submodule was never added: modelcontextprotocol/typescript-sdk has no pin here, so the coordinates are correct-looking and uninitialisable. Fix = add the submodule + pin it; until then the headers still say truthfully WHICH upstream test each spec came from.',
    'unicorn-magic':
        'One shim (packages/infra/rolldown-plugin-gjsify/src/shims/unicorn-magic.ts) declares its own deferral in the same sentence — "refs/unicorn-magic/node.js (when added — for now mirrored from node_modules/unicorn-magic@0.3.0)". Fix = add the submodule, or drop the marker and cite the npm version it really mirrors.',
};

/** This gate's own tracked path, posix-spelled — see {@link vouchedFor}. */
const SELF = 'scripts/check-refs-citations.mjs';

// ONE extension list, read from both ends: which tracked files this gate OPENS,
// and which path shapes count as a citation once opened. They were two lists, and
// the smaller one silently decided coverage — 28 tracked files (18 `.cc`, 4
// `.vala`, 2 `.rs`, 2 `.toml`, an `.astro` and a `meson.build`) cited upstream
// coordinates the scan never read while the other list already blessed them as
// citable, hiding the whole native/Rust/Vala provenance surface.
const CITABLE =
    'c|h|cpp|cc|m|rs|vala|py|sh|ts|tsx|mts|cts|js|mjs|cjs|jsx|scss|sass|css|md|mdx|html|xml|ui|json|ya?ml|svg|blp|gir|toml|astro|txt|build';

/** Text files only — `git ls-files` also lists PNGs, prebuilt `.so`s and typelibs. */
const TEXT_FILE = new RegExp(`\\.(?:${CITABLE})$`);

/** …plus the one build file that carries citations and has no extension to match. */
const TEXT_BASENAME = /(?:^|\/)meson\.build$/;

// A coordinate: `refs/<name>/<path>`, where a path segment may contain a brace
// group so `{_checkbox,_radio}.scss` is read whole and expanded rather than
// truncated at the brace.
const CITATION = /\brefs\/([A-Za-z0-9._-]+)((?:\/(?:\{[^}\s]*\}|[A-Za-z0-9._*-])+)+)/g;

// What separates a citation from a slash-joined phrase. `refs/heads/main` is a git
// ref namespace and `refs/finalizer/wrap/external/tags` is prose about weak refs —
// both match the shape, neither is provenance. A DECLARED submodule name settles it
// on its own — a bare directory under one is a real citation with no extension, and
// the adwaita-web incident above was exactly that; for anything else, only a path
// ending in a source-file extension counts.
const SOURCE_FILE = new RegExp(`\\.(?:${CITABLE})$`);

/** `{a,b}/c` → `a/c`, `b/c`. Left to right, so nested groups resolve too. */
function expandBraces(path) {
    const group = /\{([^}]*)\}/.exec(path);
    if (!group) return [path];
    const before = path.slice(0, group.index);
    const after = path.slice(group.index + group[0].length);
    return group[1].split(',').flatMap((alternative) => expandBraces(before + alternative + after));
}

/** Every submodule path `.gitmodules` declares, as the bare name under `refs/`. */
function declaredSubmodules(root) {
    const text = readFileSync(join(root, '.gitmodules'), 'utf8');
    const names = new Set();
    for (const [, path] of text.matchAll(/^\s*path\s*=\s*refs\/(\S+)\s*$/gm)) names.add(path);
    return names;
}

/** A declared submodule with no files in it is not checked out — nothing to hold. */
function isCheckedOut(root, name) {
    try {
        return readdirSync(join(root, 'refs', name)).length > 0;
    } catch {
        return false;
    }
}

const declared = declaredSubmodules(ROOT);
if (declared.size === 0) {
    console.error('check-refs-citations: .gitmodules declares no refs/ submodule — the read is broken, not the tree.');
    process.exit(1);
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '' && (TEXT_FILE.test(path) || TEXT_BASENAME.test(path)) && !path.startsWith('refs/'));

/** coordinate → the tracked files citing it, in posix spelling on every platform. */
const cited = new Map();
let placeholders = 0;
for (const trackedFile of tracked) {
    let text;
    try {
        text = readFileSync(join(ROOT, trackedFile), 'utf8');
    } catch {
        // A tracked path that is not readable here (a submodule gitlink, a file
        // removed in the working tree) cites nothing.
        continue;
    }
    for (const match of text.matchAll(CITATION)) {
        const submodule = match[1];
        // No real path ends in a sentence's full stop.
        const raw = `refs/${submodule}${match[2]}`.replace(/\.+$/, '');
        // `refs/…/_<name>.scss` and `refs/node/test/test-fs-*.js` name a FAMILY.
        // Neither resolves, and neither is wrong.
        const isPlaceholder = raw.includes('*') || /[_-]$/.test(raw) || text[match.index + match[0].length] === '<';
        if (isPlaceholder) {
            placeholders += 1;
            continue;
        }
        if (!declared.has(submodule) && !SOURCE_FILE.test(raw)) continue;
        for (const coordinate of expandBraces(raw)) {
            if (!cited.has(coordinate)) cited.set(coordinate, new Set());
            cited.get(coordinate).add(toPosixPath(trackedFile));
        }
    }
}

if (cited.size === 0) {
    console.error(
        'check-refs-citations: found no refs/ citation at all — that is a broken scan, not a tree with no provenance.',
    );
    process.exit(1);
}

const failures = [];
const skipped = new Map(); // submodule -> how many of its coordinates went unchecked
const undeclared = new Map(); // submodule -> coordinates
// Submodules something OTHER than this file cites. A ledger entry has to spell the
// coordinate it excuses, and this gate scans its own tracked file — so the entry
// was its own last citer: with the shim's marker deleted, `refs/unicorn-magic`
// stayed "cited" by the sentence explaining why it is ledgered, and the stale-entry
// arm below could never fire for it. Explaining a coordinate is not citing one.
const vouchedFor = new Set();
let checked = 0;

for (const [coordinate, files] of [...cited].sort()) {
    const submodule = coordinate.split('/')[1];
    const where = [...files].sort().join(', ');

    if (!declared.has(submodule)) {
        if (!undeclared.has(submodule)) undeclared.set(submodule, []);
        undeclared.get(submodule).push(coordinate);
        if ([...files].some((file) => file !== SELF)) vouchedFor.add(submodule);
        if (submodule in UNDECLARED_SUBMODULES) continue;
        failures.push(
            `${coordinate} names refs/${submodule}, which .gitmodules does not declare — there is nothing to\n` +
                `    init, so no reader can follow it. Cited by ${where}. Add the submodule, cite one that\n` +
                '    exists, or add an entry to UNDECLARED_SUBMODULES in this script with the reason.',
        );
        continue;
    }

    if (!isCheckedOut(ROOT, submodule)) {
        skipped.set(submodule, (skipped.get(submodule) ?? 0) + 1);
        continue;
    }

    checked += 1;
    try {
        statSync(join(ROOT, coordinate));
    } catch {
        failures.push(
            `${coordinate} does not exist in the checked-out refs/${submodule}. Cited by ${where}.\n` +
                '    Name the file upstream really has, or drop the citation if there is none.',
        );
    }
}

for (const [submodule, reason] of Object.entries(UNDECLARED_SUBMODULES)) {
    if (vouchedFor.has(submodule)) continue;
    failures.push(
        `refs/${submodule} is ledgered here as undeclared, but nothing outside this script cites it any\n` +
            `    more — drop the stale entry rather than leaving cover it no longer gives.\n` +
            `    (${reason.slice(0, 60)}…)`,
    );
}

if (failures.length > 0) {
    console.error(`check-refs-citations: ${failures.length} unfollowable citation(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        '\nA citation is the whole evidence behind a core-backed claim: it is what a reader opens to check\n' +
            'that the behaviour really came from upstream. One that resolves to nothing reads as verified\n' +
            'and is not, and the guessed spelling is the one that survives review.',
    );
    process.exit(1);
}

const ledgered = [...undeclared.keys()].length;
const skippedTotal = [...skipped.values()].reduce((sum, count) => sum + count, 0);
console.log(
    `check-refs-citations: ${cited.size} coordinates cited across ${new Set([...cited.keys()].map((c) => c.split('/')[1])).size} submodules — ` +
        `${checked} resolved, ${skippedTotal} skipped (${[...skipped.keys()].sort().join(', ') || 'none'} not checked out), ` +
        `${ledgered} undeclared submodule(s) ledgered, ${placeholders} family patterns not addressable.`,
);
