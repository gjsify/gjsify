// E2E test for `gjsify dev` — the watch → rebuild → relaunch loop.
//
// TWO hosts, and the second one is the point. `gjsify dev` exists because
// `gjsify build --watch` needs rolldown's npm-only watcher API, i.e. it cannot
// serve a Node-free GJS host — so a suite that drove only the Node CLI would
// reproduce, in the replacement, exactly the gap it was written to close
// (`tests/e2e/build-watch` proves watch works only where Node is available).
// Everything the loop promises was in fact broken under GJS while the Node rows
// were green: the CLI printed "watching …" and exited 0 with the app it had
// launched left orphaned, `gjsify run dev` exited on the first build, and the
// SIGINT handler was a listener nothing ever emitted.
//
// So the Node rows below pin the loop's LOGIC (which flags reach the bundler,
// one rebuild per edit, the diagnostics) and the GJS rows pin that the process
// is still there to run it. The GJS rows are gated the way the other suites gate
// optional runtimes — no `gjs`, no committed CLI bundle, no `rolldown-native`
// prebuild for this arch ⇒ skip, never a false red off a capable host.
//
// `--runtime node` keeps the suite headless on both: the launched app is a plain
// Node bundle that prints a marker and stays alive, so "did it relaunch" is a
// second marker on stdout rather than a window on a display.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    writeFileSync,
    readFileSync,
    mkdirSync,
    existsSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MONOREPO_ROOT, prebuildDir, spawnUntilReady, hasCommand } from '../helpers.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const CLI_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const WS_MODULES = join(MONOREPO_ROOT, 'node_modules');

/** `@gjsify/rolldown-native`'s prebuild for this host — the GJS build engine. */
const NATIVE_PREBUILD =
    process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64')
        ? prebuildDir('infra', 'rolldown-native', `linux-${process.arch}`)
        : null;

// Everything the GJS rows need beyond `gjs` itself. Each absence is a host that
// cannot answer the question, not an answer.
const SKIP_GJS =
    !hasCommand('gjs') ||
    !existsSync(CLI_BUNDLE) ||
    !NATIVE_PREBUILD ||
    !existsSync(join(NATIVE_PREBUILD, 'GjsifyRolldown-1.0.typelib')) ||
    !existsSync(join(WS_MODULES, '@gjsify'));

/**
 * A package whose `build:node` script is the ONLY place the build flags live —
 * `gjsify dev` is given no entry point, no `--outfile` and no `--globals`, so
 * anything that reaches the bundler came out of that script.
 */
