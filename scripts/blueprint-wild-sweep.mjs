#!/usr/bin/env node
// Runs the in-repo Blueprint parser over `.blp` files nobody here wrote, and prints the
// table `docs/reports/2026-09-16-blueprint-subset-gap.md` contains.
//
// WHY THIS EXISTS
//
// `scripts/check-blueprint-corpus.mjs` measures the corpus this repository WROTE. An empty
// `corpus/divergences.mjs` is a statement about those files and never about the language —
// the corpus says so itself. This asks the other question: what happens when the parser
// meets a `.blp` from a project that has never heard of us?
//
// ADR 0053 clause 6 forbids the obvious answer. Third-party `.blp` must never become the
// part of the corpus CI lacks, so the files are NOT checked in. What is checked in is this
// SWEEP — and with it, the pinned list of exactly which trees at exactly which revisions
// the report's numbers came from. That list is the whole point: a measurement over "some
// Workbench demos" is an anecdote, a measurement over `workbenchdev/demos` at
// `ca4bc5c2` is a number someone else can get again.
//
// A MEASUREMENT WHOSE INPUTS DRIFT IS NOT A MEASUREMENT
//
// Every source below carries a commit. The five that are submodules of this repository
// carry the gitlink they were pinned at when the report was written, and this script
// CHECKS that against the tree it runs in rather than trusting it: a routine
// `git submodule update --remote` moves the corpus under the report without touching a
// byte of either. When they disagree the run stops and names both, and
// `--accept-moved-pins` is how someone says "yes, re-measure against the new tree" out
// loud. The four that are not submodules are shallow-cloned at their exact sha into a
// cache OUTSIDE this repository, because clause 6 is about the repository and not about
// the machine.
//
// WHAT THIS NEEDS BEFORE IT CAN SAY ANYTHING
//
// Three prerequisites, all asserted below rather than assumed, each with its own message:
// `blueprint-compiler` 0.20.4 on PATH, the `@girs` versions `packages/infra/blueprint`
// pins INSTALLED in the tree being measured, and network access the first time a pool is
// cloned. There is deliberately no skip mode. `check-blueprint-corpus.mjs` has one because
// its goldens are committed and most of it runs without the binary; here the binary IS the
// other half of every comparison, so a run without it has nothing to report and would only
// be a green line about no measurement — the exact shape that script's `--require-oracle`
// exists to close.
//
// THE ORACLE IS PINNED TOO, AND THE VERSION IS ASSERTED
//
// `blueprint-compiler` 0.20.4 is the reference implementation here — the version
// `corpus/manifest.mjs` records as `ORACLE`, imported from there rather than restated so
// there is one truth. A different build on PATH is not a nuisance to warn about and carry
// on: every "the oracle compiles this" in the report is a claim about 0.20.4, and a run on
// 0.20.5 that printed the same table would be measuring something else under the report's
// numbers. So a mismatch exits non-zero, exactly as stage B of the corpus harness does.
//
// It is used as a BLACK BOX. Exit status, stderr, and the XML it writes — nothing is read
// out of its source, which is LGPL-3.0 while this repository is MIT. What an implementation
// ACCEPTS and what it EMITS are facts about the language.
//
// FIVE BUCKETS, AND NO SIXTH THAT SWALLOWS A SURPRISE
//
// Each file is two independent yes/no answers — does the oracle compile it, does our
// pipeline emit for it — so there are four combinations, and the one where both emit splits
// on whether the bytes agree. That is five outcomes, and all five are named:
//
//   byte-equal              both emit, identical bytes
//   silently-different      both emit, the bytes differ — the worst outcome here, because
//                           nothing in this repository goes red for it
//   refused-by-us           the oracle compiles it and our pipeline throws — the subset gap
//   refused-by-oracle       both refuse — nothing here compares WHY, so this is never
//                           called agreement; every one is printed with both reasons
//   accepted-past-oracle    the oracle refuses it and we emit anyway — we accept what the
//                           language does not have
//
// The last one has never been seen in the wild corpus and is not hypothetical: § 3 of the
// report found it by hand with `extra-menu: null;`, where the oracle says "null is not
// permitted here" and the in-repo emitter writes `<property …>null</property>`. A
// classifier with a fall-through `else` would have filed that under whichever bucket the
// author wrote last. This repository has been bitten three times by a two-case classifier
// meeting a third case; the decision table below is exhaustive by construction, and a
// combination it does not cover exits non-zero NAMING THE FILE rather than counting it
// somewhere plausible.
//
// Usage: node scripts/blueprint-wild-sweep.mjs [options]
//        --dry-run            print the pinned sources and what would be fetched and
//                             measured; clone nothing, run nothing
//        --cache-dir <dir>    where the non-submodule sources are cloned
//                             (default: $XDG_CACHE_HOME/gjsify/blueprint-wild-sweep)
//        --pool <name>        measure one pool only; repeatable. `--pool list` names them
//        --accept-moved-pins  measure against the submodule revisions this tree has, even
//                             where they are no longer the ones the report was written at
//        --root <dir>         the repository to read the parser and the gitlinks from
//        --help               this text
//
// Three prerequisites, and there is deliberately NO SKIP MODE: without any of them the run
// exits non-zero naming the one that is missing, rather than reporting a measurement it did
// not make.
//   1. `blueprint-compiler` 0.20.4 on PATH — it is the other half of every comparison
//   2. the `@girs` versions `packages/infra/blueprint/package.json` pins, installed in the
//      tree being measured — emission resolves types through their vocabulary
//   3. network access the FIRST time each non-submodule pool is cloned; afterwards the
//      cache (--cache-dir) serves it and the run needs none

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- the pinned sources

