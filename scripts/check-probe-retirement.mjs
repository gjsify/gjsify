#!/usr/bin/env node
// A probe's retirement condition is EVALUATED, not re-read by a person.
//
// THE DEFECT. `check-probe-outcomes-read.mjs` (#1552) made every `continue-on-error`
// probe's result visible. It deliberately does not ask whether the probe should still BE
// one — each carries a written retirement condition in prose above the step, and prose is
// a TODO with extra steps: it only fires if somebody re-reads the row.
//
// MEASURED, 2026-09-19. Nobody had. Two of the four conditions in `gtk-os-suites.yml` had
// been satisfied for over a week:
//
//   · `conformance-win32` retired on a published `gtk-runtime-win32-x64` carrying
//     `gstvorbis.dll`. That shipped in 0.49.0 on 2026-09-11 — and the probe had then been
//     GREEN on 25 consecutive `main` runs while still declared advisory.
//   · the darwin `rn-probe` retired on the first published node-gi carrying #1438's engine
//     fix. That shipped in 0.46.0 on 2026-09-03 — and the probe was RED on all 42 job legs
//     measured since. The condition was a PROXY for "this can gate now", and the proxy was
//     wrong for the THIRD time on that one step (it was `#1438 closes` before, and an issue
//     number before that).
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
// Exit 0 when nothing is ripe, 1 on a ripe probe or a malformed clause, 2 on a usage error.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listProbes } from './workflow-probes.mjs';

/**
 * The clause line, as it is written in the comment above a step.
 *
 * Indented inside the comment — `#   retire-when: …` — because these blocks are prose with
 * the data set off from it, so the leading run is part of the spelling rather than an
 * accident to be tolerated.
 */
const CLAUSE = /^\s*retire-when:\s*(.+?)\s*$/;

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

function createIo(root, { online }) {
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const packuments = new Map();
    const stats = { evaluated: 0, unknown: 0 };

    const curl = (url, extra = []) => {
        try {
            return execFileSync('curl', ['-sSfL', '--max-time', '60', ...extra, url], {
                encoding: 'utf8',
                maxBuffer: 1 << 28,
            });
        } catch (error) {
            throw new Unknown(`could not read ${url.split('?')[0]}: ${error.message.split('\n')[0]}`);
        }
    };

    const packument = (pkg) => {
        if (!packuments.has(pkg)) {
            let parsed;
            try {
                parsed = JSON.parse(curl(packumentUrl(pkg, nonce)));
            } catch (error) {
                if (error instanceof Unknown) throw error;
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
        if (typeof version !== 'string') throw new Unknown(`${pkg}: no dist-tag \`${tag}\``);
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
            if (typeof url !== 'string') throw new Unknown(`${pkg}@${version}: the packument names no tarball`);
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
            if (!Number.isInteger(runs) || runs < 1) throw new Unknown(`probe-green needs a positive count`);
            if (probe.id === undefined) throw new Unknown('the step has no `id`, so its outcome is not addressable');
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
                    String(runs * 3),
                    '--json',
                    'databaseId,conclusion',
                ]),
            ).filter((r) => r.conclusion && r.conclusion !== 'cancelled');
            if (list.length === 0) throw new Unknown(`${workflow}: no completed \`main\` runs to read`);

            // The step's NAME is what the reporter puts in the annotation, and it is what
            // ties the two together — the id never reaches the log.
            const label = probe.label;
            let seen = 0;
            for (const run of list) {
                if (seen >= runs) break;
                const jobs = JSON.parse(
                    gh(['api', `/repos/{owner}/{repo}/actions/runs/${run.databaseId}/jobs?per_page=100`]),
                ).jobs;
                for (const job of jobs) {
                    const step = job.steps?.find((s) => s.name === label);
                    if (!step || step.conclusion !== 'success') continue; // absent or skipped: this leg did not measure
                    const annotations = JSON.parse(
                        gh([
                            'api',
                            `/repos/{owner}/{repo}/check-runs/${job.id}/annotations?per_page=100`,
                            '--paginate',
                            '--slurp',
                        ]),
                    ).flat();
                    const red = annotations.some(
                        (a) =>
                            a.annotation_level === 'warning' &&
                            /Probe failed/.test(a.title ?? '') &&
                            String(a.message).includes(label),
                    );
                    seen += 1;
                    if (red) return false;
                }
            }
            if (seen < runs)
                throw new Unknown(`${workflow}: only ${seen} recorded outcome(s) for "${label}", wanted ${runs}`);
            return true;
        },
    };
}

/** Parse a probe's clause lines. Returns `{ clauses, errors }`. */
export function parseClauses(probe) {
    const clauses = [];
    const errors = [];
    for (const { text, line } of probe.comment) {
        const match = CLAUSE.exec(text);
        if (!match) continue;
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
    return { clauses, errors };
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

    for (const probe of inScope) {
        const { clauses, errors: parseErrors } = parseClauses(probe);
        errors.push(...parseErrors);
        if (parseErrors.length > 0) continue;
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
            if (clause.spec.online && !online) return { clause, state: 'unknown', why: 'needs --online' };
            try {
                const met = clause.spec.run(clause.args, io, probe);
                io.stats.evaluated += 1;
                return { clause, state: met ? 'met' : 'unmet' };
            } catch (error) {
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
        `check-probe-retirement: ${inScope.length} probe(s) with a stated condition, ${outOfScope} advisory by design.`,
    );
    for (const { probe, verdicts } of rows) {
        const met = verdicts.filter((v) => v.state === 'met').length;
        console.log(`\n  ${probe.rel}:${probe.line}  ${probe.label}`);
        console.log(
            `    ${met} of ${verdicts.length} clause(s) met${online ? '' : ' (offline: network clauses unevaluated)'}`,
        );
        for (const v of verdicts) {
            const mark = { met: '●', unmet: '○', unknown: '?' }[v.state];
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
    if (online && io.stats.evaluated === 0 && io.stats.unknown > 0) {
        console.error(
            `\ncheck-probe-retirement: --online was asked for and ${io.stats.unknown} clause(s) came back UNKNOWN ` +
                'with none evaluated.\n  Nothing was measured, so this run is not a pass. Re-run, or fix the access ' +
                'above (npm registry, `gh` auth).',
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
        `\ncheck-probe-retirement: nothing ripe — ${io.stats.evaluated} clause(s) evaluated, ${io.stats.unknown} unknown.`,
    );
    return process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-probe-retirement.mjs')) main();
