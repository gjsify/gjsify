/**
 * Rule `platforms-ci` — REPO-SCOPED half of the OS axis: the `<os>-<arch>` targets
 * `gjsify.platforms` PROMISES, the committed prebuild directories and the CI matrix
 * that builds them must not drift apart. Why the axis exists at all, and why
 * `gjsify.runtimes` cannot answer for it: AGENTS.md § Runtime & platform model.
 *
 * Split from the portable `prebuild-artifacts` rule because declared-vs-committed is
 * a fact about files, while THIS half parses `.github/workflows/prebuilds.yml`'s
 * matrix by filename with a parser tuned to this repo's job shapes. Nothing to port:
 * a consumer's CI is not this one, and pretending to audit it would invent platform
 * support that does not exist.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    canonicalPlatform,
    canonicalPrebuildTarget,
    collectNativePackages,
    defineRule,
    hostPrebuildTarget,
    isPlatformPackageManifest,
    KNOWN_ARCH_TOKENS,
    parsePrebuildTarget,
    platformPackageName,
    prebuildOwnership,
    PLATFORM_RE,
} from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/**
 * The `libc:` values a matrix entry may carry — the LIBC AXIS of the target
 * grammar, which is orthogonal to `<os>-<arch>` and does not live in
 * `gjsify.platforms` at all (the distinction rides npm's `libc` field, measured
 * from the ELF by `generate-platform-packages.mjs`).
 *
 * A closed vocabulary, because the failure mode of an open one is silent: an
 * entry reading `libc: gnu` or `libc: mulsl` would compose the BARE
 * `<os>-<arch>` token and hand the job a platform promise it does not build,
 * which is a green audit measuring the wrong leg. Both members earn their place:
 * `musl` composes a libc-carrying token that is dropped from the promise map
 * below, `glibc` composes the bare one and IS a promise — so the key means the
 * same thing in both directions rather than "present ⇒ ignore me".
 */
const KNOWN_MATRIX_LIBC = new Set(['glibc', 'musl']);

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
 * The table above is keyed only by OS, which mis-attributes every macOS runner that
 * is not Apple silicon: `macos-15-intel` reads as `darwin-arm64`, so an Intel job is
 * credited with the arm64 target and declared-vs-built still agrees while describing
 * the wrong artifact — invisible by construction, nothing goes red.
 *
 * Label order matters: two spellings differ by one character and mean opposite
 * architectures — `-xlarge` is Apple silicon, `-large` is Intel.
 *   arm64 — `macos-14`, `macos-15`, `macos-latest`, `*-xlarge`, `ubuntu-24.04-arm`
 *   x64   — `macos-15-intel`, `macos-26-intel`, `*-large`
 * `macos-15-intel` is the last x86_64 image Actions will offer (until August 2027),
 * so a `darwin-x64` promise has a horizon.
 */
export function archFromRunner(runsOn, os = osFromRunner(runsOn)) {
    if (/-xlarge\b/.test(runsOn)) return 'arm64';
    if (/-arm\b|-arm64\b/.test(runsOn)) return 'arm64';
    if (/-intel\b|-large\b/.test(runsOn)) return 'x64';
    return RUNNER_DEFAULT_ARCH[os];
}

