#!/usr/bin/env node
/**
 * CI entry: after a release, every PUBLISHED package's pinned intra-repo
 * dependencies must actually RESOLVE on the registry.
 *
 * A PARTIAL RELEASE CAN BE WORSE THAN NO RELEASE. The `npm:publish` sweep is
 * fail-fast, pack time rewrites every `workspace:*` to the EXACT version, and npm
 * SILENTLY SKIPS an `optionalDependency` that does not resolve. Together those
 * three leave `@gjsify/<bridge>@<v>` live on npm pinning a
 * `@gjsify/<bridge>-darwin-x64@<v>` that does not exist: the install succeeds,
 * the binary is absent, and the consumer gets the new JS bridge with no typelib
 * and no dylib — strictly worse than the previous version's error state, and
 * nothing re-checked it. Measured at 0.27.0 from the registry: `@gjsify/webgl`
 * published 3.7s BEFORE `@gjsify/webgl-darwin-arm64`, i.e. parent before platform
 * child on every one of the eleven split bridges. All siblings happened to land,
 * so the hazard was unguarded rather than live.
 *
 * PREVENTION is the sweep's ORDER — `gjsify foreach --topological`, whose graph
 * counts `optionalDependencies`, so every platform child precedes its bridge and
 * ANY prefix of the sweep is a resolvable tree (`publish-napi` has done this by
 * hand since ADR 0017). DETECTION is this script. Detection alone only shortens
 * the window, since npm has no transaction to roll back, so the two ship together.
 *
 * TWO PHASES, AND THE PHASE SELECTS THE ASSERTIONS — not the wording.
 * `--phase post-release` (the default) is the job described above, at the end of
 * `release.yml`. `--phase pre-release` runs the same enumeration on every pull
 * request and every push to `main`, from `audit-runtimes.yml`. It exists because a
 * report that arrives at the END of `release.yml` arrives after the tag and after
 * the release record — the second shape `status/sections/priorities.md` § 2 names,
 * "a job that runs only AFTER the merge … is simply absent from the PR, which reads
 * identically" to one that passed. Measured on #1494, which added two brand-new npm
 * names (`@gjsify/webview2-native` and its win32-x64 target): nothing in the tree
 * asked for their manual bootstrap, and the only thing carrying the requirement was
 * a paragraph in a pull-request body.
 *
 * WHAT THE PHASE CHANGES IS THE REGISTRY PREDICATE, and it has to. Pre-release the
 * train version is not published yet BY CONSTRUCTION. Asking "is every candidate
 * live at `package.json`'s version" on a pull request was drafted and refuted with
 * measurements (#1500): a PR adding ANY new package goes red with no remedy the
 * contributor can apply — the fix needs a publish credential plus an OTP, which CI
 * does not have — and every release cut red-lines `main` and every open PR for the
 * whole ~200-package sweep, because `.release-it.json` puts the version-bump commit
 * on `main` BEFORE the sweep runs, with a skipped publish job (the recorded v0.31.0
 * case) able to keep it red for the rest of the cycle. So pre-release asks PRESENCE
 * OF THE NAME — an answer that does not move when the train moves — and the "this
 * release published NOTHING" assertion, a statement about a COMPLETED release, is
 * dropped with it. Everything decided from the MANIFESTS (a `private` target, a
 * version-skewed literal pin, an unrecognised spec shape) is phase-independent.
 *
 * THE DECLARED-GAP LEDGER — `status/pending-npm-bootstrap.json`, read in the
 * pre-release phase ONLY. `docs/publishing.md` states the policy as "the bootstrap
 * is done before merge OR QUEUED as the next maintainer action", and a required
 * gate with no escape hatch deletes the second branch. So an absent name must be
 * LISTED, and a listed name that IS published fails too: the list empties itself at
 * bootstrap and cannot rot into a permanent exemption. That rot is measured — an
 * earlier draft's bidirectional arm looped over two package families only, so a
 * declared-and-published name outside them was never re-examined and passed with
 * exit 0 forever (#1500). This is the reader that enumerates the WHOLE tree, so
 * every entry is held against it, including one naming a package this repository
 * does not contain and one naming a `private` or off-train package, for which "not
 * published yet" is a category error rather than a queued action.
 *
 * A RELEASE DOES NOT GET TO DECLARE ITS OWN GAP: post-release the ledger is
 * IGNORED, so a bridge that shipped pinning a name nobody bootstrapped is red on
 * the release even though the pull request that added it was green. The escalation
 * is the point — pre-release says "queued", post-release says "you shipped it".
 *
 * THE POSITIVE-FACT RULE — a check that verified nothing must not report success,
 * so this asserts COUNTS rather than the absence of findings:
 *   1. at least one candidate package is LIVE at the release version. POST-RELEASE
 *      ONLY: it says the release published something, which pre-release is not yet
 *      true and never will be — there the roster below carries the same weight,
 *      because 209 undeclared absences is exactly as red as one;
 *   2. the tree DECLARES at least one release-pinned intra-repo edge — a property
 *      of the manifests, and the assertion that outlives a refactor: if the
 *      enumeration stops seeing the platform-sibling edges, every future release
 *      passes on an empty set. Phase-independent, for the same reason;
 *   3. on a COMPLETE release, at least one edge was examined. Implied by 1+2 and
 *      asserted anyway, so a change to either derivation cannot quietly produce
 *      an empty examination;
 *   4. every examined edge resolves.
 * An edge this script cannot DECIDE is a FAILURE, never a skip.
 *
 * THE ONE LEGITIMATE DROP is a target that is not a package of this repository —
 * an external dependency is the registry's problem. Dropping targets that were
 * merely not CANDIDATES swallowed two defects, both exiting 0 with "Every one of
 * 1 … edge(s) … resolves": version SKEW behind a literal pin (parent at `<v>`
 * pinning a child whose manifest stayed at `<v-1>`, so nothing publishes it at
 * `<v>`), and a published package pinning a `private` sibling
 * (`resolveWorkspaceProtocol` rewrites `workspace:^` to the target's version
 * whether or not it is publishable). Both are decided from the MANIFESTS alone,
 * so they fail identically on a complete release, a partial one and a dry tree.
 *
 * EVERY NOTEWORTHY STATE MUST REACH THE STEP SUMMARY, which is what a human opens
 * after a release. `problems` AND the not-fatal `notes` render there as GitHub
 * alerts and the table carries an explicit `Verdict` row: before that, the
 * "nothing was examined" sentence went to stdout only, so the most likely partial
 * release rendered as `Pinned edges examined | 0` with no caution under a green
 * check. The notes are ALSO `::warning::` annotations, which survive a summary
 * file that cannot be written.
 *
 * IT ALSO CHECKS THE ROSTER, not only the edges: every package whose manifest
 * carries the release version must be live at it (pre-release: must EXIST). That is
 * a SECOND question, and the edge check answered its own correctly while v0.31.0
 * left `@gjsify/napi` and its two platform children at 0.30.0 — nothing in this
 * repository declares a manifest edge to `napi`, so there was no pinned edge to
 * examine. The roster is also the only half that fires on the #1494 shape, where a
 * brand-new BRIDGE and its brand-new TARGET are both absent: `violations()` needs
 * `isLive(e.from)`, and a bridge that has never been published is not live. Only
 * "existing published bridge + brand-new target" reports twice.
 *
 * This block used to say the opposite: that an incomplete release must NOT fail
 * here, because it "can only co-occur with an already-red publish job" and a second
 * misleading red teaches everyone to ignore this job. The reasoning was sound and
 * its premise expired. It was written when INCOMPLETE meant the sweep aborted;
 * since ADR 0017 split `napi`, `node-gi` and the GTK bundles into their own jobs, a
 * package goes missing through a SKIPPED job, which is neither red nor examined,
 * while the 60-name `publish` job stays green. What survives of the old reasoning
 * is its requirement, and the roster failure meets it: it names the PACKAGE that is
 * not on npm, never "the enumeration broke".
 *
 * WHAT "RESOLVES" MEANS: the release version is by construction the MAXIMUM of
 * this train, so each of `<v>`, `=<v>`, `^<v>`, `~<v>` admits exactly one existing
 * version — `<v>` — and presence on the registry is a complete answer with no
 * semver engine involved. A spec pinned to an OLDER range is out of scope (an
 * already-published version satisfies it) and there are none, which is why an
 * unrecognised shape fails loudly instead of being bucketed.
 *
 * SCOPE: manifest-declared edges only. `@gjsify/gtk-runtime-*` is resolved by NAME
 * at install time, so no manifest edge exists to check and its own publish jobs
 * are the guard.
 *
 * A PLAIN NODE SCRIPT so it runs on a bare checkout — no `gjsify install`, no
 * build — and cannot be staled by the committed CLI bundle (the circularity
 * `verify-committed-bundles.mjs` breaks), and still works when the release that
 * would have installed the tree is what failed. The package set comes from
 * `createContext`, the same oracle every conformance rule reads, so this and
 * `audit-runtimes --check` cannot disagree about which packages exist. The default
 * registry URL is the one duplicated fact (`@gjsify/npm-registry`'s
 * `DEFAULT_REGISTRY` lives behind a built `lib/`); `--registry` overrides it.
 *
 * Usage:
 *   node scripts/verify-published-closure.mjs
 *   node scripts/verify-published-closure.mjs --phase pre-release
 *   node scripts/verify-published-closure.mjs --version 0.27.1
 *   node scripts/verify-published-closure.mjs --registry http://127.0.0.1:5555
 *   node scripts/verify-published-closure.mjs --root <dir>   # a fixture tree
 *   node scripts/verify-published-closure.mjs --json
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { createContext } from '../packages/infra/manifest-conformance/lib/context.mjs';

// Mirrors `@gjsify/npm-registry`'s DEFAULT_REGISTRY. Duplicated on purpose —
// see the header: this script must run before anything is built.
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
};
const asJson = argv.includes('--json');

// An unrecognised phase is refused rather than defaulted: silently running the
// post-release assertions on a pull request is the exact failure #1500 measured,
// and a typo must not select it.
const PHASES = ['post-release', 'pre-release'];
const phase = String(flag('--phase', 'post-release'));
const preRelease = phase === 'pre-release';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(flag('--root', scriptRoot));
const registry = String(flag('--registry', DEFAULT_REGISTRY)).replace(/\/+$/, '');
const concurrency = Math.max(1, Number(flag('--concurrency', '8')) || 8);
// Rounds, not per-request retries: npm's CDN can serve a packument that predates
// a publish by a few seconds, and a false red at release time costs a manual
// re-run of a workflow that already did its job. Only names that came back
// ABSENT are re-queried, so the retry cost is bounded by the interesting set.
const attempts = Math.max(1, Number(flag('--attempts', '3')) || 3);
const retryDelayMs = Math.max(0, Number(flag('--retry-delay-ms', '10000')) || 0);

// Same convention as `verify-package-outputs.mjs` / `verify-committed-bundles.mjs`:
// under Actions these become annotations, which is where a human looks first.
const inActions = Boolean(process.env.GITHUB_ACTIONS);

const fail = (msg) => {
    console.error(inActions ? `::error::${msg}` : `ERROR: ${msg}`);
};
/**
 * A state that does not fail the job but must not be quiet either. An annotation
 * is the one channel that cannot be lost: no writable file needed, and it renders
 * next to the job's green check rather than behind it.
 */
