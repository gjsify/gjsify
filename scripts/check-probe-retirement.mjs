#!/usr/bin/env node
// A probe's retirement condition is EVALUATED, not re-read by a person.
//
// THE DEFECT. `check-probe-outcomes-read.mjs` (#1552) made every `continue-on-error`
// probe's result visible. It deliberately does not ask whether the probe should still BE
// one — each carries a written retirement condition in prose above the step, and prose is
// a TODO with extra steps: it only fires if somebody re-reads the row.
//
// MEASURED, 2026-09-19, over the 71 push-to-`main` runs from 2026-09-10. Nobody had. Two of
// the four conditions in `gtk-os-suites.yml` had been satisfied for over a week:
//
//   · `conformance-win32` retired on a published `gtk-runtime-win32-x64` carrying
//     `gstvorbis.dll`. That shipped in 0.49.0 on 2026-09-11 — and the probe was then GREEN
//     in all 48 measured runs after it, while still declared advisory.
//   · the darwin `rn-probe` retired on the first published node-gi carrying #1438's engine
//     fix. That shipped in 0.46.0 on 2026-09-03 — and the probe was RED in 70 of those 71
//     runs, green in none. The condition was a PROXY for "this can gate now", and the proxy
//     was wrong for the THIRD time on that one step (`#1438 closes` before, an issue number
//     before that).
//
// THE FIRST VERSION OF THIS CHECK GOT THAT SECOND READING RIGHT BY LUCK AND THE FIRST ONE
// WRONG. It joined an annotation to a step on the step's `name`, while the annotation
// carries `PROBE_LABEL` — a separate string nothing coupled to the name, and for
// `conformance-win32` a different sentence entirely. So its reds were invisible and
// `probe-green 185` came back MET across a window holding five of them: a check built to
// stop a false promotion, recommending one. `check-probe-outcomes-read.mjs` now holds
// `PROBE_LABEL` to the step `name`, and `probeGreen` refuses rather than guessing when the
// two disagree. A measurement joined on a proxy is still a proxy.
//
// So both outcomes need a mouth, and both are this check's failure — the point is not that
// a probe went green, it is that A ROW NEEDS RE-READING and no human will notice:
//
//   RIPE + green → promote it: delete `continue-on-error` and make it a gate.
//   RIPE + red   → the stated condition is a proxy and it is WRONG. Correct it to name what
//                  actually blocks the step, or fix what the probe found.
//
// WHY THE CONDITIONS LIVE IN THE STEP'S COMMENT. Next to the probe is the only place that
// cannot drift away from it: a registry file elsewhere is a second thing to keep in sync,
// and a deleted step would leave its row behind. The clause lines are machine-readable
// DATA; the prose around them stays, because the prose carries the incident and a rule
// stripped of its incident gets simplified back into the bug.
//
// Usage:
//   node scripts/check-probe-retirement.mjs [--root <dir>] [--online]
//
//   Offline (the default) evaluates the tree-local clauses and reports the rest as
//   UNKNOWN. `--online` additionally reads the npm registry, the issue tracker and the
//   probe's own recorded outcomes — which is required for the check to do its job at all,
//   since both conditions above are facts about published artifacts that no checkout holds.
//
// WHAT THIS DOES NOT CATCH, stated because a gate's blind spots belong next to its claims:
//
//   · SCOPE IS A PROSE MATCH. A probe is in scope when its step name or its comment says it
//     is blocked (`DECLARES_A_CONDITION`). A genuinely blocked probe whose comment avoids
//     those words is filed as carrying no condition and is never asked for a clause. The
//     honest alternative — every `continue-on-error` step must carry clauses or an explicit
//     `advisory-by-design:` — is a change to ~15 steps across 6 workflows and a judgement
//     about each; the opt-out marker exists so that change is a one-line edit per step when
//     somebody makes it. Until then this is a real hole and not a silent one.
//   · A CLAUSE IS ONLY READ WHERE A CONDITION IS WRITTEN. The comment run starts at the
//     step's dash and stops at a blank line, so a clause below a blank line or inside the
//     step block belongs to no probe — `unattachedClauses` refuses those rather than
//     dropping them, but the placement rule itself is a convention.
//   · A CLAUSE CAN NAME SOMETHING THAT DOES NOT EXIST. A 404 packument, an absent dist-tag
//     and a label that cannot be joined are REFUSALS (`ClauseError`), not unknowns, for the
//     reason a clause that never resolves is worse than one that fails. What stays unknown
//     is weather: a timeout, a 5xx, an unauthenticated `gh`.
//
// Exit 0 when nothing is ripe, 1 on a ripe probe or a malformed clause, 2 on a usage error.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { envValueOf, listProbes, stepBlockContaining } from './workflow-probes.mjs';

