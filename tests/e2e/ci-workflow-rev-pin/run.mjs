// E2E test for `scripts/manifest-conformance/rules/workflow-rev-pin.mjs` — the rule
// that holds a workflow's hard-coded upstream revision to the `refs/` gitlink naming
// the same commit.
//
// The synthetic half is the load-bearing one here. The tree conforms the moment the
// rule lands, so a comparison that always returned "agree" would look exactly like a
// correct one; each verdict therefore gets an input shaped to produce it, including
// the two that are NOT a mismatch — a pin that has been renamed away, and a submodule
// that is no longer a gitlink. Both would otherwise let the rule pass by finding
// nothing, which is the failure mode this whole PR is about.
//
// The real-tree half is the regression guard: the drift it was written for arrived
// inside `chore: release v0.23.0`, a submodule sweep that touched no file `napi.yml`
// builds, so the assertion has to be about the repository as it is.
//
// The third half covers the git-index reader the rule now stands on instead of
// `git ls-files` (see `scripts/manifest-conformance/git-index.mjs` for why). Its
// fixtures are hand-built buffers: a version-4 or split index cannot be produced here
// without a git binary, which is exactly the environment the reader must survive.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-workflow-rev-pin/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const RULE = join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'workflow-rev-pin.mjs');
const GIT_INDEX = join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'git-index.mjs');

const { WORKFLOW_REV_PINS, compareRevPin, gitlinkSha, inspectWorkflowRevPins, readRevPin } = await import(
    `file://${RULE}`
);
const { readIndexGitlinks, resolveGitDir } = await import(`file://${GIT_INDEX}`);

const SPEC = {
    workflow: '.github/workflows/probe.yml',
    env: 'NODE_TEST_REV',
    submodule: 'refs/node',
    consumer: 'the oracle',
};
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('the workflow env reader', () => {
    it('reads the sha off the env line, quoted or bare', () => {
        assert.equal(readRevPin(`env:\n  NODE_TEST_REV: ${A}\n`, 'NODE_TEST_REV'), A);
        assert.equal(readRevPin(`env:\n  NODE_TEST_REV: '${A}'\n`, 'NODE_TEST_REV'), A);
        assert.equal(readRevPin(`env:\n    NODE_TEST_REV: ${A}\n`, 'NODE_TEST_REV'), A);
    });

    it('does not accept a mention of the name in prose', () => {
        // The pin is a VALUE, and the file talks about it in comments right above the
        // `env:` block. A reader that matched the word would compare a comment.
        assert.equal(readRevPin(`# NODE_TEST_REV: ${A} is the pin\n`, 'NODE_TEST_REV'), undefined);
        assert.equal(readRevPin(`env:\n  NODE_TEST_REV: main\n`, 'NODE_TEST_REV'), undefined);
    });
});

describe('the comparison', () => {
    it('passes only when both sides name the same commit', () => {
        assert.equal(compareRevPin(SPEC, { pin: A, gitlink: A }), undefined);
        assert.match(compareRevPin(SPEC, { pin: A, gitlink: B }), /DIFFERENT upstream commits/);
    });

    it('fails when the pin is gone, rather than reporting agreement', () => {
        assert.match(compareRevPin(SPEC, { pin: undefined, gitlink: A }), /gone or no longer a 40-character sha/);
    });

    it('fails when the submodule is no longer a gitlink', () => {
        assert.match(compareRevPin(SPEC, { pin: A, gitlink: undefined }), /not a gitlink/);
    });
});

describe('the repository itself', () => {
    it('names one commit per pinned upstream', () => {
        const { problems, checked } = inspectWorkflowRevPins(MONOREPO_ROOT);
        assert.deepEqual(problems, []);
        // An empty declaration list would satisfy the assertion above while checking
        // nothing; the emptiness has to be earned.
        assert.equal(checked, WORKFLOW_REV_PINS.length);
        assert.ok(checked > 0, 'no workflow revision pin is declared, so the assertion above proved nothing');
    });

    it('reads the gitlink out of the index', () => {
        assert.match(gitlinkSha(MONOREPO_ROOT, 'refs/node') ?? '', /^[0-9a-f]{40}$/);
        assert.equal(gitlinkSha(MONOREPO_ROOT, 'scripts'), undefined);
    });
});

// ── the git-index reader ────────────────────────────────────────────────────────────

/** One index entry as git writes it. `version` decides padding + path compression. */
function encodeEntry({ mode, sha, path, version = 2, previousPath = '' }) {
    const head = Buffer.alloc(62);
    head.writeUInt32BE(mode, 24);
    Buffer.from(sha, 'hex').copy(head, 40);
    if (version < 4) {
        head.writeUInt16BE(Math.min(path.length, 0xfff), 60);
        const name = Buffer.from(path, 'utf8');
        // 1-8 NUL bytes, padding the WHOLE entry to a multiple of eight.
        const size = (62 + name.length + 8) & ~7;
        const out = Buffer.alloc(size);
        head.copy(out);
        name.copy(out, 62);
        return out;
    }
    // Version 4: strip N bytes off the previous path, then append this suffix. The
    // fixtures below never need a multi-byte varint, so one byte is enough here.
    let shared = 0;
    while (shared < previousPath.length && shared < path.length && previousPath[shared] === path[shared]) shared++;
    const strip = previousPath.length - shared;
    assert.ok(strip < 0x80, 'fixture would need a multi-byte varint');
    return Buffer.concat([head, Buffer.from([strip]), Buffer.from(`${path.slice(shared)}\0`, 'utf8')]);
}

