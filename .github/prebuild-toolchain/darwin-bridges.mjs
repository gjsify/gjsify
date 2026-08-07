#!/usr/bin/env node
/**
 * The darwin prebuild table — ONE source for the four things the macOS job
 * asks about each bridge it builds.
 *
 * WHY THIS FILE EXISTS. `build-prebuilds-macos` verified its output through four
 * steps, each carrying its OWN hand-written package list: the typelib-leaf
 * assertion, `check-prebuild-loader-path.mjs`, the GI load-test heredoc and the
 * env-free `ctypes` dlopen. Four copies of one fact, and they had already
 * drifted — `packages/infra/rolldown-native` was in TWO of them (the load test
 * and the dlopen) and absent from the other TWO. So the bridge whose #832
 * incident is the entire reason the loader-path check exists was the one bridge
 * that check never looked at, and the same for the `.dylib`-leaf assertion. The
 * copies were also silent about it: every list was internally consistent, and
 * nothing compared them to each other or to the job's own build steps.
 *
 * WHY A SCRIPT AND NOT YAML. The obvious alternative is a YAML anchor or a
 * matrix axis, and neither works here. GitHub Actions supports NO YAML anchors
 * (`prebuilds.yml` says so at its `pull_request` trigger, where the two `paths:`
 * lists have to be repeated verbatim for the same reason). A matrix would turn
 * one job into N and multiply the Homebrew closure — the slowest part of the
 * leg — by the number of bridges. And the four uses are genuinely DIFFERENT
 * projections, not one list used four times: a directory to glob for `.gir`, an
 * argument vector for a Node script, a GI namespace + class name to resolve, and
 * an absolute path to a specific library leaf. A table of RECORDS answers all
 * four; a bare list of names answers none of them without three more inline
 * derivations in shell.
 *
 * WHAT IS DERIVED AND WHAT IS AUTHORED. Authored: the bridge's directory, its GI
 * namespace, one class in that namespace whose resolution forces `dlopen`, and
 * whether it links a Rust cdylib sibling. Derived: the Vala library's leaf
 * (`lib<namespace lowercased>` — the meson convention every one of these
 * follows) and every path (`<dir>/prebuilds/<target>/…`). The derivation cannot
 * fail silently: the `rust-libs` query hands its answer straight to a `dlopen`
 * that names the file it could not open.
 *
 * `--check` holds the table against the job itself — every `Collect @gjsify/<x>
 * prebuilds` step in `build-prebuilds-macos` must have a row and every row must
 * have a step — so a bridge promoted into that job cannot arrive unverified, and
 * one removed cannot leave a row behind. Driven by
 * `tests/e2e/prebuild-change-gate`.
 *
 * Usage:
 *   node .github/prebuild-toolchain/darwin-bridges.mjs prebuild-dirs --target darwin-arm64 [--skip <json>]
 *   node .github/prebuild-toolchain/darwin-bridges.mjs load-tests    --target darwin-arm64 [--skip <json>]
 *   node .github/prebuild-toolchain/darwin-bridges.mjs rust-libs     --target darwin-arm64 [--skip <json>]
 *   node .github/prebuild-toolchain/darwin-bridges.mjs --check
 *
 * `--skip` takes the `changes` job's JSON array verbatim (`PREBUILD_SKIP`). It is
 * applied HERE rather than by a `built()` helper in each step — that helper was
 * the fifth copy of the same decision. An unset/empty value selects everything,
 * the same fail-open direction the workflow's `if:` gates take.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'prebuilds.yml');
/** The job whose steps the table must match. */
const JOB = 'build-prebuilds-macos';

/**
 * @typedef {object} DarwinBridge
 * @property {string} dir       repo-relative package directory
 * @property {string} namespace GI namespace the typelib declares
 * @property {string} klass     a class in it — resolving one forces GI to call
 *                              `…_get_type`, which is what dlopens the library.
 *                              A typelib merely FOUND resolves the namespace and
 *                              then throws, so the class is the actual test.
 * @property {boolean} rustSibling whether the Vala library links a cargo cdylib
 *                              (`libgjsify_<x>.dylib`, underscore) it must reach
 *                              through `@loader_path` alone
 * @property {string} [library]  the library leaf, when it is NOT `lib<namespace>`.
 *                              Authored only where the derivation below cannot
 *                              hold — see `webkit-native`.
 */

