#!/usr/bin/env node
/**
 * CI entry: after a release, every PUBLISHED package's pinned intra-repo
 * dependencies must actually RESOLVE on the registry.
 *
 * WHY THIS EXISTS — a partial release can be WORSE than no release
 *
 * The `npm:publish` sweep is fail-fast: one `gjsify publish` failure aborts the
 * remaining packages (`foreach`'s sequential loop rethrows, and its topological
 * driver's `failFast` kills the in-flight set). Pack time rewrites every
 * `workspace:*` to the EXACT version, and npm SILENTLY SKIPS an
 * `optionalDependency` that does not resolve — a platform mismatch on an
 * optional dep is not an error, and neither is a version that was never
 * published. Put those three facts together and an abort in the wrong place
 * leaves `@gjsify/<bridge>@<v>` live on npm pinning
 * `@gjsify/<bridge>-darwin-x64@<v>` that does not exist: the install succeeds,
 * the binary is absent, and the consumer gets the new JS bridge with no typelib
 * and no dylib. That is strictly worse than the previous version's error state,
 * and nothing re-checked it — the root `npm:publish` script ended at the
 * foreach, and `verify-package-outputs.mjs` runs `--scope examples`.
 *
 * Measured at 0.27.0 from the registry: `@gjsify/webgl` was published at
 * 19:38:22.572Z, BEFORE `@gjsify/webgl-darwin-arm64` (19:38:26.291Z) and
 * `-darwin-x64` (19:38:29.551Z) — parent before its platform children, i.e. the
 * window was open on every one of the eleven split bridges. All seven siblings
 * happened to land, so 0.27.1 is intact; the hazard was unguarded, not live.
 *
 * TWO HALVES, AND ONLY ONE OF THEM IS THIS SCRIPT
 *
 *   PREVENTION lives in the sweep's ORDER: `npm:publish` runs `gjsify foreach
 *   --topological`, whose graph already counts `optionalDependencies`, so every
 *   platform child precedes its bridge and ANY prefix of the sweep is a
 *   resolvable tree. `publish-napi` has done this by hand since ADR 0017.
 *   DETECTION is this script. Detection without prevention only shortens the
 *   window — npm has no transaction to roll back — so the two ship together.
 *
 * THE POSITIVE-FACT RULE
 *
 * A check that verified nothing must not report success. So this script asserts
 * COUNTS, not merely the absence of findings:
 *   1. at least one candidate package is LIVE at the release version — otherwise
 *      the release published nothing and there was no closure to check;
 *   2. the tree DECLARES at least one release-pinned intra-repo edge. This is a
 *      property of the manifests, not of the registry, and it is the assertion
 *      that outlives a refactor: if the enumeration below ever stops seeing the
 *      platform-sibling edges, every future release would otherwise pass on an
 *      empty set — the exact class of bug this guard exists for;
 *   3. on a COMPLETE release (nothing absent) at least one edge was actually
 *      examined. Implied by 1+2, and asserted anyway so that a change to either
 *      derivation cannot quietly produce an empty examination;
 *   4. every examined edge resolves.
 * An edge this script cannot DECIDE is a FAILURE, never a silent skip: an
 * undecided edge is coverage lost without a signal.
 *
 * THE ONE LEGITIMATE DROP
 *
 * The enumeration walks every `dependencies` / `optionalDependencies` entry of
 * every candidate and drops EXACTLY ONE shape: a target that is not a package of
 * this repository at all. That one is genuinely out of scope — an external
 * dependency is the registry's problem, not this release's. Every target that IS
 * in this repository gets classified, and anything undecidable FAILS with the
 * target named. It used to also drop a target that was not itself a candidate,
 * which quietly swallowed two reachable defects — both measured on fixtures,
 * both exiting 0 with "Every one of 1 … edge(s) … resolves":
 *   - version SKEW behind a literal pin: a parent published at `<v>` declaring
 *     `"@gjsify/napi-darwin-arm64": "<v>"` while that child's manifest was left
 *     at `<v-1>`, so nothing publishes it at `<v>`;
 *   - a published package pinning a `private` workspace sibling —
 *     `resolveWorkspaceProtocol` rewrites `workspace:^` to the target's version
 *     whether or not the target is publishable, so the pin is dead on arrival.
 * Both are decided from the MANIFESTS alone, with no registry involved, so they
 * fail identically on a complete release, a partial one, and a dry tree.
 *
 * EVERY NOTEWORTHY STATE MUST REACH THE ARTIFACT A HUMAN READS
 *
 * The step summary is what a human actually opens after a release; stdout is
 * what nobody reads until they already suspect something. So anything this
 * script considers worth saying — `problems` AND the not-fatal `notes` — is
 * rendered there as a GitHub alert, and the table carries an explicit `Verdict`
 * row. Measured on this very script before the fix: the "nothing was examined"
 * sentence went to stdout only, so the most likely partial release rendered as
 * `Pinned edges examined | 0` with no caution under a green check — a missing
 * signal reading as a pass, inside the guard built to remove that class. The
 * notes are ALSO emitted as `::warning::` annotations, which survive a summary
 * file that cannot be written.
 *
 * WHAT IT DELIBERATELY DOES NOT FAIL ON: an INCOMPLETE release in which no
 * published package has a pinned dependency. That is the promise prevention
 * makes — any prefix of a dependency-ordered sweep is a resolvable tree — and it
 * can only co-occur with an already-red publish job. Failing there would put a
 * second, misleading red ("the enumeration broke") on top of the real cause and
 * teach everyone to ignore this job. The log says outright that no edge was
 * examined, so it can never READ as "closure verified".
 *
 * WHAT "RESOLVES" MEANS HERE. The release version is by construction the
 * MAXIMUM version of this train, so each of `<v>`, `=<v>`, `^<v>` and `~<v>`
 * admits exactly one existing version: `<v>` itself. Presence of `<v>` on the
 * registry is therefore a complete answer for every pinned shape, with no
 * semver range engine involved. An intra-repo spec pinned to an OLDER range is
 * out of scope by definition (an already-published version satisfies it) — and
 * there are none, which is why an unrecognised shape fails loudly instead of
 * being bucketed.
 *
 * SCOPE. Manifest-declared edges only. `@gjsify/gtk-runtime-*` is resolved by
 * NAME at install time rather than through an `optionalDependencies` entry, so
 * no manifest edge exists to check and its own publish jobs are the guard.
 *
 * WHY A PLAIN NODE SCRIPT. It runs on a bare checkout — no `gjsify install`, no
 * build — so it cannot be staled by the committed CLI bundle (the circularity
 * `verify-committed-bundles.mjs` exists to break) and it still works when the
 * release that would have installed the tree is exactly what failed. The
 * package set comes from `createContext`, the same oracle every conformance
 * rule reads, so this check and `audit-runtimes --check` cannot disagree about
 * which packages exist. The default registry URL is the one duplicated fact:
 * `@gjsify/npm-registry`'s `DEFAULT_REGISTRY` lives behind a built `lib/`, and
 * `--registry` is the override.
 *
 * Usage:
 *   node scripts/verify-published-closure.mjs
 *   node scripts/verify-published-closure.mjs --version 0.27.1
 *   node scripts/verify-published-closure.mjs --registry http://127.0.0.1:5555
 *   node scripts/verify-published-closure.mjs --root <dir>   # a fixture tree
 *   node scripts/verify-published-closure.mjs --json
 */

