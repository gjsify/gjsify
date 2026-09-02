/**
 * Rule `reverse-bridge-leg` — a package whose ONLY route to Node is the `gi://` reverse
 * bridge, and which declares `gjsify.runtimes.node: "polyfill"`, must run a Node suite
 * that CI actually reaches.
 *
 * WHY THIS EXISTS. Twice a GJS-bound package carried a `node` slot that did not describe
 * it, and both times the DECLARATION, not the code, was what pinned it to GJS:
 * `@gjsify/gtk-host` ([ADR 0027](../../../docs/adr/0027-gtk-host-layer.md)) and
 * `@gjsify/iframe` ([ADR 0022](../../../docs/adr/0022-webkit-on-darwin.md) § *Amendment —
 * the `node` slot*). The audit cannot catch either, and that is by construction:
 * `diffDeclared`'s `giUrlReachesNodeBridge` tolerance exists BECAUSE `--app node` claims a
 * `gi://` specifier and routes it to `@gjsify/node-gi`, so `none` and `polyfill` are each
 * defensible from the source alone. Only a RUN decides — ADR 0030 § Decision 6.
 *
 * THE DIRECTION IS DELIBERATE; the opposite one was written first and measured WRONG.
 * "A package whose `test:gjs-on-node` leg CI runs must not declare `node: none`" sounds
 * like the same statement and is not: `@gjsify/sqlite` runs exactly that leg and is
 * CORRECTLY `none`, because on Node you use `node:sqlite` and its leg proves the BRIDGE,
 * not a node-consumer story. Which packages claim `polyfill` stays a JUDGEMENT — the same
 * shape as `CROSS_RUNTIME_PACKAGES` membership: the human picks the set, the machine holds
 * CI to it. This rule is the machine half, and holds the LEG, never the judgement.
 *
 * A package that is not GJS-bound is out of scope and stated rather than silently skipped:
 * a pure-TS contract runs on Node unmodified, so there is no bridge in its claim.
 *
 * REPO-SCOPED because it reads `.github/workflows/` by path. The read is structural rather
 * than YAML-parsed, for the same reason `pr-trigger-parity` and `platforms-ci` hand-roll
 * theirs.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import {
    GIRS_VALUE_RE,
    GI_URL_RE,
    GJS_IMPORTS_GUARD_RE,
    IMPORTS_LEGACY_RE,
    listSourceFiles,
} from '../../../packages/infra/manifest-conformance/lib/source-graph.mjs';

/** The CLI invocation, in either spelling the workflows use (`gjsify run` / `node …/index.js run`). */
const RUNS_GJS_ON_NODE = /(?:^|[\s;&|])run\s+test:gjs-on-node(?:$|[\s;&|])/;

/** A step's own directory. Read from the step, never from the job — no job here sets a default. */
const WORKING_DIRECTORY = /^\s*working-directory:\s*['"]?([^'"\s]+)['"]?\s*$/;

/** The start of the step a `run:` line belongs to — the backward walk's stop. */
const STEP_START = /^\s*-\s+(?:name|uses|run|id|working-directory):/;

/** Does `test` invoke `leg` — as opposed to merely CONTAINING its name (`build:test:node`)? */
function runsLeg(test, leg) {
    return typeof test === 'string' && new RegExp(`(?<![\\w:-])${leg}(?![\\w:-])`).test(test);
}

/**
 * Is this package bound to GJS by its own shipping source?
 *
 * The same vocabulary the drift check and the reachability pass use, so the three cannot
 * come to know different packages. A guarded `globalThis.imports?.gi` probe is NOT a
 * binding — it exports null off GJS, which is the sanctioned degradation shape.
 */
export function isGjsBound(pkgDir) {
    for (const file of listSourceFiles(join(pkgDir, 'src'))) {
        let source;
        try {
            source = readFileSync(file, 'utf8');
        } catch {
            // An unreadable source file is `package-outputs`' finding, not this rule's:
            // reporting it here would spend two rules on one defect, in different words.
            continue;
        }
        if (GI_URL_RE.test(source) || GIRS_VALUE_RE.test(source)) return true;
        if (IMPORTS_LEGACY_RE.test(source) && !GJS_IMPORTS_GUARD_RE.test(source)) return true;
    }
    return false;
}

/**
 * The `working-directory` of the step that `lines[index]` belongs to, or `null`.
 *
 * Walks BACK from the `run:` line and stops at its own step's first key: a
 * `working-directory` from an earlier step would credit the wrong package, which is worse
 * than finding none at all.
 */
function stepWorkingDirectory(lines, index) {
    for (let i = index; i >= 0; i--) {
        const match = WORKING_DIRECTORY.exec(lines[i]);
        if (match) return match[1].replace(/\\/g, '/').replace(/\/+$/, '');
        if (i < index && STEP_START.test(lines[i])) return null;
    }
    return null;
}