/**
 * The clause line, as it is written in the comment above a step.
 *
 * Indented inside the comment — `#   retire-when: …` — because these blocks are prose with
 * the data set off from it, so the leading run is part of the spelling rather than an
 * accident to be tolerated.
 */
const CLAUSE = /^\s*retire-when:\s*(.+?)\s*$/;

/** The deliberate opt-out: a probe that is advisory on purpose, with the reason printed. */
const ADVISORY = /^\s*advisory-by-design:\s*(.+?)\s*$/;

/** Any `key:` at the head of a comment line — the candidate set the near-miss check reads. */
const ANY_KEY = /^\s*([A-Za-z][A-Za-z -]{0,24}?)\s*:\s*\S/;

/** Levenshtein distance, bounded by the two short strings this is ever asked about. */
function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return d[a.length][b.length];
}

/**
 * Is this comment line TRYING to be a clause and failing?
 *
 * A typo'd VERB already errors; a typo'd KEY used to be discarded in silence, because a
 * line that does not match `CLAUSE` is simply prose. Measured: a probe carrying one good
 * clause beside `retire-whn:`, `retire-when :`, `Retire-When:` and `retirewhen:` printed
 * "1 of 1 clause(s) met" and reported the probe RIPE — four conditions dropped, with the
 * verdict computed from the one that survived. That is the same silently-measured-nothing
 * shape this whole check exists to end, one level in.
 */
function looksLikeAClauseKey(text) {
    const match = ANY_KEY.exec(text);
    if (!match) return false;
    const normalised = match[1].toLowerCase().replace(/[^a-z]/g, '');
    return normalised === 'retirewhen' || distance(normalised, 'retirewhen') <= 2;
}

/**
 * A probe this check is ABOUT.
 *
 * Not every `continue-on-error` step has a retirement condition: `cli-cross-platform.yml`'s
 * ten-step diagnostic sweep is advisory BY DESIGN — its header says so — and inventing a
 * condition for it would be prose of this check's own making. The scope is therefore the
 * steps that already declare themselves blocked, in the step NAME or in the comment above
 * it, and every one of those must carry clauses.
 *
 * This is also the net that catches the NEXT one: a probe added with a prose condition and
 * no clause fails here, which is the input that makes this check bite on a tree that is
 * otherwise conformant.
 */
const DECLARES_A_CONDITION =
    /gating blocked|retirement condition|retires? (?:when|on|itself)|delete `?continue-on-error/i;

/** Clause verbs, and what makes each one TRUE — i.e. the probe may retire. */
const VERBS = {
    /** `npm-tarball-has <pkg> <dist-tag> <path>` — the published tarball carries that entry. */
    'npm-tarball-has': { arity: 3, online: true, run: (a, io) => io.tarballHas(a[0], a[1], a[2]) },
    /** `npm-version-min <pkg> <dist-tag> <version>` — what is published is at least that. */
    'npm-version-min': { arity: 3, online: true, run: (a, io) => io.versionAtLeast(a[0], a[1], a[2]) },
    /** `issue-closed <number>` — the tracker says so. */
    'issue-closed': { arity: 1, online: true, run: (a, io) => io.issueClosed(a[0]) },
    /** `tree-lacks <path> <regex>` — this checkout no longer contains the thing. */
    'tree-lacks': { arity: 2, online: false, run: (a, io) => !io.treeMatches(a[0], a[1]) },
    /** `tree-has <path> <regex>` — this checkout now contains it. */
    'tree-has': { arity: 2, online: false, run: (a, io) => io.treeMatches(a[0], a[1]) },
    /**
     * `probe-green <n>` — the last n recorded outcomes of THIS step on `main` all passed.
     *
     * The only condition that cannot be a wrong proxy, because it is the thing every proxy
     * was standing in for. It reads what `report-probe-outcome.mjs` already writes: a
     * failing probe emits a `::warning title=Probe failed (not gating)::` annotation, which
     * survives on the check run long after the log is a wall of text nobody opens. The
     * step's own CONCLUSION cannot be used — GitHub forces it to `success`, which is the
     * whole reason that reporter exists.
     */
    'probe-green': { arity: 1, online: true, run: (a, io, probe) => io.probeGreen(probe, Number(a[0])) },
};

/** `{ name, tag }` for an npm spec, so `@scope/pkg` keeps its slash out of the URL path. */
function packumentUrl(pkg, cacheBuster) {
    // The cache defeat is a QUERY PARAMETER and the header it replaced did nothing:
    // `cache-control: no-cache`, `pragma: no-cache`, `max-age=0` and `no-store` all answer
    // `cf-cache-status: HIT` against registry.npmjs.org, up to the packument's own 300 s
    // edge TTL (docs/publishing.md). A check reading a 5-minute-stale document would report
    // a condition unmet for the whole window after the release that met it.
    return `https://registry.npmjs.org/${pkg.replace('/', '%2f')}?__gjsify_probe_retirement=${cacheBuster}`;
}

