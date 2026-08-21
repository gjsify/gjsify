/**
 * Rule `workflow-rev-pin` — REPO-SCOPED. A workflow that hard-codes an upstream
 * REVISION in its own `env:` must name the commit this repository pins as the matching
 * `refs/` gitlink. Two names for one revision is a fork waiting to happen, and this
 * shape hides it: both sides are valid shas, so nothing is broken until the day the
 * upstream file they disagree about actually differs.
 *
 * WHY THIS EXISTS
 *
 * `napi.yml`'s golden-diff oracle is the measured instance. `conformance.mjs` copies
 * the addon sources out of `refs/node/test/{js-native-api,node-api}` and diffs their
 * output against the committed goldens, so a maintainer regenerating goldens locally
 * (`test:conformance:update`) reads the GITLINK, while CI wipes `refs/node` and clones
 * nodejs/node at `NODE_TEST_REV`. The two are the same input to the same oracle, named
 * twice. They had already drifted: `chore: release v0.23.0` swept the gitlink to
 * `0618e9f0` (2026-07-25) and left the env on `ed63b195` (2026-07-14), 109 commits
 * apart, and the file comment that says they MUST match had nothing behind it.
 *
 * Nothing failed, and that is the point — the two revisions happened to carry
 * byte-identical `test/js-native-api` and `test/node-api` trees, so the disagreement
 * was invisible. The next sweep decides whether it stays that way, and a golden diff
 * on an upstream nobody bumped deliberately reads as a shim regression.
 *
 * WHY NOT `refs-pin`, WHICH OWNS THE SAME DIRECTORY
 *
 * `refs-pin` needs the submodules INITIALISED (it compares the gitlink to a working
 * copy), so `audit-runtimes --check` registers it without selecting it. This rule reads
 * a workflow file plus this checkout's git INDEX, both of which a bare
 * `actions/checkout` already leaves behind — so it can run on every PR, where the sweep
 * that causes the drift lands.
 *
 * Reading the index means reading the FILE, not asking `git ls-files`. The first draft
 * shelled out and died on `windows-suites.yml` with `spawnSync git ENOENT`: that leg
 * strips every `\Git\` entry from PATH on purpose and takes `git.exe` with them, while
 * still holding a full checkout. Catching the ENOENT and skipping would have made the
 * rule green-and-blind on that leg forever; `scripts/manifest-conformance/git-index.mjs`
 * carries the parser and the whole argument.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { readIndexGitlinks } from '../git-index.mjs';

/**
 * Every workflow `env:` that names a `refs/` revision. The list is explicit rather than
 * discovered: a sha-shaped env value is not by itself a claim about a submodule, and a
 * rule that guessed would either miss the next one or invent a pairing.
 */
export const WORKFLOW_REV_PINS = [
    {
        workflow: '.github/workflows/napi.yml',
        env: 'NODE_TEST_REV',
        submodule: 'refs/node',
        consumer: '`packages/napi/napi/scripts/conformance.mjs` (addon sources → golden diff)',
    },
];

/** The revision `<env>:` is set to in a workflow, or `undefined` when it is absent. */
export function readRevPin(workflowText, env) {
    const m = workflowText.match(new RegExp(`^[ \\t]*${env}:[ \\t]*['"]?([0-9a-f]{40})['"]?[ \\t]*$`, 'm'));
    return m?.[1];
}

/**
 * The commit a submodule is pinned to in the INDEX — same reading `refs-pin` takes, and
 * for the same reason: a staged pin bump is already the pin this change means.
 *
 * @returns {string | undefined} `undefined` when the path is not a gitlink
 */
export function gitlinkSha(repoRoot, submodule) {
    return readIndexGitlinks(repoRoot).get(submodule);
}

/**
 * Compare ONE declared pairing.
 *
 * @returns {string | undefined} the failure text, or `undefined` when the two agree
 */