/**
 * Every `working-directory` a workflow step runs `test:gjs-on-node` in.
 *
 * @returns {{dirs: Set<string>, unanchored: string[]}} `unanchored` = a run this function
 *   could not attribute to a directory. Reported rather than ignored: an unparsed
 *   invocation is exactly where this rule's gap would be.
 */
export function collectWiredLegDirs(root) {
    const dir = join(root, '.github', 'workflows');
    const dirs = new Set();
    const unanchored = [];
    let files;
    try {
        files = readdirSync(dir);
    } catch {
        // A tree with no `.github/workflows` wires no leg — the answer, not an error.
        return { dirs, unanchored };
    }
    for (const file of files.sort()) {
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
        const lines = readFileSync(join(dir, file), 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (!RUNS_GJS_ON_NODE.test(lines[i])) continue;
            const found = stepWorkingDirectory(lines, i);
            if (found === null) unanchored.push(`${file}:${i + 1}`);
            else dirs.add(found);
        }
    }
    return { dirs, unanchored };
}

/**
 * @param {import('../../../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export function auditReverseBridgeLeg(ctx) {
    const failures = [];
    const notes = [];
    const { dirs: wiredDirs, unanchored } = collectWiredLegDirs(ctx.root);

    for (const where of unanchored) {
        failures.push(
            `.github/workflows/${where}: a step runs \`test:gjs-on-node\` with no \`working-directory\` above it in ` +
                `the same step, so this rule cannot tell which package the leg covers. Give the step a ` +
                `\`working-directory\`, or the wiring is invisible to the check that is supposed to see it.`,
        );
    }

    const known = new Set(ctx.packages.map((p) => p.rel));
    for (const wired of wiredDirs) {
        if (known.has(wired)) continue;
        failures.push(
            `.github/workflows: a step runs \`test:gjs-on-node\` in "${wired}", which is not a workspace package. ` +
                `A renamed or moved package leaves the step green and the leg pointing at nothing.`,
        );
    }

    const unwiredLegs = [];
    let inScope = 0;

    for (const pkg of ctx.packages) {
        const scripts = pkg.manifest.scripts ?? {};
        const wired = wiredDirs.has(pkg.rel);
        if (scripts['test:gjs-on-node'] !== undefined && !wired) unwiredLegs.push(pkg.name);

        if (pkg.gjsify?.runtimes?.node !== 'polyfill') continue;
        if (!isGjsBound(pkg.dir)) continue;
        inScope++;

        // The two routes to a Node suite the tree genuinely has: the corpus-identical leg
        // ADR 0030 asks for, or a `test:node` that `gjsify foreach test` reaches in main.yml.
        // (That `test` invokes it at all is `audit-test-scripts.mjs`'s half, not this one.)
        if (scripts['test:gjs-on-node'] !== undefined && wired) continue;
        if (scripts['test:node'] !== undefined && runsLeg(scripts.test, 'test:node')) continue;

        failures.push(
            `${pkg.rel}/package.json: declares \`gjsify.runtimes.node: "polyfill"\` and binds GJS through \`gi://\`, ` +
                `so the ONLY thing that makes the claim true is the reverse bridge — and no Node suite CI reaches ` +
                `proves it. Two ways in: a \`test:node\` script invoked from \`test\` (main.yml's \`gjsify foreach ` +
                `test\` runs it), or a \`test:gjs-on-node\` script with a workflow step that RUNS it in ` +
                `\`working-directory: ${pkg.rel}\`. A declared runtime with no suite behind it is ADR 0030 ` +
                `§ Decision 6's defect; ADR 0027 and ADR 0022 § Amendment are the two times this slot was wrong.`,
        );
    }

    if (unwiredLegs.length > 0) {
        notes.push(
            `${unwiredLegs.length} package(s) ship a \`test:gjs-on-node\` script no workflow runs: ` +
                `${unwiredLegs.sort().join(', ')}. Not a failure — each declares \`node: "none"\`, so the leg is a ` +
                `local probe rather than a claim this rule holds. It becomes one the moment the slot moves.`,
        );
    }

    return { failures, notes, stats: { inScope, wired: wiredDirs.size, unwiredLegs: unwiredLegs.length } };
}

export const reverseBridgeLegRule = defineRule({
    id: 'reverse-bridge-leg',
    scope: 'repo',
    fields: ['gjsify.runtimes'],
    description: 'a GJS-bound package declaring `runtimes.node: "polyfill"` runs a Node suite CI reaches',
    run(ctx) {
        const { failures, notes, stats } = auditReverseBridgeLeg(ctx);
        return {
            failures,
            notes,
            stats,
            summary:
                `reverse-bridge-leg: ${stats.inScope} GJS-bound package(s) declare \`node: "polyfill"\`; ` +
                `${stats.wired} \`test:gjs-on-node\` leg(s) wired in .github/workflows`,
        };
    },
});
