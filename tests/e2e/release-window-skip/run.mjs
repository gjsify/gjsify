// E2E for the release-window detector — the thing that decides whether `create-app`
// and the two Yarn-PnP suites RUN or SKIP.
//
// WHY THIS SUITE EXISTS. The detector's failure modes are invisible from inside the
// suites it governs: a skip that should not have happened looks exactly like a green
// run, and it happens in a window nobody can reproduce on demand. #1523 replaced a
// 30-minute wait with `describe(..., { skip })` precisely because the window is a
// state and not a delay — and the moment a suite can disarm itself, the question
// "under which registry answers does it disarm?" becomes the one worth testing.
//
// It is asked here against a LOCAL registry whose answers are the case, because the
// public registry offers exactly one of these states at a time and only for an hour
// after a release. All four states are the same code path with different HTTP.
//
// THE ONE THAT ALREADY BIT. Before #1523 the probe read a bare 404 as "not published
// yet". A registry that 404s EVERYTHING — proxy down, auth failure, a mistyped
// `GJSIFY_E2E_REGISTRY` — therefore reported every dependency missing and skipped both
// PnP suites green. `404s everything` below is that case, and it must never skip.
//
// The shared harness serves the packument route; npm's SINGLE-VERSION route
// `/<name>/<version>` is what this detector turns on, and `startMockRegistry` has no
// concept of it. That is what `onRequest` is the seam for, so the route is added here
// rather than a sixteenth private registry being stood up beside the shared one.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MONOREPO_ROOT, createAppRegistryGapSkipReason, unpublishedRegistryDependencies } from '../helpers.mjs';
import { startMockRegistry } from '../mock-registry.mjs';

/** The version the checkout is releasing — the only one a skip is allowed to forgive. */
const TRAIN = JSON.parse(readFileSync(join(MONOREPO_ROOT, 'package.json'), 'utf8')).version;
const NAME = '@gjsify/node-gi';
/** A version that IS published, so the default packument route proves the package exists. */
const PREVIOUS = '0.0.1';

/**
 * Which answer the registry is giving this case. `window` is the state the whole
 * mechanism exists for: npm knows the package and serves its document, but has not
 * published the train version yet.
 *
 * @type {'window' | 'published' | '404s everything' | 'answers 5xx'}
 */
let mode;

describe('release-window skip detection', { timeout: 2 * 60 * 1000 }, () => {
    let registry;

    before(async () => {
        registry = await startMockRegistry(
            { [NAME]: { [PREVIOUS]: {} } },
            {
                onRequest: (req, res) => {
                    if (mode === '404s everything') {
                        res.writeHead(404).end('not found');
                        return true;
                    }
                    if (mode === 'answers 5xx') {
                        res.writeHead(503).end('unavailable');
                        return true;
                    }
                    // npm's single-version route, which the shared registry does not model.
                    // Everything else falls through to its packument route.
                    if (decodeURIComponent(req.url ?? '') !== `/${NAME}/${TRAIN}`) return false;
                    if (mode === 'published') {
                        res.writeHead(200, { 'content-type': 'application/json' }).end(
                            JSON.stringify({ name: NAME, version: TRAIN }),
                        );
                    } else {
                        res.writeHead(404).end('not published yet');
                    }
                    return true;
                },
            },
        );
    });

    after(async () => {
        delete process.env.GJSIFY_E2E_REGISTRY;
        await registry.close();
    });

    /** Put the registry in state `next` and return its request log, freshly emptied. */
    function withRegistry(next) {
        mode = next;
        registry.requests.length = 0;
        process.env.GJSIFY_E2E_REGISTRY = registry.url.replace(/\/+$/, '');
        return registry.requests;
    }

    /** What the detector asked for, in the spelling npm uses on the wire. */
    const asked = (log) => log.map((u) => decodeURIComponent(u));

    it('skips, naming the package and version, while the train version is unpublished', async () => {
        withRegistry('window');
        const reason = await createAppRegistryGapSkipReason([[NAME, `^${TRAIN}`]]);
        assert.equal(typeof reason, 'string', 'the release window must produce a skip reason, not `false`');
        assert.match(reason, new RegExp(`${NAME}@${TRAIN.replace(/\./g, '\\.')}`));
        // The shared opening clause — one grep finds every suite in this state.
        assert.match(reason, /the workspace version is not on npm yet/);
    });

    it('runs once the train version is published', async () => {
        withRegistry('published');
        assert.equal(await createAppRegistryGapSkipReason([[NAME, `^${TRAIN}`]]), false);
    });

    // THE REGRESSION GUARD. A registry that 404s everything is a RED condition, and
    // reading it as "release in progress" would make every governed suite pass by
    // skipping — permanently, and silently, which is worse than the red #1523 removed.
    it('runs against a registry that 404s everything, rather than skipping', async () => {
        const log = withRegistry('404s everything');
        assert.equal(await createAppRegistryGapSkipReason([[NAME, `^${TRAIN}`]]), false);
        // Two requests, not one: the version 404 alone is not evidence, so the package's
        // own document is asked for as confirmation and its 404 withdraws the claim.
        assert.deepEqual(asked(log), [`/${NAME}/${TRAIN}`, `/${NAME}`]);
    });

    it('runs when the registry answers 5xx', async () => {
        withRegistry('answers 5xx');
        assert.equal(await createAppRegistryGapSkipReason([[NAME, `^${TRAIN}`]]), false);
    });

    it('runs when the registry is unreachable', async () => {
        mode = 'window';
        // Port 1 listens for nobody: every probe is ECONNREFUSED.
        process.env.GJSIFY_E2E_REGISTRY = 'http://127.0.0.1:1';
        assert.equal(await createAppRegistryGapSkipReason([[NAME, `^${TRAIN}`]]), false);
    });

    // A range that is not this release train's is a WRONG RANGE, not a window, and it
    // has to keep failing the suite the way the old deadline did — otherwise the fix for
    // a mis-set deadline becomes a mis-set gate that forgives any range at all.
    it('does not even probe a range off the release train', async () => {
        const log = withRegistry('window');
        assert.equal(await createAppRegistryGapSkipReason([[NAME, '^99.0.0']]), false);
        assert.deepEqual(asked(log), [], 'a range no release could have minted must not reach the registry');
    });

    // `>=<train>` is chosen over an obviously-foreign spelling on purpose: it CONTAINS the
    // train version, so a lax "strip what is not a digit" reading would recover it, probe,
    // and skip. Only refusing the spelling outright keeps this case from being decided by
    // the train-version guard instead — which would make this test agree for the wrong reason.
    it('does not even probe a range spelled in a form process-template.mjs never writes', async () => {
        const log = withRegistry('window');
        assert.equal(await createAppRegistryGapSkipReason([[NAME, `>=${TRAIN}`]]), false);
        assert.deepEqual(asked(log), [], 'an unrecognised spelling must fail closed, not be guessed at');
    });

    // The Yarn-PnP half of the same probe. `wanted` is passed explicitly so the case is
    // about the detector and not about which platform packages this host happens to omit.
    it('reports an unpublished dependency to the PnP suites, and nothing on a broken registry', async () => {
        withRegistry('window');
        assert.deepEqual(await unpublishedRegistryDependencies({ wanted: [{ name: NAME, version: TRAIN }] }), [
            `${NAME}@${TRAIN}`,
        ]);

        withRegistry('404s everything');
        assert.deepEqual(await unpublishedRegistryDependencies({ wanted: [{ name: NAME, version: TRAIN }] }), []);
    });
});
