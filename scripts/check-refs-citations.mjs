#!/usr/bin/env node
// Every `refs/<submodule>/<path>` cited as provenance is a path that exists.
//
// THE INCIDENT
//
// ADR 0004's core-first arrangement and every "core-backed" claim in the Adwaita
// tree rest on citations: a header says which upstream file a behaviour was ported
// from, and a reader is expected to open it. NINETEEN of the Adwaita ones named a
// file that has never existed — not in the pinned commit, and not in any of
// libadwaita's 5325 commits. How MANY coordinates there are is printed by the
// summary line and written nowhere: the figure this paragraph used to carry moved
// twice while the extractor below was being fixed, and prose cannot notice that.
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
// THAT IS ONE SUBMODULE, and the summary line prints how many of the declared ones
// were checked out so nobody reads the tick as repo-wide. `refs/adwaita-web` cannot
// be a second: `.gitmodules` gives it an SSH url — as it does half the pool — so a
// runner cannot init it, and the scss-directory incident above therefore lives in
// the one tree this gate structurally cannot verify in CI.
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

/**
 * The LINE half of a coordinate: `:332`, `:336-346`, or either with an `#anchor`.
 *
 * THE GAP (#1529). Everything above this line asks whether a cited FILE exists. A
 * citation can be wrong by hundreds of lines and still pass — measured on #1528,
 * where three coordinates into `gtkmenutrackeritem.c` described the right semantics
 * at the wrong addresses (`c:551-562` for the role derivation, which is a block of
 * local declarations ~215 lines away from it), and this gate exited 0 on all three.
 * The instance was corrected before the merge; the class was not, and it matters
 * more than a typo: one of those strings sits in `@gjsify/adwaita-core`'s
 * conformance vectors and is PUBLISHED, so a reader who follows it lands on
 * variable declarations and concludes the vector's rationale is wrong. Citations
 * into `refs/` are how this repo grounds behaviour in upstream source instead of in
 * recollection; one that cannot be trusted to point at the right line turns
 * "verified against upstream" into "asserted, and the assertion was never read".
 *
 * WHAT IS HELD, and each arm is zero-false-positive BY CONSTRUCTION, because the
 * two heuristics that would catch more were MEASURED and are worse than nothing:
 *
 *   RANGE   the cited lines must exist and be ordered (`1 <= start <= end <= EOF`),
 *           and must not be entirely blank. This is the half that makes a `refs/`
 *           bump report its own damage: a citation correct when written drifts
 *           silently today, and a file that shrinks under it now fails.
 *
 *   ANCHOR  `…/gtkmenutrackeritem.c:332#sensitive` — the text after `#` must appear
 *           within the cited range. This is the half that catches a citation wrong
 *           AT BIRTH, which RANGE cannot: 551-562 exists, it simply says something
 *           else. It is opt-in per citation, and that is a deliberate limit rather
 *           than an oversight — see the note in `status/open-todos.md`.
 *
 * WHAT WAS MEASURED AND REJECTED: deriving the anchor from the citing prose — take
 * the backticked tokens near the coordinate and require one of them at the cited
 * lines. Run over this tree it flags 14 of the 40 line citations that have a
 * backticked token nearby, and reading them, they are overwhelmingly prose that
 * merely MENTIONS a name rather than quoting the cited source (`SHORTCUT_LABEL_VECTORS`
 * is the citing file's own constant; `.rpm` is a sentence). That is the same
 * quote-versus-mention wall `status/sections/priorities.md` records at 42 of 98 for
 * the ledger, reached independently here. A guard with that flag rate gets switched
 * off and then proves nothing, so it is not built.
 */