/** Numeric semver compare, prerelease-insensitive — these are all release versions. */
function atLeast(version, minimum) {
    const parse = (v) =>
        String(v)
            .split('-')[0]
            .split('.')
            .map((n) => Number.parseInt(n, 10) || 0);
    const [a, b] = [parse(version), parse(minimum)];
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return true;
}

/**
 * The real world, behind one seam.
 *
 * Every online answer is a THREE-valued one: true, false, or a thrown `Unknown`. A registry
 * that times out must not read as "the condition is unmet" — that is how a ripe probe would
 * stay invisible for as long as the outage lasts, which is the failure this check exists to
 * end, wearing a different hat. It must equally not read as "ripe", which would red an
 * unrelated PR over somebody else's downtime. So it reads as UNKNOWN, is printed, and is
 * counted — and `main()` refuses a run in which EVERY online clause came back unknown,
 * because a check that evaluated nothing and exited 0 is the shape this repository has paid
 * for more than any other.
 */
class Unknown extends Error {}

/**
 * The clause itself is wrong — a package that does not exist, a label that cannot be
 * joined, a count that is not a count. Distinct from `Unknown` because the remedies are
 * opposite: an outage is waited out, and a malformed clause never resolves on its own.
 * Measured: `npm-version-min @gjsify/does-not-exist-xyzzy latest 1.0.0` sat UNKNOWN on
 * every run, so the probe could never be ripe and nothing ever said why.
 */
class ClauseError extends Error {}