/**
 * The eight wild pools and the language pool, each at the revision the report's numbers
 * were measured over.
 *
 * `submodule` is a path under `refs/`; the commit beside it is the gitlink this repository
 * pinned it at, and the run verifies it. The rest are not submodules of this repository —
 * ADR 0053 § Alternatives says why Blueprint's own upstreams are not in `refs/` — so they
 * carry an https URL and a sha, and are cloned into the cache.
 *
 * `own` marks the one pool this studio wrote. It is measured like every other and counted
 * apart everywhere the number is a claim about FOREIGN files, because a parser passing its
 * author's own files is not evidence about anybody else's.
 */
const SOURCES = [
    {
        pool: 'Workbench demos',
        url: 'https://github.com/workbenchdev/demos.git',
        commit: 'ca4bc5c2681cfd909c7f5787c11059351c0179f9',
    },
    {
        pool: 'Muzika',
        url: 'https://github.com/vixalien/muzika.git',
        commit: '032b880e6a5da2f4ddd501c95ca21e7b67cfa6d0',
    },
    {
        pool: 'refs/map-editor',
        submodule: 'refs/map-editor',
        url: 'https://github.com/PixelRPG/map-editor.git',
        commit: 'e835c417089e900b3d2f56f13661b31f9d10f311',
        own: true,
    },
    {
        pool: 'refs/epiphany',
        submodule: 'refs/epiphany',
        url: 'https://gitlab.gnome.org/GNOME/epiphany.git',
        commit: '48bb1e24f4e8b4a74c19c3908470fc6fab10b765',
    },
    {
        pool: 'refs/Gradia',
        submodule: 'refs/Gradia',
        url: 'https://github.com/AlexanderVanhee/Gradia.git',
        commit: '50689c927162e90e7db6dcb64de5f31eb0bdf79e',
    },
    {
        pool: 'Decibels',
        // The GNOME Incubator project, not the author's personal mirror — `vixalien/decibels`
        // on GitHub carries no `.blp` at all. This sha is the upstream commit the local
        // working copy's `.blp` are byte-identical to.
        url: 'https://gitlab.gnome.org/GNOME/Incubator/decibels.git',
        commit: '116f735e2310df7313968e727e63491eef49c46f',
    },
    {
        pool: 'refs/troll',
        submodule: 'refs/troll',
        url: 'https://github.com/sonnyp/troll.git',
        commit: '37b53b29db0b6496f31e13c7f843100db31c9eb1',
    },
    {
        pool: 'refs/showtime',
        submodule: 'refs/showtime',
        url: 'https://gitlab.gnome.org/GNOME/showtime.git',
        commit: '6df538fc257416921b14e0572fc0770242355949',
    },
    {
        // Not an application and not in the wild table: the reference implementation's own
        // test samples, which are the language defined by example. A test suite is written
        // to reach corners, which is exactly what makes it worth measuring beside eight
        // applications that were written to ship. `tests/samples/` only — `sample_errors/`
        // holds files that exist to be rejected and would measure the error messages, not
        // the subset.
        pool: 'the language',
        url: 'https://gitlab.gnome.org/jwestman/blueprint-compiler.git',
        commit: '31b62c24a72c1670d2d93dcdf2d130f1ae12778e',
        subdir: 'tests/samples',
        recursive: false,
        language: true,
    },
];

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));

const flagValue = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
};
const takesValue = new Set(['--cache-dir', '--pool', '--root']);
const KNOWN_FLAGS = new Set([...takesValue, '--dry-run', '--accept-moved-pins', '--help', '-h']);

const die = (message, code = 2) => {
    console.error(`blueprint-wild-sweep: ${message}`);
    process.exit(code);
};

if (args.includes('--help') || args.includes('-h')) {
    const self = readFileSync(join(HERE, 'blueprint-wild-sweep.mjs'), 'utf8');
    const usage = self.slice(self.indexOf('// Usage:'), self.indexOf('\nimport '));
    console.log(usage.replace(/^\/\/ ?/gm, '').trimEnd());
    process.exit(0);
}

// A mistyped flag must never read as its own absence — `--dry-runs` quietly cloning and
// measuring is the same defect class the pin check above exists for, one level down.
const valuePositions = new Set(args.flatMap((a, i) => (takesValue.has(a) ? [i + 1] : [])));
const stray = args.filter((a, i) => !valuePositions.has(i) && !KNOWN_FLAGS.has(a));
if (stray.length > 0) die(`unknown argument(s): ${stray.join(', ')}\n  try --help`);