import { appendFileSync, readFileSync } from 'node:fs';
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
 * A state that does not fail the job but must not be quiet either. An
 * annotation is the one report channel that cannot be lost: it needs no
 * writable file, and it renders next to the job's green check instead of behind
 * it.
 */
const warn = (msg) => {
    console.log(inActions ? `::warning title=Release closure::${msg}` : `WARNING: ${msg}`);
};

const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = String(flag('--version', rootManifest.version ?? ''));
if (!version) {
    fail(`no release version — ${join(repoRoot, 'package.json')} has no "version" and --version was not passed.`);
    process.exit(1);
}

// `discoveryRoots: ['packages']` for the same reason `audit-runtimes.mjs` uses
// it: `packages/napi/*` and `packages/node-gi/*` are deliberately NOT workspace
// members, yet they are published by their own release jobs — and `@gjsify/napi`
// carries the only intra-repo edges spelled as a LITERAL version rather than
// `workspace:*`. Narrowing to the `workspaces` globs would drop exactly the
// packages whose pinning shape is most brittle.
const ctx = createContext({ root: repoRoot, discoveryRoots: ['packages'] });

/** Every package this release could have published: non-private, on the train. */
const candidates = ctx.allPackages.filter(
    (p) => !p.private && typeof p.manifest.name === 'string' && p.manifest.version === version,
);
/**
 * Every package IN THIS REPOSITORY, by name — `private` ones and any left off
 * the release train INCLUDED. Deliberately wider than the candidate set: the
 * enumeration has to be able to SEE an edge into one of those in order to fail
 * on it. Narrowing this map to candidates is precisely the bug that let a dead
 * pin pass (see THE ONE LEGITIMATE DROP in the header).
 */