function createIo(root, { online }) {
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const packuments = new Map();
    const stats = { evaluated: 0, unknown: 0, onlineClauses: 0, onlineEvaluated: 0 };

    // The STATUS is read rather than left to `-f`, because 404 and "the registry is down"
    // are different answers: the first is a fact about the clause and must be fixed, the
    // second is weather and must be waited out. `-f` collapses both into exit 22.
    const curl = (url) => {
        let out;
        try {
            out = execFileSync('curl', ['-sSL', '--max-time', '60', '-w', '\n%{http_code}', url], {
                encoding: 'utf8',
                maxBuffer: 1 << 28,
            });
        } catch (error) {
            throw new Unknown(`could not reach ${url.split('?')[0]}: ${error.message.split('\n')[0]}`);
        }
        const cut = out.lastIndexOf('\n');
        const status = Number(out.slice(cut + 1).trim());
        const body = out.slice(0, cut);
        if (status === 404) throw new ClauseError(`${url.split('?')[0]} does not exist (404)`);
        if (status < 200 || status >= 300) throw new Unknown(`${url.split('?')[0]} answered ${status}`);
        return body;
    };

    const packument = (pkg) => {
        if (!packuments.has(pkg)) {
            let parsed;
            try {
                parsed = JSON.parse(curl(packumentUrl(pkg, nonce)));
            } catch (error) {
                // A ClauseError must survive this: a 404 is the answer, and re-wrapping it
                // as an outage is how a clause naming a package that does not exist sat
                // UNKNOWN forever while the probe could never be ripe.
                if (error instanceof Unknown || error instanceof ClauseError) throw error;
                throw new Unknown(`${pkg}: the registry answered something that is not a packument`);
            }
            packuments.set(pkg, parsed);
        }
        return packuments.get(pkg);
    };

    const publishedVersion = (pkg, tag) => {
        const version = packument(pkg)['dist-tags']?.[tag];
        // A MISSING dist-tag is a fact, not an outage: the clause names a tag that does not
        // exist, and answering "unmet" would hide a typo forever.
        if (typeof version !== 'string') throw new ClauseError(`${pkg}: no dist-tag \`${tag}\``);
        return version;
    };

    return {
        stats,
        online,

        treeMatches(rel, pattern) {
            const path = join(root, rel);
            // An absent file is not a match. Said out loud rather than silently: a
            // `tree-lacks` clause over a path that was RENAMED would then go true and
            // report the probe ripe, so the caller is told which file it did not find.
            if (!existsSync(path)) {
                console.log(`  note: ${rel} does not exist, so nothing in it matches /${pattern}/`);
                return false;
            }
            return new RegExp(pattern).test(readFileSync(path, 'utf8'));
        },

        versionAtLeast(pkg, tag, minimum) {
            const version = publishedVersion(pkg, tag);
            return atLeast(version, minimum);
        },

        tarballHas(pkg, tag, entry) {
            const version = publishedVersion(pkg, tag);
            const url = packument(pkg).versions?.[version]?.dist?.tarball;
            if (typeof url !== 'string') throw new ClauseError(`${pkg}@${version}: the packument names no tarball`);
            const listing = (() => {
                try {
                    // `tar -tz` from a pipe, so a 50 MB GTK bundle never lands on disk.
                    return execFileSync('sh', ['-c', `curl -sSfL --max-time 300 '${url}?__probe=${nonce}' | tar -tz`], {
                        encoding: 'utf8',
                        maxBuffer: 1 << 28,
                    });
                } catch (error) {
                    throw new Unknown(`${pkg}@${version}: could not list the tarball: ${error.message.split('\n')[0]}`);
                }
            })();
            // npm tarballs root everything at `package/`; the clause names the path a
            // consumer sees, so it is matched as a suffix rather than anchored.
            return listing.split('\n').some((line) =>
                line
                    .trim()
                    .replace(/^package\//, '')
                    .endsWith(entry),
            );
        },

        issueClosed(number) {
            const out = (() => {
                try {
                    return execFileSync('gh', ['issue', 'view', String(number), '--json', 'state', '--jq', '.state'], {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                } catch (error) {
                    throw new Unknown(`issue #${number}: ${error.message.split('\n')[0]}`);
                }
            })();
            return out.trim() === 'CLOSED';
        },

        probeGreen(probe, runs) {
            if (!Number.isInteger(runs) || runs < 1) throw new ClauseError('probe-green needs a positive count');
            if (probe.id === undefined)
                throw new ClauseError('the step has no `id`, so its outcome is not addressable');

            // THE JOIN, and getting it wrong is what this fix is about. The annotation
            // carries `PROBE_LABEL`; the API calls the step by its `name`. Nothing coupled
            // the two until `check-probe-outcomes-read.mjs` began asserting they are equal,
            // so this REFUSES rather than guessing when they are not: a probe whose reds
            // cannot be recognised reads as green, which is a false PROMOTE on a step that
            // has never passed. Measured on `conformance-win32`, whose label was a
            // different sentence — `probe-green 185` came back MET across a window holding
            // five annotated reds.
            const reader = stepBlockContaining(probe.lines, `steps.${probe.id}.outcome`);
            const label = reader === null ? undefined : envValueOf(reader, 'PROBE_LABEL');
            if (label === undefined) {
                throw new ClauseError(
                    `\`steps.${probe.id}.outcome\` is read by a step that passes no \`PROBE_LABEL\`, so no ` +
                        'annotation names this probe and `probe-green` has nothing to read.',
                );
            }
            if (label !== probe.label) {
                throw new ClauseError(
                    "`PROBE_LABEL` is not this step's `name`, so an annotation cannot be joined back to the " +
                        'step. `check-probe-outcomes-read.mjs` refuses this too.',
                );
            }
            if (probe.job === null) throw new ClauseError('could not tell which job owns this step');

            const workflow = probe.rel.split('/').pop();
            const gh = (args) => {
                try {
                    return execFileSync('gh', args, {
                        encoding: 'utf8',
                        maxBuffer: 1 << 28,
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                } catch (error) {
                    throw new Unknown(`${workflow}: ${error.message.split('\n')[0]}`);
                }
            };

            // A matrix job's API name is its declared name with the expressions filled in,
            // so the declaration becomes a pattern. SCOPING MATTERS: one step name appears
            // in two jobs of `gtk-os-suites.yml` and the other one GATES — unscoped, that
            // gating step's green legs counted as this probe's, three legs per run.
            const pattern = probe.job.name
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\$\\\{\\\{.*?\\\}\\\}/g, '.+');
            const jobPattern = new RegExp(`^${pattern}$`);

            const list = JSON.parse(
                gh([
                    'run',
                    'list',
                    '--workflow',
                    workflow,
                    '--branch',
                    'main',
                    '--event',
                    'push',
                    '--limit',
                    String(runs * 6),
                    '--json',
                    'databaseId,conclusion,createdAt',
                ]),
            ).filter((run) => run.conclusion && run.conclusion !== 'cancelled');
            if (list.length === 0) throw new Unknown(`${workflow}: no completed \`main\` runs to read`);

            // A RUN is the unit, not a leg: the question is "did this probe pass", and on a
            // matrix job that is only true when every leg which measured anything passed.
            let measured = 0;
            const reds = [];
            for (const run of list) {
                if (measured >= runs) break;
                const jobs = JSON.parse(
                    gh(['api', `/repos/{owner}/{repo}/actions/runs/${run.databaseId}/jobs?per_page=100`]),
                ).jobs.filter((job) => jobPattern.test(job.name));
                let legs = 0;
                let red = false;
                for (const job of jobs) {
                    const step = job.steps?.find((candidate) => candidate.name === probe.label);
                    // Absent, skipped or cancelled: this leg measured NOTHING. Counting a
                    // skip as a pass is how "0 green" would have read as "2 green".
                    if (!step || step.conclusion !== 'success') continue;
                    legs += 1;
                    const annotations = JSON.parse(
                        gh([
                            'api',
                            `/repos/{owner}/{repo}/check-runs/${job.id}/annotations?per_page=100`,
                            '--paginate',
                            '--slurp',
                        ]),
                    ).flat();
                    // ANCHORED rather than `includes`: the reporter's message is exactly
                    // `<label> exited non-zero; …`, so a label that is a substring of
                    // another probe's cannot answer for it.
                    const failed = annotations.some(
                        (a) =>
                            a.annotation_level === 'warning' &&
                            /Probe failed/.test(a.title ?? '') &&
                            String(a.message).startsWith(`${label} exited non-zero`),
                    );
                    if (failed) red = true;
                }
                if (legs === 0) continue; // the run never reached this step
                measured += 1;
                if (red) reds.push(run.createdAt?.slice(0, 10) ?? String(run.databaseId));
            }

            if (measured < runs) {
                throw new Unknown(
                    `${workflow}: only ${measured} run(s) recorded an outcome for "${probe.label}", wanted ${runs}`,
                );
            }
            if (reds.length > 0) {
                console.log(`    note: RED in ${reds.length} of the last ${measured} measured run(s)`);
                return false;
            }
            return true;
        },
    };
}

/** Parse a probe's clause lines. Returns `{ clauses, errors, advisory }`. */
export function parseClauses(probe) {
    const clauses = [];
    const errors = [];
    let advisory;
    for (const { text, line } of probe.comment) {
        const optOut = ADVISORY.exec(text);
        if (optOut) {
            advisory = { reason: optOut[1], line };
            continue;
        }
        const match = CLAUSE.exec(text);
        if (!match) {
            if (looksLikeAClauseKey(text)) {
                errors.push(
                    `${probe.rel}:${line}: \`${text.trim()}\` is nearly a clause and is therefore not one. ` +
                        'The key is spelled exactly `retire-when:` — a near miss is DISCARDED, and a discarded ' +
                        'clause is a condition that silently stops being part of the conjunction.',
                );
            }
            continue;
        }
        const [verb, ...args] = match[1].split(/\s+/);
        const spec = VERBS[verb];
        if (spec === undefined) {
            errors.push(
                `${probe.rel}:${line}: unknown clause verb \`${verb}\`. ` +
                    `The vocabulary is: ${Object.keys(VERBS).sort().join(', ')}.`,
            );
            continue;
        }
        if (args.length !== spec.arity) {
            errors.push(`${probe.rel}:${line}: \`${verb}\` takes ${spec.arity} argument(s), got ${args.length}.`);
            continue;
        }
        clauses.push({ verb, args, spec, line, source: match[1] });
    }
    return { clauses, errors, advisory };
}

/**
 * Every clause line in a workflow that no probe claimed.
 *
 * The comment walk stops at a blank line and starts at the step's dash, so a clause below a
 * blank line, or inside the step block, belongs to nothing — and used to vanish without a
 * word. Counting the file's clause lines against the attributed ones turns that into a
 * refusal: a clause that exists and is read by nobody is the defect this file is about.
 */
export function unattachedClauses(probes) {
    const byFile = new Map();
    for (const probe of probes) {
        if (!byFile.has(probe.rel)) byFile.set(probe.rel, { rawLines: probe.rawLines, attributed: new Set() });
        for (const { text, line } of probe.comment) {
            if (CLAUSE.test(text) || ADVISORY.test(text)) byFile.get(probe.rel).attributed.add(line);
        }
    }
    const stray = [];
    for (const [rel, { rawLines, attributed }] of byFile) {
        rawLines.forEach((raw, i) => {
            const text = raw.trim().replace(/^#\s?/, '');
            if (!raw.trim().startsWith('#')) return;
            if (!CLAUSE.test(text) && !ADVISORY.test(text)) return;
            if (attributed.has(i + 1)) return;
            stray.push(
                `${rel}:${i + 1}: \`${text.trim()}\` is attached to no probe — a blank line between the comment ` +
                    'and the step, or a clause inside the step block, detaches it. Nothing would ever evaluate it.',
            );
        });
    }
    return stray;
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log('usage: node scripts/check-probe-retirement.mjs [--root <dir>] [--online]');
        return process.exit(0);
    }
    const online = args.includes('--online');
    const rootFlag = args.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : args[rootFlag + 1];
    // A mistyped flag must not read as its own absence — `check-blueprint-census.mjs`'s note.
    const stray = args.filter(
        (arg, i) => arg !== '--root' && arg !== '--online' && !(rootFlag !== -1 && i === rootFlag + 1),
    );
    if (stray.length > 0 || (rootFlag !== -1 && typeof root !== 'string')) {
        const why = stray.length > 0 ? `unknown argument(s): ${stray.join(', ')}` : '--root needs a directory';
        console.error(
            `check-probe-retirement: ${why}\n  usage: node scripts/check-probe-retirement.mjs [--root <dir>] [--online]`,
        );
        return process.exit(2);
    }

    const io = createIo(root, { online });
    const probes = listProbes(root);
    const inScope = probes.filter((p) =>
        DECLARES_A_CONDITION.test(`${p.label}\n${p.comment.map((c) => c.text).join('\n')}`),
    );
    const outOfScope = probes.length - inScope.length;

    const errors = [];
    const ripe = [];
    const rows = [];
    const optedOut = [];

    errors.push(...unattachedClauses(probes));

    for (const probe of inScope) {
        const { clauses, errors: parseErrors, advisory } = parseClauses(probe);
        errors.push(...parseErrors);
        if (parseErrors.length > 0) continue;
        if (advisory !== undefined) {
            optedOut.push({ probe, advisory });
            continue;
        }
        if (clauses.length === 0) {
            errors.push(
                `${probe.rel}:${probe.line}: the probe "${probe.label}" states a retirement condition in prose and ` +
                    'carries no machine-readable clause, so nothing evaluates it. Add one or more comment lines ' +
                    'above the step:\n' +
                    `      #   retire-when: <${Object.keys(VERBS).sort().join(' | ')}> <args…>`,
            );
            continue;
        }

        const verdicts = clauses.map((clause) => {
            if (clause.spec.online) io.stats.onlineClauses += 1;
            if (clause.spec.online && !online) return { clause, state: 'unknown', why: 'needs --online' };
            try {
                const met = clause.spec.run(clause.args, io, probe);
                io.stats.evaluated += 1;
                if (clause.spec.online) io.stats.onlineEvaluated += 1;
                return { clause, state: met ? 'met' : 'unmet' };
            } catch (error) {
                // A malformed clause is a REFUSAL, not an unknown: it never resolves on its
                // own, so leaving it unknown means the probe can never be ripe and nobody is
                // told why. Only weather is tolerated.
                if (error instanceof ClauseError) {
                    errors.push(`${probe.rel}:${clause.line}: \`${clause.source}\` — ${error.message}`);
                    return { clause, state: 'error', why: error.message };
                }
                if (!(error instanceof Unknown)) throw error;
                io.stats.unknown += 1;
                return { clause, state: 'unknown', why: error.message };
            }
        });

        rows.push({ probe, verdicts });
        if (verdicts.every((v) => v.state === 'met')) ripe.push({ probe, verdicts });
    }

    // The ledger, every run — the sibling checks print theirs for the same reason: a
    // deferral that is not printed is one that outlives its cause.
    console.log(
        `check-probe-retirement: ${inScope.length} probe(s) with a stated condition, ` +
            `${outOfScope} carrying none, ${optedOut.length} advisory by declaration.`,
    );
    for (const { probe, advisory } of optedOut) {
        console.log(`\n  ${probe.rel}:${probe.line}  ${probe.label}\n    advisory by design — ${advisory.reason}`);
    }
    for (const { probe, verdicts } of rows) {
        const met = verdicts.filter((v) => v.state === 'met').length;
        console.log(`\n  ${probe.rel}:${probe.line}  ${probe.label}`);
        console.log(
            `    ${met} of ${verdicts.length} clause(s) met${online ? '' : ' (offline: network clauses unevaluated)'}`,
        );
        for (const v of verdicts) {
            const mark = { met: '●', unmet: '○', unknown: '?', error: '!' }[v.state];
            console.log(`    ${mark} ${v.clause.source}${v.why ? `  — ${v.why}` : ''}`);
        }
    }

    if (errors.length > 0) {
        console.error(`\ncheck-probe-retirement: ${errors.length} probe condition(s) that nothing can evaluate.\n`);
        for (const error of errors) console.error(`  ${error}`);
        return process.exit(1);
    }

    // A run in which every online clause came back unknown proved nothing and must not
    // read as a pass — the green-that-checked-nothing shape, in this check's own words.
    // SCOPED TO THE ONLINE CLAUSES, which is the whole point of the guard. Keyed on the
    // total it fired only when NOTHING at all evaluated, so a single tree-local clause
    // masked a complete registry and `gh` outage: measured, a probe with one `tree-lacks`
    // beside one registry clause exited 0 having read the network zero times.
    if (online && io.stats.onlineClauses > 0 && io.stats.onlineEvaluated === 0) {
        console.error(
            `\ncheck-probe-retirement: --online was asked for and NONE of the ${io.stats.onlineClauses} online ` +
                `clause(s) could be evaluated (${io.stats.unknown} unknown).\n  The published half of every ` +
                'condition went unread, so this run is not a pass. Re-run, or fix the access above (npm registry, ' +
                '`gh` auth).',
        );
        return process.exit(1);
    }

    if (ripe.length > 0) {
        console.error(`\ncheck-probe-retirement: ${ripe.length} probe(s) whose retirement condition is now MET.\n`);
        for (const { probe, verdicts } of ripe) {
            console.error(`  ${probe.rel}:${probe.line}: "${probe.label}"`);
            for (const v of verdicts) console.error(`      ● ${v.clause.source}`);
            console.error(
                '    Every clause it stated has come true, so it is no longer knowingly blocked.\n' +
                    '    Either PROMOTE it — delete `continue-on-error`, its `id` and the reader step, and rewrite\n' +
                    '    the comment as what the step now guarantees — or, if it is still red, the condition was a\n' +
                    '    PROXY and it is wrong: correct the clauses to name what actually blocks it, and record what\n' +
                    '    the probe found. Measure first; a met condition is not evidence that the step passes.\n',
            );
        }
        return process.exit(1);
    }

    console.log(
        `\ncheck-probe-retirement: nothing ripe — ${io.stats.evaluated} clause(s) evaluated ` +
            `(${io.stats.onlineEvaluated} of ${io.stats.onlineClauses} online), ${io.stats.unknown} unknown.`,
    );
    return process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-probe-retirement.mjs')) main();