/**
 * The `strategy.matrix.include` entries of one job, as `{arch?, runner?, libc?, …}` records.
 *
 * `runs-on` is read literally, so `runs-on: ${{ matrix.runner }}` tells
 * `osFromRunner` nothing and falls through to `linux` — right for the Linux legs BY
 * ACCIDENT, wrong for any macOS or Windows matrix. Hence the OS-per-leg comes from
 * the include entries, not from the expression.
 *
 * Entry N's arch belongs to entry N's runner: two flat sets would produce the CROSS
 * product and invent targets no job builds, the moment a matrix mixes OSes.
 *
 * Lightweight structural read, like the rest of this file — no YAML dependency in a
 * script that must run with NO install: find `matrix:`, treat everything
 * more-indented as its block, start an entry at each `- key: value`, attach the
 * sibling `key: value` lines to it.
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
 * Which `<os>-<arch>` targets CI actually produces, per package name. Split `jobs:`
 * into its 2-space-indented blocks, take each job's `runs-on` (→ OS) and `arch:`
 * matrix entries (→ arch), attribute those targets to the packages the job PRODUCES
 * an artifact for.
 *
 * "Produces" is narrow: the package name must appear in a step that also carries a
 * production verb (build / collect / stage / prebuild / upload), and comment lines
 * are dropped outright. The workflows are full of explanatory comments naming
 * packages they merely depend on, and crediting those manufactures platform support
 * that does not exist.
 *
 * Jobs gated on `github.event_name == 'workflow_dispatch'` are EXCLUDED: a
 * manually-dispatched exploratory job (today: napi's blocked Windows attempt and
 * `build-prebuilds-macos-experimental`) is not a platform CI produces, and counting it
 * lets a package declare a target no user will ever receive.
 *
 * A LIBC-CARRYING target is excluded too, and for a different reason: it is not a
 * `gjsify.platforms` promise in the first place. `prebuilds.yml`'s Alpine leg marks its
 * matrix entries `libc: musl`, composes `linux-<arch>-musl`, and contributes nothing
 * here — it proves that the SOURCES build and load on musl, which is what keeps the
 * npm `libc` policy honest, without promising anybody a musl binary. That exclusion is
 * what let the leg stop being `workflow_dispatch`-only: without the key it would be
 * credited with `linux-x64`/`linux-arm64`, the targets the glibc legs build, and the
 * audit would pass having measured the wrong job. An unrecognised `libc:` value, or the
 * right one on a non-Linux entry, THROWS rather than folding down to a bare token.
 *
 * ADVISORY — a package the parser finds no job for is reported as unverified rather
 * than failed, so a build wired up in a shape this parser cannot read never produces
 * a false CI failure.
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
            // Only tokens that NAME a CPU count: `arch:` is a matrix key here but
            // also a common ACTION INPUT, and `uraimo/run-on-arch-action`'s
            // documented value alongside a custom `base_image` is the literal
            // `none`. Unfiltered, any such value becomes the phantom target
            // `linux-none` and fails declared-vs-built for every package the job
            // builds.
            if (arch && KNOWN_ARCH_TOKENS.has(arch[1])) current.archs.add(arch[1]);
            if (/^\s*if:\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(line)) current.manualOnly = true;
        }
        for (const job of jobs) {
            if (job.manualOnly) continue;
            const os = osFromRunner(job.runsOn);
            // Prefer the matrix's own (arch, runner) PAIRS: they carry a per-leg
            // OS, which `runs-on: ${{ matrix.runner }}` cannot. Entries naming no
            // runner fall back to the job's literal `runs-on` (the QEMU legs'
            // shape); a job with no matrix keeps the single-target path.
            const includes = parseMatrixIncludes(job.body).filter((e) => e.arch || e.runner);
            const targets = new Set();
            if (includes.length > 0) {
                for (const entry of includes) {
                    const runsOn = entry.runner ?? job.runsOn;
                    const entryOs = entry.runner ? osFromRunner(entry.runner) : os;
                    const arch =
                        entry.arch && KNOWN_ARCH_TOKENS.has(entry.arch) ? entry.arch : archFromRunner(runsOn, entryOs);
                    // The LIBC AXIS. An entry with no `libc:` is glibc by
                    // omission, which is what every leg but the Alpine one is.
                    if (entry.libc !== undefined && !KNOWN_MATRIX_LIBC.has(entry.libc)) {
                        throw new TypeError(
                            `${file}: job \`${job.job}\` has a matrix entry with \`libc: ${entry.libc}\`, which is not ` +
                                `one of ${[...KNOWN_MATRIX_LIBC].join(', ')}. Refusing to guess: an unrecognised value ` +
                                'would compose the bare `<os>-<arch>` token and credit this job with a platform it does ' +
                                'not build, so the audit would pass having measured the wrong leg.',
                        );
                    }
                    // Same refusal for the right value on the wrong OS.
                    // `hostPrebuildTarget` honours `-musl` on linux ONLY (npm's
                    // `libc` field is documented Linux-only), so a `libc: musl`
                    // entry on a macOS or Windows runner would come back as the
                    // BARE token — i.e. as a promise — and half-honouring the key
                    // is exactly the silence the closed vocabulary above exists
                    // to prevent.
                    if (entry.libc === 'musl' && entryOs !== 'linux') {
                        throw new TypeError(
                            `${file}: job \`${job.job}\` declares \`libc: musl\` on a ${entryOs} matrix entry ` +
                                `(runner \`${runsOn}\`). The libc axis is Linux-only, so this token cannot be composed ` +
                                'and the entry would silently be read as an ordinary platform promise.',
                        );
                    }
                    // `canonicalPrebuildTarget`, NOT `canonicalPlatform`: the
                    // latter is libc-BLIND by design (it splits on `-` and keeps
                    // two parts), so it folds `linux-x64-musl` straight back down
                    // to `linux-x64` — which is the very silent credit this key
                    // exists to prevent, arriving through the canonicaliser
                    // instead of through the missing key. Measured: with
                    // `canonicalPlatform` here the musl fixture below credits
                    // `linux-x64` and passes as if the axis did not exist.
                    targets.add(canonicalPrebuildTarget(hostPrebuildTarget(entryOs, arch, entry.libc ?? 'glibc')));
                }
            } else {
                // The libc key is read ONLY from `matrix.include` entries above.
                // A job that carries one in any other shape (a list-form
                // `matrix.libc:`, a job-level `env:`) would have it silently
                // ignored here and be credited with the BARE token — the same
                // wrong credit the key exists to prevent, arriving through a
                // matrix shape instead of through a deleted line. This branch
                // therefore refuses rather than composing, for the reason the
                // vocabulary above is closed: a libc key that is load-bearing in
                // one code path and inert in another is worse than no key.
                const stray = job.body.find((line) => /^\s*libc:\s*\S/.test(line));
                if (stray !== undefined) {
                    throw new TypeError(
                        `${file}: job \`${job.job}\` carries \`${stray.trim()}\` outside a ` +
                            '`matrix.include` entry, where the libc axis is not read. Move it onto the include ' +
                            'entries: read from anywhere else it would be ignored and the job credited with the ' +
                            'bare `<os>-<arch>` token, which is the silent fold the key exists to prevent.',
                    );
                }
                const archs = job.archs.size > 0 ? [...job.archs] : [archFromRunner(job.runsOn, os)];
                for (const arch of archs) targets.add(canonicalPlatform(`${os}-${arch}`));
            }
            // A libc-carrying target is NOT a `gjsify.platforms` promise, so it
            // must not reach the map declared-vs-built is computed from. The
            // vocabulary is `<os>-<arch>` and the libc distinction rides npm's
            // own field; a musl leg therefore proves that the SOURCES build and
            // load on musl without promising anyone a musl binary.
            //
            // Dropped here rather than at the composition above so the throw
            // guarding the vocabulary still sees every value, and so the reason
            // sits with the invariant it protects.
            // Deleting the current entry mid-iteration is defined for a Set (the
            // iterator skips removed entries), so no copy is needed.
            for (const target of targets) {
                if (parsePrebuildTarget(target).libc) targets.delete(target);
            }
            // Attribute nothing when every target was dropped. Adding an EMPTY
            // set would be worse than adding none: `auditPlatforms` treats the
            // presence of a set as "the parser found jobs for this package" and
            // then fails every declared target as unbuilt. Today the glibc legs
            // are parsed first so the set is already populated, which makes this
            // a correctness property that would otherwise depend on job ORDER in
            // the file.
            if (targets.size === 0) continue;
            // This map means exactly "which targets does CI BUILD", so a job that
            // only CONSUMES another job's artifacts must contribute nothing. The
            // per-step verb test cannot see that alone: `commit-prebuilds`' steps
            // are named "Download <pkg> <arch> prebuilds" and `publish-napi`'s
            // "Confirm both prebuilds are STAGED" — production verbs in plain
            // `ubuntu-latest` jobs with no arch matrix, so every package they
            // mention got credited with `linux-x64` and failed the rule in BOTH
            // directions at once.
            //
            // The test is downloads-AND-uploads-nothing, not downloads: `@gjsify/webgl`'s
            // win32 artifact is built by a PAIR because valac cannot run on Windows,
            // and the Windows half downloads the Linux half's generated C before
            // compiling it. A job-level `downloads → skip` would credit that leg with
            // nothing and read as "declares win32-x64 but no CI job produces it".
            //
            // Keyed on the ACTIONS, never on a job-name pattern: a list of job names
            // is a second copy of the workflow that drifts from it. The per-step
            // exclusion below carries the rest of the precision — a download step's
            // `path:` is a DESTINATION, never something the job built.
            const bodyText = job.body.join('\n');
            const downloads = /uses:\s*actions\/download-artifact/.test(bodyText);
            const uploads = /uses:\s*actions\/upload-artifact/.test(bodyText);
            if (downloads && !uploads) continue;
            // Attribute per STEP, not per line: a step's package identity and
            // its production verb usually sit on different lines (`- name:
            // Build native addon` + `working-directory: packages/…`).
            for (const step of splitSteps(job.body)) {
                if (/uses:\s*actions\/download-artifact/.test(step)) continue;
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
 * A ledger — the caller-injected `prebuildGirGaps` map, with no producer in this
 * tree since the module that fed it drained to zero and was deleted, so this
 * function is armed and unfed rather than live — excuses a committed
 * directory holding no `.gir` on one promise: "the next `prebuilds.yml`
 * run that rebuilds this target lands the file". Two ways for that to be false, and
 * the ledger sees neither. That the build STOPS EMITTING the `.gir` is caught at the
 * moment of truth by `scripts/stage-prebuild.mjs`, which refuses to stage a
 * `.typelib` with no `.gir` beside it. That NOTHING EVER REBUILDS THE TARGET is this
 * function: such a deferral can never clear, so the entry keeps passing, the audit
 * keeps printing its reason, and a gap the tree calls transient is permanent with
 * nothing saying so — the failure class the ledger replaced, one level up.
 *
 * So a deferral must name a package `prebuilds.yml` BUILDS, for the target whose
 * directory is short a file — checkable from the workflow this file already parses,
 * hence repo-scoped rather than in portable `prebuild-artifacts`.
 *
 * ADVISORY WHEN THE PARSER IS BLIND: an empty coverage map means the workflow shape
 * was unreadable, not that the ledger is wrong, and turning a parser gap into a red
 * `main` for every open PR is the incident this gate exists to stop. A map that
 * credits OTHER packages and not this one is a real answer.
 *
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
        // An entry naming a package this tree does not audit already fails in
        // `prebuild-artifacts`; reporting it twice from a rule that would have to
        // guess what was meant is noise.
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

        // A committed artifact nobody declared: either the declaration or the
        // artifact is stale, and a consumer resolving `prebuilds/<p>/` finds
        // something the package does not promise to keep working.
        for (const shipped of pkg.shipped) {
            if (!declaredCanon.has(canonicalPlatform(shipped))) {
                failures.push(
                    `${pkg.name} (${pkg.path}): ships \`prebuilds/${shipped}/\` but does not declare it in \`gjsify.platforms\` (${pkg.declared.join(', ')}).`,
                );
            }
        }

        // BOTH directions, so whoever changes one is forced to change the other:
        //   declared ⊄ CI  → a platform users are promised but never receive
        //   CI ⊄ declared  → a platform CI pays to build that nothing claims
        // Only when the parser found CI jobs for this package — see parseCiPlatforms.
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
            // Committed binaries no workflow reproduces: built by hand once, and
            // nothing rebuilds them when the Vala/Rust changes or proves they still
            // match.
            failures.push(
                `${pkg.name} (${pkg.path}): ships prebuilds (${pkg.shipped.join(', ')}) but no CI job produces any of them — a hand-built binary nothing reproduces. Wire it into .github/workflows/prebuilds.yml.`,
            );
        }
    }
    return { failures, rows };
}

// "a CI job targets it", not "a green build exists": this is parsed out of the
// workflow YAML, which knows nothing about run results, so saying "built" would
// claim more than the data supports.
const LEGEND_PARTS = [
    '✓ declared, a CI job targets it, artifact committed',
    '○ declared, a CI job targets it, artifact NOT committed here',
    '⚠ committed artifact, no CI job targets it',
    '! declared, no CI job targets it',
    '? produced, undeclared',
    '· unsupported',
];

/**
 * The OS × package matrix as DATA — the columns, the legend, and one mark per cell.
 *
 * Split out of {@link renderPlatformMatrix} when the website stopped hand-copying the
 * rendered table into `platform-support.mdx`: that copy drifted twice unseen, and by
 * the time it was measured it showed `@gjsify/webgl` as UNSUPPORTED on win32 — the
 * one cell a Windows reader is there to check — and had lost a whole package row.
 * Two renderings of one mark rule; never two mark rules.
 *
 * Takes rows that have been through {@link creditPlatformArtifacts} and REFUSES
 * anything else: every glyph but `·` turns on where the artifact for a cell is, and
 * since ADR 0017 that fact lives on a package this table has no row for. A renderer
 * reading it off the bridge alone cannot fail — it quietly answers a different
 * question, which this signature exists to make unrepeatable.
 */
