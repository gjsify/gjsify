// E2E test for `gjsify install` over a dev link to an UNPUBLISHED package.
//
// `gjsify link` (ADR 0065) excludes the linked names from the FETCH set and
// deliberately not from the RESOLVE, because the resolve is what writes the
// lockfile and a linked tree must leave `gjsify-lock.json` byte-identical. The
// consequence nobody had measured: a linked package the registry does not have AT
// ALL made the resolve itself fail, so no install could run while the link
// existed, however correct the symlinks were. Measured against the real registry
// with lotse linked into a consumer: `Package not found in registry: @lotse/core
// (https://registry.npmjs.org/%40lotse/core)`, exit 1 — and linking a private
// sibling repo under development is the ordinary case, not an exotic one.
//
// The fix tolerates a `PackageNotFoundError` for a LINKED name in `resolveDeps`'s
// per-edge catch. A 404 ONLY: a timeout or a dropped connection is not an answer
// about what the registry holds, and reading one as an answer would write a
// lockfile missing the whole linked subtree over a network blip. Row 4 is that
// line, held with a 403 — `isRetryableStatus` lets it through on the first
// attempt, where a 500 or 503 would spend the ~23 s retry budget first.
//
// Row 1 is the CONTROL and is why row 2 is not vacuous: without it, a suite that
// only installs successfully over a link cannot distinguish the fix from a
// registry that happened to answer.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

/** One published version: a manifest plus the entry file it ships. */
function versionSpec(name, version) {
    return {
        main: 'index.js',
        dependencies: {},
        files: { 'index.js': `module.exports = ${JSON.stringify({ name, version })};\n` },
    };
}