/** Every bridge `build-prebuilds-macos` builds. Order = the job's step order. */
export const DARWIN_BRIDGES = /** @type {DarwinBridge[]} */ ([
    { dir: 'packages/infra/lightningcss-native', namespace: 'GjsifyLightningcss', klass: 'Engine', rustSibling: true },
    { dir: 'packages/infra/oxfmt-native', namespace: 'GjsifyOxfmt', klass: 'Formatter', rustSibling: true },
    { dir: 'packages/infra/rolldown-native', namespace: 'GjsifyRolldown', klass: 'Bundler', rustSibling: true },
    { dir: 'packages/node/terminal-native', namespace: 'GjsifyTerminal', klass: 'Terminal', rustSibling: false },
    { dir: 'packages/node/tls-native', namespace: 'GjsifyTls', klass: 'Tls', rustSibling: false },
    { dir: 'packages/node/http-soup-bridge', namespace: 'GjsifyHttpSoupBridge', klass: 'Server', rustSibling: false },
    { dir: 'packages/node/http2-native', namespace: 'GjsifyHttp2', klass: 'SessionBridge', rustSibling: false },
    { dir: 'packages/framework/webgl', namespace: 'Gwebgl', klass: 'WebGLRenderingContext', rustSibling: false },
    // The ONE row whose library leaf is authored, and the reason the field
    // exists. ADR 0022 makes GIR namespace and symbol prefix deliberately
    // different here — the typelib answers to `WebKit` 6.0 (so `@gjsify/iframe`
    // needs no OS branch) while the C symbols and the library stay
    // `gjsify_webkit` / `libgjsifywebkit`. The derivation would say
    // `libwebkit.dylib`, which is not this artifact and IS the name of the real
    // WebKitGTK. It has no Rust sibling, so nothing consumes the leaf today; it
    // is declared anyway because the first consumer that appears would otherwise
    // dlopen the wrong file, and "wrong library, plausible name" is the worst
    // shape of that bug.
    {
        dir: 'packages/framework/webkit-native',
        namespace: 'WebKit',
        klass: 'WebView',
        rustSibling: false,
        library: 'libgjsifywebkit.dylib',
    },
]);

/**
 * The Vala library's leaf for a namespace, per the meson convention every bridge
 * here follows (`GjsifyOxfmt` → `libgjsifyoxfmt`). DERIVED rather than authored
 * so a second spelling of the same fact cannot drift from the first — and safe
 * to derive because its only consumer dlopens the result by absolute path and
 * reports the name it could not open.
 *
 * @param {string} namespace
 * @param {string} ext including the dot
 */
export function valaLibraryLeaf(namespace, ext = '.dylib') {
    return `lib${namespace.toLowerCase()}${ext}`;
}

/**
 * The library leaf for a bridge: authored if the row says so, derived otherwise.
 * One function so no caller has to remember the override exists.
 *
 * @param {DarwinBridge} bridge
 */
export function libraryLeaf(bridge) {
    return bridge.library ?? valaLibraryLeaf(bridge.namespace);
}

/**
 * Drop the bridges this run did not build.
 *
 * Keyed on the directory BASENAME, the key `changed-packages.mjs` emits, and
 * matched with the quotes included so `"http2-native"` cannot be found inside a
 * longer key. Filtering is not cosmetic: a skipped package's committed
 * `prebuilds/<target>/` is present in the checkout, so an unfiltered loop would
 * load-test a binary this run did not build and report it as this run's coverage.
 *
 * @param {readonly DarwinBridge[]} bridges
 * @param {string | undefined} skipJson `PREBUILD_SKIP`, verbatim
 */
export function selectBuilt(bridges, skipJson) {
    const raw = (skipJson ?? '').trim();
    if (raw === '') return [...bridges];
    return bridges.filter((b) => !raw.includes(`"${basename(b.dir)}"`));
}

/**
 * The `Collect @gjsify/<x> prebuilds` steps of the macOS job, as package dirs.
 *
 * A structural read of the workflow, matching how `changed-packages.mjs` and the
 * `platforms-ci` rule read the same file. Deliberately keyed on the COLLECT step
 * rather than the build step: collecting is what produces the directory these
 * four checks then open.
 *
 * @param {string} text workflow YAML
 * @returns {string[]} repo-relative package dirs, in step order
 */