function writeProject(projectDir, source) {
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify(
            {
                name: 'dev-command-fixture',
                version: '1.0.0',
                type: 'module',
                private: true,
                scripts: {
                    'build:node': 'gjsify build src/index.ts --app node --outfile dist/index.node.mjs --no-minify',
                },
                gjsify: { example: { node: 'dist/index.node.mjs' } },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(join(projectDir, 'src', 'index.ts'), source, 'utf-8');
}

/**
 * Source for an app that records its own PID and keeps running — the shape of a
 * real app holding a main loop open, so the loop has a live child to kill. The
 * PID is what lets the suite ask whether the OLD process actually went away,
 * which "a second marker was printed" on its own does not answer.
 *
 * `pidPath` is a parameter rather than `<projectDir>/app.pid` because a fixture
 * that writes into the watched tree is a fixture that edits its own sources: the
 * flat project below watches the project ROOT, and a pid file dropped there
 * would drive the loop the row is trying to measure.
 */
function longRunningApp(pidPath, marker) {
    const pidFile = JSON.stringify(pidPath);
    return [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${pidFile}, String(process.pid));`,
        `console.log('started ${marker}');`,
        'setInterval(() => {}, 60000);',
        '',
    ].join('\n');
}

const startDev = (projectDir, args, ready) =>
    spawnUntilReady('node', [CLI_ENTRY, 'dev', ...args], {
        cwd: projectDir,
        ready,
        label: 'gjsify dev',
        timeoutMs: 90 * 1000,
    });

/**
 * The same fixture, but with the entry at the project ROOT — so the watch dir
 * derives to `.` and every build writes `dist/` INTO the watched tree.
 *
 * This is the arrangement that used to make the loop feed itself: one edit, then
 * a rebuild every ~5 s forever, because the bundle it had just written was a
 * change under the directory it was watching.
 */
function writeFlatProject(projectDir, source) {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify(
            {
                name: 'dev-flat-fixture',
                version: '1.0.0',
                type: 'module',
                private: true,
                scripts: { 'build:node': 'gjsify build index.ts --app node --outfile dist/out.mjs --no-minify' },
                gjsify: { example: { node: 'dist/out.mjs' } },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(join(projectDir, 'index.ts'), source, 'utf-8');
}

/**
 * A project that is NOT flat: the entry sits at the root (so the watch dir derives
 * to `.`, with `dist/` written INTO it) and the module it imports lives one
 * directory down, in `components/`.
 *
 * Every other fixture in this suite keeps its whole source in one top-level file,
 * which is exactly why `fs.watch(dir, { recursive: true })` silently ignoring
 * `recursive` under GJS was invisible from here: a flat tree is the one shape a
 * FLAT directory monitor covers completely. On a real project — an edit to
 * `components/Button.tsx` — the loop produced no rebuild at all and the suite
 * stayed green. The nested module carries that extension for the same reason;
 * whether its JSX would COMPILE is `tests/e2e/jsx-config-gate`'s question, not
 * this row's.
 *
 * Both halves of the arrangement are load-bearing, and the row measures both.
 * Recursion makes `dist/` and the linked `node_modules/` watched directories too,
 * so the reported filename has to be the path relative to the watched dir for
 * `isSelfWrite` to recognise the bundle the loop just wrote; a basename does not
 * resolve back to it, and the loop feeds itself forever.
 */
function writeNestedProject(projectDir, pidPath, marker) {
    mkdirSync(join(projectDir, 'components'), { recursive: true });
    writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify(
            {
                name: 'dev-nested-fixture',
                version: '1.0.0',
                type: 'module',
                private: true,
                scripts: { 'build:node': 'gjsify build index.ts --app node --outfile dist/out.mjs --no-minify' },
                gjsify: { example: { node: 'dist/out.mjs' } },
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    writeFileSync(
        join(projectDir, 'index.ts'),
        [
            "import { writeFileSync } from 'node:fs';",
            "import { MARKER } from './components/marker.js';",
            `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
            "console.log('started ' + MARKER);",
            'setInterval(() => {}, 60000);',
            '',
        ].join('\n'),
        'utf-8',
    );
    writeNestedMarker(projectDir, marker);
}

/** Rewrite ONLY the nested module — the entry point is left untouched. */
function writeNestedMarker(projectDir, marker) {
    writeFileSync(
        join(projectDir, 'components', 'marker.tsx'),
        `export const MARKER = ${JSON.stringify(marker)};\n`,
        'utf-8',
    );
}

/**
 * Link the workspace packages the GJS build engine resolves, instead of running a
 * real install into every fixture. `@girs`/`rolldown` come along because the
 * bundler's own resolution reaches for them.
 */
function linkWorkspaceModules(projectDir) {
    const modules = join(projectDir, 'node_modules');
    mkdirSync(modules, { recursive: true });
    for (const pkg of ['@gjsify', '@girs', 'rolldown', '@rolldown']) {
        const src = join(WS_MODULES, pkg);
        if (existsSync(src) && !existsSync(join(modules, pkg))) symlinkSync(src, join(modules, pkg), 'dir');
    }
}