const repoByName = new Map(
    ctx.allPackages.filter((p) => typeof p.manifest.name === 'string').map((p) => [p.manifest.name, p]),
);

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
 * Decide one intra-repo edge. Two outcomes, and only one of them is a skip:
 *
 * `release`     — packs as a pin satisfiable ONLY by `version`, and the target is
 *                 a package this release publishes at `version`. Exact presence
 *                 on the registry is then a complete answer.
 * `undecidable` — anything else, WITH the reason. Never silently dropped: the
 *                 caller turns each one into a failure naming the target,
 *                 because an edge nobody could decide is coverage lost with no
 *                 signal — and two of the three reasons below are outright
 *                 defects that no probe would ever have reported.
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
            // THE ONLY LEGITIMATE DROP: the target is not a package of this
            // repository, so this release neither publishes it nor pins it to a
            // version of its own — it is the registry's problem. Every in-repo
            // target is decided below, and an undecidable one FAILS.
            if (!target) continue;
            edges.push({ from: pkg.manifest.name, block, to, spec, ...decide(spec, target) });
        }
    }
}

const undecidableEdges = edges.filter((e) => e.kind === 'undecidable');
const pinnedEdges = edges.filter((e) => e.kind === 'release');

// ── registry probe ───────────────────────────────────────────────────────────

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
        return Boolean(doc?.versions && Object.hasOwn(doc.versions, version));
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
 * CONFIRMED absent — a 404, not merely "we did not get a `true`". The three
 * states are distinct on purpose: an errored probe (5xx, timeout, DNS) means we
 * do not KNOW, and treating it as absent would turn one transient registry hiccup
 * into a fabricated "this platform package was never published" verdict on a
 * release that is in fact intact. Unknown belongs to `probeErrors()`, which fails
 * the job for what it is: no evidence.
 */
const isAbsent = (name) => state.get(name) === false;
const probeErrors = () => candidates.filter((p) => state.get(p.manifest.name) instanceof Error);
/** A pinned edge is violated when its parent IS live and its target is CONFIRMED absent. */
const violations = () => pinnedEdges.filter((e) => isLive(e.from) && isAbsent(e.to));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await probeAll(candidates.map((p) => p.manifest.name));
for (let round = 2; round <= attempts; round++) {
    const liveCount = candidates.filter((p) => isLive(p.manifest.name)).length;
    if (violations().length === 0 && probeErrors().length === 0 && liveCount > 0) break;
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
/**
 * EXAMINED means resolved to a definite answer, not merely "looked at": the
 * parent is confirmed live AND the target's probe came back live or 404. An edge
 * whose target ERRORED was inspected and decided nothing, and counting it would
 * overstate the very number the empty-result assertion is built on. It cannot
 * currently produce a false green (an errored probe already fails the job), but a
 * count that reports more than it verified is the shape this whole guard exists
 * to remove — so it is defined honestly rather than defended by a side condition.
 */
const examined = pinnedEdges.filter((e) => isLive(e.from) && (isLive(e.to) || isAbsent(e.to)));
const byBlock = (list, block) => list.filter((e) => e.block === block).length;

// ── report ───────────────────────────────────────────────────────────────────

const problems = [];
if (errored.length > 0) {
    problems.push(
        `${errored.length} registry probe(s) never produced an answer after ${attempts} round(s). A probe that could ` +
            'not be completed is not evidence of anything; re-run the job.',
    );
}
// The liveness-derived conclusions below are only sound when EVERY probe was
// answered. With an unanswered probe in the set, "nothing is live" and "the
// release is complete" are both unknowable, and stating either would replace a
// missing signal with a wrong one — the very substitution this file exists to
// prevent. The probe-error problem above already fails the job.
if (errored.length === 0 && live.length === 0) {
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
    // Without this guard the message below fires on `pinnedEdges === 0` and
    // states "the tree declares 0 release-pinned edge(s) … those three facts
    // cannot all be true", which is self-contradicting: zero declared edges
    // being zero examined is the ONE way all three CAN be true. The real
    // finding there is the assertion above, and sending the next reader after a
    // non-existent examination-filter bug wastes exactly the attention this
    // guard is asking for.
    pinnedEdges.length > 0 &&
    examined.length === 0
) {
    // Implied by the two assertions above (pinned edges exist AND every package
    // is live ⇒ some pinned parent is live). Asserted explicitly so a future
    // change to either derivation cannot silently yield an empty examination.
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
        `${bad.length} pinned dependency/dependencies of PUBLISHED package(s) do not resolve at ${version}. npm ` +
            'skips an unresolvable optionalDependency in SILENCE, so consumers install the new bridge with no ' +
            'binary behind it. Re-run the release workflow: `gjsify publish --tolerate-republish` makes a re-run a ' +
            'no-op for what already landed and publishes the rest.',
    );
}

