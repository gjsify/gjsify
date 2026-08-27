// E2E for ADR 0032 § 9 — the desktop platform-file chain, over a real
// `gjsify build --app gjs`.
//
// The unit suite (`packages/infra/cli/src/platform-resolve.spec.ts`) drives the
// resolveId handler against a mock context, which proves the ORDER. What it
// cannot prove is that the plugin is actually composed into the gjs and node
// orchestrators and that the real resolver finds the siblings — the failure
// shape this repository keeps paying for is a mechanism that is correct and not
// wired in. So this suite writes real variant files, runs the real CLI, and reads
// the emitted bundle.
//
// IT NEVER ASSERTS WHICH OS IT RUNS ON. The OS rung is the one part of the chain
// whose answer depends on the host, so the vector below writes ALL THREE OS
// variants and asserts a PROPERTY: exactly one of them is in the bundle, and
// neither `.desktop` nor the base file is. That is green on Linux, macOS and
// Windows, and on a host outside ADR 0018's target set the fixture degrades to
// the `.desktop` rung — which the vector accounts for rather than assuming away.
// A sibling suite once asserted a URI scheme was openable: true on a desktop,
// false on a headless CI shard.
//
// `transform.jsx: false` on the fixture is not incidental: `gjsify build` refuses
// a JSX entry with no JSX configuration (its own gate), and these fixtures are
// about file resolution, not about JSX. The `.tsx` extension is kept because that
// is the extension § 9 writes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

/** Every marker the fixture can emit, so "absent" is asserted against a known set. */
const OS_MARKERS = ['OSFORK_LINUX', 'OSFORK_MACOS', 'OSFORK_WINDOWS'];

