// SPDX-License-Identifier: MIT
//
// Quad-runtime E2E harness for the @gjsify/node-gi cross-runtime proof.
//
// ONE unchanged `gi://` source builds + runs with byte-identical output on FOUR
// runtimes:
//   • gjs  — `gjsify build --app gjs` → native `gi://` (the reference)
//   • node — `gjsify build --app node` → `@gjsify/node-gi` reverse bridge
//   • bun  — the SAME `--app node` bundle (Node-API addon; Bun's common ABI)
//   • deno — the SAME `--app node` bundle (`--node-modules-dir=manual`)
//
// gjs is the REFERENCE: node/bun/deno output must equal the gjs output exactly
// (and, for a scenario that declares one, a fixed golden). A runtime not on PATH
// is skipped with a diagnostic, so the harness runs gjs+node in the light CI leg
// and all four where bun+deno are installed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const gjsify = join(here, 'node_modules', '.bin', 'gjsify');

// Every runtime we know how to build for + run on. `on(entry)` returns the argv
// that runs the built entry under that runtime. gjs runs the native `--app gjs`
// bundle; node/bun/deno run the `--app node` bundle (or its runtime twin).
const RUNTIMES = {
    gjs: { probe: 'gjs', on: (entry) => ['gjs', ['-m', entry]] },
    node: { probe: 'node', on: (entry) => ['node', [entry]] },
    bun: { probe: 'bun', on: (entry) => ['bun', [entry]] },
    // manual: use the existing node_modules as-is — `auto` would re-resolve the
    // example's heavy build-time dep tree (@gjsify/cli + all platform binaries)
    // and hang; the app only needs the runtime dep @gjsify/node-gi, already linked.
    deno: { probe: 'deno', on: (entry) => ['deno', ['run', '-A', '--node-modules-dir=manual', entry]] },
};

function isOnPath(cmd) {
    try {
        execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

/** Which of gjs/node/bun/deno are runnable here (node is always assumed — we ARE node). */
export function availableRuntimes() {
    return Object.keys(RUNTIMES).filter((rt) => (rt === 'node' ? true : isOnPath(RUNTIMES[rt].probe)));
}

// Run a command capturing stdout+stderr; on failure re-throw with both streams so
// a CI log shows the child's real error (execFileSync hides stderr otherwise).
function exec(cmd, args, timeoutMs) {
    try {
        return execFileSync(cmd, args, {
            cwd: here,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: timeoutMs,
            encoding: 'utf-8',
        });
    } catch (err) {
        const out = (err.stdout || '').toString();
        const e = (err.stderr || '').toString();
        throw new Error(
            `${cmd} ${args.join(' ')} failed (code ${err.status ?? err.code})\n--- stdout ---\n${out}\n--- stderr ---\n${e}`,
        );
    }
}

function build(app, srcFile, outfile) {
    exec(gjsify, ['build', srcFile, '--app', app, '--outfile', outfile], 120 * 1000);
    const outPath = join(here, outfile);
    assert.ok(existsSync(outPath), `${outfile} was not produced`);
    return outPath;
}

// The node-gi runtime twin of the bundler's `--app node` output: prepend the
// globals shim + rewrite each `gi://Ns?version=X` default import to
// `requireGi('Ns','X')` — the exact shape the bundler emits, used when the
// installed CLI predates the gi://→requireGi rewrite. Runs unchanged on
// node/bun/deno.
function writeRuntimeTwin(srcFile, outfile) {
    const src = readFileSync(join(here, srcFile), 'utf-8');
    const rewritten = src.replace(
        /import\s+(\w+)\s+from\s+['"]gi:\/\/(\w+)\?version=([\d.]+)['"];?/g,
        (_m, ident, ns, ver) => `const ${ident} = requireGi('${ns}', '${ver}');`,
    );
    const body =
        "import '@gjsify/node-gi/globals';\n" +
        "import { requireGi } from '@gjsify/node-gi/gi';\n" +
        rewritten;
    mkdirSync(join(here, 'dist'), { recursive: true });
    const out = join(here, outfile);
    writeFileSync(out, body);
    return out;
}

/**
 * Build + run a scenario on every available runtime and assert byte-identical
 * output. gjs is the reference; node/bun/deno must match it (and the golden if
 * given). Returns the map of runtime → output for further assertions.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ name: string, srcFile: string, base: string, golden?: string }} scenario
 *   base = dist basename stem (e.g. "app" → dist/app.gjs.mjs / dist/app.node.mjs)
 */
export function runScenario(t, { name, srcFile, base, golden }) {
    const runtimes = availableRuntimes();
    const outputs = {};

    // gjs — always the real bundler + native gi:// (the reference).
    assert.ok(runtimes.includes('gjs'), `gjs must be on PATH to run scenario "${name}"`);
    const gjsBundle = build('gjs', srcFile, `dist/${base}.gjs.mjs`);
    outputs.gjs = exec(...RUNTIMES.gjs.on(gjsBundle), 60 * 1000).trim();
    if (golden !== undefined) assert.equal(outputs.gjs, golden, `${name}: gjs diverged from golden`);

    // node/bun/deno — the real `--app node` bundle when the CLI is rewrite-capable,
    // else the runtime twin. ONE artifact, run under each runtime.
    const nodeBundle = build('node', srcFile, `dist/${base}.node.mjs`);
    const capable = readFileSync(nodeBundle, 'utf-8').includes('requireGi');
    let nodeEntry = nodeBundle;
    if (!capable) {
        t.diagnostic(`${name}: installed @gjsify/cli predates gi://→requireGi; using the runtime twin`);
        nodeEntry = writeRuntimeTwin(srcFile, `dist/${base}.node-runtime.mjs`);
    } else {
        t.diagnostic(`${name}: real \`gjsify build --app node\` bundle`);
    }

    for (const rt of ['node', 'bun', 'deno']) {
        if (!runtimes.includes(rt)) {
            t.diagnostic(`${name}: ${rt} not on PATH — skipped`);
            continue;
        }
        outputs[rt] = exec(...RUNTIMES[rt].on(nodeEntry), 60 * 1000).trim();
        assert.equal(outputs[rt], outputs.gjs, `${name}: ${rt} output is not byte-identical to gjs`);
    }

    return outputs;
}