const warn = (msg) => {
    const title = preRelease ? 'Pre-release npm bootstrap' : 'Release closure';
    console.log(inActions ? `::warning title=${title}::${msg}` : `WARNING: ${msg}`);
};

if (!PHASES.includes(phase)) {
    fail(`unknown --phase ${JSON.stringify(phase)}; expected one of ${PHASES.join(', ')}.`);
    process.exit(1);
}

const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = String(flag('--version', rootManifest.version ?? ''));
if (!version) {
    fail(`no release version — ${join(repoRoot, 'package.json')} has no "version" and --version was not passed.`);
    process.exit(1);
}

// `discoveryRoots: ['packages']` for the reason `audit-runtimes.mjs` uses it:
// `packages/napi/*` and `packages/node-gi/*` are deliberately NOT workspace
// members yet are published by their own release jobs, and `@gjsify/napi` carries
// the only intra-repo edges spelled as a LITERAL version rather than
// `workspace:*`. The `workspaces` globs would drop exactly the packages whose
// pinning shape is most brittle.
const ctx = createContext({ root: repoRoot, discoveryRoots: ['packages'] });

/** Every package this release could have published: non-private, on the train. */
const candidates = ctx.allPackages.filter(
    (p) => !p.private && typeof p.manifest.name === 'string' && p.manifest.version === version,
);
/**
 * Every package IN THIS REPOSITORY by name, `private` ones and any left off the
 * release train INCLUDED — deliberately wider than the candidate set, because the
 * enumeration must SEE an edge into one of those to fail on it. Narrowing this map
 * to candidates is the bug that let a dead pin pass (header, THE ONE LEGITIMATE
 * DROP).
 */
