/**
 * Rule `reverse-bridge-leg` — a package whose ONLY route to Node is the `gi://` reverse
 * bridge, and which declares `gjsify.runtimes.node: "polyfill"`, must run a Node suite
 * that CI actually reaches.
 *
 * WHY THIS EXISTS. Twice now a GJS-bound package has carried a `node` slot that did not
 * describe it, and both times the declaration — not the code — was what pinned it to GJS.
 * `@gjsify/gtk-host` was `none` while a host showcase already built and ran for the node
 * target (ADR 0027 amended it), and `@gjsify/iframe` was `none` while its whole suite
 * measurably ran over the bridge (ADR 0022 § *Amendment — the `node` slot*). The audit
 * cannot catch either: `diffDeclared`'s `giUrlReachesNodeBridge` tolerance exists BECAUSE
 * both readings are honest for such a package — `--app node` claims a `gi://` specifier
 * and routes it to `@gjsify/node-gi`, so `none` and `polyfill` are each defensible from
 * the source alone. Only a RUN decides, which is ADR 0030 § Decision 6's point and
 * ADR 0027's own words: the slot flips in the change that gives it a test leg.
 *
 * THE DIRECTION IS DELIBERATE, and the opposite one was written first and measured WRONG.
 * "A package whose `test:gjs-on-node` leg CI runs must not declare `node: none`" sounds
 * like the same statement and is not: `@gjsify/sqlite` runs exactly that leg in
 * `node-gi.yml` and is CORRECTLY `none`, because on Node you use `node:sqlite` and its leg
 * proves the BRIDGE rather than a node-consumer story. Which packages claim `polyfill` is
 * therefore a JUDGEMENT — the same shape as `CROSS_RUNTIME_PACKAGES` membership, where
 * the human picks the set and the machine holds CI to it. This rule is the machine half.
 *
 * TWO WAYS TO SATISFY IT, because the tree genuinely has two:
 *
 *   1. `test:node` invoked from `test` — `gjsify foreach test` runs it in main.yml's
 *      sweep. `@gjsify/adwaita-react-native` is the member that arrives this way.
 *      (That `test` invokes it at all is `audit-test-scripts.mjs`'s half, not this one.)
 *   2. `test:gjs-on-node` with a workflow step that RUNS it — the corpus-identical leg
 *      ADR 0030 asks for. `@gjsify/gtk-host`, `@gjsify/react-native`, `@gjsify/iframe`.
 *
 * OUT OF SCOPE, and stated rather than silently skipped: a package that is NOT GJS-bound.
 * A pure-TS contract resolving to its own `lib/esm/index.js` runs on Node unmodified;
 * there is no bridge in the claim and nothing for a Node leg to prove that the package's
 * ordinary suite does not.
 *
 * REPO-SCOPED because it reads `.github/workflows/` — this repository's jobs, by path.
 * Structural read, no YAML dependency, for the same reason `pr-trigger-parity` and
 * `platforms-ci` hand-roll theirs.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import {
    GIRS_VALUE_RE,
    GI_URL_RE,
    GJS_IMPORTS_GUARD_RE,
    IMPORTS_LEGACY_RE,
    isNonShippingSource,
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
        if (isNonShippingSource(file)) continue;
        let source;
        try {
            source = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        if (GI_URL_RE.test(source) || GIRS_VALUE_RE.test(source)) return true;
        if (IMPORTS_LEGACY_RE.test(source) && !GJS_IMPORTS_GUARD_RE.test(source)) return true;
    }
    return false;
}

/**
 * Every `working-directory` a workflow step runs `test:gjs-on-node` in.
 *
 * @returns {{dirs: Set<string>, unanchored: string[]}} `unanchored` = a run with no
 *   `working-directory` above it in its own step. That is reported rather than ignored:
 *   an unparsed invocation is exactly where this rule's gap would be.
 */
export function collectWiredLegDirs(root) {
    const dir = join(root, '.github', 'workflows');
    const dirs = new Set();
    const unanchored = [];
    let files;
    try {
        files = readdirSync(dir);
    } catch {
        return { dirs, unanchored };
    }
    for (const file of files.sort()) {
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
        const lines = readFileSync(join(dir, file), 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (!RUNS_GJS_ON_NODE.test(lines[i])) continue;
            let found = null;
            for (let j = i; j >= 0; j--) {
                const m = WORKING_DIRECTORY.exec(lines[j]);
                if (m) {
                    found = m[1].replace(/\\/g, '/').replace(/\/+$/, '');
                    break;
                }
                // Stop at the step this `run:` belongs to: a `working-directory` from an
                // EARLIER step would credit the wrong package, which is worse than not
                // finding one at all.
                if (j < i && STEP_START.test(lines[j])) break;
            }
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

    let inScope = 0;
    let unwiredLegs = [];

    for (const pkg of ctx.packages) {
        const scripts = pkg.manifest.scripts ?? {};
        if (scripts['test:gjs-on-node'] !== undefined && !wiredDirs.has(pkg.rel)) {
            unwiredLegs.push(pkg.name);
        }

        if (pkg.gjsify?.runtimes?.node !== 'polyfill') continue;
        if (!isGjsBound(pkg.dir)) continue;
        inScope++;

        if (scripts['test:gjs-on-node'] !== undefined && wiredDirs.has(pkg.rel)) continue;
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

    unwiredLegs = unwiredLegs.sort();
    if (unwiredLegs.length > 0) {
        notes.push(
            `${unwiredLegs.length} package(s) ship a \`test:gjs-on-node\` script no workflow runs: ` +
                `${unwiredLegs.join(', ')}. Not a failure — each declares \`node: "none"\`, so the leg is a local ` +
                `probe rather than a claim this rule holds. It becomes one the moment the slot moves.`,
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
