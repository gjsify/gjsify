// E2E for the exact `create` / `showcase` command variations the homepage
// advertises, run on EACH of the four host runtimes gjsify supports.
//
// The homepage's runtime tabs show, per command, one invocation per runtime:
//
//   gjsify create <app>        · npx  @gjsify/cli create <app>
//   bunx  @gjsify/cli create <app>  · deno run -A npm:@gjsify/cli create <app>
//   gjsify showcase <name>     · npx  @gjsify/cli showcase <name>
//   bunx  @gjsify/cli showcase <name> · deno run -A npm:@gjsify/cli showcase <name>
//
// Since the CLI is host-runtime-aware (its default `--app`/`--runtime` follow
// the host it runs on — commit `feat(cli): make the CLI host-runtime-aware`),
// each invocation runs the command ON that runtime. This suite proves the CLI
// dispatches these correctly on all four hosts.
//
// Invoked the way the homepage's wrappers resolve locally, WITHOUT shelling out
// to real `npx`/`bunx`/`deno run npm:` network installs (the same pattern
// `showcase-runtime` + the `cli-cross-runtime` CI job use):
//   - node / bun / deno run `packages/infra/cli/lib/index.js`
//   - gjs runs the committed `packages/infra/cli/dist/cli.gjs.mjs` via `gjs -m`
//
// Bounded, display-free, addon-free, network-free:
//   - `create <app>` IS display-free → scaffolded for real on all four hosts,
//     and the four scaffolds are asserted identical.
//   - `showcase` LAUNCHES a GTK GUI → we never render it; we assert the
//     dispatch/routing only (list, JSON catalog, unknown-name error, the
//     4-way `--runtime` selector, the host-default advertised in `--help`).
//     The actual GUI launch is display-bound (and network-bound via `dlx` on
//     gjs) and is covered structurally by `tests/e2e/showcase-runtime`
//     (`run --runtime`) + the `cli-cross-runtime` CI job.
//
// Self-skips a runtime whose binary (`bun`/`deno`/`gjs`) is not on PATH, so CI
// legs without a runtime still pass (mirrors `showcase-runtime`).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_ENTRY = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
const GJS_BUNDLE = fileURLToPath(new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url));

// How each host launches the local CLI entry (+ the substring its banner
// reports so we can prove the CLI booted under THAT runtime). node is the host
// running `node --test`, so it is never skipped; bun/deno/gjs self-skip when
// their binary is absent.
const HOSTS = {
    node: { argv: (args) => [process.execPath, [LIB_ENTRY, ...args]], banner: /Running on Node\.js/ },
    bun: { argv: (args) => ['bun', [LIB_ENTRY, ...args]], banner: /Running on Bun/ },
    deno: { argv: (args) => ['deno', ['run', '-A', LIB_ENTRY, ...args]], banner: /Running on Deno/ },
    gjs: { argv: (args) => ['gjs', ['-m', GJS_BUNDLE, ...args]], banner: /Running on GJS/ },
};

function onPath(cmd) {
    try {
        return spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 15_000 }).status === 0;
    } catch {
        return false;
    }
}