const dryRun = args.includes('--dry-run');
const acceptMovedPins = args.includes('--accept-moved-pins');
const root = resolve(flagValue('--root') ?? join(HERE, '..'));
const pools = args.flatMap((a, i) => (a === '--pool' ? [args[i + 1]] : []));
for (const [flag, value] of [
    ['--cache-dir', flagValue('--cache-dir')],
    ['--root', flagValue('--root')],
]) {
    if (args.includes(flag) && (typeof value !== 'string' || value.startsWith('--'))) {
        die(`${flag} needs a value`);
    }
}

if (pools.includes('list')) {
    for (const source of SOURCES) console.log(source.pool);
    process.exit(0);
}
for (const name of pools) {
    if (!SOURCES.some((s) => s.pool === name)) die(`no pool called "${name}". \`--pool list\` names them.`);
}
const selected = pools.length === 0 ? SOURCES : SOURCES.filter((s) => pools.includes(s.pool));

const defaultCache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'gjsify', 'blueprint-wild-sweep');
const cacheDir = resolve(flagValue('--cache-dir') ?? defaultCache);

// Clause 6 again, mechanically: the files must not land in the repository, and "must not"
// is worth a check rather than a convention, because `--cache-dir .cache` is one keystroke
// from a 273-file untracked diff that the next `git add -A` commits.
if (!relative(root, cacheDir).startsWith('..') && relative(root, cacheDir) !== '') {
    die(
        `--cache-dir ${cacheDir} is inside the repository at ${root}. ADR 0053 clause 6 keeps\n` +
            '  third-party .blp out of this tree; the sweep is what gets checked in, not the files.',
    );
}

// ---------------------------------------------------------------- the oracle

const { ORACLE } = await import(`file://${join(root, 'packages/infra/blueprint/corpus/manifest.mjs')}`);

const probe = spawnSync(ORACLE.tool, ['--version'], { encoding: 'utf8' });
if (probe.status !== 0) {
    die(
        `${ORACLE.tool} is not on PATH (${probe.error ? probe.error.message : `exit ${probe.status}`}).\n` +
            `  Every number this prints is a comparison against it, so there is nothing to print without it.\n` +
            `  Fedora: dnf install ${ORACLE.tool}-${ORACLE.version}`,
    );
}
const installed = probe.stdout.trim();
if (installed !== ORACLE.version) {
    die(
        `this machine has ${ORACLE.tool} ${installed} and the report's numbers are ${ORACLE.version}.\n` +
            '  Refusing rather than printing the same table from a different oracle: "the oracle compiles\n' +
            `  this" is a claim about ${ORACLE.version}. Per ADR 0053 clause 5 a new upstream release is the\n` +
            '  upgrade notice — re-measure deliberately and move the numbers in the report with it.',
    );
}

// ---------------------------------------------------------------- materialising a pool

const git = (cwd, ...argv) => spawnSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** The commit this repository's index pins a submodule at, or null if it tracks no such path. */
const gitlinkOf = (path) => {
    const run = git(root, 'ls-tree', 'HEAD', '--', path);
    const sha = run.status === 0 ? (run.stdout.match(/^160000 commit ([0-9a-f]{40})\t/) ?? [])[1] : undefined;
    return sha ?? null;
};

/**
 * A working tree holding the pool at its pinned commit, plus a one-line note saying where it
 * came from. Submodules that are checked out at the pin are read in place; everything else
 * is a shallow single-commit clone in the cache, which is why the cache survives between
 * runs and why a second run costs nothing.
 */
const materialise = (source) => {
    if (source.submodule) {
        const pinned = gitlinkOf(source.submodule);
        if (pinned === null) {
            die(`${source.pool}: this tree tracks no submodule at ${source.submodule}.`);
        }
        if (pinned !== source.commit && !acceptMovedPins) {
            die(
                `${source.pool}: the report was measured at ${source.commit.slice(0, 10)} and this tree pins\n` +
                    `  ${pinned.slice(0, 10)}. A moved gitlink changes the corpus under the report without touching\n` +
                    '  a byte of either, so this stops rather than reprinting the table from other files.\n' +
                    '  Re-measure on purpose with --accept-moved-pins, and move the report with what it says.',
            );
        }
        const dir = join(root, source.submodule);
        const head = existsSync(join(dir, '.git')) ? git(dir, 'rev-parse', 'HEAD').stdout.trim() : null;
        if (head === pinned) return { dir, note: `${source.submodule} @ ${pinned.slice(0, 10)} (submodule)` };
        // Not initialised, or checked out at something else. Clone it like any other pool
        // rather than telling the reader to go and run `git submodule update`: the point of
        // this script is that someone who is not in this working copy can reproduce it, and
        // the 164 GB warning in the workspace hub is a reason NOT to init one more.
        return clone(
            source,
            pinned,
            head === null ? 'submodule not initialised' : `submodule is at ${head.slice(0, 10)}`,
        );
    }
    return clone(source, source.commit, null);
};

