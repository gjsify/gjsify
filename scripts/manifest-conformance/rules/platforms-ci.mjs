/**
 * Rule `platforms-ci` — REPO-SCOPED half of the OS axis.
 *
 * `gjsify.runtimes` declares the RUNTIME reach of a package (gjs × node ×
 * browser × nativescript). It says nothing about OPERATING SYSTEMS — so a
 * package could declare `gjs: "polyfill"` and still have no loadable artifact
 * on macOS or Windows, because the native bridge it needs only ever built on
 * Linux. That blind spot is exactly how the whole native-bridge set stayed
 * Linux-only while the project described itself as platform-independent.
 *
 * `package.json#gjsify.platforms` closes it: the list of `<os>-<arch>` targets
 * a native package PROMISES a prebuild for. It is the OS-axis sibling of
 * `gjsify.runtimes`, and the checks below keep the promise, the committed
 * artifacts and the CI that produces them from drifting apart.
 *
 * WHY REPO-SCOPED, and why this is split from `prebuild-artifacts`:
 * the declared-vs-committed half is a fact about files and lives in the
 * portable `prebuild-artifacts` rule. THIS half reads
 * `.github/workflows/prebuilds.yml`'s matrix — this repository's own CI, by
 * filename, with a parser tuned to its job shapes. There is nothing to port:
 * a consumer's CI is not this one, and pretending to audit it would invent
 * platform support that does not exist.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    canonicalPlatform,
    collectNativePackages,
    defineRule,
    isPlatformPackageManifest,
    KNOWN_ARCH_TOKENS,
    platformPackageName,
    prebuildOwnership,
    PLATFORM_RE,
} from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/** Default arch a bare runner label implies, keyed by the OS it maps to. */
const RUNNER_DEFAULT_ARCH = { linux: 'x64', darwin: 'arm64', win32: 'x64' };

export function osFromRunner(runsOn) {
    if (/macos/i.test(runsOn)) return 'darwin';
    if (/windows/i.test(runsOn)) return 'win32';
    return 'linux';
}

/**
 * The arch a runner LABEL implies, when the job declares no `arch:` matrix key.
 *
 * The default table above is keyed only by OS, which silently mis-attributes
 * every macOS runner that is not Apple silicon: `macos-15-intel` would be read
 * as `darwin-arm64`, so an Intel job would be credited with the arm64 target
 * and the declared-vs-built symmetry would hold while describing the wrong
 * artifact. That failure is invisible by construction — both sides agree, and
 * nothing goes red.
 *
 * GitHub's label vocabulary is deliberately checked in a specific order,
 * because two of its spellings differ by one character and mean opposite
 * architectures: `-xlarge` is Apple silicon, `-large` is Intel. Reading them
 * the other way round is the same silent mis-attribution with a longer fuse.
 *
 *   arm64 — `macos-14`, `macos-15`, `macos-latest`, `*-xlarge`,
 *           `ubuntu-24.04-arm`
 *   x64   — `macos-15-intel`, `macos-26-intel`, `*-large`
 *
 * `macos-15-intel` is the LAST x86_64 image Actions will offer (available
 * until August 2027, after which Apple's discontinuation of the architecture
 * ends GitHub's support for it) — so a `darwin-x64` promise necessarily has a
 * horizon, and the parser should be honest about which leg produced it.
 */
export function archFromRunner(runsOn, os = osFromRunner(runsOn)) {
    if (/-xlarge\b/.test(runsOn)) return 'arm64';
    if (/-arm\b|-arm64\b/.test(runsOn)) return 'arm64';
    if (/-intel\b|-large\b/.test(runsOn)) return 'x64';
    return RUNNER_DEFAULT_ARCH[os];
}

/**
 * The `strategy.matrix.include` entries of one job, as `{arch?, runner?}` PAIRS.
 *
 * `runs-on` is read literally, so a job whose runner comes from the matrix
 * (`runs-on: ${{ matrix.runner }}`) tells `osFromRunner` nothing — it falls
 * through to `linux`. That is right for the Linux legs BY ACCIDENT, and wrong
 * for any macOS or Windows matrix, which is why the OS-per-leg has to come
 * from the include entries rather than from the expression.
 *
 * Pairing matters as much as reading: a job's `arch:` values and its `runner:`
 * values are not two independent sets — entry N's arch belongs to entry N's
 * runner. Collecting them into two flat sets would produce the CROSS product,
 * inventing targets no job builds the moment a matrix mixes operating systems.
 *
 * Deliberately the same lightweight structural read as the rest of this file
 * (no YAML dependency in a script that must run with NO install): find the
 * `matrix:` key, treat everything more-indented as its block, start a new entry
 * at each `- key: value`, and attach the sibling `key: value` lines to it.
 */