/** A whole index file: `DIRC`, version, count, the entries, extensions, checksum. */
function encodeIndex({ version, entries, extensions = [] }) {
    const header = Buffer.alloc(12);
    header.write('DIRC', 0, 'latin1');
    header.writeUInt32BE(version, 4);
    header.writeUInt32BE(entries.length, 8);
    const encoded = [];
    let previousPath = '';
    for (const entry of entries) {
        encoded.push(encodeEntry({ ...entry, version, previousPath }));
        previousPath = entry.path;
    }
    const ext = extensions.map(({ signature, body }) => {
        const head = Buffer.alloc(8);
        head.write(signature, 0, 'latin1');
        head.writeUInt32BE(body.length, 4);
        return Buffer.concat([head, body]);
    });
    // The trailing 20 bytes are a checksum nothing here verifies; the reader only has
    // to stop before them, so any filler proves that.
    return Buffer.concat([header, ...encoded, ...ext, Buffer.alloc(20, 0xab)]);
}

/** A throwaway checkout whose `.git/index` is exactly the bytes given. */
function fakeCheckout(indexBuffer, { asWorktreeFile = false } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-git-index-'));
    if (asWorktreeFile) {
        // `git worktree add` writes `.git` as a FILE naming the real git dir — the shape
        // this branch is developed in, and the one a directory-only reader gets wrong.
        const real = join(root, 'metadata');
        mkdirSync(real, { recursive: true });
        writeFileSync(join(root, '.git'), 'gitdir: ./metadata\n');
        writeFileSync(join(real, 'index'), indexBuffer);
    } else {
        mkdirSync(join(root, '.git'), { recursive: true });
        writeFileSync(join(root, '.git', 'index'), indexBuffer);
    }
    return root;
}

const SUB = 'c'.repeat(40);
const BLOB = 'd'.repeat(40);

describe('the git-index reader', () => {
    for (const version of [2, 3, 4]) {
        it(`returns gitlinks and only gitlinks from a version-${version} index`, () => {
            const root = fakeCheckout(
                encodeIndex({
                    version,
                    // Path-sorted, as git writes it — which is what gives version 4's
                    // prefix compression something to strip on the `refs/` pair.
                    entries: [
                        { mode: 0o100644, sha: BLOB, path: 'package.json' },
                        { mode: 0o100644, sha: BLOB, path: 'refs/README.md' },
                        { mode: 0o160000, sha: SUB, path: 'refs/node' },
                    ],
                }),
            );
            const gitlinks = readIndexGitlinks(root);
            assert.deepEqual([...gitlinks], [['refs/node', SUB]]);
        });
    }

    it('finds the index through a worktree `.git` FILE', () => {
        const root = fakeCheckout(
            encodeIndex({ version: 2, entries: [{ mode: 0o160000, sha: SUB, path: 'refs/node' }] }),
            { asWorktreeFile: true },
        );
        assert.equal(resolveGitDir(root), join(root, 'metadata'));
        assert.equal(readIndexGitlinks(root).get('refs/node'), SUB);
    });

    it('names a SPLIT index rather than reporting the submodule as gone', () => {
        // The entries really do live elsewhere in this shape, so a reader that ignored
        // the `link` extension would answer "not a gitlink" — blaming the submodule for
        // a limitation of the parser.
        const root = fakeCheckout(
            encodeIndex({
                version: 2,
                entries: [],
                extensions: [{ signature: 'link', body: Buffer.alloc(20) }],
            }),
        );
        assert.throws(() => readIndexGitlinks(root), /SPLIT index/);
    });

    it('refuses bytes that are not an index, and versions it does not implement', () => {
        assert.throws(() => readIndexGitlinks(fakeCheckout(Buffer.alloc(64))), /DIRC/);
        const future = encodeIndex({ version: 2, entries: [] });
        future.writeUInt32BE(5, 4);
        assert.throws(() => readIndexGitlinks(fakeCheckout(future)), /index version 5/);
    });

    it('says so when there is no checkout at all, rather than reporting no pins', () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-git-index-'));
        assert.throws(() => resolveGitDir(root), /not a git checkout/);
        // And the rule turns that into a FINDING — never into a quiet pass.
        const { problems, checked } = inspectWorkflowRevPins(root);
        assert.equal(checked, 0);
        assert.equal(problems.length, 1);
        assert.match(problems[0], /git index could not be read/);
    });
});