const clone = (source, commit, why) => {
    const dir = join(cacheDir, `${source.pool.replace(/[^A-Za-z0-9]+/g, '-')}-${commit.slice(0, 10)}`);
    const note = `${source.url} @ ${commit.slice(0, 10)}${why ? ` (${why})` : ''}`;
    if (existsSync(join(dir, '.git')) && git(dir, 'rev-parse', 'HEAD').stdout.trim() === commit) {
        return { dir, note: `${note} (cached)` };
    }
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, '.git'))) {
        const init = spawnSync('git', ['init', '--quiet', dir], { encoding: 'utf8' });
        if (init.status !== 0) die(`${source.pool}: git init failed: ${(init.stderr || '').trim()}`);
        git(dir, 'remote', 'add', 'origin', source.url);
    }
    git(dir, 'remote', 'set-url', 'origin', source.url);
    // One commit, no history, no blobs but the checkout's. Both GitHub and GitLab serve an
    // arbitrary reachable sha this way; where a host does not, the fallback is a full fetch
    // of the default branch, which still lands on the same pinned commit.
    let fetch = git(dir, 'fetch', '--quiet', '--depth', '1', 'origin', commit);
    if (fetch.status !== 0) {
        console.log(`  ${source.pool}: the host refused a single-commit fetch, taking the whole history`);
        fetch = git(dir, 'fetch', '--quiet', '--tags', 'origin');
    }
    if (fetch.status !== 0)
        die(`${source.pool}: fetching ${commit.slice(0, 10)} failed: ${(fetch.stderr || '').trim()}`);
    const checkout = git(dir, 'checkout', '--quiet', '--detach', commit);
    if (checkout.status !== 0) {
        die(`${source.pool}: ${commit.slice(0, 10)} is not in ${source.url}: ${(checkout.stderr || '').trim()}`);
    }
    return { dir, note };
};

/**
 * Every `.blp` a pool contributes, sorted, with `.git` never walked into.
 *
 * `statSync` FOLLOWS symlinks, so a checkout holding a dangling one threw `ENOENT` out of a
 * directory listing and a symlink pointing at its own ancestor recursed until the stack gave
 * out — both in Node's voice, from a line that says nothing about which tree it was reading.
 * `lstatSync` answers about the link itself, so neither is reachable now; `depth` bounds what
 * is left, since the parameter was already being carried and never read.
 */
const MAX_WALK_DEPTH = 32;

const blueprintsIn = (dir, source) => {
    const base = source.subdir ? join(dir, source.subdir) : dir;
    if (!existsSync(base)) die(`${source.pool}: ${source.subdir ?? '.'} is not in the checkout at ${dir}.`);
    const found = [];
    const walk = (at, depth) => {
        if (depth > MAX_WALK_DEPTH) {
            die(`${source.pool}: ${relative(dir, at)} is more than ${MAX_WALK_DEPTH} directories deep — a link loop?`);
        }
        let entries;
        try {
            entries = readdirSync(at, { withFileTypes: true });
        } catch (error) {
            return die(`${source.pool}: cannot read ${relative(dir, at) || '.'}: ${error.message}`);
        }
        for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            const path = join(at, entry.name);
            // A `Dirent` answers about the link, not its target — the same question `lstat`
            // answers, and the one that makes a dangling link a file this loop skips.
            if (entry.isDirectory()) {
                if (source.recursive !== false) walk(path, depth + 1);
            } else if (entry.isFile() && entry.name.endsWith('.blp')) {
                found.push(path);
            } else if (entry.isSymbolicLink() && entry.name.endsWith('.blp')) {
                // A `.blp` reached through a link is a real file of this pool, and a broken
                // link is a checkout problem worth naming rather than silently dropping.
                if (existsSync(path)) found.push(path);
                else die(`${source.pool}: ${relative(dir, path)} is a symlink to nothing.`);
            }
        }
    };
    walk(base, 0);
    return found;
};

// ---------------------------------------------------------------- the OTHER pinned input

// The oracle is not the only version this measurement depends on, and it was the only one
// checked. Emission needs introspection: `resolve-ident.mjs` reads `@girs/gtk-4.0/vocabulary`
// and `@girs/adw-1/vocabulary`, so every table below is a statement about a parser AND a
// vocabulary. The report says `@girs` 5.2.0. On a machine with 5.0.0 installed this printed a
// different table and said nothing; in a tree with nothing installed it died in Node's voice
// with `ERR_MODULE_NOT_FOUND` rather than in this script's.
//
// That is the same defect this sweep was written to find, one dependency over: two inputs at
// two versions, and no line saying so. `package.json` is the pin — `check-girs-exact-pins.mjs`
// keeps those specs exact — so it is read rather than restated, and a spec that has stopped
// being exact fails here too, because a range cannot be asserted against and would quietly
// turn this check back off.
const BLUEPRINT_PKG = join(root, 'packages/infra/blueprint/package.json');
const declaredDeps = JSON.parse(readFileSync(BLUEPRINT_PKG, 'utf8')).dependencies ?? {};