export function parseMatrixIncludes(lines) {
    const unquote = (v) => v.replace(/^['"]|['"]$/g, '').trim();
    const entries = [];
    let matrixIndent = -1;
    let current = null;
    for (const line of lines) {
        if (!line.trim()) continue;
        const indent = line.length - line.trimStart().length;
        if (matrixIndent < 0) {
            if (/^\s*matrix:\s*$/.test(line)) matrixIndent = indent;
            continue;
        }
        // Anything at or left of `matrix:` ends the block (`steps:`, the next key).
        if (indent <= matrixIndent) break;
        const item = /^\s*-\s+([A-Za-z_][\w-]*):\s*(.+?)\s*$/.exec(line);
        if (item) {
            current = { [item[1]]: unquote(item[2]) };
            entries.push(current);
            continue;
        }
        const kv = /^\s*([A-Za-z_][\w-]*):\s*(.+?)\s*$/.exec(line);
        if (kv && current) current[kv[1]] = unquote(kv[2]);
    }
    return entries;
}

/** Group a job's lines into step blocks (a step starts at `- name:`/`- uses:`/`- run:`). */
export function splitSteps(lines) {
    const steps = [];
    let current = [];
    for (const line of lines) {
        if (/^\s*-\s+(name|uses|run):/.test(line) && current.length > 0) {
            steps.push(current.join('\n'));
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) steps.push(current.join('\n'));
    return steps;
}

/**
 * Which `<os>-<arch>` targets CI actually produces, per package name.
 *
 * Deliberately a lightweight structural read of the workflow files rather
 * than a full YAML parse: split `jobs:` into its 2-space-indented job blocks,
 * take each job's `runs-on` (→ OS) and any `arch:` matrix entries (→ arch),
 * and attribute those targets to the packages that job actually PRODUCES an
 * artifact for.
 *
 * "Produces" is deliberately narrow — a package name has to appear on a line
 * that also carries a production verb (build / collect / stage / prebuild /
 * upload). A bare mention does not count, because the workflows are full of
 * explanatory comments naming packages they merely depend on ("…whose
 * `gjsify build` needs `@gjsify/rolldown-native`"), and crediting those would
 * manufacture platform support that does not exist. Comment lines are dropped
 * outright for the same reason.
 *
 * Jobs gated on `github.event_name == 'workflow_dispatch'` are EXCLUDED: a
 * manually-dispatched exploratory job (today: napi's blocked Windows attempt)
 * is not a platform CI produces, and counting it would let a package declare
 * a target no user will ever receive.
 *
 * The result is ADVISORY — a package the parser finds no job for is reported
 * as unverified rather than failed, so a build wired up in a workflow shape
 * this parser does not understand can never produce a false CI failure.
 */
export async function parseCiPlatforms(
    root,
    nativePkgs,
    workflowFiles = ['prebuilds.yml', 'napi.yml', 'node-gi.yml', 'release.yml'],
) {
    const byPackage = new Map();
    // A step identifies its package either by npm name or by the workspace
    // path it builds in (`working-directory: packages/node-gi/node-gi`) — the
    // macOS/arm64 jobs use the latter exclusively, so name-only matching would
    // silently under-report their coverage.
    const identifiers = nativePkgs.map((p) => ({ name: p.name, name_re: p.name, path_re: p.path }));
    for (const file of workflowFiles) {
        const abs = resolve(root, '.github', 'workflows', file);
        if (!existsSync(abs)) continue;
        const text = await readFile(abs, 'utf8');
        const lines = text.split('\n');
        let current = null;
        const jobs = [];
        let inJobs = false;
        for (const line of lines) {
            if (/^jobs:\s*$/.test(line)) {
                inJobs = true;
                continue;
            }
            if (!inJobs) continue;
            const header = /^ {2}([A-Za-z0-9][\w-]*):\s*$/.exec(line);
            if (header) {
                current = { job: header[1], file, runsOn: '', archs: new Set(), body: [] };
                jobs.push(current);
                continue;
            }
            if (!current) continue;
            if (/^\s*#/.test(line)) continue; // explanatory comment — never a production step
            current.body.push(line);
            const runsOn = /^\s*runs-on:\s*(.+?)\s*$/.exec(line);
            if (runsOn) current.runsOn = runsOn[1];
            const arch = /^\s*-?\s*arch:\s*['"]?([\w]+)['"]?\s*$/.exec(line);
            // Only tokens that NAME a CPU count. `arch:` is a matrix key here,
            // but it is also a common ACTION INPUT (it was one on the emulated
            // legs until they stopped using `uraimo/run-on-arch-action`, whose
            // documented value alongside a custom `base_image` is the literal
            // `none`). An unfiltered read turns any such value into a phantom
            // target — `linux-none` — and fails the declared-vs-built contract
            // for every package the job builds.
            if (arch && KNOWN_ARCH_TOKENS.has(arch[1])) current.archs.add(arch[1]);
            if (/^\s*if:\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(line)) current.manualOnly = true;
        }
        for (const job of jobs) {
            if (job.manualOnly) continue;
            const os = osFromRunner(job.runsOn);
            // Prefer the matrix's own (arch, runner) PAIRS: they carry a
            // per-leg OS, which `runs-on: ${{ matrix.runner }}` cannot. Entries
            // naming no runner fall back to the job's literal `runs-on` (the
            // QEMU legs' shape), and a job with no matrix at all keeps the
            // single-target path. `ubuntu-24.04-arm` / `macos-15-intel` and
            // friends carry the arch in the label — see `archFromRunner`.
            const includes = parseMatrixIncludes(job.body).filter((e) => e.arch || e.runner);
            const targets = new Set();
            if (includes.length > 0) {
                for (const entry of includes) {
                    const runsOn = entry.runner ?? job.runsOn;
                    const entryOs = entry.runner ? osFromRunner(entry.runner) : os;
                    const arch =
                        entry.arch && KNOWN_ARCH_TOKENS.has(entry.arch) ? entry.arch : archFromRunner(runsOn, entryOs);
                    targets.add(canonicalPlatform(`${entryOs}-${arch}`));
                }
            } else {
                const archs = job.archs.size > 0 ? [...job.archs] : [archFromRunner(job.runsOn, os)];
                for (const arch of archs) targets.add(canonicalPlatform(`${os}-${arch}`));
            }
            // A job that DOWNLOADS artifacts is consuming what another job
            // produced, so nothing in it may be read as production — and this
            // map means exactly "which targets does CI BUILD".
            //
            // The per-step verb test cannot make that distinction on its own:
            // `commit-prebuilds`' steps are called "Download <pkg> <arch>
            // prebuilds" and `publish-napi`'s is "Confirm both prebuilds are
            // STAGED", both of which are production verbs, and both of which
            // then contribute the CONSUMING job's own platform. It was harmless
            // until ADR 0017 only because those steps named the BRIDGE, which
            // the real build legs had already credited with the same targets —
            // so the surplus attribution was invisible. Once they name the
            // per-target package it is not: `commit-prebuilds` and
            // `publish-napi` are plain `ubuntu-latest` jobs with no arch matrix,
            // so every platform package they mention was credited with
            // `linux-x64` and failed the rule in BOTH directions at once
            // ("declares darwin-arm64, CI produces none" + "CI builds
            // linux-x64, not declared").
            //
            // Keyed on the ACTION, not on a job-name pattern: `download` is what
            // makes a job a consumer, and a list of job names is a second copy
            // of the workflow that drifts from it. No producer downloads — the
            // build legs compile from a checkout — so this costs no coverage,
            // which the platform matrix is diffed against to confirm.
            if (/uses:\s*actions\/download-artifact/.test(job.body)) continue;
            // Attribute per STEP, not per line: a step's package identity and
            // its production verb usually sit on different lines (`- name:
            // Build native addon` + `working-directory: packages/…`).
            for (const step of splitSteps(job.body)) {
                if (!/\b(build|collect|stage|prebuild|upload)/i.test(step)) continue;
                for (const id of identifiers) {
                    if (!step.includes(id.name_re) && !step.includes(id.path_re)) continue;
                    const set = byPackage.get(id.name) ?? new Set();
                    for (const target of targets) set.add(target);
                    byPackage.set(id.name, set);
                }
            }
        }
    }
    return byPackage;
}

/**
 * Is every DEFERRED missing `.gir` actually on its way?
 *
 * The missing-`.gir` ledger (`scripts/manifest-conformance/prebuild-gir-gaps.mjs`)
 * excuses a committed directory that holds no `.gir`, on one stated promise: "the
 * next `prebuilds.yml` run that rebuilds this target lands the file". That promise
 * has two ways to be false, and the ledger could not see either of them.
 *
 *   1. The build stops emitting the `.gir`. Caught at the moment of truth by
 *      `scripts/stage-prebuild.mjs`, which refuses to stage a `.typelib` with no
 *      `.gir` beside it — in the build leg, with the build log in front of whoever
 *      reads it.
 *   2. NOTHING EVER REBUILDS THE TARGET. That is this function. A deferral for a
 *      target no CI leg produces cannot clear, ever: the ledger entry keeps
 *      passing, the audit keeps printing its reason, and a gap the tree describes
 *      as transient is permanent with nothing anywhere saying so. Which is the
 *      failure class the ledger was introduced to replace, one level up.
 *
 * So a deferral must name a package `prebuilds.yml` BUILDS, for the target whose
 * directory is short a file. That is checkable from the workflow this file already
 * parses, which is why it lives in the repo-scoped rule rather than in the portable
 * `prebuild-artifacts` one: a consumer's CI is not this one.
 *
 * ADVISORY WHEN THE PARSER IS BLIND, deliberately: if the coverage map is empty,
 * the workflow shape (not the ledger) is what this could not read, and turning a
 * parser gap into a red `main` for every open PR is the incident this whole gate
 * exists to stop. An empty map therefore yields a note, never a failure — while a
 * map that credits OTHER packages and not this one is a real answer.
 *
 * @param {Array<object>} nativePkgs rows from `collectNativePackages()`
 * @param {Map<string, Set<string>>} prebuildCi coverage parsed from `prebuilds.yml`
 * @param {Record<string, string>} [girGaps] the ledger, `ctx.options.prebuildGirGaps`
 * @returns {{failures: string[], notes: string[]}}
 */
export function auditGirGapArrival(nativePkgs, prebuildCi, girGaps = {}) {
    /** @type {string[]} */ const failures = [];
    /** @type {string[]} */ const notes = [];
    const deferred = Object.keys(girGaps);
    if (deferred.length === 0) return { failures, notes };
    if (prebuildCi.size === 0) {
        notes.push(
            `${deferred.length} missing-\`.gir\` deferral(s) could not be checked for an arrival path — no package in ` +
                "`prebuilds.yml` was recognised by the workflow parser at all, so the silence is this rule's, not CI's.",
        );
        return { failures, notes };
    }
    const byName = new Map(nativePkgs.map((p) => [p.name, p]));
    for (const name of deferred) {
        const pkg = byName.get(name);
        // An entry naming a package this tree does not audit is already a failure
        // in `prebuild-artifacts` (nothing matched it). Reporting it twice, from a
        // rule that would have to guess what was meant, adds noise and no signal.
        if (!pkg) continue;
        const built = prebuildCi.get(name) ?? new Set();
        const orphaned = (pkg.declared ?? []).filter((target) => !built.has(target));
        if (orphaned.length === 0) {
            notes.push(`${name}: \`prebuilds.yml\` builds ${[...built].sort().join(', ')} — a run restages it.`);
            continue;
        }
        failures.push(
            `${name} (${pkg.path}) is deferred in the missing-\`.gir\` ledger, whose reason promises the next ` +
                `\`prebuilds.yml\` run lands the file — but no job in \`prebuilds.yml\` builds this package for ` +
                `${orphaned.join(', ')}${built.size > 0 ? ` (it builds ${[...built].sort().join(', ')})` : ''}. ` +
                'Nothing can ever clear this entry, so the deferral is PERMANENT and the ledger says otherwise. ' +
                'Either give the target a build leg, or commit the `.gir` and delete the entry — a deferral is only ' +
                'honest while something is on its way to ending it.',
        );
    }
    return { failures, notes };
}

/**
 * Keep promise, artifact and CI in sync. Returns human-readable failure lines
 * (empty = ok) plus the per-package rows the reporters render.
 */
export function auditPlatforms(nativePkgs, ciPlatforms) {
    const failures = [];
    const rows = [];
    for (const pkg of nativePkgs) {
        const ci = ciPlatforms.get(pkg.name);
        const ciList = ci ? [...ci].sort() : null;
        rows.push({ ...pkg, ci: ciList });

        if (!pkg.declared) {
            failures.push(
                `${pkg.name} (${pkg.path}): missing \`gjsify.platforms\` — every package with a native build system must declare the \`<os>-<arch>\` targets it ships a prebuild for. \`gjsify.runtimes\` covers runtimes, not operating systems; without this the package's OS reach is undocumented and unverifiable.`,
            );
            continue;
        }
        const bad = pkg.declared.filter((p) => !PLATFORM_RE.test(p));
        if (bad.length > 0) {
            failures.push(
                `${pkg.name} (${pkg.path}): invalid \`gjsify.platforms\` entr${bad.length === 1 ? 'y' : 'ies'} ${bad.join(', ')} — expected \`\${process.platform}-\${process.arch}\`, i.e. os ∈ {linux, darwin, win32} and arch ∈ {x64, arm64, ppc64, s390x, riscv64}. The uname spelling (\`linux-x86_64\`, \`linux-aarch64\`) is no longer accepted: one spelling, and it is the one a running process can compute about itself.`,
            );
            continue;
        }
        const declaredCanon = new Set(pkg.declared.map(canonicalPlatform));

        // A committed artifact nobody declared: either the declaration is
        // stale or the artifact is. Both are silent-wrongness risks — a
        // consumer resolving `prebuilds/<p>/` finds something the package
        // does not promise to keep working.
        for (const shipped of pkg.shipped) {
            if (!declaredCanon.has(canonicalPlatform(shipped))) {
                failures.push(
                    `${pkg.name} (${pkg.path}): ships \`prebuilds/${shipped}/\` but does not declare it in \`gjsify.platforms\` (${pkg.declared.join(', ')}).`,
                );
            }
        }

        // The promise and the build must agree in BOTH directions, so that
        // whoever changes one is forced to change the other:
        //   declared ⊄ CI  → a platform users are promised but never receive
        //   CI ⊄ declared  → a platform CI pays to build that nothing claims,
        //                    and that no consumer-facing document mentions
        // Only enforced when the parser found CI jobs for this package at all
        // — see parseCiPlatforms' contract.
        if (ci) {
            for (const declared of pkg.declared) {
                if (!ci.has(canonicalPlatform(declared))) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): declares \`${declared}\` in \`gjsify.platforms\` but no CI job produces that target — a promised platform with no build is a prebuild consumers will never receive.`,
                    );
                }
            }
            for (const built of ci) {
                if (!declaredCanon.has(built)) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): CI builds \`${built}\` but \`gjsify.platforms\` (${pkg.declared.join(', ')}) does not declare it — an artifact the package does not promise is invisible to consumers and to every platform-support document generated from this field.`,
                    );
                }
            }
        } else if (pkg.shipped.length > 0) {
            // Committed binaries that no workflow reproduces. They were built
            // by hand once and drift silently from their sources forever after
            // — nothing rebuilds them when the Vala/Rust changes, and nothing
            // proves they still match. Wire the package into a prebuild
            // workflow, or stop shipping the artifact.
            failures.push(
                `${pkg.name} (${pkg.path}): ships prebuilds (${pkg.shipped.join(', ')}) but no CI job produces any of them — a hand-built binary nothing reproduces. Wire it into .github/workflows/prebuilds.yml.`,
            );
        }
    }
    return { failures, rows };
}