function run(runtime, args, { cwd, timeoutMs = 60_000 } = {}) {
    const [bin, argv] = HOSTS[runtime].argv(args);
    return new Promise((resolve, reject) => {
        const child = spawn(bin, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const kill = setTimeout(() => {
            // ChildProcess.kill with a known signal never throws — failure
            // to deliver just returns false (the process already exited).
            child.kill('SIGKILL');
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

/** Sorted relative file list of a scaffolded tree (for cross-host equality). */
function listFiles(root) {
    const out = [];
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) stack.push(full);
            else out.push(relative(root, full));
        }
    }
    return out.sort();
}

// Cross-host reference: the first host to scaffold sets it, every later host
// asserts byte-identical output — proving all four homepage `create`
// invocations produce the SAME project.
let reference = null;

describe('homepage create/showcase variations across runtimes', { timeout: 5 * 60 * 1000 }, () => {
    for (const runtime of Object.keys(HOSTS)) {
        describe(`host: ${runtime}`, () => {
            let available = true;
            let tmp;

            before(() => {
                if (runtime !== 'node' && !onPath(runtime)) {
                    available = false;
                    return;
                }
                tmp = mkdtempSync(join(tmpdir(), `gjsify-e2e-homepage-${runtime}-`));
            });

            after(() => {
                if (tmp) rmSync(tmp, { recursive: true, force: true });
            });

            // The CLI boots under this host and its banner names the host
            // runtime — the host-runtime-aware detector working end-to-end.
            it('boots under the host and its banner names the runtime', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['--help']);
                assert.equal(r.status, 0, r.stderr);
                assert.match(r.stdout, /Running on /);
                assert.match(r.stdout, HOSTS[runtime].banner);
            });

            // `create <app>` — display-free: scaffolded for real, then compared
            // across hosts. This is the `create` homepage row per runtime.
            it('create <app> scaffolds a valid project (identical across hosts)', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['create', 'my-app', '--template', 'cli'], { cwd: tmp });
                assert.equal(r.status, 0, `create failed:\n${r.stderr}\n${r.stdout}`);

                const proj = join(tmp, 'my-app');
                for (const f of ['package.json', 'tsconfig.json', 'README.md', join('src', 'index.ts')]) {
                    assert.ok(existsSync(join(proj, f)), `scaffold missing ${f}`);
                }
                const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf-8'));
                assert.equal(pkg.name, 'my-app', 'project name not rewritten');
                assert.notEqual(pkg.name, 'new-gjsify-app', 'sentinel name leaked through');

                const manifest = {
                    files: listFiles(proj),
                    pkg: readFileSync(join(proj, 'package.json'), 'utf-8'),
                    index: readFileSync(join(proj, 'src', 'index.ts'), 'utf-8'),
                };
                if (!reference) reference = { runtime, manifest };
                else
                    assert.deepEqual(
                        manifest,
                        reference.manifest,
                        `${runtime} scaffold differs from ${reference.runtime}`,
                    );
            });

            // `showcase` (no args) lists the curated catalog — dispatch reached,
            // manifest resolved (its path differs under the gjs bundle).
            it('showcase lists the curated catalog', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['showcase']);
                assert.equal(r.status, 0, r.stderr);
                assert.match(r.stdout, /Available gjsify showcases/);
                assert.match(r.stdout, /canvas2d-fireworks/);
            });

            it('showcase --json emits a valid catalog', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['showcase', '--json']);
                assert.equal(r.status, 0, r.stderr);
                const catalog = JSON.parse(r.stdout);
                assert.ok(Array.isArray(catalog) && catalog.length > 0, 'empty/invalid catalog');
                assert.ok(
                    catalog.some((e) => e.name === 'canvas2d-fireworks'),
                    'known showcase missing from catalog',
                );
            });

            // Unknown name → clean exit 1, never a GUI and never a crash. (Under
            // gjs a bare `process.exit` used to fall through to `undefined`
            // showcase access → `m_should_exit` core dump — guard against it.)
            it('showcase <unknown> fails cleanly (no GUI, no crash)', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['showcase', 'no-such-showcase-xyz']);
                assert.equal(r.status, 1, `expected clean exit 1, got ${r.status}`);
                assert.match(r.stdout + r.stderr, /Unknown showcase/);
                assert.doesNotMatch(r.stdout + r.stderr, /m_should_exit|core dumped|Bail out/);
            });

            // The name is resolved before any runtime dispatch, so `--runtime`
            // co-exists and the unknown-name error still wins (no GUI launch).
            it('showcase <unknown> --runtime <host> still errors on the name', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['showcase', 'no-such-showcase-xyz', '--runtime', runtime]);
                assert.equal(r.status, 1, `expected clean exit 1, got ${r.status}`);
                assert.match(r.stdout + r.stderr, /Unknown showcase/);
            });

            // The 4-way `--runtime` selector is wired: an out-of-set value is
            // rejected with the declared choices (locale-independent literals).
            it('showcase --runtime <bogus> is rejected by the selector', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['showcase', 'canvas2d-fireworks', '--runtime', 'bogus']);
                assert.notEqual(r.status, 0, 'invalid runtime should fail');
                const out = r.stdout + r.stderr;
                assert.match(out, /runtime/);
                assert.match(out, /bogus/);
                // The 4 valid choices are echoed regardless of the yargs locale.
                for (const rt of ['gjs', 'node', 'bun', 'deno']) assert.match(out, new RegExp(rt));
            });

            // `--help` advertises that the default runtime follows the host —
            // i.e. the host-default is picked when `--runtime`/`--app` is omitted.
            it('showcase --help advertises the host-default runtime', async (t) => {
                if (!available) return t.skip(`${runtime} not on PATH`);
                const r = await run(runtime, ['showcase', '--help']);
                assert.equal(r.status, 0, r.stderr);
                assert.match(r.stdout, /--runtime/);
                assert.match(r.stdout, /host runtime/);
            });

            // The actual showcase GUI launch on this runtime needs a display
            // (and, on gjs, a network `dlx` install), so it cannot run in the
            // headless CI e2e sandbox. The runtime-launch ROUTING it shares with
            // `run --runtime` is covered by `tests/e2e/showcase-runtime`, and the
            // CLI-on-every-runtime axis by the `cli-cross-runtime` CI job.
            it.skip('showcase <name> launches the GUI on the host runtime (needs a display)', () => {});
        });
    }
});