describe('--app gjs desktop platform file resolution (ADR 0032 § 9)', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-desktop-platform-resolve-');
        tmpDir = env.tmpDir;

        projectDir = join(tmpDir, 'desktop-platform-resolve-project');
        const src = join(projectDir, 'src');
        mkdirSync(src, { recursive: true });

        const mod = (name, marker) => writeFileSync(join(src, name), `export const value = '${marker}';\n`);

        // `.gtk` outranks both the OS and `.desktop`.
        mod('toolkit.tsx', 'TOOLKIT_BASE');
        mod('toolkit.gtk.tsx', 'TOOLKIT_GTK');
        mod('toolkit.linux.tsx', 'TOOLKIT_LINUX');
        mod('toolkit.macos.tsx', 'TOOLKIT_MACOS');
        mod('toolkit.windows.tsx', 'TOOLKIT_WINDOWS');
        mod('toolkit.desktop.tsx', 'TOOLKIT_DESKTOP');

        // No `.gtk`: the OS rung wins over `.desktop`. All three OS variants
        // exist so the assertion can be about the RUNG, not about this host.
        mod('osfork.tsx', 'OSFORK_BASE');
        mod('osfork.linux.tsx', 'OSFORK_LINUX');
        mod('osfork.macos.tsx', 'OSFORK_MACOS');
        mod('osfork.windows.tsx', 'OSFORK_WINDOWS');
        mod('osfork.desktop.tsx', 'OSFORK_DESKTOP');

        // Only `.desktop`: the last rung before the base file.
        mod('anydesk.tsx', 'ANYDESK_BASE');
        mod('anydesk.desktop.tsx', 'ANYDESK_DESKTOP');

        // The two refusals. § 9's honest outcome is the BASE file, loudly.
        mod('refused.tsx', 'REFUSED_BASE');
        mod('refused.native.tsx', 'REFUSED_NATIVE');
        mod('refused.web.tsx', 'REFUSED_WEB');

        writeFileSync(
            join(src, 'entry.tsx'),
            [
                "import { value as toolkit } from './toolkit';",
                "import { value as osfork } from './osfork';",
                "import { value as anydesk } from './anydesk';",
                "import { value as refused } from './refused';",
                "console.log('PICKED', toolkit, osfork, anydesk, refused);",
                '',
            ].join('\n'),
        );

        setupProject(
            projectDir,
            {
                name: 'test-desktop-platform-resolve',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
                // See the header: the CLI's JSX gate, not a property under test.
                gjsify: { bundler: { transform: { jsx: false } } },
            },
            env.tarballsDir,
            env.tarballMap,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    let bundle = '';
    let output = '';

    it('builds', () => {
        // spawnSync, not execFileSync: the plugin's warnings go to stderr and
        // both streams are asserted below. A non-zero status is reported with the
        // output rather than as a bare "Command failed".
        const run = spawnSync(
            'npx',
            ['gjsify', 'build', 'src/entry.tsx', '--app', 'gjs', '--no-minify', '--outfile', 'dist/app.mjs'],
            { cwd: projectDir, encoding: 'utf8', timeout: 180 * 1000 },
        );
        output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
        assert.equal(run.status, 0, `build failed:\n${output}`);
        const outPath = join(projectDir, 'dist', 'app.mjs');
        assert.ok(existsSync(outPath), 'dist/app.mjs missing');
        bundle = readFileSync(outPath, 'utf-8');
    });

    it('takes .gtk over the OS variant and over .desktop', () => {
        assert.ok(bundle.includes('TOOLKIT_GTK'), 'the .gtk variant must win');
        for (const other of ['TOOLKIT_BASE', 'TOOLKIT_DESKTOP', 'TOOLKIT_LINUX', 'TOOLKIT_MACOS', 'TOOLKIT_WINDOWS']) {
            assert.ok(!bundle.includes(other), `${other} must not be in the bundle`);
        }
    });

    // The host-independent form of "the OS rung fires and outranks .desktop".
    it('takes exactly ONE OS variant over .desktop, without naming which', () => {
        const present = OS_MARKERS.filter((marker) => bundle.includes(marker));
        assert.ok(!bundle.includes('OSFORK_BASE'), 'the base file must not win over an OS variant');
        if (present.length === 1) {
            assert.ok(
                !bundle.includes('OSFORK_DESKTOP'),
                'the OS rung outranks .desktop, so .desktop must not also be present',
            );
            return;
        }
        // A host outside ADR 0018's target set has no OS rung at all; the chain
        // is then `.gtk` → `.desktop`, which is the documented degradation.
        assert.equal(present.length, 0, `expected one OS variant or none, got: ${present.join(', ')}`);
        assert.ok(bundle.includes('OSFORK_DESKTOP'), 'with no OS rung the .desktop variant must win');
    });

    it('takes .desktop when it is the only variant', () => {
        assert.ok(bundle.includes('ANYDESK_DESKTOP'), 'the .desktop variant must win');
        assert.ok(!bundle.includes('ANYDESK_BASE'), 'the base file must not win over .desktop');
    });

    // The exclusion that looks like an oversight. Neither `.native` nor `.web` is
    // reachable, however specific it looks next to the base file.
    it('falls through to the BASE file past .native and .web', () => {
        assert.ok(bundle.includes('REFUSED_BASE'), 'the base file must win');
        assert.ok(!bundle.includes('REFUSED_NATIVE'), '.native must never be resolved for a desktop target');
        assert.ok(!bundle.includes('REFUSED_WEB'), '.web must never be resolved for a desktop target');
    });

    // Falling through is § 9's decision; falling through in silence is not. The
    // author's `.native.tsx` is dead code in this build, and the only place that
    // can say so is the resolver that walked past it.
    it('warns by name about each refused sibling it walked past', () => {
        for (const refused of ['./refused.native', './refused.web']) {
            assert.ok(
                output.includes(refused),
                `the build must name ${refused} as walked past.\nbuild output:\n${output}`,
            );
        }
        assert.ok(
            output.includes('ADR 0032'),
            `the warning must carry the reason, not just the file name.\nbuild output:\n${output}`,
        );
    });
});