/**
 * The OS × package matrix — the honest answer to "where does this run?".
 *
 * Takes rows that have been through {@link creditPlatformArtifacts} and REFUSES
 * anything else. Every glyph below except `·` turns on where the artifact for a
 * cell is, and since ADR 0017 that fact lives on a package this table does not
 * have a row for; a renderer that reads it off the bridge alone cannot fail, it
 * just quietly answers a different question — which is the whole defect this
 * signature exists to make unrepeatable.
 */
export function renderPlatformMatrix(rows, { markdown = false } = {}) {
    const uncredited = rows.filter((r) => r.artifacts == null || typeof r.artifacts !== 'object');
    if (uncredited.length > 0) {
        throw new TypeError(
            `renderPlatformMatrix: ${uncredited.length} row(s) carry no \`artifacts\` map (first: ${uncredited[0].name}). ` +
                'Rows must come from `platformRows()`, which runs `creditPlatformArtifacts()` BEFORE filtering the ' +
                'per-target platform packages out of the table — the artifact state of a split bridge lives on its ' +
                'children, so crediting after the filter finds nothing and every declared target renders `✓`.',
        );
    }
    const all = new Set();
    for (const r of rows) {
        for (const p of r.declared ?? []) all.add(canonicalPlatform(p));
        for (const p of Object.keys(r.artifacts)) all.add(canonicalPlatform(p));
        for (const p of r.ci ?? []) all.add(canonicalPlatform(p));
    }
    const platforms = [...all].sort();
    const mark = (r, p) => {
        const declared = (r.declared ?? []).some((d) => canonicalPlatform(d) === p);
        const built = (r.ci ?? []).some((c) => canonicalPlatform(c) === p);
        // "Is there a committed artifact for this cell ANYWHERE in this repo",
        // asked of the credit map rather than of this row's own `prebuilds/`.
        // A declared target with no committed artifact is a distinct state from
        // one with — the matrix is the document people read to answer "can I
        // install this there?", and collapsing the two is how "declared" came to
        // look like "delivered" in the first place.
        //
        // The previous spelling read `r.shipped`/`r.uncommitted` off the row and
        // gated the exemption on OWNERSHIP rather than on `gjsify.prebuilds` —
        // both correct as far as they went, and both blind to WHERE the state
        // moved. ADR 0017 put it on the per-target CHILD packages, which
        // `matrixRows` filters out of this table, so on a bridge row `shipped` is
        // always `[]` and `uncommitted` always `null`: the `○` and `⚠` branches
        // became unreachable and every declared target a CI job builds rendered
        // `✓` "artifact committed". Measured on 0.27.0: `@gjsify/napi` claimed a
        // committed artifact on both its targets while its two children defer
        // BOTH via `gjsify.platformsUncommitted` (the linux-x64 directory was
        // deleted in #960 precisely so the only loadable copy is one CI just
        // built), and `@gjsify/node-gi` claimed one on all five while building
        // with node-gyp at install time and committing nothing anywhere. This
        // table is rendered into the website's Platform Support page, so that
        // cell is exactly the documentation lie it exists to prevent.
        const artifact = r.artifacts[p];
        if (declared && artifact?.committed === true) return built ? '✓' : '⚠'; // ⚠ committed, nothing rebuilds it
        if (declared && built) return '○'; // built, but no artifact committed here
        if (declared) return '!'; // promised, nothing produces it at all
        if (artifact?.committed === true || built) return '?'; // produced, never promised
        return '·';
    };
    // "a CI job targets it", not "a green build exists": this is parsed out of
    // the workflow YAML, which knows nothing about run results. Saying "built"
    // would claim more than the data supports — the failure mode this whole
    // audit exists to remove.
    const legendParts = [
        '✓ declared, a CI job targets it, artifact committed',
        '○ declared, a CI job targets it, artifact NOT committed here',
        '⚠ committed artifact, no CI job targets it',
        '! declared, no CI job targets it',
        '? produced, undeclared',
        '· unsupported',
    ];
    if (markdown) {
        const lines = [
            `| package | tier | ${platforms.join(' | ')} |`,
            `|---|---|${platforms.map(() => '---').join('|')}|`,
        ];
        for (const r of rows) {
            lines.push(`| \`${r.name}\` | ${r.tier ?? '—'} | ${platforms.map((p) => mark(r, p)).join(' | ')} |`);
        }
        lines.push('');
        lines.push(legendParts.map((l) => `\`${l.slice(0, 1)}\`${l.slice(1)}`).join(' · '));
        return lines.join('\n');
    }
    const nameWidth = Math.max(...rows.map((r) => String(r.name).length), 'package'.length);
    const head = `${'package'.padEnd(nameWidth)} │ ${platforms.map((p) => p.padEnd(14)).join(' │ ')}`;
    const sep = `${'─'.repeat(nameWidth)}─┼─${platforms.map(() => '─'.repeat(14)).join('─┼─')}`;
    const body = rows.map(
        (r) => `${String(r.name).padEnd(nameWidth)} │ ${platforms.map((p) => mark(r, p).padEnd(14)).join(' │ ')}`,
    );
    return [head, sep, ...body, '', legendParts.join('   ')].join('\n');
}