function readPid(pidFile) {
    const pid = Number(readFileSync(pidFile, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Whether `pid` is still RUNNING — a zombie counts as gone.
 *
 * Signal 0 alone cannot answer this. It succeeds on a zombie too, because the
 * pid still exists until someone reaps it, and the reaper is exactly what
 * differs between the two places this suite runs: a desktop session reparents
 * an orphan onto an init that reaps it within milliseconds, while the CI
 * container's pid 1 is the job shell, which reaps nothing. So a child that
 * `gjsify dev` correctly killed on its way out stays visible to `kill(pid, 0)`
 * FOREVER there — measured: this test timed out after 20 s in the container
 * while passing in 0.8 s locally, on a process that was already dead.
 *
 * `/proc` gives the state directly. Elsewhere signal 0 is the best available
 * answer, and the platforms without `/proc` are also the ones that reap.
 */
function processState(pid) {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
        // The comm field is parenthesised and may itself contain ')' — the
        // state is the first token after the LAST one.
        return (
            stat
                .slice(stat.lastIndexOf(')') + 1)
                .trim()
                .split(/\s+/)[0] ?? null
        );
    } catch {
        return null;
    }
}

function isAlive(pid) {
    const state = processState(pid);
    if (state !== null) return state !== 'Z';
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        // ESRCH — the process is gone, which is the answer, not an error.
        return false;
    }
}

/** Poll `probe()` until it returns true, or fail with what was seen instead. */
async function waitFor(probe, describeState, timeoutMs = 90 * 1000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (probe()) return;
        if (Date.now() > deadline) throw new Error(`timeout: ${describeState()}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

describe('gjsify dev E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-dev-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`gjsify workspace @gjsify/cli run build\``);
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('rebuilds using the flags the build script declares', async () => {
        const projectDir = join(tmpDir, 'rebuild');
        writeProject(projectDir, "export const msg = 'first';\nconsole.log(msg);\n");
        const outfile = join(projectDir, 'dist', 'index.node.mjs');
        const session = await startDev(
            projectDir,
            ['--runtime', 'node', '--build-only', '--debounce', '50'],
            /\[dev\] watching src/,
        );

        try {
            // The command was told neither what to build nor where to put it, so
            // a bundle at exactly this path is the script's own entry point and
            // `--outfile` arriving at the bundler.
            assert.ok(existsSync(outfile), `first build never produced ${outfile}\n${session.output()}`);
            assert.match(readFileSync(outfile, 'utf-8'), /first/, 'first build should embed the initial source');

            writeFileSync(join(projectDir, 'src', 'index.ts'), "export const msg = 'second-edit';\n", 'utf-8');
            await waitFor(
                () => readFileSync(outfile, 'utf-8').includes('second-edit'),
                () => `rebuild never picked up the edit; output:\n${session.output()}`,
            );
            assert.doesNotMatch(readFileSync(outfile, 'utf-8'), /'first'/, 'rebuild left stale source in the bundle');
        } finally {
            await session.stop();
        }
    });

    it('relaunches the app after a rebuild', async () => {
        const projectDir = join(tmpDir, 'relaunch');
        writeProject(projectDir, longRunningApp(join(projectDir, 'app.pid'), 'BOOT-A'));
        const session = await startDev(projectDir, ['--runtime', 'node', '--debounce', '50'], /started BOOT-A/);

        try {
            const firstPid = readPid(join(projectDir, 'app.pid'));
            assert.ok(firstPid, 'the launched app never recorded a pid');

            writeFileSync(
                join(projectDir, 'src', 'index.ts'),
                longRunningApp(join(projectDir, 'app.pid'), 'BOOT-B'),
                'utf-8',
            );
            await waitFor(
                () => session.output().includes('started BOOT-B'),
                () => `app never relaunched; output:\n${session.output()}`,
            );
            // A relaunch, not a second app beside the first: the previous process
            // must be gone, or every save would leak one.
            await waitFor(
                () => !isAlive(firstPid),
                () => `the previous app (pid ${firstPid}) survived the relaunch`,
                30 * 1000,
            );
        } finally {
            await session.stop();
        }
    });

    it('stops the app it launched when it is interrupted', async () => {
        const projectDir = join(tmpDir, 'shutdown');
        writeProject(projectDir, longRunningApp(join(projectDir, 'app.pid'), 'GUARD'));
        const session = await startDev(projectDir, ['--runtime', 'node', '--debounce', '50'], /started GUARD/);

        try {
            const appPid = readPid(join(projectDir, 'app.pid'));
            assert.ok(appPid, 'the launched app never recorded a pid');

            // Signalled by PID, not by process group: the group kill would reach
            // the app directly and prove nothing about who took it down.
            process.kill(session.child.pid, 'SIGINT');
            await Promise.race([
                session.exited,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`dev did not exit on SIGINT:\n${session.output()}`)), 20000),
                ),
            ]);
            await waitFor(
                () => !isAlive(appPid),
                () =>
                    `the app (pid ${appPid}) was orphaned when dev exited (state: ${processState(appPid) ?? 'unknown'})`,
                20 * 1000,
            );
        } finally {
            await session.stop();
        }
    });

    it('rebuilds once per edit, not once per build it just wrote', async () => {
        const projectDir = join(tmpDir, 'self-write');
        const pidFile = join(tmpDir, 'self-write.pid');
        writeFlatProject(projectDir, longRunningApp(pidFile, 'ONCE-A'));
        const session = await startDev(projectDir, ['--runtime', 'node', '--debounce', '50'], /started ONCE-A/);

        try {
            writeFileSync(join(projectDir, 'index.ts'), longRunningApp(pidFile, 'ONCE-B'), 'utf-8');
            await waitFor(
                () => session.output().includes('started ONCE-B'),
                () => `the edit was never picked up; output:\n${session.output()}`,
            );
            // The discriminator is what happens NEXT: a loop watching its own
            // output relaunches again a build later, so the count keeps climbing
            // while nothing is edited. One build here measured ~5 s, so this
            // window covers several rounds of it.
            await new Promise((resolve) => setTimeout(resolve, 15 * 1000));
            const launches = session.output().match(/started ONCE-/g) ?? [];
            assert.equal(
                launches.length,
                2,
                `expected exactly one relaunch for one edit, saw ${launches.length} launches:\n${session.output()}`,
            );
        } finally {
            await session.stop();
        }
    });

    it('names both fixes when there is nothing to build', async () => {
        const projectDir = join(tmpDir, 'no-script');
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'no-script', version: '1.0.0', type: 'module', private: true }, null, 2) + '\n',
            'utf-8',
        );

        const session = await spawnUntilReady('node', [CLI_ENTRY, 'dev', '--runtime', 'node'], {
            cwd: projectDir,
            ready: /gjsify dev src\/index\.ts/,
            awaitExit: true,
            label: 'gjsify dev (no build script)',
            timeoutMs: 60 * 1000,
        });

        assert.notEqual(session.code, 0, 'dev with nothing to build should fail');
        assert.match(session.output(), /--script/);
    });
});