export function platformMatrixData(rows) {
    const uncredited = rows.filter((r) => r.artifacts == null || typeof r.artifacts !== 'object');
    if (uncredited.length > 0) {
        throw new TypeError(
            `platformMatrixData: ${uncredited.length} row(s) carry no \`artifacts\` map (first: ${uncredited[0].name}). ` +
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
        // "Is there a committed artifact for this cell ANYWHERE in this repo", asked
        // of the credit map rather than of this row's own `prebuilds/`. A declared
        // target with no committed artifact is a DISTINCT state from one with: this
        // table is rendered into the website's Platform Support page, where readers
        // answer "can I install this there?", and collapsing the two is how
        // "declared" came to look like "delivered".
        //
        // Reading `r.shipped`/`r.uncommitted` off the row cannot work: ADR 0017 moved
        // that state onto the per-target CHILD packages, which `matrixRows` filters
        // out, so on a bridge row `shipped` is always `[]` — the `○` and `⚠` branches
        // go unreachable and every CI-built declared target renders `✓`.
        const artifact = r.artifacts[p];
        if (declared && artifact?.committed === true) return built ? '✓' : '⚠'; // ⚠ committed, nothing rebuilds it
        if (declared && built) return '○'; // built, but no artifact committed here
        if (declared) return '!'; // promised, nothing produces it at all
        if (artifact?.committed === true || built) return '?'; // produced, never promised
        return '·';
    };
    return {
        platforms,
        legend: LEGEND_PARTS,
        rows: rows.map((r) => ({
            name: String(r.name),
            tier: r.tier ?? null,
            cells: Object.fromEntries(platforms.map((p) => [p, mark(r, p)])),
        })),
    };
}

/**
 * The OS × package matrix, rendered for a terminal or for markdown.
 *
 * The marks themselves come from {@link platformMatrixData} — this function only
 * lays them out.
 */
export function renderPlatformMatrix(rows, { markdown = false } = {}) {
    const { platforms, legend, rows: data } = platformMatrixData(rows);
    const cells = (r) => platforms.map((p) => r.cells[p]);
    if (markdown) {
        const lines = [
            `| package | tier | ${platforms.join(' | ')} |`,
            `|---|---|${platforms.map(() => '---').join('|')}|`,
        ];
        for (const r of data) {
            lines.push(`| \`${r.name}\` | ${r.tier ?? '—'} | ${cells(r).join(' | ')} |`);
        }
        lines.push('');
        lines.push(legend.map((l) => `\`${l.slice(0, 1)}\`${l.slice(1)}`).join(' · '));
        return lines.join('\n');
    }
    const nameWidth = Math.max(...data.map((r) => r.name.length), 'package'.length);
    const head = `${'package'.padEnd(nameWidth)} │ ${platforms.map((p) => p.padEnd(14)).join(' │ ')}`;
    const sep = `${'─'.repeat(nameWidth)}─┼─${platforms.map(() => '─'.repeat(14)).join('─┼─')}`;
    const body = data.map(
        (r) =>
            `${r.name.padEnd(nameWidth)} │ ${cells(r)
                .map((m) => m.padEnd(14))
                .join(' │ ')}`,
    );
    return [head, sep, ...body, '', legend.join('   ')].join('\n');
}

/**
 * The declared targets whose artifact this repository never commits, so the only way
 * one reaches a consumer is inside the tarball a `release.yml` job stages.
 *
 * `auditPlatforms` compares a declaration against the UNION of every workflow, which
 * answers "does CI build this?" and says nothing about who SHIPS it. For a package
 * whose binary is committed here that is the whole story (the normal `publish` job
 * packs the checked-out directory); for one that commits nothing it is half, and the
 * missing half is where both node-gi platform gaps came from — `win32-x64`/`darwin-arm64`
 * in 0.26.0 and `darwin-x64` right after #921 added it. Each time the union was green
 * because `node-gi.yml` genuinely builds the target, and each time the published
 * tarball had no such binary in it.
 *
 * The three `prebuildOwnership` states answer this exactly:
 *   · `install-time` — nothing committed here for ANY target, so every declared one
 *     needs a release leg. Today `@gjsify/node-gi`.
 *   · `committed-here` — committed directories ship themselves; only targets the
 *     package records as NOT committed (`gjsify.platformsUncommitted`) need one.
 *   · `split` — SKIPPED: the parent holds the declaration but owns no artifact, and
 *     each per-target child is its own row answering for its own target.
 *
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
 * WHY `prebuildsCi` IS SUBTRACTED rather than ignored: a target `prebuilds.yml`
 * builds is on its way to being COMMITTED — `commit-prebuilds` lands the directory and
 * `clear-committed-platform-exemptions.mjs` deletes the exemption in the same commit.
 * That is the TEMPORARY half of the exemption contract (§ Runtime & platform model)
 * and the NORMAL state of a newly-added target: between "the leg is green" and "the
 * artifact is committed" the package legitimately declares a target with no artifact
 * and no release leg. Without the subtraction the rule demands a release leg that must
 * not exist, and the next exotic-arch addition has to route around the check to land.
 *
 * ADVISORY-SAFE like `auditPlatforms`, in the other direction: for these packages "no
 * release leg" IS the defect, so an unrecognised leg reads as absent — the failing
 * direction — and the message names the parser.
 *
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
 * A platform package is a re-tarballing of one directory the parent's build produced;
 * no workflow mentions it by name, and nothing should — the job that produces the
 * binary is the parent's, identified by the parent's name and path. Without this,
 * every one of them reaches this rule's last branch ("ships prebuilds but no CI job
 * produces any of them — a hand-built binary nothing reproduces"), exactly backwards
 * for the most reproducible artifact in the tree.
 *
 * NARROWED, not inherited wholesale: the rule checks CI coverage in both directions,
 * and an unnarrowed set would report `@gjsify/webgl-linux-x64` as building targets it
 * does not declare. That makes the child's own ci-vs-declared check vacuous by
 * design — the child's declaration is GENERATED from the parent's list and audited
 * against it by the `platform-packages` rule, while the parent keeps the full
 * both-directions contract against the workflow matrix.
 *
 * @param {Map<string, Set<string>>} byPackage from {@link parseCiPlatforms}
 */
export function creditPlatformPackages(nativePkgs, byPackage, ctx) {
    for (const pkg of nativePkgs) {
        const record = ctx.get(pkg.name);
        if (!record || !isPlatformPackageManifest(record.manifest)) continue;
        if (byPackage.has(pkg.name)) continue; // a workflow named it explicitly — take it at its word
        const target = record.manifest.gjsify.platforms[0];
        // Find the bridge by the ONE naming derivation rather than string-stripping
        // the suffix here: the parent is whichever native package the derivation
        // reproduces this name from.
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
 * MIRROR IMAGE of `creditPlatformPackages`, along the same naming derivation and for
 * the same reason: ADR 0017 records a fact about a bridge's binaries on a DIFFERENT
 * package than the one a reader asks about. That function moves CI coverage DOWN to
 * the children; this one moves ARTIFACT state UP to the bridge, because the matrix has
 * one row per bridge and none for its children.
 *
 * NOT folded into `collectNativePackages()`: that row feeds the FAILURE set
 * (`prebuild-artifacts` holds each tarball to the directories IT contains,
 * `releaseOnlyTargets` asks what THIS package commits), and a row whose `shipped`
 * silently included a sibling's directories would make both ask the wrong question.
 * The credit is additive and derived, so it lives in its own field, on a copy, at the
 * point of RENDERING.
 *
 * A record per target rather than a flat set of tokens, because the bridge does not
 * contain the artifact: `package` names the tarball the binary is really in, which is
 * what a reader needs in order to check it.
 *
 * OWN state wins over a child's — a bridge still naming its own `gjsify.prebuilds` is
 * legal (none today) and then IS the owner; picking the child would make the state
 * depend on row order.
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
    // Raw on purpose: `prebuild-artifacts` validates the shape and names the package
    // when it is wrong, and a reporter must not crash on data a rule is already
    // failing — so a malformed value reads here as "no exemption".
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
        // A row is a bridge's per-target package when the ONE derivation reproduces
        // its name from that bridge's name plus its single declared target — the same
        // test `creditPlatformPackages` applies in the other direction.
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
    // Two extra single-file passes, not folded into the union: the union answers "does
    // CI build it", these answer "who SHIPS it" and "is it on its way to being
    // committed", and collapsing the three into one map is what let a promise pass for
    // a delivery twice. Each is a regex sweep over an already-read file.
    const prebuildCi = await coverage(['prebuilds.yml']);
    failures.push(...auditReleaseCoverage(nativePkgs, await coverage(['release.yml']), prebuildCi));
    // A third question over the same map: can the thing a deferral waits for arrive.
    const arrival = auditGirGapArrival(nativePkgs, prebuildCi, ctx.options?.prebuildGirGaps ?? {});
    failures.push(...arrival.failures);
    // BEFORE the `matrixRows` filter — the ordering constraint: a split bridge's
    // artifact state lives on the children the filter removes, so crediting afterwards
    // finds nothing and every declared, CI-targeted cell renders `✓` (see
    // `renderPlatformMatrix`). Reporting only; failures come from the uncredited rows.
    const credited = creditPlatformArtifacts(rows);
    return {
        failures,
        rows: credited,
        // The positive half of the arrival check, so a passing run SAYS which
        // deferrals have a leg that will end them rather than only going quiet.
        girArrivalNotes: arrival.notes,
        // How many declared targets ship ONLY from a release job, so the summary states
        // what was checked rather than implying the whole tree was.
        releaseOnly: nativePkgs.reduce((n, pkg) => n + releaseOnlyTargets(pkg).length, 0),
        // The MATRIX answers "can I install this bridge there?" — one row per bridge.
        // The single-cell platform-package rows say nothing the parent's row does not
        // and would bury the handful a reader came for, so they are filtered from the
        // report while staying fully in the failure set above.
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
                // something is on its way to ending it, so name the leg that will.
                ...girArrivalNotes.map((n) => `  · ${n}`),
            ].join('\n'),
        };
    },
});