/**
 * The declared targets whose artifact this repository never commits, so the only
 * way one can reach a consumer is inside the tarball a `release.yml` job stages.
 *
 * `auditPlatforms` above compares a declaration against the UNION of every
 * workflow, which answers "does CI build this?" and deliberately says nothing
 * about who SHIPS it. For a package whose binary is committed here that is the
 * whole story — the normal `publish` job packs the checked-out directory. For a
 * package that commits nothing it is only half of one, and the missing half is
 * where both node-gi platform gaps came from: `win32-x64`/`darwin-arm64` in
 * 0.26.0 and `darwin-x64` right after #921 added it. Each time the union was
 * green because `node-gi.yml` genuinely builds the target on every node-gi PR,
 * and each time the published tarball had no such binary in it.
 *
 * The three ownership states (`prebuildOwnership`) answer this exactly:
 *   · `install-time` — nothing is committed here for ANY target, so every
 *     declared one needs a release leg. Today `@gjsify/node-gi`.
 *   · `committed-here` — the committed directories ship themselves; only the
 *     targets the package itself records as NOT committed
 *     (`gjsify.platformsUncommitted`) need one. Today `@gjsify/napi`'s two
 *     per-target packages, whose exemption reasons name these very legs.
 *   · `split` — SKIPPED. The parent holds the declaration but owns no artifact;
 *     each per-target child is its own row here and answers for its own target.
 *
 * @param {object} pkg a row from `collectNativePackages()`
 * @returns {string[]} canonical targets, possibly empty
 */