/** The version actually on disk, resolved the way Node resolves it: up the `node_modules` chain. */
const installedVersionOf = (name) => {
    // Not through the exports map: `@girs/adw-1` does not expose `./package.json`, so
    // `require.resolve` would throw for a package that is installed and perfectly fine.
    let at = join(root, 'packages/infra/blueprint', 'src');
    for (;;) {
        const candidate = join(at, 'node_modules', ...name.split('/'), 'package.json');
        if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')).version;
        const up = dirname(at);
        if (up === at) return null;
        at = up;
    }
};

for (const [name, want] of Object.entries(declaredDeps)) {
    if (!/^\d+\.\d+\.\d+$/.test(want)) {
        die(
            `packages/infra/blueprint/package.json pins ${name} as "${want}", which is a range.\n` +
                '  This sweep asserts the vocabulary it measures with, and a range cannot be asserted\n' +
                '  against. Make the pin exact (scripts/check-girs-exact-pins.mjs) — otherwise this\n' +
                '  check is off and nothing says so.',
        );
    }
    const have = installedVersionOf(name);
    if (have === null) {
        die(
            `${name} is not installed under ${relative(process.cwd(), root) || '.'}, and emission needs its\n` +
                `  vocabulary — \`resolve-ident.mjs\` imports ${name}/vocabulary, so there is nothing to\n` +
                '  measure without it. Run `gjsify install` in THIS tree, or --root a tree that has it.',
        );
    }
    if (have !== want) {
        die(
            `this tree has ${name} ${have} and the report's numbers are ${want}.\n` +
                '  The vocabulary decides which types resolve, so another one prints a different table\n' +
                '  under the same headings. Install the pinned version, or re-measure deliberately and\n' +
                '  move the report with what it says.',
        );
    }
}

// ---------------------------------------------------------------- the two implementations

const BLUEPRINT_SRC = join(root, 'packages/infra/blueprint/src');
const { parseBlueprint } = await import(`file://${join(BLUEPRINT_SRC, 'parser.mjs')}`);
const { emitGtkBuilderXml } = await import(`file://${join(BLUEPRINT_SRC, 'emit-xml.mjs')}`);
const { accessibilityElement, accessibilityValue, gtypeName, resolveIdent } = await import(
    `file://${join(BLUEPRINT_SRC, 'resolve-ident.mjs')}`
);

/** The oracle colours its diagnostics; leaving the escapes in makes them ungreppable. */
const ESC = String.fromCharCode(27);
const plain = (text) =>
    text
        .split(ESC)
        .map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, '')))
        .join('');

