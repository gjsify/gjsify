// E2E test for `scripts/stack-chained-pr.mjs` — the decision of whether a hand-chained PR
// becomes a native stack, and the wiring that keeps its write token away from head code.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-stack-chained-pr/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'stack-chained-pr.mjs');
const WORKFLOW = join(MONOREPO_ROOT, '.github', 'workflows', 'stack-chained-prs.yml');

const { planStack } = await import(`file://${SCRIPT}`);

const REPO = 'gjsify/gjsify';
const pr = (over = {}) => ({
    number: 12,
    base: { ref: 'feat/lower' },
    head: { repo: { full_name: REPO } },
    stack: null,
    ...over,
});
const plan = (over = {}) =>
    planStack({
        repo: REPO,
        pr: pr(),
        lower: { number: 11, stack: null },
        lowerStackTop: null,
        defaultBranch: 'main',
        ...over,
    });

describe('stack-chained-pr: the plan', () => {
    it('creates a stack from the lower PR and this one, bottom first', () => {
        assert.deepEqual(plan(), { action: 'create', pullRequests: [11, 12] });
    });

    it('adds onto an existing stack when the lower PR is its top', () => {
        assert.deepEqual(plan({ lower: { number: 11, stack: { number: 3 } }, lowerStackTop: 11 }), {
            action: 'add',
            stackNumber: 3,
            pullRequests: [12],
        });
    });

    it('refuses to branch a stack from its middle', () => {
        const result = plan({ lower: { number: 11, stack: { number: 3 } }, lowerStackTop: 14 });
        assert.equal(result.action, 'none');
        assert.match(result.reason, /would branch the stack/);
    });

    it('leaves alone a PR on the default branch, a fork, a stacked PR, and one with no lower PR', () => {
        assert.equal(plan({ pr: pr({ base: { ref: 'main' } }) }).action, 'none');
        assert.equal(plan({ pr: pr({ head: { repo: { full_name: 'someone/gjsify' } } }) }).action, 'none');
        assert.equal(plan({ pr: pr({ head: { repo: null } }) }).action, 'none');
        assert.equal(plan({ pr: pr({ stack: { number: 1 } }) }).action, 'none');
        assert.equal(plan({ lower: null }).action, 'none');
    });
});

describe('stack-chained-prs.yml: the wiring', () => {
    const yaml = readFileSync(WORKFLOW, 'utf8');

    it('holds the write token without checking out head code', () => {
        assert.match(yaml, /pull-requests: write/);
        assert.match(yaml, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
        assert.match(yaml, /sparse-checkout: \|\n\s+scripts\/stack-chained-pr\.mjs\n/);
    });

    it('no-ops when the base branch predates the script', () => {
        const guard = yaml.indexOf('[ ! -f scripts/stack-chained-pr.mjs ]');
        assert.notEqual(guard, -1);
        assert.ok(guard < yaml.indexOf('node scripts/stack-chained-pr.mjs'));
    });
});
