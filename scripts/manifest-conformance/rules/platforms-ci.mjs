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

/** The OS × package matrix — the honest answer to "where does this run?". */
export function renderPlatformMatrix(rows, { markdown = false } = {}) {
    const all = new Set();
    for (const r of rows) {
        for (const p of r.declared ?? []) all.add(canonicalPlatform(p));
        for (const p of r.shipped) all.add(canonicalPlatform(p));
        for (const p of r.ci ?? []) all.add(canonicalPlatform(p));
    }
    const platforms = [...all].sort();
    const mark = (r, p) => {
        const declared = (r.declared ?? []).some((d) => canonicalPlatform(d) === p);
        const shipped = r.shipped.some((s) => canonicalPlatform(s) === p);
        const built = (r.ci ?? []).some((c) => canonicalPlatform(c) === p);
        // A declared target the package itself records as not-committed is a
        // distinct state from "shipped" — the matrix is the document people
        // read to answer "can I install this there?", and collapsing the two
        // is how "declared" came to look like "delivered" in the first place.
        //
        // Gated on OWNERSHIP, not on `gjsify.prebuilds`. Keying it on the field
        // meant that the moment ADR 0017 moved the directories out of the
        // bridges, every split parent lost its exemption state and fell through
        // to `declared && built` — rendering `✓` "artifact committed" for the
        // seven `darwin-x64` targets and `@gjsify/napi`'s `darwin-arm64`, none
        // of which has an artifact anywhere. This table is rendered into the
        // website's Platform Support page, so that is the documentation lie the
        // cell exists to prevent, reintroduced through the back door. What the
        // field was really standing in for is "is this package under the
        // committed-artifact contract at all" — `@gjsify/node-gi` builds on
        // install and an exemption there means nothing — and that question has
        // a name.
        const exempt =
            prebuildOwnership(r) !== 'install-time' &&
            r.uncommitted != null &&
            typeof r.uncommitted === 'object' &&
            Object.keys(r.uncommitted).some((t) => canonicalPlatform(t) === p);
        if (declared && exempt) return built ? '○' : '!';
        if (declared && built) return '✓';
        if (declared && shipped) return '⚠'; // committed once, nothing rebuilds it
        if (declared) return '!'; // promised, nothing produces it at all
        if (shipped || built) return '?'; // produced, never promised
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

/** Shared by the rule and by `--platforms`, so both see the same rows. */
export async function platformRows(ctx) {
    const nativePkgs = collectNativePackages(ctx);
    const ciPlatforms = creditPlatformPackages(nativePkgs, await parseCiPlatforms(ctx.root, nativePkgs), ctx);
    const { failures, rows } = auditPlatforms(nativePkgs, ciPlatforms);
    return {
        failures,
        rows,
        // The MATRIX answers "can I install this bridge there?" — one row per
        // bridge. 51 single-cell platform-package rows would say nothing the
        // parent's row does not already say and would bury the twelve rows a
        // reader came for, so they are filtered from the report while staying
        // fully in the failure set above.
        matrixRows: rows.filter((r) => {
            const record = ctx.get(r.name);
            return !record || !isPlatformPackageManifest(record.manifest);
        }),
    };
}

export const platformsCiRule = defineRule({
    id: 'platforms-ci',
    scope: 'repo',
    fields: ['gjsify.platforms', 'gjsify.prebuilds'],
    description: 'declared `<os>-<arch>` targets, committed prebuild dirs and the CI matrix that builds them agree',
    async run(ctx) {
        const { failures, rows, matrixRows } = await platformRows(ctx);
        const unverified = rows.filter((r) => !r.ci).length;
        return {
            failures,
            stats: { packages: rows.length, unverified },
            rows: matrixRows,
            summary:
                `platform audit: OK. ${rows.length} native package(s) declare \`gjsify.platforms\`; ` +
                'committed prebuilds and CI-produced targets agree with every declaration' +
                `${unverified > 0 ? ` (${unverified} package(s) had no CI job the parser recognised — reported, not enforced)` : ''}.`,
        };
    },
});
