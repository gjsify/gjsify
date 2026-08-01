// SPDX-License-Identifier: MIT
//
// The @gjsify/node-gi GTK capstone proof: ONE unchanged `gi://` Adwaita source
// ([`src/app.ts`](src/app.ts)) builds AND runs with byte-identical output on BOTH
// runtimes.
//
//   gjsify build src/app.ts --app gjs   → gjs  -m dist/app.gjs.mjs   (native gi://)
//   gjsify build src/app.ts --app node  → node    dist/app.node.mjs  (@gjsify/node-gi)
//
// The test asserts the two stdout streams are byte-identical AND equal to the
// fixed GOLDEN output below. Run via `node --test dual.e2e.mjs`.
//
// GTK needs a display + the Gtk-4.0 / Adw-1 typelibs, so BOTH builds are run under
// the same display (Xvfb in CI), with the software-only render env
// (GSK_RENDERER=cairo, LIBGL_ALWAYS_SOFTWARE=1, GTK_A11Y=none). The test
// SELF-SKIPS when no display is present (DISPLAY / WAYLAND_DISPLAY unset), so a
// plain headless `node --test` stays green; the dedicated `gtk-smoke` CI job runs
// it under `xvfb-run -a dbus-run-session`.
//
// GJS side: always built by the real `gjsify build --app gjs` bundler (the `gjs`
// binary must be on PATH).
//
// Node side: built by the real `gjsify build --app node` bundler when the
// installed `gjsify` CLI carries the `gi://` → `requireGi` rewrite + the
// `@gjsify/node-gi/globals` injection. The npm-published `@gjsify/cli` on the
// `latest` tag may still PREDATE that rewrite (it ships on `main`), so when an
// older CLI is installed the test runs the SAME source through the
// `@gjsify/node-gi` runtime directly via the exact module shape the bundler emits
// — `import '@gjsify/node-gi/globals'` plus `requireGi('Ns','ver')` in place of
// each `gi://` import. Either way the node output must equal the golden and the
// gjs output byte-for-byte. Once a rewrite-capable CLI is installed (locally
// today, or from npm once released) this automatically upgrades to the real
// `--app node` bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const gjsify = join(here, 'node_modules', '.bin', 'gjsify');

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// The fixed sequence of lines both runtimes must print, in order.
const GOLDEN = [
    'gtk-dual: start',
    'activated',
    'child: template',
    'title: hello',
    'css: applied',
    'action: hello',
    'quit',
    'done',
].join('\n');

// The software-only GTK render env for the run children. The display (DISPLAY)
// comes from the surrounding xvfb-run / real session; these keep GTK off any
// GPU/Vulkan path a headless Xvfb cannot provide and off the a11y bus. Merged
// over the inherited env (which already carries DISPLAY + whatever the CI wrapper
// set), so a value already present is preserved.
const RUN_ENV = {
    GSK_RENDERER: 'cairo',
    LIBGL_ALWAYS_SOFTWARE: '1',
    GTK_A11Y: 'none',
    ...process.env,
};

// Run a command, capturing stdout+stderr; on failure re-throw with both streams
// attached so a CI failure shows the real error (execFileSync otherwise hides
// the child's stderr behind a generic "Command failed" message).
function exec(cmd, args, timeoutMs, env) {
    try {
        return execFileSync(cmd, args, {
            cwd: here,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: timeoutMs,
            encoding: 'utf-8',
            env: env ?? process.env,
        });
    } catch (err) {
        const out = (err.stdout || '').toString();
        const e = (err.stderr || '').toString();
        throw new Error(
            `${cmd} ${args.join(' ')} failed (code ${err.status ?? err.code})\n--- stdout ---\n${out}\n--- stderr ---\n${e}`,
        );
    }
}

function build(app, outfile) {
    exec(gjsify, ['build', 'src/app.ts', '--app', app, '--outfile', outfile], 120 * 1000);
    const outPath = join(here, outfile);
    assert.ok(existsSync(outPath), `${outfile} was not produced`);
    return outPath;
}

// Run a built GTK bundle under the software render env, then keep ONLY the golden
// lifecycle lines: a headless GTK/dbus session prints assorted portal / a11y /
// gvfs warnings to stdout+stderr that vary by host, so the assertion is on the
// app's own deterministic lines (each carries a known prefix), not the raw stream.
const GOLDEN_PREFIXES = [
    'gtk-dual:',
    'activated',
    'child:',
    'title:',
    'css:',
    'action:',
    'quit',
    'done',
    'activate-error:',
];
function run(cmd, args) {
    const raw = exec(cmd, args, 60 * 1000, RUN_ENV);
    return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => GOLDEN_PREFIXES.some((p) => l === p || l.startsWith(p)))
        .join('\n');
}

// Produce the node-gi runtime twin of the bundler's `--app node` output from the
// shared source: prepend the globals shim + rewrite each `gi://Ns?version=X`
// default import to `requireGi('Ns','X')`. This is exactly what the bundler
// emits; it lets the @gjsify/node-gi runtime run the UNCHANGED source on Node
// when the installed CLI is older than the bundler rewrite.
function writeRuntimeTwin() {
    const src = readFileSync(join(here, 'src', 'app.ts'), 'utf-8');
    const rewritten = src.replace(
        /import\s+(\w+)\s+from\s+['"]gi:\/\/(\w+)\?version=([\d.]+)['"];?/g,
        (_m, ident, ns, ver) => `const ${ident} = requireGi('${ns}', '${ver}');`,
    );
    const body =
        "import '@gjsify/node-gi/globals';\n" + "import { requireGi } from '@gjsify/node-gi/gi';\n" + rewritten;
    mkdirSync(join(here, 'dist'), { recursive: true });
    const out = join(here, 'dist', 'app.node-runtime.mjs');
    writeFileSync(out, body);
    return out;
}

test(
    'one gi:// Adwaita source builds + runs byte-identically on gjs and node',
    { skip: haveDisplay ? false : 'no display (DISPLAY / WAYLAND_DISPLAY unset)' },
    (t) => {
        // --- GJS: the real bundler, native gi:// ---
        const gjsBundle = build('gjs', 'dist/app.gjs.mjs');
        const gjsOut = run('gjs', ['-m', gjsBundle]);
        assert.equal(gjsOut, GOLDEN, 'gjs output diverged from the golden');

        // --- Node: the real bundler when available, else the node-gi runtime twin ---
        const nodeBundle = build('node', 'dist/app.node.mjs');
        const capable = readFileSync(nodeBundle, 'utf-8').includes('requireGi');
        let nodeEntry;
        if (capable) {
            t.diagnostic('node target: real `gjsify build --app node` bundle (rewrite-capable CLI)');
            nodeEntry = nodeBundle;
        } else {
            t.diagnostic(
                'node target: installed @gjsify/cli predates the gi://→requireGi rewrite (unreleased on npm); running the same source through the @gjsify/node-gi runtime',
            );
            nodeEntry = writeRuntimeTwin();
        }
        const nodeOut = run('node', [nodeEntry]);

        assert.equal(nodeOut, GOLDEN, 'node output diverged from the golden');
        assert.equal(gjsOut, nodeOut, 'gjs and node outputs are not byte-identical');
    },
);
