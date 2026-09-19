// E2E: the gate that keeps Linux system paths out of macOS and Windows artifacts.
//
// `scripts/check-foreign-platform-paths.mjs` says in its own header that "a checker with no
// way to be pointed somewhere else is a checker with no test", and shipped with the `--root`
// seam and no test. This is that test, and it exists for a sharper reason than symmetry: the
// gate is TEXTUAL, so its worth is exactly the set of shapes it cannot miss — and that set is
// unknowable by reading it. Every case below was run against the gate before it was written
// down, and two of them were GREEN on the first cut:
//
//   · the gate's own original defect rewritten as a multi-line template literal, which is the
//     idiomatic way to emit a shell script from TypeScript and therefore the shape this code
//     most wants to take next;
//   · a Linux path in a SHARED HELPER of `launcher.ts`, which the first cut's per-function
//     scanning put outside every scope.
//
// The blind spots are asserted too, as passes. A documented limitation nobody exercises is a
// limitation that quietly becomes a bug — and a reader who sees `/usr` + `/share` slip through
// here learns the boundary in one line instead of trusting a paragraph.
//
// Every case drives a FIXTURE root through `--root`, never the repository, so nothing here
// depends on the tree it runs in. A gate probed by mutating the real checkout passes or fails
// for whatever else is in that checkout.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GATE = join(REPO_ROOT, 'scripts', 'check-foreign-platform-paths.mjs');
const SHIP = 'packages/infra/cli/src/utils/ship';
const FOREIGN_ONLY = ['plist.ts', 'dmg.ts', 'icns.ts', 'ico.ts', 'msi.ts', 'pe-launcher.ts'];

const created = [];

function write(root, rel, text) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
}

/**
 * A minimal tree the gate reports clean on: the six foreign-only modules, a `launcher.ts`
 * carrying all three renderers plus a shared helper, and enough framework sources to clear the
 * walker's own "did I scan anything?" floor.
 *
 * SYNTHETIC rather than copied from the repository on purpose. A fixture cloned from the real
 * launcher would start passing or failing for reasons belonging to that file, and the cases
 * below are about the gate, not about today's launcher.
 */
function fixture(overrides = {}) {
    const root = mkdtempSync(join(tmpdir(), 'foreign-paths-'));
    created.push(root);
    for (const name of FOREIGN_ONLY) write(root, `${SHIP}/${name}`, 'export const marker = 1;\n');
    write(root, `${SHIP}/launcher.ts`, LAUNCHER);
    // The floor is 10; twelve leaves room for a case to delete one without tripping it.
    for (let i = 0; i < 12; i++) {
        write(root, `packages/framework/sample/src/mod${i}.ts`, `export const n${i} = ${i};\n`);
    }
    for (const [rel, text] of Object.entries(overrides)) write(root, rel, text);
    return root;
}

/** The gate's verdict on a fixture: `{ ok, out }`, with stdout and stderr joined. */
function run(root) {
    const result = spawnSync(process.execPath, [GATE, '--root', root], { encoding: 'utf8' });
    return { ok: result.status === 0, code: result.status, out: `${result.stdout}${result.stderr}` };
}

/**
 * A launcher with the shape the real one has: three top-level renderers, the Linux default
 * present and correct inside the prefix form, and a helper the foreign renderers call.
 */
const LAUNCHER = `// Fixture launcher.
export function renderLauncher(kind: string): string {
    if (kind === 'prefix') return renderPrefixLauncher();
    if (kind === 'app') return renderAppBundleLauncher();
    return renderWindowsLauncher();
}

function renderPrefixLauncher(): string {
    const lines = [
        '#!/bin/sh',
        'XDG_DATA_DIRS="$prefix/share:\${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"',
        'export XDG_DATA_DIRS',
    ];
    return lines.join('\\n');
}

function renderAppBundleLauncher(): string {
    const lines = ['#!/bin/sh', prependVar('XDG_DATA_DIRS', '$contents/Resources/share')];
    return lines.join('\\n');
}

function renderWindowsLauncher(): string {
    const lines = ['@echo off', prependVar('XDG_DATA_DIRS', '%~dp0share')];
    return lines.join('\\n');
}

function prependVar(variable: string, value: string): string {
    return \`\${variable}="\${value}"\\\${\${variable}:+:$\${variable}}\`;
}
`;