export function releaseOnlyTargets(pkg) {
    const ownership = prebuildOwnership(pkg);
    if (ownership === 'split') return [];
    const uncommitted = new Set(Object.keys(pkg.uncommitted ?? {}).map(canonicalPlatform));
    return (pkg.declared ?? [])
        .map(canonicalPlatform)
        .filter((target) => ownership === 'install-time' || uncommitted.has(target));
}

/**
 * Hold `release.yml` to every target that can only ship from it.
 *
 * WHY `prebuildsCi` IS SUBTRACTED and not merely ignored: a target that
 * `prebuilds.yml` builds is on its way to being COMMITTED — `commit-prebuilds`
 * lands the directory and `clear-committed-platform-exemptions.mjs` deletes the
 * exemption in the same commit. That is the TEMPORARY half of the exemption
 * contract (§ Runtime & platform model), and it is the NORMAL state of a
 * newly-added target: for the days between "the leg is green" and "the artifact
 * is committed", the package legitimately declares a target with no artifact and
 * no release leg. Without this subtraction the rule would demand a release leg
 * for every such target — a leg that must not exist — and the next exotic-arch
 * addition would have to route around the check to land at all.
 *
 * ADVISORY-SAFE in the same way as `auditPlatforms`: a package the parser found
 * no release coverage for at all still fails, because for these packages "no
 * release leg" IS the defect. There is nothing here that a workflow shape the
 * parser misunderstands could turn into a false pass — an unrecognised leg reads
 * as absent, which is the failing direction, so the message names the parser.
 *
 * @param {Array<object>} nativePkgs rows from `collectNativePackages()`
 * @param {Map<string, Set<string>>} releaseCi coverage parsed from `release.yml` alone
 * @param {Map<string, Set<string>>} prebuildsCi coverage parsed from `prebuilds.yml` alone
 * @returns {string[]} failure lines (empty = ok)
 */
