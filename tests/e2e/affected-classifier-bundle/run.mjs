// E2E guard for the dedicated CI classifier bundle.
//
// The `changes` job in .github/workflows/main.yml boots
// `packages/infra/cli/dist/affected.gjs.mjs` with `gjs -m` on a plain
// ubuntu-latest host that only `apt install`s gjs (no Fedora image). That host
// has the GLib/Gio/GioUnix typelibs that ship with gjs but NOT `gi://Soup` — so
// if the dedicated bundle's import graph ever pulls Soup (e.g. someone makes the
// `affected` command import a network/`@gjsify/fetch`-using module), the bundle
// throws at module load, the classifier crashes, and main.yml fails OPEN to a
// full run on EVERY PR — silently disabling selective CI project-wide.
//
// This guard asserts, on the committed bundle (env-independent — a content
// check, since the Fedora e2e container itself HAS Soup), that it stays
// Soup-free and only requires the typelibs the classifier host provides.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `GJSIFY_AFFECTED_BUNDLE` points the runtime checks at a bundle built
// somewhere else — used to validate a rebuild BEFORE it is committed (the
// pre-commit hook is what normally keeps the committed one in step).
const bundlePath =
    process.env.GJSIFY_AFFECTED_BUNDLE ||
    fileURLToPath(new URL('../../../packages/infra/cli/dist/affected.gjs.mjs', import.meta.url));

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

/** `true` when a usable `gjs` is on PATH (the bundle can only run there). */
function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { encoding: 'utf-8' });
    return r.status === 0;
}

describe('dedicated affected-classifier bundle', () => {
    it('is committed + non-empty', () => {
        assert.ok(existsSync(bundlePath), 'dist/affected.gjs.mjs must be committed');
        assert.ok(readFileSync(bundlePath, 'utf8').length > 1000);
    });

    it('does NOT require gi://Soup (the classifier host has no Soup typelib)', () => {
        const src = readFileSync(bundlePath, 'utf8');
        assert.ok(
            !/gi:\/\/Soup/.test(src),
            'affected.gjs.mjs must not require gi://Soup — it would crash the typelib-less ' +
                'classifier host into a permanent full-run fallback. Keep the `affected` command ' +
                'import graph free of @gjsify/fetch / @gjsify/npm-registry (which pull Soup).',
        );
    });

    it('requires only the GLib/Gio/GioUnix typelibs the host provides', () => {
        const src = readFileSync(bundlePath, 'utf8');
        const namespaces = [...src.matchAll(/gi:\/\/([A-Za-z][A-Za-z0-9]*)\?version=/g)].map((m) => m[1]);
        const allowed = new Set(['GLib', 'Gio', 'GioUnix']);
        const disallowed = [...new Set(namespaces)].filter((n) => !allowed.has(n));
        assert.deepEqual(
            disallowed,
            [],
            `unexpected gi:// typelib deps in the classifier bundle: ${disallowed.join(', ') || '(none)'}`,
        );
    });

    it('embeds the affected classifier logic', () => {
        const src = readFileSync(bundlePath, 'utf8');
        assert.ok(
            /ignored-only|skip-all|global-trigger/.test(src),
            'bundle should embed the affected classifier',
        );
    });
});

// ─── --changed-from-stdin ──────────────────────────────────────────────────
//
// AGENTS.md documents `--changed-from-stdin` as THE fixture-driven way to test
// the CI classifier ("Local dry-run … `--changed-from-stdin` for fixture-driven
// testing"). It read stdin with `readFileSync(0, 'utf8')` — the Node idiom,
// which the GJS bundle cannot honour: `@gjsify/fs` has no numeric-descriptor
// path, so the `0` was coerced to a relative PATH and every invocation of the
// documented flag died with
//
//     Error: ENOENT: … read '0'   (readStdinLines → readFileSync)
//
// i.e. the ONE input channel that lets a test drive the classifier
// deterministically did not work in the artifact CI actually boots. The fix
// (`packages/infra/cli/src/utils/stdin.ts`) reads fd 0 through
// `GioUnix.InputStream` under GJS and keeps `readFileSync(0)` on Node.

const STDIN_CASES = [
    {
        name: 'a docs-only change is skip-all',
        input: 'README.md\ndocs/some-note.md\n',
        expect: (r) => {
            assert.equal(r.skipAll, true, 'docs-only must classify as skip-all');
            assert.equal(r.global, false);
        },
    },
    {
        name: 'a global trigger forces a full run',
        input: 'gjsify-lock.json\n',
        expect: (r) => assert.equal(r.global, true, 'gjsify-lock.json is a global trigger'),
    },
    {
        name: 'a single package seeds a closure',
        input: 'packages/node/path/src/index.ts\n',
        expect: (r) => {
            assert.equal(r.global, false);
            assert.equal(r.skipAll, false);
            assert.ok(r.workspaces.includes('@gjsify/path'), 'the touched workspace must be a seed');
        },
    },
    {
        name: 'blank lines and stray whitespace are ignored',
        input: '\n   \n  packages/node/path/src/index.ts  \n\n',
        expect: (r) => assert.ok(r.workspaces.includes('@gjsify/path')),
    },
    {
        name: 'empty stdin classifies as skip-all instead of crashing',
        input: '',
        expect: (r) => assert.equal(r.skipAll, true),
    },
];

function classify(cmd, args, input) {
    const out = execFileSync(cmd, args, { cwd: repoRoot, input, encoding: 'utf-8' });
    return JSON.parse(out);
}

describe('gjsify affected --changed-from-stdin', () => {
    describe('under the GJS classifier bundle (what CI boots)', { skip: !hasGjs() && 'gjs not on PATH' }, () => {
        for (const c of STDIN_CASES) {
            it(c.name, () => {
                c.expect(
                    classify('gjs', ['-m', bundlePath, 'affected', '--changed-from-stdin', '--format=json'], c.input),
                );
            });
        }
    });

    describe('under Node (the `gjsify` npm entry)', () => {
        for (const c of STDIN_CASES) {
            it(c.name, () => {
                c.expect(
                    classify('node', [cliEntry, 'affected', '--changed-from-stdin', '--format=json'], c.input),
                );
            });
        }
    });
});
