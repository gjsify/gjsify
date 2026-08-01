// E2E test for `gjsify pack`'s `workspace:` protocol substitution.
//
// Sibling guard to `tests/e2e/publish-files-glob`, for the same failure mode
// one layer down: the packer producing a tarball that no registry client can
// install, WITHOUT saying a word.
//
// `workspace:^` / `workspace:~` / `workspace:*` are a workspace-protocol
// notation; npm/yarn/pnpm all reject them at install time
// (`Unsupported URL Type "workspace:"`). `gjsify pack` therefore rewrites them
// to the sibling workspace's real version before packing. It used to give up
// SILENTLY whenever `findWorkspaceRoot()` returned null — and that lookup is
// deliberately strict: it only accepts a root whose own `workspaces` globs
// list the package as a member. Packages that live inside the monorepo but are
// intentionally NOT members (`packages/napi/**`, `packages/node-gi/**` — own
// CI, own release cadence, see AGENTS.md) hit exactly that path, so a
// `workspace:^` in one of them shipped verbatim into the tarball.
//
// The rule this test pins down: a `workspace:` range is either substituted
// correctly or the pack FAILS. It is never silently published.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/pack-workspace-protocol/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

/** Pack `cwd` and return the `package.json` the tarball actually contains. */
function packAndReadManifest(cwd) {
    execFileSync('node', [CLI_ENTRY, 'pack'], { cwd, encoding: 'utf-8' });
    const tgz = readdirSync(cwd).find((f) => f.endsWith('.tgz'));
    assert.ok(tgz, 'pack produced a .tgz');
    const raw = execFileSync('tar', ['xzOf', join(cwd, tgz), 'package/package.json'], {
        encoding: 'utf-8',
    });
    return JSON.parse(raw);
}

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe('gjsify pack — workspace: protocol substitution', () => {
    let root;

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-pack-wsproto-'));
        // The monorepo root: `packages/member` is a member, `packages/outsider`
        // deliberately is NOT (mirrors packages/napi + packages/node-gi).
        writeJson(join(root, 'package.json'), {
            name: 'ws-proto-monorepo',
            version: '0.0.0',
            private: true,
            workspaces: ['packages/member', 'packages/other-member'],
        });

        mkdirSync(join(root, 'packages', 'member'), { recursive: true });
        writeJson(join(root, 'packages', 'member', 'package.json'), {
            name: '@x/member',
            version: '2.3.4',
        });

        mkdirSync(join(root, 'packages', 'other-member'), { recursive: true });
        writeJson(join(root, 'packages', 'other-member', 'package.json'), {
            name: '@x/other-member',
            version: '9.9.9',
            dependencies: { '@x/member': 'workspace:^' },
            files: ['README.md'],
        });
        writeFileSync(join(root, 'packages', 'other-member', 'README.md'), '# other-member\n');

        mkdirSync(join(root, 'packages', 'outsider'), { recursive: true });
        writeJson(join(root, 'packages', 'outsider', 'package.json'), {
            name: '@x/outsider',
            version: '0.1.0',
            dependencies: { '@x/member': 'workspace:^' },
            devDependencies: { '@x/other-member': 'workspace:*' },
            peerDependencies: { '@x/member': 'workspace:~' },
            files: ['README.md'],
        });
        writeFileSync(join(root, 'packages', 'outsider', 'README.md'), '# outsider\n');

        // A non-member with an UNRESOLVABLE workspace: range (no such sibling).
        mkdirSync(join(root, 'packages', 'dangling'), { recursive: true });
        writeJson(join(root, 'packages', 'dangling', 'package.json'), {
            name: '@x/dangling',
            version: '0.1.0',
            dependencies: { '@x/nope': 'workspace:^' },
            files: ['README.md'],
        });
        writeFileSync(join(root, 'packages', 'dangling', 'README.md'), '# dangling\n');
    });

    after(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('substitutes workspace: ranges for a package that IS a workspace member', () => {
        const pkg = packAndReadManifest(join(root, 'packages', 'other-member'));
        assert.equal(pkg.dependencies['@x/member'], '^2.3.4');
    });

    it('substitutes workspace: ranges for a package that is NOT a workspace member', () => {
        const pkg = packAndReadManifest(join(root, 'packages', 'outsider'));
        // ^ / * / ~ across all four dependency blocks.
        assert.equal(pkg.dependencies['@x/member'], '^2.3.4');
        assert.equal(pkg.devDependencies['@x/other-member'], '9.9.9');
        assert.equal(pkg.peerDependencies['@x/member'], '~2.3.4');
    });

    it('never ships a literal workspace: range', () => {
        const pkg = packAndReadManifest(join(root, 'packages', 'outsider'));
        const ranges = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
            (block) => Object.values(pkg[block] ?? {}),
        );
        assert.deepEqual(
            ranges.filter((r) => String(r).startsWith('workspace:')),
            [],
            'a workspace: range in a published tarball is unresolvable by every registry client',
        );
    });

    it('FAILS LOUDLY when a workspace: range names no sibling workspace', () => {
        const dir = join(root, 'packages', 'dangling');
        assert.throws(
            () => execFileSync('node', [CLI_ENTRY, 'pack'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }),
            (err) => {
                const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
                assert.match(out, /no sibling workspace/i);
                return true;
            },
        );
    });

    it('FAILS LOUDLY when a workspace: range is used outside any monorepo', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-pack-standalone-'));
        try {
            writeJson(join(dir, 'package.json'), {
                name: 'standalone-with-ws-range',
                version: '1.0.0',
                dependencies: { '@x/member': 'workspace:^' },
                files: ['README.md'],
            });
            writeFileSync(join(dir, 'README.md'), '# standalone\n');
            assert.throws(
                () => execFileSync('node', [CLI_ENTRY, 'pack'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }),
                (err) => {
                    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
                    assert.match(out, /not inside a monorepo/i);
                    return true;
                },
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('still packs a standalone package that has NO workspace: ranges', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-pack-plain-'));
        try {
            writeJson(join(dir, 'package.json'), {
                name: 'standalone-plain',
                version: '1.0.0',
                dependencies: { lodash: '^4.0.0' },
                files: ['README.md'],
            });
            writeFileSync(join(dir, 'README.md'), '# plain\n');
            const pkg = packAndReadManifest(dir);
            assert.equal(pkg.dependencies.lodash, '^4.0.0');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
