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
import { fileURLToPath } from 'node:url';

const bundlePath = fileURLToPath(
    new URL('../../../packages/infra/cli/dist/affected.gjs.mjs', import.meta.url),
);

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