export function compareRevPin(spec, { pin, gitlink }) {
    const where = `\`${spec.workflow}\`'s \`${spec.env}\``;
    if (pin === undefined) {
        return (
            `${where} is gone or no longer a 40-character sha, so the revision ${spec.consumer} is measured against ` +
            'can no longer be compared to the `' +
            spec.submodule +
            '` gitlink. Removing the pin is a real option — delete this pairing from `WORKFLOW_REV_PINS` in the same ' +
            'change and say what reads the revision instead. Renaming it silently is not: the check would pass by ' +
            'finding nothing.'
        );
    }
    if (gitlink === undefined) {
        return `\`${spec.submodule}\` is not a gitlink in this repository's index, so ${where} pins nothing that can be checked.`;
    }
    if (pin !== gitlink) {
        return (
            `${where} and the \`${spec.submodule}\` gitlink name DIFFERENT upstream commits:\n` +
            `    workflow env: ${pin}\n` +
            `    gitlink:      ${gitlink}\n` +
            `    ${spec.consumer} reads the gitlink locally and the env in CI, so the same oracle runs against two\n` +
            '    upstreams and only notices on the day their files differ. Point both at the same commit — and when\n' +
            '    the bump is deliberate, regenerate whatever the old revision produced in that same change.'
        );
    }
    return undefined;
}

/** @returns {{problems: string[], checked: number}} */
export function inspectWorkflowRevPins(repoRoot, pins = WORKFLOW_REV_PINS) {
    const problems = [];
    let checked = 0;

    /** @type {Map<string, string>} */
    let gitlinks;
    try {
        gitlinks = readIndexGitlinks(repoRoot);
    } catch (err) {
        // Kept because the index is the ONLY side of the comparison that is not a file
        // in the work tree, and an unreadable one must not degrade to "not applicable":
        // that is a pass that measured nothing. Converting the throw into a finding is
        // what puts the parser's own message under this rule's print block instead of
        // letting the registry's throw-to-failure net deliver it as a stack trace.
        return {
            problems: [
                "this repository's git index could not be read, so no workflow revision pin could be compared to a " +
                    `\`refs/\` gitlink: ${err instanceof Error ? err.message : String(err)}`,
            ],
            checked: 0,
        };
    }

    for (const spec of pins) {
        const file = join(repoRoot, spec.workflow);
        if (!existsSync(file)) {
            problems.push(
                `\`${spec.workflow}\` is declared in \`WORKFLOW_REV_PINS\` but does not exist. A deleted workflow takes ` +
                    'its pairing with it; a renamed one keeps it.',
            );
            continue;
        }
        checked++;
        const problem = compareRevPin(spec, {
            pin: readRevPin(readFileSync(file, 'utf8'), spec.env),
            gitlink: gitlinks.get(spec.submodule),
        });
        if (problem) problems.push(problem);
    }
    return { problems, checked };
}

export const workflowRevPinRule = defineRule({
    id: 'workflow-rev-pin',
    scope: 'repo',
    // Governs no manifest field — its subject is a workflow `env:` and this repository's
    // git index. Declared empty so the registry's "say what you govern" contract is met.
    fields: [],
    description: 'a workflow that pins an upstream revision names the same commit as the `refs/` gitlink',
    run(ctx) {
        const { problems, checked } = inspectWorkflowRevPins(ctx.root);
        if (checked === 0 && problems.length === 0) {
            // `WORKFLOW_REV_PINS` emptied out. The rule would then pass on every leg
            // while comparing nothing — the exact silence it was written to end, so it
            // says so instead of reporting `0 pin(s), OK`.
            problems.push(
                '`WORKFLOW_REV_PINS` declares no pairing, so this rule compared nothing and passed. Either restore ' +
                    'the pairing that was removed, or delete the rule together with the workflow `env:` it held.',
            );
        }
        return {
            failures: problems,
            stats: { checked },
            summary: `workflow-rev-pin: OK. ${checked} workflow revision pin(s) name the commit the matching \`refs/\` gitlink does.`,
        };
    },
});