describe('foreign-platform-paths gate', () => {
    it('reports a clean fixture clean, and says what it scanned', () => {
        const { ok, out } = run(fixture());
        assert.ok(ok, `expected a clean fixture to pass:\n${out}`);
        assert.match(out, /no Linux system path in 6 foreign-only modules/);
    });

    // ---- Scope 1 ----------------------------------------------------------------------------

    it('fails on a Linux path written into a macOS-only module', () => {
        const root = fixture({ [`${SHIP}/plist.ts`]: "export const dirs = '/usr/share';\n" });
        const { ok, out } = run(root);
        assert.ok(!ok, 'a Linux path in plist.ts must fail');
        assert.match(out, /plist\.ts:1 emits the Linux path \/usr\/share/);
    });

    // THE REGRESSION THIS SUITE WAS WRITTEN FOR. `launcher.ts` emits a shell script, and a
    // shell script in TypeScript wants to be a template literal. The gate's first cut asked
    // "is there an odd number of quote characters before the token ON THIS LINE?", and the
    // inner lines of a multi-line template carry no quote character at all — so the very
    // defect the gate was built for passed green in the shape it is most likely to return in.
    it('fails on a Linux path inside a MULTI-LINE template literal', () => {
        const root = fixture({
            [`${SHIP}/dmg.ts`]: 'export const script = `\n#!/bin/sh\nXDG_DATA_DIRS=/usr/local/share:/usr/share\n`;\n',
        });
        const { ok, out } = run(root);
        assert.ok(!ok, 'a template literal is emitted text and must be scanned as such');
        assert.match(out, /dmg\.ts:3 emits the Linux path \/usr\/local\/share/);
    });

    // A line opening with `//` or `*` is exempt as prose — but INSIDE a template literal it is
    // script content, so the exemption must not follow the text in there. Otherwise two
    // characters hide any path from this gate.
    it('does not let a comment-shaped line inside a template literal escape', () => {
        const root = fixture({
            [`${SHIP}/icns.ts`]: 'export const s = `\n// staged into /usr/share by the installer\n`;\n',
        });
        assert.ok(!run(root).ok, 'a `//` line inside a template is content, not a comment');
    });

    it('fails when a listed foreign-only module is gone rather than scanning nothing', () => {
        const root = fixture();
        rmSync(join(root, SHIP, 'msi.ts'));
        const { ok, out } = run(root);
        assert.ok(!ok, 'a vanished file must fail, not disappear from the scan');
        assert.match(out, /msi\.ts is listed as macOS\/Windows-only but does not exist/);
    });

    // ---- Scope 2 ----------------------------------------------------------------------------

    it('leaves the Linux default inside renderPrefixLauncher alone', () => {
        // The fixture launcher already carries `${XDG_DATA_DIRS:-/usr/local/share:/usr/share}`
        // in the prefix renderer. It is correct there and a gate that flags it is a gate that
        // gets switched off, so the clean case above is also this assertion — stated once more
        // on its own because it is the whole reason scope 2 is not whole-file.
        assert.ok(run(fixture()).ok);
    });

    it('fails on the original `.app` defect', () => {
        const root = fixture({
            [`${SHIP}/launcher.ts`]: LAUNCHER.replace(
                "prependVar('XDG_DATA_DIRS', '$contents/Resources/share')",
                '\'XDG_DATA_DIRS="$contents/Resources/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"\'',
            ),
        });
        const { ok, out } = run(root);
        assert.ok(!ok, 'the defect this gate was written for must fail');
        assert.match(out, /launcher\.ts:\d+ writes the Linux path \/usr\/local\/share outside `renderPrefixLauncher`/);
    });

    // The first cut scanned the two foreign renderers by name, which put every shared helper
    // in the file outside all three scopes — and both foreign renderers call one.
    it('fails on a Linux path in a shared helper, which no renderer contains', () => {
        const root = fixture({
            [`${SHIP}/launcher.ts`]: LAUNCHER.replace(
                'function prependVar(variable: string, value: string): string {',
                "function prependVar(variable: string, value: string): string {\n    const fallback = '/usr/share';\n    void fallback;",
            ),
        });
        assert.ok(!run(root).ok, 'a helper both foreign renderers call is not exempt');
    });

    it('fails loudly when a foreign renderer is renamed', () => {
        const root = fixture({
            [`${SHIP}/launcher.ts`]: LAUNCHER.replaceAll('renderWindowsLauncher', 'renderWin32Launcher'),
        });
        const { ok, out } = run(root);
        assert.ok(!ok, 'a renamed renderer must be loud, not silently unscanned');
        assert.match(out, /has no top-level `function renderWindowsLauncher\(`/);
    });

    it('fails when the exempt Linux renderer itself is gone', () => {
        const root = fixture({
            [`${SHIP}/launcher.ts`]: LAUNCHER.replaceAll('renderPrefixLauncher', 'renderSystemLauncher'),
        });
        const { ok, out } = run(root);
        assert.ok(!ok, 'the exemption must not silently widen to the whole file');
        assert.match(out, /has no top-level `function renderPrefixLauncher\(`/);
    });

    // ---- Scope 3 ----------------------------------------------------------------------------

    it('fails on a framework literal with no darwin/win32 decision beside it', () => {
        const root = fixture({
            'packages/framework/sample/src/mod0.ts': "export const DIR = '/usr/share/locale';\n",
        });
        const { ok, out } = run(root);
        assert.ok(!ok, 'framework code ships to all three OSes');
        assert.match(out, /mod0\.ts:1 bakes the Linux path \/usr\/share with no darwin\/win32 decision/);
    });

    it('accepts the same literal once the module decides what the other two get', () => {
        const root = fixture({
            'packages/framework/sample/src/mod0.ts':
                "const NONE = ['darwin', 'win32'];\nexport const DIR = '/usr/share/locale';\n" +
                'export function pick(p: string) {\n    return NONE.includes(p) ? undefined : DIR;\n}\n',
        });
        assert.ok(run(root).ok, 'a decision within 15 lines is what the rule asks for');
    });

    it('reads a decision in CODE only, never one in a comment', () => {
        const root = fixture({
            'packages/framework/sample/src/mod0.ts':
                "// darwin and win32 get nothing, honest.\nexport const DIR = '/usr/share/locale';\n",
        });
        assert.ok(!run(root).ok, 'prose about a decision is not a decision');
    });

    it('exempts a module whose own path says linux', () => {
        const root = fixture({
            'packages/framework/sample/src/linux/paths.ts': "export const DIR = '/usr/share/locale';\n",
        });
        assert.ok(run(root).ok, 'a `linux` path segment declares the module\u2019s scope');
    });

    // THE WINDOWS SPELLING, pinned FROM LINUX. `relative()` answers in the host's separator, so
    // on `windows-latest` \u2014 where `audit-runtimes.yml` really runs this gate \u2014 the same module
    // arrives as `packages\framework\sample\src\linux\paths.ts`, and the exemption pattern
    // matches `/`, `-` and `.` but not `\`. Unfixed, that module is exempt on Linux and scanned
    // on Windows: one gate, two verdicts, red on the leg its author never runs.
    //
    // A filename containing a literal backslash is the proxy, because a POSIX host cannot make
    // a real `\` separator. It drives the identical code path \u2014 a `\` inside the relative path \u2014
    // which is why folding both separators, rather than `path.sep`, is what makes this testable
    // at all. The case fails if the fold is removed.
    it('exempts the same module when the path is spelled the Windows way', () => {
        const root = fixture({
            'packages/framework/sample/src/linux\\paths.ts': "export const DIR = '/usr/share/locale';\n",
        });
        const { ok, out } = run(root);
        assert.ok(ok, `a \\-separated linux segment must be exempt too:\n${out}`);
    });

    // ---- The scanner's own honesty ------------------------------------------------------------

    // Counting bare backticks desynced on `packages/framework/webgl/src/ts/utils.ts`, whose
    // regex character class holds one. From the flip onward every line read as template
    // content and the gate failed on prose. The scanner now lexes past regexes and strings,
    // and an unbalanced state at EOF is a FAILURE rather than a silent wrong answer.
    it('is not desynced by a backtick inside a regex literal', () => {
        const root = fixture({
            'packages/framework/sample/src/mod0.ts':
                'export const safe = (c: string) => !/["$`@\\\\\'\\0]/.test(c);\nexport const ok = 1;\n',
        });
        const { ok, out } = run(root);
        assert.ok(ok, `a backtick in a regex must not flip template state:\n${out}`);
    });

    it('is not desynced by a nested template inside an interpolation', () => {
        const root = fixture({
            'packages/framework/sample/src/mod0.ts':
                'export const s = (x: boolean) => `a${x ? `b` : `c`}d`;\nexport const ok = 1;\n',
        });
        assert.ok(run(root).ok, 'interpolations nest, so the tracker has to be a stack');
    });

    it('fails rather than guessing when template tracking does not close', () => {
        // A file the lexer cannot balance. `'` opens a string the scanner runs to end-of-line,
        // so the closing backtick is never seen and the stack stays open at EOF.
        const root = fixture({ [`${SHIP}/ico.ts`]: 'export const s = `unclosed\n' });
        const { ok, out } = run(root);
        assert.ok(!ok, 'a scanner that lost track must say so');
        assert.match(out, /template-literal tracking did not close by end of file/);
    });

    // ---- The blind spots, exercised so they stay known ---------------------------------------

    // A textual gate cannot see a path it never sees written. These pass, and that is the
    // documented boundary rather than an oversight — `locale-dir.spec.ts` and the reviewer are
    // what hold this line. Asserting them keeps the header's list measured: if a future
    // sharpening starts catching one, this case fails and the header gets corrected with it.
    it('does NOT catch a path assembled from pieces', () => {
        const root = fixture({
            [`${SHIP}/dmg.ts`]:
                "import { join } from 'node:path';\n" +
                "export const a = '/usr' + '/share/locale';\n" +
                "export const b = join('/usr', 'share', 'locale');\n" +
                "export const c = `${'/usr'}/share`;\n",
        });
        assert.ok(run(root).ok, 'assembled paths are outside any textual gate — see the header');
    });

    it('does NOT catch a literal imported from another module', () => {
        const root = fixture({
            'packages/framework/sample/src/mod0.ts':
                "const NONE = ['darwin', 'win32'];\nexport const DIR = '/usr/share/locale';\nexport const n = NONE.length;\n",
            [`${SHIP}/dmg.ts`]:
                "import { DIR } from '../../../../../framework/sample/src/mod0.js';\nexport const d = DIR;\n",
        });
        assert.ok(run(root).ok, 'scope 1 reads a module\u2019s own text; it does not follow imports');
    });

    it('does NOT catch a new foreign-only module nobody listed', () => {
        const root = fixture({ [`${SHIP}/nsis.ts`]: "export const dirs = '/usr/share';\n" });
        assert.ok(run(root).ok, 'FOREIGN_ONLY_FILES is hand-maintained — adding a module means adding it there');
    });

    // ---- The seam itself ----------------------------------------------------------------------

    it('refuses a --root with no directory after it', () => {
        const result = spawnSync(process.execPath, [GATE, '--root'], { encoding: 'utf8' });
        assert.equal(result.status, 2, 'falling back to the real root would answer about another tree, in green');
    });

    it('cleans up', () => {
        for (const root of created) rmSync(root, { recursive: true, force: true });
    });
});