export function auditReleaseCoverage(nativePkgs, releaseCi, prebuildsCi) {
    const failures = [];
    for (const pkg of nativePkgs) {
        const released = releaseCi.get(pkg.name);
        const committing = prebuildsCi.get(pkg.name);
        for (const target of releaseOnlyTargets(pkg)) {
            if (committing?.has(target)) continue; // on its way to being committed
            if (released?.has(target)) continue;
            failures.push(
                `${pkg.name} (${pkg.path}): declares \`${target}\` in \`gjsify.platforms\` and commits no artifact for it, but no job in .github/workflows/release.yml produces that target — the published tarball would ship every OTHER platform and silently omit this one. Add a release prebuild leg that builds, LOAD-TESTS and uploads it (mirror the nearest existing leg), and a matching download into the publish job's staging path. Another workflow building it is not enough: an artifact belongs to the run that produced it, so a release cannot download node-gi.yml's or napi.yml's uploads.`,
            );
        }
    }
    return failures;
}

/**
 * Credit each per-target platform package (ADR 0017) with its PARENT's CI
 * coverage, narrowed to its own target.
 *
 * A platform package is a re-tarballing of one directory the parent's build
 * produced; no workflow mentions it by name, and nothing should — the job that
 * produces the binary is the parent's, identified by the parent's name and path.
 * Without this the `platforms-ci` rule reaches its last branch for all 51 of them
 * ("ships prebuilds but no CI job produces any of them — a hand-built binary
 * nothing reproduces"), which is exactly backwards: the artifact is the single
 * most reproducible thing in the tree.
 *
 * NARROWED, not inherited wholesale, because the rule checks CI coverage in both
 * directions and an unnarrowed set would report `@gjsify/webgl-linux-x64` as
 * building four targets it does not declare. Narrowing makes the child's own
 * ci-vs-declared check vacuous — deliberately: the child's declaration is
 * GENERATED from the parent's list and audited against it by the
 * `platform-packages` rule, while the parent keeps the full both-directions
 * contract against the workflow matrix. Coverage moves, it does not disappear.
 *
 * @param {Array<object>} nativePkgs rows from `collectNativePackages()`
 * @param {Map<string, Set<string>>} byPackage from {@link parseCiPlatforms}
 * @param {import('../../../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export function creditPlatformPackages(nativePkgs, byPackage, ctx) {
    for (const pkg of nativePkgs) {
        const record = ctx.get(pkg.name);
        if (!record || !isPlatformPackageManifest(record.manifest)) continue;
        if (byPackage.has(pkg.name)) continue; // a workflow named it explicitly — take it at its word
        const target = record.manifest.gjsify.platforms[0];
        // Find the bridge this package belongs to by the ONE naming derivation,
        // rather than by string-stripping the suffix here: the parent is whichever
        // native package the derivation reproduces this name from.
        const parent = nativePkgs.find((p) => platformPackageName(p.name, target) === pkg.name);
        const parentCi = parent ? byPackage.get(parent.name) : undefined;
        if (!parentCi) continue;
        const canon = canonicalPlatform(target);
        if (parentCi.has(canon)) byPackage.set(pkg.name, new Set([canon]));
    }
    return byPackage;
}

/**
 * Credit each bridge with the artifact state its per-target packages hold.
 *
 * The MIRROR IMAGE of `creditPlatformPackages` above, along the same single
 * naming derivation and for the same reason: ADR 0017 records a fact about a
 * bridge's binaries on a DIFFERENT package than the one a reader asks about.
 * That function moves CI coverage DOWN to the children so each answers for its
 * own target; this one moves the ARTIFACT state UP to the bridge, because the
 * matrix has exactly one row per bridge and none for its children — and every
 * glyph but `·` turns on where the artifact for that cell is.
 *
 * NOT folded into `collectNativePackages()`: that row is the input to the
 * FAILURE set (`prebuild-artifacts` holds each tarball to the directories IT
 * contains, `releaseOnlyTargets` asks what THIS package commits), and a row
 * whose `shipped` silently included a sibling's directories would make both ask
 * the wrong question. The credit is additive and derived, so it goes in a field
 * of its own, on a copy, at the point of RENDERING.
 *
 * A record per target rather than a flat set of tokens, because the bridge does
 * not contain the artifact: `package` names the tarball the binary is really in,
 * which is what a reader needs in order to go and check it, and a row claiming
 * `shipped: ['linux-x64']` would replace one wrong answer with another.
 *
 * OWN state wins over a child's. A bridge that still names its own
 * `gjsify.prebuilds` is legal (none today) and then IS the owner; a child could
 * only contradict it, and picking the child would make the state depend on row
 * order.
 *
 * @param {Array<object>} rows rows from {@link auditPlatforms}, children INCLUDED
 * @returns {Array<object>} copies carrying
 *   `artifacts: Record<target, {package: string, committed: boolean, reason?: string}>`
 */