/** What the oracle does with a file: its XML, or the first line of why not. */
const runOracle = (path) => {
    const run = spawnSync(ORACLE.tool, ['compile', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return run.status === 0
        ? { xml: run.stdout }
        : { error: plain((run.stderr || '').trim().split('\n')[0]) || `exit ${run.status}` };
};

/** What this repository does with the same file. */
const runInRepo = (path, key) => {
    try {
        const ast = parseBlueprint(readFileSync(path, 'utf8'), key);
        return { xml: emitGtkBuilderXml(ast, { accessibilityElement, accessibilityValue, gtypeName, resolveIdent }) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
};

const BUCKETS = ['byte-equal', 'silently-different', 'refused-by-us', 'refused-by-oracle', 'accepted-past-oracle'];

/**
 * How often a construct appears, counted by FILES CONTAINING IT rather than by first parse
 * error — which is the only count that orders a plan. A file stops at the first construct
 * the subset does not hold and hides every later one behind it, so the refusal census below
 * says what blocks a file FIRST and this says what a file needs AT ALL. Epiphany's
 * `location-entry.blp` is the difference in one file: it stops on an inline `template`, and
 * it also wants expressions and a cast to `Gio.Icon`.
 *
 * These are TEXT matches, not parses, and that is a real limitation worth stating rather
 * than hiding: the parser cannot count what it refuses to read, and a second parser written
 * here to do it would be a second subset to keep true. They are in the script so the next
 * reader can disagree with a specific regex instead of with a number. Each was checked
 * against the file it is about — `menu-model: menu { }` is an inline menu and a `menu { }`
 * root is not; a response flag trails the label rather than opening the entry.
 */
/**
 * Does `resolve-ident.mjs` have a vocabulary for this namespace? Memoised, because the sweep asks
 * it once per qualified name in 368 files.
 *
 * `gtypeName` in REFERENCE position applies the C prefix and checks nothing else, so the only way
 * it throws is the namespace — which makes the throw the answer rather than an accident worth
 * swallowing. There is no predicate to call instead: the resolver's business is to answer for a
 * type, and this is the one question a report has that a compile does not.
 */
const VOCABULARY_KNOWN = new Map();
const hasVocabulary = (namespace) => {
    const cached = VOCABULARY_KNOWN.get(namespace);
    if (cached !== undefined) return cached;
    let known = true;
    try {
        gtypeName({ namespace, name: 'CensusProbe' }, { file: '<census>', line: 0 }, 'reference');
    } catch {
        known = false;
    }
    VOCABULARY_KNOWN.set(namespace, known);
    return known;
};

const CONSTRUCTS = [
    [
        'expressions: `expr`, `bind $closure(…)`, `as <Type>`, `typeof<Type>`, `a.b.c`',
        (t) =>
            /(^|[^\w-])expr\s*[(\s]/.test(t) ||
            /\bbind\s+\$/.test(t) ||
            /\bas\s*<\s*[$A-Za-z]/.test(t) ||
            /\btypeof\s*</.test(t) ||
            /\bbind\s+[A-Za-z_][\w-]*\.[\w-]+\.[\w-]+/.test(t),
    ],
    [
        'a type from a namespace with no vocabulary',
        // ASKED, NOT LISTED. This used to name the namespaces in a regex, and a hand-kept list of
        // what another module knows is wrong the moment that module learns one more: at the `@girs`
        // 5.3.0 bump it still counted `Gio`, `Gdk` and `GObject` as unresolvable after the resolver
        // had loaded all three, and it had counted `GtkSource`, `Shumate` and `WebKit` that way for
        // longer. So the resolver answers instead. A bare `using Gio 2.0;` is still not the
        // construct — emission needs the GType name only where a type from the namespace is NAMED,
        // which is what the `.` plus a capital matches, and `$Ns.Inner` is excluded because an
        // extern type asks no vocabulary anything.
        (t) => [...t.matchAll(/(?<![$\w-])([A-Z][A-Za-z0-9]*)\.[A-Z]/g)].some(([, ns]) => !hasVocabulary(ns)),
    ],
    ['`marks [ ]` on `Gtk.Scale`', (t) => /^\s*marks\s*\[/m.test(t)],
    ['inline `template Type { }`', (t) => /^[ \t]+template\s+/m.test(t)],
    ['`null` as a value', (t) => /:\s*null\s*;/.test(t)],
    ['`[internal-child …]`', (t) => /\[\s*internal-child\b/.test(t)],
    ['inline `menu { }` as a value', (t) => /:\s*menu\s*\{/.test(t)],
    [
        'response flags',
        (t) => {
            const block = t.match(/responses\s*\[([\s\S]*?)\]/);
            return block !== null && /[)"]\s*(destructive|suggested|disabled)\b/.test(block[1]);
        },
    ],
    ['`mime-types [ ]` on `Gtk.FileFilter`', (t) => /^\s*mime-types\s*\[/m.test(t)],
    ['`offsets [ ]` on `Gtk.LevelBar`', (t) => /^\s*offsets\s*\[/m.test(t)],
    ['`template` with no parent', (t) => /^template\s+[^:\n{]*\{/m.test(t)],
    ['`items [ ]` on `Gtk.ComboBoxText`', (t) => /^\s*items\s*\[/m.test(t)],
    ['`[action response=…]` action widgets', (t) => /\[\s*action\s+response\s*=/.test(t)],
    ['`translation-domain`', (t) => /^\s*translation-domain\b/m.test(t)],
    ['`bind-property` (the pre-0.8.2 spelling)', (t) => /\bbind-property\b/.test(t)],
];

/**
 * The decision table, written out rather than implied. Two booleans and one byte
 * comparison; every combination of them is a row here and there is no `else`, so an
 * outcome this does not name comes back `null` and stops the run instead of being counted
 * as whichever bucket happens to be last.
 *
 * `refused-by-oracle` is the one bucket that cannot be called agreement. Both sides said no;
 * nothing here compares WHY, and two compilers refusing the same file for unrelated reasons
 * is a real thing this cannot distinguish from a shared verdict — a subset gap could hide
 * behind an oracle error on the same file. There is no comparison to write: the two produce
 * unrelated prose, and matching it would be this script guessing. So both reasons are
 * printed side by side, every one of them, and the reader does the comparing.
 */
const classify = (oracle, ours) => {
    const oracleEmitted = typeof oracle.xml === 'string';
    const weEmitted = typeof ours.xml === 'string';
    if (oracleEmitted && weEmitted) return oracle.xml === ours.xml ? 'byte-equal' : 'silently-different';
    if (oracleEmitted && !weEmitted) return 'refused-by-us';
    if (!oracleEmitted && !weEmitted) return 'refused-by-oracle';
    if (!oracleEmitted && weEmitted) return 'accepted-past-oracle';
    return null;
};

// ---------------------------------------------------------------- the sweep

console.log(
    `blueprint-wild-sweep — oracle ${ORACLE.tool} ${installed}, parser at ${relative(process.cwd(), root) || '.'}`,
);
console.log(`cache: ${cacheDir}\n`);

if (dryRun) {
    console.log('--dry-run: the pinned sources, and nothing fetched or measured.\n');
    for (const source of selected) {
        const pin = source.submodule ? (gitlinkOf(source.submodule) ?? '(not tracked)') : source.commit;
        const drift = source.submodule && pin !== source.commit ? `  ← tree pins ${pin.slice(0, 10)}` : '';
        console.log(`  ${source.pool.padEnd(18)} ${source.url}`);
        console.log(`  ${''.padEnd(18)} @ ${source.commit}${source.subdir ? ` (${source.subdir})` : ''}${drift}`);
    }
    process.exit(0);
}

const rows = [];
const unexpected = [];
const refusalsByMessage = new Map();
const bothRefused = [];
const divergent = [];
const census = new Map(CONSTRUCTS.map(([name]) => [name, { wild: 0, language: 0 }]));
/** Which constructs each file that does NOT build correctly today needs — § 6's arithmetic. */
const needs = new Map();

for (const source of selected) {
    const { dir, note } = materialise(source);
    const files = blueprintsIn(dir, source);
    const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    for (const path of files) {
        const key = `${source.pool}:${relative(dir, path)}`;
        let text;
        try {
            text = readFileSync(path, 'utf8');
        } catch (error) {
            // Unreadable is not a verdict. Counting it anywhere would put a file the run
            // never saw into a bucket, which is the miscount this whole table is about.
            die(`${key}: cannot be read, so it cannot be classified: ${error.message}`);
        }
        const found = CONSTRUCTS.filter(([, test]) => test(text)).map(([name]) => name);
        for (const name of found) census.get(name)[source.language ? 'language' : 'wild'] += 1;
        const oracle = runOracle(path);
        const ours = runInRepo(path, key);
        const bucket = classify(oracle, ours);
        if (bucket === null) {
            unexpected.push(key);
            continue;
        }
        counts[bucket] += 1;
        if (bucket !== 'byte-equal' && bucket !== 'refused-by-oracle' && !source.language && !source.own) {
            needs.set(key, found);
        }
        if (bucket === 'refused-by-us') {
            // Grouped by the parser's own words, which is the only construct name that is
            // not this script's guess about what the file contains.
            const construct = ours.error.replace(/^.*?:\d+:\d+:\s*/, '').replace(/"[^"]*"/g, '"…"');
            refusalsByMessage.set(construct, [...(refusalsByMessage.get(construct) ?? []), key]);
        }
        if (bucket === 'refused-by-oracle') bothRefused.push([key, oracle.error, ours.error]);
        if (bucket === 'silently-different' || bucket === 'accepted-past-oracle') divergent.push([bucket, key]);
    }
    rows.push({ source, note, files: files.length, counts });
    console.log(`  measured ${String(files.length).padStart(3)} .blp — ${source.pool} — ${note}`);
}

// An unnamed outcome is the defect this script was written not to have, so it is the first
// thing printed and the run is red whatever the rest of the table says.
if (unexpected.length > 0) {
    console.error('\nblueprint-wild-sweep: FAILED — the classifier met an outcome it does not name:\n');
    for (const key of unexpected) console.error(`  - ${key}`);
    process.exit(1);
}

// ---------------------------------------------------------------- the table

const wild = rows.filter((r) => !r.source.language);
const language = rows.filter((r) => r.source.language);
const sum = (subset, bucket) => subset.reduce((n, r) => n + r.counts[bucket], 0);
const total = (subset) => subset.reduce((n, r) => n + r.files, 0);

const bucketTable = (subset) => {
    const lines = ['| pool | files | byte-equal | refused | wrong |', '|---|---:|---:|---:|---:|'];
    for (const row of [...subset].sort((a, b) => b.files - a.files)) {
        const refused = row.counts['refused-by-us'] + row.counts['refused-by-oracle'];
        const wrong = row.counts['silently-different'] + row.counts['accepted-past-oracle'];
        const name = row.source.own ? `\`${row.source.pool}\` (own)` : row.source.pool;
        lines.push(`| ${name} | ${row.files} | ${row.counts['byte-equal']} | ${refused} | ${wrong} |`);
    }
    return lines.join('\n');
};

const pct = (n, of) => (of === 0 ? '0.0' : ((n / of) * 100).toFixed(1));

console.log('\n## The headline\n');
const wildFiles = total(wild);
const wildEqual = sum(wild, 'byte-equal');
const wildRefused = sum(wild, 'refused-by-us') + sum(wild, 'refused-by-oracle');
const wildWrong = sum(wild, 'silently-different') + sum(wild, 'accepted-past-oracle');
console.log(
    `Of ${wildFiles} wild files, ${wildEqual} are byte-equal with the oracle (${pct(wildEqual, wildFiles)}%), ` +
        `${wildRefused} are refused (${pct(wildRefused, wildFiles)}%), and ${wildWrong} ` +
        `${wildWrong === 1 ? 'is silently wrong' : 'are silently wrong'}.`,
);

const foreign = wild.filter((r) => !r.source.own);
const foreignFiles = total(foreign);
const foreignEqual = sum(foreign, 'byte-equal');
console.log(
    `Counting only the ${foreignFiles} files this studio did not write: ${foreignEqual} byte-equal ` +
        `(${pct(foreignEqual, foreignFiles)}%), ` +
        `${sum(foreign, 'refused-by-us') + sum(foreign, 'refused-by-oracle')} refused, ` +
        `${sum(foreign, 'silently-different') + sum(foreign, 'accepted-past-oracle')} wrong.`,
);
console.log(
    `\n${sum(wild, 'refused-by-us')} of the ${wildRefused} refusals are files the oracle compiles; ` +
        `${sum(wild, 'refused-by-oracle')} ${sum(wild, 'refused-by-oracle') === 1 ? 'is' : 'are'} refused by ` +
        'both — for reasons this does not compare, printed below.',
);

console.log(`\n${bucketTable(wild)}`);

if (language.length > 0) {
    const l = language[0];
    console.log(
        `\nThe language corpus (${l.files} \`.blp\` in the reference implementation's \`tests/samples\`): ` +
            `${l.counts['byte-equal']} byte-equal, ` +
            `${l.counts['refused-by-us'] + l.counts['refused-by-oracle']} refused, ` +
            `${l.counts['silently-different'] + l.counts['accepted-past-oracle']} wrong.`,
    );
}

if (bothRefused.length > 0) {
    console.log('\n## Refused by both — the two reasons, uncompared\n');
    for (const [key, theirs, ours] of bothRefused) {
        console.log(`  ${key}\n       oracle: ${theirs}\n       ours:   ${ours}`);
    }
}

if (divergent.length > 0) {
    console.log('\n## Wrong output, not an error\n');
    for (const [bucket, key] of divergent) console.log(`  ${bucket.padEnd(21)} ${key}`);
}

// ---------------------------------------------------------------- what the wild uses

const languageFiles = total(language);
console.log('\n## What the wild actually uses, ordered\n');
console.log(`| # | construct | wild (${wildFiles}) | language (${languageFiles}) |`);
console.log('|---:|---|---:|---:|');
const ordered = [...census].sort((a, b) => b[1].wild - a[1].wild || b[1].language - a[1].language);
ordered.forEach(([name, n], i) => {
    const w = wildFiles === 0 ? `${n.wild}` : `${n.wild} (${pct(n.wild, wildFiles)}%)`;
    const l = languageFiles === 0 ? `${n.language}` : `${n.language} (${pct(n.language, languageFiles)}%)`;
    console.log(`| ${i + 1} | ${name} | ${w} | ${l} |`);
});

// ---------------------------------------------------------------- the bottom line
//
// Ordered by files unblocked, greedily: at each step the construct that frees the most
// foreign files whose WHOLE remaining need is covered once it is closed. A file needing two
// constructs moves nothing until both are closed, which is why the increments here are
// smaller than the census above and why the two tables have to be read together.

if (needs.size > 0 && pools.length === 0) {
    const validForeign = foreignFiles - sum(foreign, 'refused-by-oracle');
    const open = new Map(needs);
    const closed = new Set();
    const steps = [];
    while (open.size > 0) {
        const gain = new Map();
        for (const [name] of census) {
            if (closed.has(name)) continue;
            const freed = [...open].filter(([, n]) => n.every((c) => c === name || closed.has(c)));
            if (freed.length > 0) gain.set(name, freed);
        }
        if (gain.size === 0) {
            // Every remaining file needs at least two still-open constructs, so no single
            // next step frees anything. Close whichever open construct the most of them
            // name, and keep going rather than stopping with a table that does not add up.
            const tally = new Map();
            for (const [, n] of open) for (const c of n) if (!closed.has(c)) tally.set(c, (tally.get(c) ?? 0) + 1);
            const next = [...tally].sort((a, b) => b[1] - a[1])[0][0];
            closed.add(next);
            steps.push([next, 0]);
            continue;
        }
        // Ties are common — six constructs each free exactly one file — so the tie-break is
        // the census order above rather than whatever `sort` does with an unspecified
        // comparison. Without it the table's LABELS shuffle between runs on the same tree
        // while its numbers do not, which is the kind of diff that costs an afternoon.
        const [name, freed] = [...gain].sort(
            (a, b) =>
                b[1].length - a[1].length ||
                census.get(b[0]).wild - census.get(a[0]).wild ||
                census.get(b[0]).language - census.get(a[0]).language,
        )[0];
        closed.add(name);
        for (const [key] of freed) open.delete(key);
        steps.push([name, freed.length]);
    }
    console.log('\n## The honest bottom line\n');
    console.log(`| after closing | cumulative | of ${validForeign} valid foreign files |`);
    console.log('|---|---:|---:|');
    let cumulative = validForeign - needs.size;
    console.log(`| today | ${cumulative} | ${pct(cumulative, validForeign)}% |`);
    for (const [name, freed] of steps) {
        cumulative += freed;
        console.log(`| + ${name} | ${cumulative} | ${pct(cumulative, validForeign)}% |`);
    }
    console.log('\nWhat each file that does not build today still needs:\n');
    for (const [key, n] of needs) console.log(`  ${key}\n       ${n.join(' + ')}`);
}

console.log("\n## What we refuse, by the parser's own words\n");
for (const [construct, files] of [...refusalsByMessage].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(files.length).padStart(3)}  ${construct}`);
    for (const key of files) console.log(`       ${key}`);
}

console.log('\n## The sources this ran over\n');
for (const row of rows) console.log(`  ${row.source.pool.padEnd(18)} ${row.note}`);