/**
 * NOT failures — and therefore the most dangerous thing this script produces,
 * because nothing downstream forces them to be seen. Every entry here is
 * rendered into the step summary as an alert AND emitted as an Actions
 * annotation, so a state worth naming cannot end up visible only to whoever
 * scrolls the log of a green job. This list is deliberately not `console.log`
 * calls: a value can be routed to every channel, a print statement cannot.
 */
const notes = [];
if (problems.length === 0 && examined.length === 0) {
    // Never phrase this as a verified closure. NOTHING was examined; the tree
    // that is published simply contains no pinned dependency, which is exactly
    // what an aborted-but-dependency-ordered sweep looks like — and with
    // ordering plus fail-fast, that is the TYPICAL abort, so this is the state a
    // human is most likely to be reading about in the release UI.
    notes.push(
        `NO edge was examined: none of the ${pinnedEdges.length} release-pinned edge(s) this tree declares has a ` +
            `published parent (${notLive.length} package(s) absent at ${version}). Nothing on npm points at ` +
            'anything missing, so the closure is intact — but this run verified no edge, and an unverified closure ' +
            'is not a verified one. The publish job that stopped short is the finding: re-run the release ' +
            '(`gjsify publish --tolerate-republish` no-ops for what already landed).',
    );
}

/** One sentence a human can read off the summary table without decoding counts. */
const verdict =
    problems.length > 0
        ? `**FAILED** — ${problems.length} problem(s); see the caution(s) above`
        : examined.length === 0
          ? '**NOTHING VERIFIED** — no edge was examined; see the warning above'
          : `**OK** — all ${examined.length} examined edge(s) resolve`;

if (asJson) {
    console.log(
        JSON.stringify(
            {
                version,
                registry,
                candidates: candidates.length,
                live: live.length,
                notLive,
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
        // closure — a missing package with a live dependent is a violation
        // below; one with no live dependent broke nothing.
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
    const lines = ['## Published dependency closure', ''];
    // ALERTS FIRST, above the table. A count is not a finding: `Pinned edges
    // examined | 0` with nothing beside it reads as a pass, and that is the
    // rendering the most likely partial release produces. GitHub's alert syntax
    // is the loudest thing available in a step summary — CAUTION for what failed
    // the job, WARNING for what it declined to fail but must still be read.
    for (const p of problems) lines.push('> [!CAUTION]', `> ${p}`, '');
    for (const n of notes) lines.push('> [!WARNING]', `> ${n}`, '');
    lines.push(
        '| Fact | Value |',
        '|---|---|',
        `| Registry | \`${registry}\` |`,
        `| Version | \`${version}\` |`,
        `| Candidate packages | ${candidates.length} |`,
        `| Live at this version | ${live.length} |`,
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
        for (const e of bad) lines.push(`- \`${e.from}@${version}\` → \`${e.block}.${e.to}@${version}\` (missing)`);
        lines.push(
            '',
            'A re-run of `release.yml` is the recovery path: `gjsify publish --tolerate-republish` no-ops for what already landed.',
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
    // A REPORTING side-channel must never be able to decide the verdict. An
    // unwritable summary file threw out of here, and because the throw happens
    // AFTER the closure has been computed but BEFORE `process.exit`, a run that
    // had verified every edge exited 1 for a reason that has nothing to do with
    // npm — the report fabricating a finding. Measured, not hypothetical: under
    // the ci-fedora container the job's `GITHUB_STEP_SUMMARY` belongs to the
    // runner user and `EACCES`'d, and four green fixtures went red on it.
    // The verdict is `problems`; this file is a courtesy. So warn and carry on.
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