export function creditPlatformArtifacts(rows) {
    /** @type {Map<string, Record<string, {package: string, committed: boolean, reason?: string}>>} */
    const byName = new Map(rows.map((r) => [r.name, {}]));
    const record = (owner, target, state) => {
        const artifacts = byName.get(owner);
        if (artifacts && !(target in artifacts)) artifacts[target] = state;
    };
    // Raw on purpose — `prebuild-artifacts` validates the shape and names the
    // package when it is wrong. A reporter must not crash on data a rule is
    // already failing, so a malformed value reads here as "no exemption".
    const deferrals = (row) =>
        row.uncommitted != null && typeof row.uncommitted === 'object' && !Array.isArray(row.uncommitted)
            ? Object.entries(row.uncommitted)
            : [];
    const stateOf = (row, target) => {
        if (row.shipped.some((s) => canonicalPlatform(s) === target)) return { package: row.name, committed: true };
        const deferred = deferrals(row).find(([t]) => canonicalPlatform(t) === target);
        return deferred ? { package: row.name, committed: false, reason: String(deferred[1]) } : null;
    };

    for (const row of rows) {
        const own = [...row.shipped, ...deferrals(row).map(([t]) => t)].map(canonicalPlatform);
        for (const target of new Set(own)) record(row.name, target, stateOf(row, target));
    }
    for (const child of rows) {
        // A row is a bridge's per-target package when the ONE derivation
        // reproduces its name from that bridge's name plus its single declared
        // target — the same test `creditPlatformPackages` applies in the other
        // direction, rather than string-stripping the suffix here.
        const declared = child.declared ?? [];
        if (declared.length !== 1) continue;
        const parent = rows.find(
            (p) => p.name !== child.name && platformPackageName(p.name, declared[0]) === child.name,
        );
        if (!parent) continue;
        const canon = canonicalPlatform(declared[0]);
        const state = stateOf(child, canon);
        if (state) record(parent.name, canon, state);
    }
    return rows.map((row) => ({ ...row, artifacts: byName.get(row.name) ?? {} }));
}