describe('gjsify dev under GJS', { skip: SKIP_GJS, timeout: 8 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-dev-gjs-'));
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    /** The GJS-bundled CLI, with the native bundler engine on its library path. */
    const startGjs = (projectDir, argv, ready) =>
        spawnUntilReady('gjs', ['-m', CLI_BUNDLE, ...argv], {
            cwd: projectDir,
            ready,
            label: `gjs cli ${argv[0]}`,
            timeoutMs: 4 * 60 * 1000,
            env: {
                ...process.env,
                HOME: tmpDir,
                XDG_CACHE_HOME: join(tmpDir, '.cache'),
                GI_TYPELIB_PATH: NATIVE_PREBUILD,
                LD_LIBRARY_PATH: NATIVE_PREBUILD,
            },
        });

    it('stays alive, rebuilds and relaunches, and stops the app on SIGINT', async () => {
        const projectDir = join(tmpDir, 'loop');
        writeProject(projectDir, longRunningApp(join(projectDir, 'app.pid'), 'GJS-A'));
        linkWorkspaceModules(projectDir);
        const session = await startGjs(projectDir, ['dev', '--runtime', 'node', '--debounce', '50'], /started GJS-A/);

        try {
            const firstPid = readPid(join(projectDir, 'app.pid'));
            assert.ok(firstPid, 'the launched app never recorded a pid');

            // Reaching this at all is the first assertion: the CLI used to print
            // its two lines, launch the app and EXIT 0 here, because nothing held
            // the GJS process open once the entry module's top-level await
            // settled. `spawnUntilReady` would then have reported an exit before
            // ready — but only if it got there before the marker; the edit below
            // is what needs the loop to still be running.
            writeFileSync(
                join(projectDir, 'src', 'index.ts'),
                longRunningApp(join(projectDir, 'app.pid'), 'GJS-B'),
                'utf-8',
            );
            await waitFor(
                () => session.output().includes('started GJS-B'),
                () => `no rebuild under GJS; output:\n${session.output()}`,
                4 * 60 * 1000,
            );
            await waitFor(
                () => !isAlive(firstPid),
                () => `the previous app (pid ${firstPid}) survived the relaunch under GJS`,
                60 * 1000,
            );

            // Ctrl+C is how this command ends. Signalled by PID rather than to
            // the group, so what is measured is the handler and not the terminal:
            // under GJS `process.on('SIGINT')` registered a listener nothing ever
            // emitted, so the default disposition killed the CLI and left the app
            // behind.
            const appPid = readPid(join(projectDir, 'app.pid'));
            process.kill(session.child.pid, 'SIGINT');
            await Promise.race([
                session.exited,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`dev did not exit on SIGINT:\n${session.output()}`)), 30000),
                ),
            ]);
            await waitFor(
                () => !isAlive(appPid),
                () => `the app (pid ${appPid}) was orphaned when dev exited under GJS`,
                30 * 1000,
            );
        } finally {
            await session.stop();
        }
    });

    it('survives `gjsify run dev`, the entry point the templates print', async () => {
        const projectDir = join(tmpDir, 'run-dev');
        writeProject(projectDir, "export const msg = 'run-first';\nconsole.log(msg);\n");
        linkWorkspaceModules(projectDir);
        const pkgPath = join(projectDir, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        pkg.scripts.dev = 'gjsify dev --runtime node --build-only --debounce 50';
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

        // Under GJS `gjsify run <script>` dispatches a single `gjsify …` script
        // IN-PROCESS and exits on the result — which for a watch loop is the
        // moment it finished arming, not the moment it is done.
        const outfile = join(projectDir, 'dist', 'index.node.mjs');
        const session = await startGjs(projectDir, ['run', 'dev'], /\[dev\] watching src/);

        try {
            await waitFor(
                () => existsSync(outfile) && readFileSync(outfile, 'utf-8').includes('run-first'),
                () => `the first build never landed; output:\n${session.output()}`,
                4 * 60 * 1000,
            );
            const firstBuild = statSync(outfile).mtimeMs;
            writeFileSync(join(projectDir, 'src', 'index.ts'), "export const msg = 'run-second';\n", 'utf-8');
            await waitFor(
                // Guarded: a rebuild may REPLACE the file rather than write
                // through it, and a bare `statSync` would then throw ENOENT out
                // of the probe — reporting a mid-write moment as a failure.
                () => {
                    try {
                        return (
                            statSync(outfile).mtimeMs > firstBuild &&
                            readFileSync(outfile, 'utf-8').includes('run-second')
                        );
                    } catch {
                        return false;
                    }
                },
                () => `\`gjsify run dev\` did not survive its first build; output:\n${session.output()}`,
                4 * 60 * 1000,
            );
        } finally {
            await session.stop();
        }
    });

    it('rebuilds for an edit in a SUBDIRECTORY of the watched tree', async () => {
        const projectDir = join(tmpDir, 'nested');
        // The pid file goes OUTSIDE the project: this fixture watches its own root, so
        // anything written inside it drives the loop the row is measuring.
        const pidFile = join(tmpDir, 'nested.pid');
        writeNestedProject(projectDir, pidFile, 'NEST-A');
        linkWorkspaceModules(projectDir);
        const session = await startGjs(projectDir, ['dev', '--runtime', 'node', '--debounce', '50'], /started NEST-A/);

        try {
            // Under GJS `recursive` was accepted and dropped — a Gio directory monitor
            // reports its direct children only — so this edit reached nothing at all and
            // the wait below ran to its timeout with the app still on NEST-A.
            writeNestedMarker(projectDir, 'NEST-B');
            await waitFor(
                () => session.output().includes('started NEST-B'),
                () => `a nested edit produced no rebuild under GJS; output:\n${session.output()}`,
                4 * 60 * 1000,
            );

            // ONE rebuild. Recursion put `dist/` and the linked `node_modules/` under
            // watch as well, so a loop that cannot recognise its own output relaunches
            // again a build later and keeps climbing while nothing is edited. One build
            // here measures in seconds, so this window covers several rounds of it.
            await new Promise((resolve) => setTimeout(resolve, 15 * 1000));
            const launches = session.output().match(/started NEST-/g) ?? [];
            assert.equal(
                launches.length,
                2,
                `expected exactly one rebuild for one nested edit, saw ${launches.length}:\n${session.output()}`,
            );
        } finally {
            await session.stop();
        }
    });
});