const LINE_SUFFIX = /^:(\d+)(?:-(\d+))?(?:#([^\s`'"),\]]+))?/;

// ONE extension list, read from both ends: which tracked files this gate OPENS, and
// which path shapes count as a citation once opened. They were two, and the smaller
// silently decided coverage — 28 files (18 `.cc`, 4 `.vala`, 2 `.rs`, 2 `.toml`, an
// `.astro`, a `meson.build`) cited coordinates the scan never read, which is the
// whole native/Rust/Vala provenance surface.
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

// `refs/deno/ext/{web,fetch,crypto,…}` and `refs/npm-cli/.../semver/.` elide a
// segment the way `*` elides a name — but `…` and `...` survive expansion as
// addressable-looking coordinates, so the day their submodule is checked out the
// gate fails on a path nobody wrote. Skipped for the same reason `*` is.
const ELIDED_SEGMENT = /(?:^|\/)(?:…|\.{1,3})(?:\/|$)/;

// One Reference line, several files in ONE directory: only the first carries the
// `refs/` prefix, so only the first was ever checked — 29 lines spell it that way,
// 14 of them Adwaita. A continuation is a file name after a comma, optionally over
// a comment-line break, CLOSED by end of line, another comma, `)` or a parenthetical.
// That closer is the whole discriminator: it keeps `refs/create-ecdh/browser.js,
// Node.js lib/internal/…` out, where "Node.js" is a sentence, not a sibling file.
const CONTINUATION =
    /^,[ \t]*(?:\r?\n[ \t]*(?:\/\/|\*|#)[ \t]*)?([A-Za-z0-9_][A-Za-z0-9._-]*\.[A-Za-z0-9]+)(?=$|[\n,)]|[ \t]\()/;

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
/** `{ coordinate, start, end, anchor, where }` for every coordinate naming a LINE. */
const lineCitations = [];
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

        // The listed siblings resolve in the first path's directory.
        const paths = [raw];
        const directory = raw.slice(0, raw.lastIndexOf('/'));
        let rest = text.slice(match.index + match[0].length);
        for (let tail = CONTINUATION.exec(rest); tail !== null; tail = CONTINUATION.exec(rest)) {
            paths.push(`${directory}/${tail[1]}`);
            rest = rest.slice(tail[0].length);
        }

        for (const path of paths) {
            for (const coordinate of expandBraces(path)) {
                if (ELIDED_SEGMENT.test(coordinate)) {
                    placeholders += 1;
                    continue;
                }
                if (!cited.has(coordinate)) cited.set(coordinate, new Set());
                cited.get(coordinate).add(toPosixPath(trackedFile));
                // The line half, read only for the coordinate the `refs/` prefix is
                // actually attached to: a `, sibling.c` continuation carries no line
                // of its own, and the brace expansions name a family.
                if (coordinate === raw && paths.length === 1) {
                    const suffix = LINE_SUFFIX.exec(text.slice(match.index + match[0].length));
                    if (suffix) {
                        lineCitations.push({
                            coordinate,
                            start: Number(suffix[1]),
                            end: Number(suffix[2] ?? suffix[1]),
                            anchor: suffix[3],
                            where: toPosixPath(trackedFile),
                        });
                    }
                }
            }
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

/**
 * What is wrong with ONE line citation against the file it names, or `null`.
 *
 * A pure function of the file's lines and the coordinate, so the fixture matrix
 * below can put every shape through the real reader rather than through a copy.
 */
function lineProblem(lines, citation) {
    const { start, end, anchor } = citation;
    if (start < 1 || end < start) {
        return `names lines ${start}-${end}, which is not a range`;
    }
    if (end > lines.length) {
        return `names line ${end}, and the file has ${lines.length} — the citation is past the end of the file, so the submodule moved under it or the number was never right`;
    }
    const body = lines.slice(start - 1, end);
    if (body.every((line) => line.trim() === '')) {
        return `names ${start === end ? `line ${start}` : `lines ${start}-${end}`}, which is blank`;
    }
    if (anchor !== undefined && !body.join('\n').includes(anchor)) {
        const shown = body
            .map((line) => line.trim())
            .filter((line) => line !== '')
            .slice(0, 3)
            .join(' / ');
        return `carries the anchor \`${anchor}\`, and ${start === end ? `line ${start}` : `lines ${start}-${end}`} does not contain it. What is there: ${shown.slice(0, 160)}`;
    }
    return null;
}

// THE DETECTOR IS ASSERTED BEFORE IT IS BELIEVED. Every arm below is silent on a
// clean tree, and a reader that has quietly stopped reading is silent in exactly the
// same way — so the shapes are put through `lineProblem` first and a wrong verdict is
// fatal. Same reason `scripts/check-changelog-references.mjs` runs a fixture matrix
// ahead of the file it checks.
const LINE_FIXTURES = [
    { why: 'a correct single-line citation', at: { start: 3, end: 3 }, bad: false },
    { why: 'a correct range', at: { start: 2, end: 4 }, bad: false },
    { why: 'a line past the end of the file', at: { start: 99, end: 99 }, bad: true },
    { why: 'a range whose end is past the end of the file', at: { start: 3, end: 99 }, bad: true },
    { why: 'an inverted range', at: { start: 4, end: 2 }, bad: true },
    { why: 'a zero line number', at: { start: 0, end: 0 }, bad: true },
    { why: 'a range that is entirely blank', at: { start: 5, end: 6 }, bad: true },
    { why: 'an anchor that IS at the cited line', at: { start: 3, end: 3, anchor: 'sensitive' }, bad: false },
    // THE #1529 SHAPE, and the only arm that catches it: the range exists, it is not
    // blank, and it says something else entirely.
    {
        why: 'an anchor that is in the file but NOT at the cited line',
        at: { start: 7, end: 8, anchor: 'sensitive' },
        bad: true,
    },
    { why: 'an anchor spanning a range that contains it', at: { start: 2, end: 4, anchor: 'enabled' }, bad: false },
];

const FIXTURE_LINES = [
    'static void',
    'gtk_menu_tracker_item_set_enabled (GtkMenuTrackerItem *self,',
    '                                   gboolean enabled) { self->sensitive = enabled;',
    '}',
    '',
    '   ',
    '  GVariant *value;',
    '  gboolean is_radio;',
];

for (const fixture of LINE_FIXTURES) {
    const verdict = lineProblem(FIXTURE_LINES, { anchor: undefined, ...fixture.at });
    if (fixture.bad !== (verdict !== null)) {
        failures.push(
            `SELF-TEST: the line reader must ${fixture.bad ? 'REJECT' : 'ACCEPT'} ${fixture.why}, and it did not ` +
                `(verdict: ${verdict ?? 'accepted'}). Nothing this gate says about a cited line can be believed.`,
        );
    }
}

let linesChecked = 0;
let linesSkipped = 0;
let anchored = 0;
for (const citation of lineCitations) {
    const submodule = citation.coordinate.split('/')[1];
    if (!declared.has(submodule) || !isCheckedOut(ROOT, submodule)) {
        linesSkipped += 1;
        continue;
    }
    let lines;
    try {
        lines = readFileSync(join(ROOT, citation.coordinate), 'utf8').split('\n');
    } catch {
        // The file arm above already failed on this coordinate, or it is a directory.
        linesSkipped += 1;
        continue;
    }
    linesChecked += 1;
    if (citation.anchor !== undefined) anchored += 1;
    const problem = lineProblem(lines, citation);
    if (problem !== null) {
        failures.push(
            `${citation.coordinate}:${citation.start}${citation.end === citation.start ? '' : `-${citation.end}`} ` +
                `${problem}. Cited by ${citation.where}.\n` +
                '    Read the file and cite the line that carries the behaviour, or drop the line number.',
        );
    }
}

// TWO DIFFERENT FACTS, and conflating them is what turned this gate red on its own
// first CI run. "The tree carries no anchored citation" is a property of the
// CHECKOUT — `git ls-files` reaches it in every job — and means nobody has opted in,
// so the arm can fire nowhere: FATAL. "This host verified no anchor" is a property of
// which `refs/` submodules are on DISK, and `audit-runtimes.yml` checks out
// `refs/libadwaita` and nothing else on purpose (~13 MB against ~150 GB for the pool);
// the step's own comment says it "holds what that one contains and no more". The first
// version asserted the second and printed the first's message, so a job that could not
// READ the tree's one anchor reported that the tree had none, and told the author to
// add an anchor that was already there.
//
// So the tree-level claim stays fatal and the host-level one becomes a NAMED line in
// the summary. That is not "skip when empty": the fatal half no longer depends on the
// host at all, and the readable half is kept non-zero by construction — the anchored
// `refs/libadwaita` citation in `packages/web/adwaita-core/src/accent.ts` is inside the
// one submodule this workflow does check out, so the arm verifies real text on every
// run of the required check.
const anchoredInTree = lineCitations.filter((citation) => citation.anchor !== undefined).length;
if (lineCitations.length === 0) {
    failures.push(
        'the line reader found no `refs/<sub>/<path>:<line>` coordinate anywhere in the tree. That is a broken ' +
            'scan, not a tree without line citations.',
    );
} else if (anchoredInTree === 0) {
    // The ANCHOR arm is the only one that catches a citation wrong at birth, and an
    // opt-in arm with nothing opted in is an arm that cannot fail. One real anchored
    // citation keeps it exercised; retrofitting the rest is ledgered in
    // `status/open-todos.md`.
    failures.push(
        'no line citation in the tracked tree carries an `#anchor`, so the arm that verifies WHAT is at a cited ' +
            'line can fire nowhere. Anchor at least one — `refs/<sub>/<path>:<line>#<token at that line>`.',
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
// How many DECLARED submodules were on disk is the gate's real coverage, so it is
// the headline rather than a subtraction the reader has to do from the skip list.
const checkable = [...declared].filter((name) => isCheckedOut(ROOT, name)).length;
console.log(
    `check-refs-citations: ${cited.size} coordinates cited across ${new Set([...cited.keys()].map((c) => c.split('/')[1])).size} submodules — ` +
        `${checked} resolved in the ${checkable} of ${declared.size} declared submodules checked out here, ` +
        `${skippedTotal} skipped (${[...skipped.keys()].sort().join(', ') || 'none'}), ` +
        `${ledgered} undeclared submodule(s) ledgered, ${placeholders} family patterns not addressable. ` +
        `Of ${lineCitations.length} coordinate(s) naming a LINE, ${linesChecked} were read against the file ` +
        `(${anchored} of the tree's ${anchoredInTree} #anchor(s) verified at the cited text), ` +
        `${linesSkipped} skipped as not checked out, after ${LINE_FIXTURES.length} self-test shapes.`,
);
// Loud rather than fatal — see the two-facts note above. A host that reads none of the
// tree's anchors has not exercised the arm, and says so instead of claiming coverage.
if (anchored === 0) {
    console.log(
        `check-refs-citations: NOTE — none of the ${anchoredInTree} anchored citation(s) was readable here; they ` +
            `live in ${[...new Set(lineCitations.filter((c) => c.anchor !== undefined).map((c) => c.coordinate.split('/')[1]))].sort().join(', ')}, ` +
            'which this host has not checked out. The ANCHOR arm verified nothing on this run.',
    );
}