/** Shared by the rule and by `--platforms`, so both see the same rows. */
export async function platformRows(ctx) {
    const nativePkgs = collectNativePackages(ctx);
    const coverage = async (files) =>
        creditPlatformPackages(nativePkgs, await parseCiPlatforms(ctx.root, nativePkgs, files), ctx);
    const ciPlatforms = await coverage(undefined); // the union — every workflow
    const { failures, rows } = auditPlatforms(nativePkgs, ciPlatforms);
    // Two extra single-file passes, deliberately not folded into the union: the
    // union answers "does CI build it", these answer "who SHIPS it" and "is it on
    // its way to being committed", and collapsing three different questions into
    // one map is what let a promise pass for a delivery twice. Each pass is a
    // regex sweep over one already-read workflow file — microseconds, no install.
    const prebuildCi = await coverage(['prebuilds.yml']);
    failures.push(...auditReleaseCoverage(nativePkgs, await coverage(['release.yml']), prebuildCi));
    // A THIRD question over the same map: not "does CI build what is promised" but
    // "can the thing a deferral is waiting for ever arrive". Same pass, so it costs
    // nothing beyond the comparison.
    const arrival = auditGirGapArrival(nativePkgs, prebuildCi, ctx.options?.prebuildGirGaps ?? {});
    failures.push(...arrival.failures);
    // BEFORE the `matrixRows` filter, which is the whole ordering constraint: the
    // artifact state of a split bridge lives on the children the filter removes,
    // so crediting afterwards would find nothing to credit and every declared,
    // CI-targeted cell would render `✓` — see `renderPlatformMatrix`. Reporting
    // only; the failure set above is computed from the uncredited rows.
    const credited = creditPlatformArtifacts(rows);
    return {
        failures,
        rows: credited,
        // The positive half of the arrival check, so a passing run SAYS which
        // deferrals have a leg that will end them rather than only going quiet.
        girArrivalNotes: arrival.notes,
        // How many declared targets ship ONLY from a release job, so the summary
        // states what was checked rather than implying the whole tree was.
        releaseOnly: nativePkgs.reduce((n, pkg) => n + releaseOnlyTargets(pkg).length, 0),
        // The MATRIX answers "can I install this bridge there?" — one row per
        // bridge. 51 single-cell platform-package rows would say nothing the
        // parent's row does not already say and would bury the twelve rows a
        // reader came for, so they are filtered from the report while staying
        // fully in the failure set above.
        matrixRows: credited.filter((r) => {
            const record = ctx.get(r.name);
            return !record || !isPlatformPackageManifest(record.manifest);
        }),
    };
}

export const platformsCiRule = defineRule({
    id: 'platforms-ci',
    scope: 'repo',
    fields: ['gjsify.platforms', 'gjsify.prebuilds', 'gjsify.platformsUncommitted'],
    description:
        'declared `<os>-<arch>` targets, committed prebuild dirs and the CI matrix that builds them agree — and a target this repo commits nothing for is produced by `release.yml`, which is the only job that can ship it',
    async run(ctx) {
        const { failures, rows, matrixRows, releaseOnly, girArrivalNotes } = await platformRows(ctx);
        const unverified = rows.filter((r) => !r.ci).length;
        return {
            failures,
            stats: { packages: rows.length, unverified, releaseOnly, girDeferralsWithLeg: girArrivalNotes.length },
            rows: matrixRows,
            summary: [
                `platform audit: OK. ${rows.length} native package(s) declare \`gjsify.platforms\`; ` +
                    'committed prebuilds and CI-produced targets agree with every declaration' +
                    `${releaseOnly > 0 ? `; ${releaseOnly} target(s) that ship only from a release job have a release.yml leg` : ''}` +
                    `${unverified > 0 ? ` (${unverified} package(s) had no CI job the parser recognised — reported, not enforced)` : ''}.`,
                // Printed, not merely counted: a deferral is acceptable only while
                // something is on its way to ending it, so the run that tolerates
                // one should name the leg that will.
                ...girArrivalNotes.map((n) => `  · ${n}`),
            ].join('\n'),
        };
    },
});