describe('gjsify install — a dev link to an unpublished package', { timeout: 120_000 }, () => {
    let registry, registryUrl, cliEntry, envForCli, root, checkout;

    // The registry has `dl-dep` and `dl-public`, and deliberately NOT
    // `dl-private` — that is the 404 the whole suite is about. `dl-forbidden` is
    // absent too; row 4's `onRequest` answers it 403 before the default route.
    const PACKAGES = {
        'dl-dep': { '1.0.0': versionSpec('dl-dep', '1.0.0') },
        'dl-public': { '1.0.0': versionSpec('dl-public', '1.0.0') },
    };

    /**
     * A consumer project with `deps` declared and the mock registry configured.
     *
     * One directory per row: the consumer's manifest is what `gjsify link`
     * intersects its selection against (`consumerKnownNames`), so a single shared
     * project would make every row resolve every other row's packages.
     */
    function makeProject(label, deps) {
        const dir = join(root, label);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: label, version: '0.1.0', type: 'commonjs', private: true, dependencies: deps },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
        return dir;
    }

    /**
     * One package in the linked checkout.
     *
     * The entry file is written because `assertDevLinksBuilt` fails closed on a
     * link whose declared `main` does not exist — a fixture without it would
     * refuse at link time and never reach the resolve this suite is testing.
     */
    function checkoutPackage(dirName, name, version) {
        const dir = join(checkout, 'packages', dirName);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name, version, type: 'commonjs', main: 'index.js' }, null, 2) + '\n',
        );
        writeFileSync(
            join(dir, 'index.js'),
            `module.exports = ${JSON.stringify({ name, version, from: 'checkout' })};\n`,
        );
        return dir;
    }

    const lockfileOf = (dir) => readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8');

    before(async () => {
        registry = await startMockRegistry(PACKAGES, {
            onRequest: (req, res) => {
                // A non-404 answer about a linked name, for row 4. Not retryable
                // (`isRetryableStatus(403)` is false), so the failure arrives on the
                // first attempt instead of after the retry budget.
                if (decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]) === 'dl-forbidden') {
                    res.writeHead(403).end('forbidden');
                    return true;
                }
                return false;
            },
        });
        registryUrl = registry.url;

        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-dev-link-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            // Hermetic: nothing here may read or seed the developer's own cache.
            XDG_CACHE_HOME: join(root, 'cache'),
        };

        // The linked checkout — a gjsify workspace, which is what
        // `resolveCheckoutWorkspaces` demands before any link is written.
        checkout = join(root, 'checkout');
        mkdirSync(checkout, { recursive: true });
        writeFileSync(
            join(checkout, 'package.json'),
            JSON.stringify(
                { name: 'dl-checkout', version: '0.0.0', private: true, workspaces: ['packages/*'] },
                null,
                2,
            ) + '\n',
        );
        checkoutPackage('private', 'dl-private', '0.0.0');
        // A version no registry copy has, so "which copy is installed" is decidable
        // from the file alone in row 3.
        checkoutPackage('public', 'dl-public', '9.9.9');
        checkoutPackage('forbidden', 'dl-forbidden', '0.0.0');
    });

    after(async () => {
        await registry?.close();
        if (root) rmSync(root, { recursive: true, force: true });
    });

    describe('an unpublished linked package', () => {
        let project;

        before(() => {
            project = makeProject('unpublished', { 'dl-dep': '^1.0.0', 'dl-private': '*' });
        });

        it('CONTROL: without the link, the install fails naming dl-private', async () => {
            const r = await runCli(cliEntry, ['install'], { cwd: project, env: envForCli, timeoutMs: 60_000 });
            assert.notEqual(r.status, 0, `install must fail without the link:\n${r.stdout}\n${r.stderr}`);
            assert.match(`${r.stdout}${r.stderr}`, /dl-private/);
        });

        it('with the link, the install succeeds and dl-private comes from the checkout', async () => {
            const linked = await runCli(cliEntry, ['link', checkout, '--packages', 'dl-private'], {
                cwd: project,
                env: envForCli,
            });
            assert.equal(linked.status, 0, `link failed: ${linked.stderr}\n${linked.stdout}`);

            const r = await runCli(cliEntry, ['install'], { cwd: project, env: envForCli, timeoutMs: 60_000 });
            assert.equal(r.status, 0, `install failed over the link:\n${r.stdout}\n${r.stderr}`);

            const linkPath = join(project, 'node_modules', 'dl-private');
            assert.ok(lstatSync(linkPath).isSymbolicLink(), 'dl-private must be a symlink, not a registry copy');
            assert.equal(realpathSync(linkPath), realpathSync(join(checkout, 'packages', 'private')));

            // The rest of the tree still installed — the tolerance must not have
            // turned the resolve into a no-op.
            const dep = JSON.parse(readFileSync(join(project, 'node_modules', 'dl-dep', 'package.json'), 'utf-8'));
            assert.equal(dep.version, '1.0.0');
        });

        it('the lockfile records the spec but no entry for the unpublished package', async () => {
            const lock = JSON.parse(lockfileOf(project));
            assert.equal(
                lock.packages['node_modules/dl-private'],
                undefined,
                'nothing is known about an unpublished package, so nothing may be locked for it',
            );
            assert.ok(lock.packages['node_modules/dl-dep'], 'the published dep is still locked');
            // `requested` is the project's own specs verbatim, so the dependency
            // stays visible in the file even with no resolution behind it.
            assert.ok(
                lock.requested.some((s) => s.startsWith('dl-private@')),
                `requested must still carry the spec: ${JSON.stringify(lock.requested)}`,
            );
        });
    });

    describe('the designed case — a link over a PUBLISHED package', () => {
        let project, lockBefore;

        before(() => {
            project = makeProject('published', { 'dl-dep': '^1.0.0', 'dl-public': '^1.0.0' });
        });

        it('installs from the registry without a link', async () => {
            const r = await runCli(cliEntry, ['install'], { cwd: project, env: envForCli, timeoutMs: 60_000 });
            assert.equal(r.status, 0, `install failed: ${r.stdout}\n${r.stderr}`);
            lockBefore = lockfileOf(project);
            const pkg = JSON.parse(readFileSync(join(project, 'node_modules', 'dl-public', 'package.json'), 'utf-8'));
            assert.equal(pkg.version, '1.0.0');
        });

        it('leaves the lockfile BYTE-IDENTICAL once linked', async () => {
            const linked = await runCli(cliEntry, ['link', checkout, '--packages', 'dl-public'], {
                cwd: project,
                env: envForCli,
            });
            assert.equal(linked.status, 0, `link failed: ${linked.stderr}\n${linked.stdout}`);

            const r = await runCli(cliEntry, ['install'], { cwd: project, env: envForCli, timeoutMs: 60_000 });
            assert.equal(r.status, 0, `install failed over the link:\n${r.stdout}\n${r.stderr}`);

            assert.equal(lockfileOf(project), lockBefore, 'a link must never change what the consumer commits');
            // And the tree DID change — the guarantee is about the committed file,
            // not about the installed copy.
            const pkg = JSON.parse(readFileSync(join(project, 'node_modules', 'dl-public', 'package.json'), 'utf-8'));
            assert.equal(pkg.version, '9.9.9', 'the checkout copy is what a linked tree builds against');
        });
    });

    describe('a non-404 answer about a linked name', () => {
        let project;

        before(() => {
            project = makeProject('forbidden', { 'dl-dep': '^1.0.0', 'dl-forbidden': '*' });
        });

        it('stays FATAL — only "the registry does not have it" is tolerated', async () => {
            const linked = await runCli(cliEntry, ['link', checkout, '--packages', 'dl-forbidden'], {
                cwd: project,
                env: envForCli,
            });
            assert.equal(linked.status, 0, `link failed: ${linked.stderr}\n${linked.stdout}`);

            const r = await runCli(cliEntry, ['install'], { cwd: project, env: envForCli, timeoutMs: 90_000 });
            assert.equal(r.timedOut, false, 'the 403 must surface, not hang');
            assert.notEqual(r.status, 0, `a 403 about a linked name must fail the install:\n${r.stdout}\n${r.stderr}`);
            assert.match(`${r.stdout}${r.stderr}`, /403/);
        });
    });
});