export function collectedDirsInMacosJob(text) {
    // Split `jobs:` into 2-space-indented job blocks and take ours.
    const jobs = text.slice(text.search(/^jobs:\s*$/m)).split(/^ {2}(?=[a-z0-9-]+:\s*$)/m);
    const job = jobs.find((j) => j.startsWith(`${JOB}:`));
    if (!job) throw new Error(`no \`${JOB}:\` job in ${WORKFLOW} — this parser no longer understands its shape`);
    const dirs = [];
    for (const step of job.split(/^ {6}- (?=name:|uses:|run:)/m).slice(1)) {
        if (!/^name:\s*Collect @gjsify\//m.test(step)) continue;
        const wd = /^\s*working-directory:\s*(\S+)\s*$/m.exec(step);
        if (!wd) throw new Error(`a Collect step in \`${JOB}\` has no working-directory:\n${step.slice(0, 160)}`);
        dirs.push(wd[1]);
    }
    return dirs;
}

/**
 * Table vs job, both directions.
 *
 * @param {readonly DarwinBridge[]} bridges
 * @param {readonly string[]} collected
 * @returns {string[]} problems (empty = ok)
 */
export function checkTable(bridges, collected) {
    const problems = [];
    const rows = new Set(bridges.map((b) => b.dir));
    const steps = new Set(collected);
    if (collected.length === 0) {
        problems.push(
            `no \`Collect @gjsify/… prebuilds\` step found in \`${JOB}\` — refusing to report a table that matches nothing.`,
        );
    }
    for (const dir of steps) {
        if (!rows.has(dir)) {
            problems.push(
                `${dir}: built by \`${JOB}\` but has NO row in DARWIN_BRIDGES, so none of the four verify steps ` +
                    'covers it — a prebuild committed to main without its typelib leaf, loader path, GI load or ' +
                    'env-free dlopen ever being checked. Add a row (dir, namespace, klass, rustSibling).',
            );
        }
    }
    for (const dir of rows) {
        if (!steps.has(dir)) {
            problems.push(
                `${dir}: has a row in DARWIN_BRIDGES but \`${JOB}\` no longer collects it — the verify steps would ` +
                    'open a directory this job does not produce. Delete the row.',
            );
        }
    }
    for (const b of bridges) {
        if (!existsSync(join(ROOT, b.dir, 'package.json'))) {
            problems.push(`${b.dir}: no package.json — the table names a directory that is not a package.`);
        }
    }
    return problems;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main() {
    const argv = process.argv.slice(2);
    const flag = (name) => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const query = argv.find((a) => !a.startsWith('--') && a !== flag('target') && a !== flag('skip'));

    if (argv.includes('--check')) {
        const problems = checkTable(DARWIN_BRIDGES, collectedDirsInMacosJob(readFileSync(WORKFLOW, 'utf8')));
        for (const p of problems) console.error(`::error::${p}`);
        // `return process.exit(…)`, never a bare call: under GJS the exit is
        // SCHEDULED, so the statements after it still run and the code can be lost
        // (`gjsify/deferred-process-exit`). `main()` returns void, so returning the
        // exit is the sanctioned repair.
        if (problems.length > 0) return process.exit(1);
        console.log(`darwin-bridges: table matches \`${JOB}\` — ${DARWIN_BRIDGES.length} bridge(s).`);
        return;
    }

    const target = flag('target');
    if (!target) {
        console.error('[darwin-bridges] --target <os>-<arch> is required for a path-shaped query.');
        return process.exit(2);
    }
    const built = selectBuilt(DARWIN_BRIDGES, flag('skip'));
    // What was filtered out, on STDERR so it lands in the step log without
    // entering the loop the caller feeds from stdout. The per-bridge "not built by
    // this run, not verified" line each step used to print came from its own
    // `built()` helper; moving the filter here must not silently drop it, or a
    // reader of one step can no longer tell a skipped bridge from a missing row.
    const skipped = DARWIN_BRIDGES.filter((b) => !built.includes(b)).map((b) => basename(b.dir));
    if (skipped.length > 0) {
        console.error(`[darwin-bridges] not built by this run, not verified: ${skipped.join(', ')}`);
    }
    const dirOf = (b) => `${b.dir}/prebuilds/${target}`;

    switch (query) {
        case 'prebuild-dirs':
            for (const b of built) console.log(dirOf(b));
            return;
        case 'load-tests':
            // `dir|namespace|class` — read by a `while IFS='|' read` loop, the
            // shape the heredocs it replaces already used.
            for (const b of built) console.log(`${b.dir}|${b.namespace}|${b.klass}`);
            return;
        case 'rust-libs':
            // `dir|<path to the VALA library>` — dlopening the Vala half is what
            // exercises the `@loader_path` hop to its cdylib sibling. Bridges
            // without a sibling are absent: there is no hop to prove, and a pass
            // would claim coverage the artifact does not need.
            for (const b of built) {
                if (b.rustSibling) console.log(`${b.dir}|${dirOf(b)}/${libraryLeaf(b)}`);
            }
            return;
        default:
            console.error(
                `[darwin-bridges] unknown query \`${query ?? '(none)'}\` — expected prebuild-dirs | load-tests | rust-libs | --check.`,
            );
            process.exit(2);
    }
}

// Only when invoked directly, so the pure helpers stay importable from a test.
if (process.argv[1] && resolve(process.argv[1]).endsWith('darwin-bridges.mjs')) main();