const repoByName = new Map(
    ctx.allPackages.filter((p) => typeof p.manifest.name === 'string').map((p) => [p.manifest.name, p]),
);
const candidateNames = new Set(candidates.map((p) => p.manifest.name));

/**
 * THE DECLARED-GAP LEDGER (header). Read `--root`-relative so a fixture tree
 * carries its own and the whole composition — enumeration, probe, ledger — is
 * exercisable without cutting a release. `scripts/check-shipped-runtime-packages.mjs`
 * reads the SAME file: one ledger, two readers, because two ledgers overlapping on
 * six names is the second copy that drifts.
 *
 * An absent file is an EMPTY ledger, not an error, and cannot produce a false
 * green: an undeclared absence still fails, and the one rule the file enables —
 * a listed name that IS published — exists to force the entry's deletion, which is
 * what deleting the file does. What it must not do is pass QUIETLY, so the entry
 * count and the path are printed on every run.
 */
const LEDGER_REL_PATH = join('status', 'pending-npm-bootstrap.json');
const ledgerPath = join(repoRoot, LEDGER_REL_PATH);
/** @type {Map<string, string>} name → the queued maintainer action. */
const pending = new Map();
if (existsSync(ledgerPath)) {
    let ledger;
    try {
        ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    } catch (err) {
        fail(`${LEDGER_REL_PATH} does not parse: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
    if (!ledger.pending || typeof ledger.pending !== 'object') {
        fail(`${LEDGER_REL_PATH} has no "pending" object — the ledger shape changed and nothing would be declared.`);
        process.exit(1);
    }
    for (const [name, reason] of Object.entries(ledger.pending)) pending.set(name, String(reason ?? ''));
}
/**
 * A declared gap is only honoured PRE-RELEASE (header, A RELEASE DOES NOT GET TO
 * DECLARE ITS OWN GAP). Post-release this is always false, so the ledger cannot
 * silence a release that shipped a bridge pinning a name nobody bootstrapped.
 */
const expectedAbsent = (name) => preRelease && pending.has(name);

/**
 * What pack time will write into the PUBLISHED manifest for this spec.
 * `resolveWorkspaceProtocol` (`packages/infra/workspace/src/discover.ts`)
 * resolves `*` / `^` / `~` against the TARGET's own version — whether or not
 * that target is on this train, and whether or not it is publishable at all.
 */
function publishedSpec(spec, target) {
    if (!spec.startsWith('workspace:')) return spec;
    const rest = spec.slice('workspace:'.length);
    const targetVersion = String(target.manifest.version ?? '');
    if (rest === '*') return targetVersion;
    if (rest === '^') return `^${targetVersion}`;
    if (rest === '~') return `~${targetVersion}`;
    return rest; // explicit range (`workspace:^1.2.3`) — passed through verbatim
}

const pinsRelease = (spec) =>
    spec === version || spec === `=${version}` || spec === `^${version}` || spec === `~${version}`;

/**
 * Decide one intra-repo edge.
 *
 * `release`     — packs as a pin satisfiable ONLY by `version`, and the target is
 *                 published at `version` by this release, so exact presence on the
 *                 registry is a complete answer.
 * `undecidable` — anything else, WITH the reason. The caller turns each into a
 *                 failure naming the target; two of the three reasons below are
 *                 outright defects no registry probe would have reported.
 */
function decide(spec, target) {
    const packed = publishedSpec(spec, target);
    if (target.private) {
        return {
            kind: 'undecidable',
            packed,
            why:
                'the target is a `private` package — no release ever publishes it, so a pin on it from a PUBLISHED ' +
                'package is dead on arrival (npm would resolve the NAME to whatever unrelated package owns it, or ' +
                'to nothing). Unmark the target or drop the dependency',
        };
    }
    if (!pinsRelease(packed)) {
        return {
            kind: 'undecidable',
            packed,
            why:
                `it packs as ${JSON.stringify(packed)}, which is not the release version ${version}; this script ` +
                'decides only release-pinned edges, so nothing here verified it. Put the edge on the train ' +
                '(`workspace:^` / `workspace:*`) or teach `decide()` the shape',
        };
    }
    if (target.manifest.version !== version) {
        return {
            kind: 'undecidable',
            packed,
            why:
                `it pins ${version}, but that package's own manifest is at ` +
                `${target.manifest.version ?? '(no version)'} — this release does not publish it at ${version}, so ` +
                'the pin cannot resolve. Put the two manifests on the same version',
        };
    }
    return { kind: 'release', packed };
}

/** @type {{from: string, block: string, to: string, spec: string, kind: string, packed: string, why?: string}[]} */
const edges = [];
for (const pkg of candidates) {
    for (const block of ['dependencies', 'optionalDependencies']) {
        const deps = pkg.manifest[block];
        if (!deps || typeof deps !== 'object') continue;
        for (const [to, spec] of Object.entries(deps)) {
            if (typeof spec !== 'string') continue;
            const target = repoByName.get(to);
            // THE ONLY LEGITIMATE DROP: not a package of this repository, so this
            // release neither publishes nor pins it. Every in-repo target is
            // decided below, and an undecidable one FAILS.
            if (!target) continue;
            edges.push({ from: pkg.manifest.name, block, to, spec, ...decide(spec, target) });
        }
    }
}

const undecidableEdges = edges.filter((e) => e.kind === 'undecidable');
const pinnedEdges = edges.filter((e) => e.kind === 'release');

/** name → true (version present) | false (absent) | Error (probe failed). */
const state = new Map();

async function probe(name) {
    const url = `${registry}/${name.replace('/', '%2f')}`;
    try {
        const res = await fetch(url, {
            headers: {
                // Abbreviated packument: version keys only, a fraction of the
                // bytes. `no-cache` so a CDN edge cannot answer with a document
                // minted before the publish we are checking.
                accept: 'application/vnd.npm.install-v1+json',
                'cache-control': 'no-cache',
            },
            signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 404) return false;
        if (!res.ok) return new Error(`${res.status} ${res.statusText}`);
        const doc = await res.json();
        if (!doc?.versions) return false;
        // THE PHASE'S ONE REGISTRY PREDICATE (header). Post-release: this exact
        // version, because that is what the release claims to have published.
        // Pre-release: the NAME exists at all, because the train version is
        // unpublished by construction and asking for it makes every cut red.
        return preRelease ? Object.keys(doc.versions).length > 0 : Object.hasOwn(doc.versions, version);
    } catch (err) {
        return err instanceof Error ? err : new Error(String(err));
    }
}

async function probeAll(names) {
    let cursor = 0;
    const workers = [];
    for (let w = 0; w < Math.min(concurrency, names.length); w++) {
        workers.push(
            (async () => {
                while (cursor < names.length) {
                    const name = names[cursor++];
                    state.set(name, await probe(name));
                }
            })(),
        );
    }
    await Promise.all(workers);
}

const isLive = (name) => state.get(name) === true;
/**
 * CONFIRMED absent — a 404, not merely "we did not get a `true`". An errored probe
 * (5xx, timeout, DNS) means we do not KNOW, and treating it as absent would turn a
 * transient registry hiccup into a fabricated "never published" verdict on an
 * intact release. Unknown belongs to `probeErrors()`, which fails the job for what
 * it is: no evidence.
 */
const isAbsent = (name) => state.get(name) === false;
const probeErrors = () => candidates.filter((p) => state.get(p.manifest.name) instanceof Error);
/**
 * A pinned edge is violated when its parent IS live and its target is CONFIRMED
 * absent — and, pre-release, was not DECLARED absent, because the point of the
 * ledger is that a queued bootstrap is a known cost rather than a finding. It is
 * still reported, as a note; see `notes` below.
 */
const violations = () => pinnedEdges.filter((e) => isLive(e.from) && isAbsent(e.to) && !expectedAbsent(e.to));
/** Absences nobody declared — the ones a retry round might still turn into a `true`. */
const unexpectedlyAbsent = () =>
    candidates.filter((p) => isAbsent(p.manifest.name) && !expectedAbsent(p.manifest.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await probeAll(candidates.map((p) => p.manifest.name));
for (let round = 2; round <= attempts; round++) {
    const liveCount = candidates.filter((p) => isLive(p.manifest.name)).length;
    // `unexpectedlyAbsent()` is in the condition, not just `violations()`: an absent
    // package with no incoming edge fails the ROSTER and appears in neither the
    // violation nor the error set, so without it a CDN answer minted before a
    // publish became a verdict on the first round. It matters most where a false red
    // is most expensive — pre-release this is a REQUIRED check on every PR. A
    // DECLARED absence is excluded, so a queued bootstrap costs no rounds at all.
    if (violations().length === 0 && probeErrors().length === 0 && unexpectedlyAbsent().length === 0 && liveCount > 0) {
        break;
    }
    // Re-query only what came back absent or errored — a present version never
    // becomes absent, so the rest of the answer is already final.
    const retry = candidates.map((p) => p.manifest.name).filter((n) => state.get(n) !== true);
    if (retry.length === 0) break;
    if (!asJson) {
        console.log(
            `Release closure check: round ${round}/${attempts} — re-querying ${retry.length} unresolved name(s) in ${retryDelayMs}ms (registry propagation).`,
        );
    }
    await sleep(retryDelayMs);
    await probeAll(retry);
}

const live = candidates.filter((p) => isLive(p.manifest.name)).map((p) => p.manifest.name);
const notLive = candidates.filter((p) => isAbsent(p.manifest.name)).map((p) => p.manifest.name);
const errored = probeErrors().map((p) => ({ name: p.manifest.name, error: String(state.get(p.manifest.name)) }));
const bad = violations();
/** Pre-release only; post-release `expectedAbsent` is false, so this is `notLive`. */
const absentUndeclared = notLive.filter((n) => !expectedAbsent(n));
const absentDeclared = notLive.filter((n) => expectedAbsent(n));
/**
 * The ledger's BIDIRECTIONAL arm and its two category errors. Held here rather than
 * in the ship-runtime reader because this is the enumeration that sees the whole
 * tree — the earlier draft's arm looped over two families, and a
 * declared-and-published name outside them passed forever (header).
 */
const ledgerStale = preRelease ? [...pending.keys()].filter((n) => isLive(n)) : [];
const ledgerForeign = preRelease ? [...pending.keys()].filter((n) => !repoByName.has(n)) : [];
const ledgerUnpublishable = preRelease
    ? [...pending.keys()].filter((n) => repoByName.has(n) && !candidateNames.has(n))
    : [];
const ledgerReasonless = preRelease ? [...pending].filter(([, why]) => why.trim() === '').map(([n]) => n) : [];
/**
 * EXAMINED means resolved to a definite answer, not merely "looked at": parent
 * confirmed live AND the target's probe came back live or 404. An edge whose target
 * ERRORED decided nothing, and counting it would overstate the number the
 * empty-result assertion is built on. It cannot currently produce a false green (an
 * errored probe already fails the job) — defined honestly rather than defended by a
 * side condition.
 */
const examined = pinnedEdges.filter((e) => isLive(e.from) && (isLive(e.to) || isAbsent(e.to)));
const byBlock = (list, block) => list.filter((e) => e.block === block).length;

const problems = [];
if (errored.length > 0) {
    problems.push(
        `${errored.length} registry probe(s) never produced an answer after ${attempts} round(s). A probe that could ` +
            'not be completed is not evidence of anything; re-run the job.',
    );
}
// The liveness-derived conclusions below are only sound when EVERY probe was
// answered: with an unanswered probe, "nothing is live" and "the release is
// complete" are both unknowable, and stating either would replace a missing signal
// with a wrong one. The probe-error problem above already fails the job.
// PHASE-DEPENDENT (header, THE POSITIVE-FACT RULE § 1). "This release published
// nothing" is a statement about a COMPLETED release; pre-release it is the normal
// state of a train that has not been cut, and asserting it there is one of the
// three consequences #1500 measured. The roster below carries the weight instead,
// and it has to say something either way: 209 undeclared absences is as red as one.
if (!preRelease && errored.length === 0 && live.length === 0) {
    problems.push(
        `0 of ${candidates.length} candidate package(s) are on ${registry} at ${version} — this release published ` +
            'NOTHING. Nothing on npm is broken; the closure check simply verified nothing, and a check that verified ' +
            'nothing must not report success.',
    );
}
if (pinnedEdges.length === 0) {
    problems.push(
        `the tree at ${repoRoot} declares NO release-pinned intra-repo dependency at all, so there is nothing for ` +
            'this check to verify. That is a property of the manifests, not of the registry: in this repository the ' +
            'platform children of the split native bridges are ~60 exact-pinned `optionalDependencies` edges. Zero ' +
            'means the enumeration above no longer sees them, and every future release would pass on an empty set.',
    );
}
if (
    errored.length === 0 &&
    live.length > 0 &&
    notLive.length === 0 &&
    // Without this guard the message below fires on `pinnedEdges === 0` and claims
    // "those three facts cannot all be true" — self-contradicting, since zero
    // declared edges being zero examined is the ONE way they can. The real finding
    // there is the assertion above, and pointing the next reader at a non-existent
    // examination-filter bug wastes the attention this guard is asking for.
    pinnedEdges.length > 0 &&
    examined.length === 0
) {
    // Implied by the two assertions above (pinned edges exist AND every package is
    // live ⇒ some pinned parent is live), asserted so a change to either derivation
    // cannot silently yield an empty examination.
    problems.push(
        `every one of ${live.length} candidate package(s) is live at ${version}, the tree declares ` +
            `${pinnedEdges.length} release-pinned edge(s), and yet ZERO were examined. Those three facts cannot all ` +
            'be true — the examination filter is broken.',
    );
}
if (undecidableEdges.length > 0) {
    problems.push(
        `${undecidableEdges.length} intra-repo dependency edge(s) could not be DECIDED against ${version} — each is ` +
            'named above with its reason. An edge this check cannot decide is a FAILURE, never a skip: the only ' +
            'edge it may drop is one whose target is not a package of this repository at all. Two of the reasons ' +
            'are outright dead pins (a `private` target, or a target whose manifest is on a different version) ' +
            'that no registry probe would ever have reported.',
    );
}
if (bad.length > 0) {
    problems.push(
        `${bad.length} pinned dependency/dependencies of PUBLISHED package(s) do not resolve` +
            `${preRelease ? '' : ` at ${version}`}. npm skips an unresolvable optionalDependency in SILENCE, so ` +
            'consumers install the new bridge with no binary behind it. ' +
            // The remediation is the one thing that CANNOT be shared. "Re-run the
            // release workflow" is not advice a contributor on a pull request can
            // take, and #1500's second measured consequence was a message that sent
            // the reader after an edge on the path where there is none.
            (preRelease
                ? 'Bootstrap the target BEFORE the bridge — that order is a correctness property, not a style ' +
                  'preference — or declare it in `status/pending-npm-bootstrap.json` with the queued action. ' +
                  'Procedure: docs/publishing.md § New `@gjsify/*` package.'
                : 'Re-run the release workflow: `gjsify publish --tolerate-republish` makes a re-run a no-op for ' +
                  'what already landed and publishes the rest.'),
    );
}
/**
 * THE ROSTER, beside the edges: did every package this train MEANT to publish
 * actually arrive?
 *
 * The edge check answers a different question, and answered it correctly while
 * v0.31.0 shipped `@gjsify/napi` and its two platform children at 0.30.0: nothing
 * in this repository declares a manifest edge to `@gjsify/napi`, so there was no
 * pinned edge to examine, let alone fail.
 *
 * The header's reasoning for tolerating an incomplete release rested on a clause
 * that stopped holding — that it "can only co-occur with an already-red publish
 * job". That was true when INCOMPLETE meant the sweep aborted. Since ADR 0017 gave
 * `napi`, `node-gi` and the GTK bundles their own publish jobs, a package can go
 * missing through a SKIPPED job, which is neither red nor examined, while the
 * 60-name `publish` job is green.
 *
 * Two things this deliberately does NOT do. It does not turn a skipped publish job
 * into a failure — the skip is correct, `publish-napi` cannot run without its
 * prebuild — and it does not report that the enumeration broke. The finding is a
 * NAMED package that is not on npm, which is what the header's "second misleading
 * red" warning is asking for.
 *
 * The roster comes from the MANIFESTS under `packages/**` (`candidates`, via
 * `createContext`) and not from the root `workspaces` globs. Measured on the
 * incident: a workspace-derived roster reports "All 138 at 0.31.0" — green —
 * because `packages/napi/*` and `packages/node-gi/*` are not in that list at all,
 * by design, and `release.yml` relies on the exclusion. The packages the dedicated
 * jobs own are exactly the ones that can go missing and exactly the ones those
 * globs cannot see.
 */
const nameList = (names) => `${names.slice(0, 20).join(', ')}${names.length > 20 ? `, … (+${names.length - 20})` : ''}`;

if (!preRelease && errored.length === 0 && live.length > 0 && notLive.length > 0) {
    problems.push(
        `${notLive.length} of ${candidates.length} package(s) this train meant to publish are NOT on ${registry} ` +
            `at ${version}: ${nameList(notLive)}` +
            `. Each one declares ${version} in its own manifest, so the ` +
            'release intended to publish it. A package with no incoming manifest edge (`@gjsify/napi`, ' +
            '`@gjsify/node-gi`, the `@gjsify/gtk-runtime-*` bundles) has its own publish job as its ONLY guard, ' +
            'and a skipped job is neither red nor examined. Re-run the release workflow: `gjsify publish ' +
            '--tolerate-republish` no-ops for what already landed and publishes the rest.',
    );
}

/**
 * THE PRE-RELEASE ROSTER, and the ledger's four rules. The question is BOOTSTRAP
 * state, not release completeness: does the npm name exist at all, so that the
 * release's OIDC exchange has something to publish to? `--tolerate-untrusted-new`
 * makes the answer invisible at release time — an unbootstrapped name returns
 * `{ok: true, action: 'skipped-untrusted-new'}` and the sweep stays GREEN with the
 * name simply absent, announced by one `~` line in a log carrying one line per
 * published package — and npm then skips the unresolvable edge at install time.
 * Three silent layers, so the report has to arrive before any of them.
 */
if (preRelease && errored.length === 0 && absentUndeclared.length > 0) {
    problems.push(
        `${absentUndeclared.length} of ${candidates.length} publishable name(s) do not exist on ${registry} and ` +
            `nothing declares that: ${nameList(absentUndeclared)}. npm Trusted Publishing cannot CREATE a package ` +
            '— OIDC requires the name to already exist — so the first publish is a manual maintainer action needing ' +
            'a publish credential and an OTP, which CI does not have. Until it happens the release publishes GREEN ' +
            'with the name missing (`--tolerate-untrusted-new`), and npm then skips the unresolvable edge at install ' +
            'time in silence. Bootstrap it (docs/publishing.md § New `@gjsify/*` package: `gjsify publish <dir> ' +
            '--access public --otp <code>`, then `gjsify trust <name>`, TARGET before BRIDGE), or declare it in ' +
            `${LEDGER_REL_PATH} with the queued action — that is the "or queued as the next maintainer action" ` +
            'branch of the policy, and the entry has to be deleted again the moment the name goes live.',
    );
}
if (ledgerStale.length > 0) {
    problems.push(
        `${LEDGER_REL_PATH} still lists ${nameList(ledgerStale)}, which IS on ${registry}. The bootstrap is done — ` +
            'delete the entry. This arm is what keeps the ledger from rotting into a permanent exemption, and it is ' +
            'held HERE rather than in `check-shipped-runtime-packages.mjs` because this is the reader that ' +
            'enumerates the whole tree: an earlier draft looped over two package families, so a ' +
            'declared-and-published name outside them was never re-examined and passed with exit 0 forever (#1500).',
    );
}
if (ledgerForeign.length > 0) {
    problems.push(
        `${LEDGER_REL_PATH} lists ${nameList(ledgerForeign)}, which this repository does not contain. A ledger entry ` +
            'is a queued publish of OUR package; a name nothing here builds can never be cleared and would sit ' +
            'forever. Remove it, or fix the spelling.',
    );
}
if (ledgerUnpublishable.length > 0) {
    problems.push(
        `${LEDGER_REL_PATH} lists ${nameList(ledgerUnpublishable)}, which this repository contains but no release ` +
            `publishes — it is \`private\`, or its manifest is not on the train at ${version}. "Not published yet" ` +
            'is not a queued action there but a category error, and the entry would never clear. Put the package on ' +
            'the train, or drop the entry.',
    );
}
if (ledgerReasonless.length > 0) {
    problems.push(
        `${LEDGER_REL_PATH} lists ${nameList(ledgerReasonless)} with an empty reason. The value is the queued action ` +
            'and who owns it; an entry without one is an exemption, which is the thing this ledger is shaped to ' +
            'refuse.',
    );
}

/**
 * NOT failures, and therefore the most dangerous thing this script produces:
 * nothing downstream forces them to be seen. Every entry is rendered into the step
 * summary as an alert AND emitted as an Actions annotation, so a state worth naming
 * cannot end up visible only to whoever scrolls a green job's log. A list rather
 * than `console.log` calls because a value can be routed to every channel and a
 * print statement cannot.
 */
const notes = [];
// A note for "no edge was examined because the sweep stopped short" used to live
// here. The roster assertion above now FAILS that state and names the missing
// packages, so the note became unreachable — `problems.length === 0` implies every
// candidate is live, which with a non-empty edge set implies a live pinned parent.
// Removed rather than left as dead reassurance; `verdict` still carries a
// NOTHING VERIFIED branch for any path that reaches zero examined edges without a
// problem, which is the honest thing to print if one is ever found.
//
// A DECLARED GAP IS NOT A FINDING BUT IT IS NOT NOTHING EITHER: the release that
// ships while an entry stands publishes a name-shaped hole, and post-release the
// ledger is ignored, so that release goes red. Every pull request and every push to
// `main` therefore carries the reminder next to its green check.
if (absentDeclared.length > 0) {
    notes.push(
        `${absentDeclared.length} name(s) are declared pending bootstrap in ${LEDGER_REL_PATH} and are absent from ` +
            `${registry}, as declared: ${nameList(absentDeclared)}. That is the policy's "queued as the next ` +
            'maintainer action" branch, not a pass — it needs a publish credential and an OTP, and the NEXT release ' +
            'is red on it: the post-release phase ignores this ledger deliberately, because a release does not get ' +
            'to declare its own gap.',
    );
}
const pinnedByDeclared = pinnedEdges.filter((e) => isLive(e.from) && expectedAbsent(e.to));
if (pinnedByDeclared.length > 0) {
    notes.push(
        `${pinnedByDeclared.length} release-pinned edge(s) point at a name declared pending bootstrap, so the cost ` +
            'of the queued action is a SILENT one: npm skips an unresolvable optionalDependency without an error, ' +
            `and the consumer installs the bridge with nothing behind it. ${pinnedByDeclared
                .slice(0, 5)
                .map((e) => `${e.from} → ${e.block}.${e.to}`)
                .join('; ')}.`,
    );
}

/** One sentence a human can read off the summary table without decoding counts. */
const verdict =
    problems.length > 0
        ? `**FAILED** — ${problems.length} problem(s); see the caution(s) above`
        : preRelease
          ? // Pre-release the SUBJECT is names, not edges — an examinable edge needs a
            // live parent, and a tree whose new bridge is not published yet legitimately
            // has none. Reusing the edge-based branch here reported NOTHING VERIFIED
            // over a run that had confirmed every name it was asked about.
            live.length === 0
              ? '**NOTHING VERIFIED** — no publishable name was confirmed on the registry'
              : `**OK** — ${live.length} publishable name(s) exist on npm` +
                `${absentDeclared.length > 0 ? `, ${absentDeclared.length} declared pending` : ''}` +
                `; ${examined.length} examined edge(s) resolve`
          : examined.length === 0
            ? '**NOTHING VERIFIED** — no edge was examined; see the warning above'
            : `**OK** — all ${examined.length} examined edge(s) resolve`;

if (asJson) {
    console.log(
        JSON.stringify(
            {
                phase,
                version,
                registry,
                candidates: candidates.length,
                live: live.length,
                notLive,
                absentUndeclared,
                absentDeclared,
                pending: Object.fromEntries(pending),
                errored,
                edges: { total: edges.length, pinned: pinnedEdges.length, examined: examined.length },
                undecidableEdges,
                violations: bad,
                notes,
                ok: problems.length === 0,
            },
            null,
            2,
        ),
    );
} else if (preRelease) {
    // A DIFFERENT HEADLINE for a different question, because the counts are only
    // readable next to the question they answer. "live at 0.46.0: 209" and "the name
    // exists: 209" are the same integer about two different facts, and the one thing
    // this file may not do is let a reader mistake one for the other.
    console.log(`Pre-release npm bootstrap check — ${registry} (root ${repoRoot}, train at ${version})`);
    console.log(`  publishable names (non-private, on the train): ${candidates.length}`);
    console.log(`  existing on the registry (any version):        ${live.length}`);
    console.log(
        `  release-pinned intra-repo edges examined:      ${examined.length} ` +
            `(${byBlock(examined, 'optionalDependencies')} optionalDependencies, ${byBlock(examined, 'dependencies')} dependencies)`,
    );
    console.log(`  declared pending bootstrap (${LEDGER_REL_PATH}): ${pending.size}`);
    for (const [name, why] of pending) console.log(`    pending: ${name} — ${why}`);
    if (absentUndeclared.length > 0) {
        console.log(
            `  ABSENT and undeclared (${absentUndeclared.length}): ${absentUndeclared.slice(0, 12).join(', ')}` +
                `${absentUndeclared.length > 12 ? ', …' : ''}`,
        );
    }
    for (const e of errored) console.error(`  probe failed: ${e.name} — ${e.error}`);
    for (const e of undecidableEdges) {
        console.error(
            `  UNDECIDABLE EDGE: ${e.from}@${version} → ${e.block}.${e.to} = ${JSON.stringify(e.spec)} — ${e.why}.`,
        );
    }
    for (const e of bad) {
        console.error(`  UNRESOLVABLE: ${e.from} → ${e.block}.${e.to} does NOT exist on the registry`);
    }
    for (const p of problems) fail(p);
    for (const n of notes) warn(n);
    if (problems.length === 0) {
        console.log(
            `Every one of ${live.length} publishable name(s) exists on npm` +
                `${pending.size > 0 ? ` (${pending.size} declared pending)` : ''}, and ` +
                // "all 0 edge(s) resolve" is a success claim over an empty set, which is
                // the one sentence this file may not print. Say which question was
                // actually answered instead.
                (examined.length > 0
                    ? `all ${examined.length} release-pinned dependency edge(s) resolve.`
                    : 'NO release-pinned edge was examinable — every pinned parent is absent — so this run ' +
                      'verified names only.'),
        );
    }
} else {
    console.log(`Release closure check — ${registry} at ${version} (root ${repoRoot})`);
    console.log(`  candidate packages (non-private, on the train): ${candidates.length}`);
    console.log(`  live on the registry at ${version}:              ${live.length}`);
    console.log(
        `  release-pinned intra-repo edges examined:       ${examined.length} ` +
            `(${byBlock(examined, 'optionalDependencies')} optionalDependencies, ${byBlock(examined, 'dependencies')} dependencies)`,
    );
    if (notLive.length > 0) {
        // Reported, never asserted on: the candidate set is a superset of what a
        // release publishes (a brand-new name awaiting its manual bootstrap is
        // legitimately absent). Whether an absence MATTERS is decided by the
        // closure — a missing package with a live dependent is a violation below.
        console.log(
            `  absent at ${version} (${notLive.length}): ${notLive.slice(0, 12).join(', ')}${notLive.length > 12 ? ', …' : ''}`,
        );
    }
    for (const e of errored) console.error(`  probe failed: ${e.name} — ${e.error}`);
    for (const e of undecidableEdges) {
        console.error(
            `  UNDECIDABLE EDGE: ${e.from}@${version} → ${e.block}.${e.to} = ${JSON.stringify(e.spec)} — ${e.why}.`,
        );
    }
    for (const e of bad) {
        console.error(`  UNRESOLVABLE: ${e.from}@${version} → ${e.block}.${e.to}@${version} is NOT on the registry`);
    }
    for (const p of problems) fail(p);
    for (const n of notes) warn(n);
    if (problems.length === 0 && examined.length > 0) {
        console.log(
            `Every one of ${examined.length} release-pinned dependency edge(s) across ${live.length} published ` +
                'package(s) resolves.',
        );
    }
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
    const lines = [preRelease ? '## Pre-release npm bootstrap' : '## Published dependency closure', ''];
    // ALERTS FIRST, above the table: a count is not a finding, and `Pinned edges
    // examined | 0` with nothing beside it reads as a pass — the rendering the most
    // likely partial release produces. CAUTION for what failed the job, WARNING for
    // what it declined to fail but must still be read.
    for (const p of problems) lines.push('> [!CAUTION]', `> ${p}`, '');
    for (const n of notes) lines.push('> [!WARNING]', `> ${n}`, '');
    lines.push(
        '| Fact | Value |',
        '|---|---|',
        `| Registry | \`${registry}\` |`,
        `| Version | \`${version}\` |`,
        preRelease ? `| Publishable names | ${candidates.length} |` : `| Candidate packages | ${candidates.length} |`,
        preRelease ? `| Existing on npm | ${live.length} |` : `| Live at this version | ${live.length} |`,
        ...(preRelease
            ? [
                  `| Declared pending bootstrap | ${pending.size} |`,
                  `| Absent and undeclared | ${absentUndeclared.length} |`,
              ]
            : []),
        `| Pinned edges examined | ${examined.length} |`,
        `| Unresolvable edges | ${bad.length} |`,
        `| Undecidable edges | ${undecidableEdges.length} |`,
        // The row that cannot be misread. Everything above it is a number, and a
        // number needs a reader who knows which ones are supposed to be zero.
        `| Verdict | ${verdict} |`,
        '',
    );
    if (bad.length > 0) {
        lines.push('### Unresolvable pinned dependencies', '');
        for (const e of bad) {
            lines.push(
                preRelease
                    ? `- \`${e.from}\` → \`${e.block}.${e.to}\` (the NAME does not exist on npm)`
                    : `- \`${e.from}@${version}\` → \`${e.block}.${e.to}@${version}\` (missing)`,
            );
        }
        lines.push(
            '',
            preRelease
                ? 'Bootstrap the target before the bridge (`docs/publishing.md` § New `@gjsify/*` package), or declare it in `status/pending-npm-bootstrap.json`.'
                : 'A re-run of `release.yml` is the recovery path: `gjsify publish --tolerate-republish` no-ops for what already landed.',
            '',
        );
    }
    if (undecidableEdges.length > 0) {
        // Named here too, not only on stdout: the reason is per-edge, and the
        // aggregate caution above cannot carry which target is at fault.
        lines.push('### Undecidable dependency edges', '');
        for (const e of undecidableEdges) {
            lines.push(`- \`${e.from}@${version}\` → \`${e.block}.${e.to}\` = \`${e.spec}\` — ${e.why}.`);
        }
        lines.push('');
    }
    // A REPORTING side-channel must never decide the verdict. An unwritable summary
    // threw from here — after the closure was computed, before `process.exit` — so a
    // run that had verified every edge exited 1 for a reason unrelated to npm: the
    // report fabricating a finding. Under the ci-fedora container
    // `GITHUB_STEP_SUMMARY` belongs to the runner user and `EACCES`'d, taking four
    // green fixtures red. The verdict is `problems`; this file is a courtesy.
    try {
        appendFileSync(summaryPath, `${lines.join('\n')}\n`);
    } catch (err) {
        console.error(
            `WARNING: could not write the GitHub step summary at ${summaryPath} — ${err instanceof Error ? err.message : String(err)}. ` +
                'The verdict below is unaffected; only the rendered summary is missing.',
        );
    }
}

process.exit(problems.length === 0 ? 0 : 1);
