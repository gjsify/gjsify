// SPDX-License-Identifier: MIT
// @gjsify/node-gi — uv-driven GLib auto-pump tests (the NON-blocking case).
//
// Under GJS the GLib main loop IS the process loop, so pending GLib sources (Gio
// async completions, GLib timeouts/idles) always dispatch. Under node-gi a plain
// `node bundle.mjs` used to need a blocking GLib.MainLoop.run() for anything
// GLib-scheduled to fire — an `await` on a Gio async op simply hung. The auto-pump
// (src/loop.cc, armed by startMainLoop) integrates the default GLib main context
// with Node's libuv loop: a uv_prepare/uv_check pair drains ready GLib sources
// each loop turn, a mirrored uv_timer wakes libuv for GLib's earliest timer, and
// uv_poll watchers on the context's queried fds (including its cross-thread
// wakeup eventfd) wake libuv for I/O and GTask completions.
//
// Keep-alive contract (asserted via CHILD processes — under node:test the
// runner's own handles mask process-lifetime effects):
//   • an in-flight scope=async GI callback (GAsyncReadyCallback) keeps the
//     process alive until the completion dispatches — like in-flight Node I/O;
//   • an armed GLib timeout keeps the process alive like a due setTimeout;
//   • a purely-sync program still exits promptly (the pump alone holds no ref).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireGi } from '../gi.js';

const giUrl = new URL('../gi.js', import.meta.url).href;

// Guard every awaited pump path with a clean timeout so a drain regression fails
// with a message instead of wedging the test runner. The guard timer is unref'd —
// it must not itself keep the loop alive (that would mask keep-alive bugs).
function withTimeout(promise, ms, what) {
    let timer;
    const guard = new Promise((_resolve, reject) => {
        timer = setTimeout(
            () =>
                reject(
                    new Error(`${what} did not settle within ${ms}ms — the auto-pump is not draining the GLib context`),
                ),
            ms,
        );
        timer.unref?.();
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

test('a Gio async op completes and settles an await without a blocking loop', async () => {
    const Gio = requireGi('Gio', '2.0');
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-pump-'));
    const path = join(dir, 'fixture.txt');
    writeFileSync(path, 'pumped without a mainloop');
    try {
        const file = Gio.File.new_for_path(path);
        const result = await withTimeout(
            new Promise((resolve, reject) => {
                file.load_contents_async(null, (_source, res) => {
                    try {
                        resolve(file.load_contents_finish(res));
                    } catch (error) {
                        reject(error);
                    }
                });
            }),
            10000,
            'Gio.File.load_contents_async',
        );
        // load_contents_finish → [ok, contents, etag]
        assert.equal(result[0], true);
        assert.equal(Buffer.from(result[1]).toString('utf8'), 'pumped without a mainloop');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a GLib timeout resolves an awaited promise without a blocking loop', async () => {
    const GLib = requireGi('GLib', '2.0');
    const t0 = Date.now();
    await withTimeout(
        new Promise((resolve) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                resolve();
                return false;
            });
        }),
        10000,
        'GLib.timeout_add(50ms)',
    );
    // The timeout must have genuinely waited (the pump mirrors GLib's deadline
    // into a uv timer rather than busy-dispatching it early).
    assert.ok(Date.now() - t0 >= 40, `fired after ${Date.now() - t0}ms — expected >= ~50ms`);
});

test('a GLib idle fires without a blocking loop', async () => {
    const GLib = requireGi('GLib', '2.0');
    await withTimeout(
        new Promise((resolve) => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                resolve();
                return false;
            });
        }),
        10000,
        'GLib.idle_add',
    );
});

test('many concurrent Gio async ops all settle', async () => {
    const Gio = requireGi('Gio', '2.0');
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-pump-'));
    try {
        const jobs = [];
        for (let i = 0; i < 8; i++) {
            const path = join(dir, `f${i}.txt`);
            writeFileSync(path, `content-${i}`);
            const file = Gio.File.new_for_path(path);
            jobs.push(
                new Promise((resolve, reject) => {
                    file.load_contents_async(null, (_source, res) => {
                        try {
                            resolve(Buffer.from(file.load_contents_finish(res)[1]).toString('utf8'));
                        } catch (error) {
                            reject(error);
                        }
                    });
                }),
            );
        }
        const all = await withTimeout(Promise.all(jobs), 15000, '8 concurrent load_contents_async');
        assert.deepEqual(all.sort(), Array.from({ length: 8 }, (_v, i) => `content-${i}`).sort());
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a blocking MainLoop.run still co-pumps libuv after pump-driven activity', async () => {
    const GLib = requireGi('GLib', '2.0');
    // First, pump-driven work…
    await withTimeout(
        new Promise((resolve) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                resolve();
                return false;
            });
        }),
        10000,
        'pre-run GLib.timeout_add',
    );
    // …then the classic blocking-loop case: a NODE timer must still fire inside
    // the blocking run (the UvLoopSource co-pump, un-broken by the auto-pump).
    const loop = GLib.MainLoop.new(null, false);
    let fired = false;
    setTimeout(() => {
        fired = true;
        loop.quit();
    }, 50);
    loop.run();
    assert.equal(fired, true);
});

test('a blocking loop started from a pump-dispatched callback still runs GLib sources', async () => {
    // Adversarial nesting: the pump dispatches a GLib timeout callback, which
    // synchronously runs a nested blocking MainLoop quit by ANOTHER GLib timeout.
    // While that nested run is on the pump's stack the UvLoopSource stays parked
    // (Node timers wait — the documented degradation), but GLib sources must keep
    // dispatching and the nested run must return.
    const GLib = requireGi('GLib', '2.0');
    await withTimeout(
        new Promise((resolve) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                const loop = GLib.MainLoop.new(null, false);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
                    loop.quit();
                    return false;
                });
                loop.run();
                resolve();
                return false;
            });
        }),
        10000,
        'nested blocking run from a pump-dispatched callback',
    );
});

// ---- child-process keep-alive contract --------------------------------------

const childEnv = { ...process.env, NODE_GI_NATIVE: process.env.NODE_GI_NATIVE || 'build' };

function runChild(source, { args = [], timeout = 20000 } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-pump-child-'));
    const script = join(dir, 'child.mjs');
    writeFileSync(script, source);
    try {
        const stdout = execFileSync(process.execPath, [script, ...args], {
            encoding: 'utf8',
            timeout,
            env: childEnv,
        });
        return stdout;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('child: a top-level await on a Gio async op survives to completion and exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-pump-fixture-'));
    const fixture = join(dir, 'data.txt');
    writeFileSync(fixture, 'kept alive by the in-flight async op');
    try {
        // Without the in-flight scope=async keep-alive Node would exit 13
        // (unsettled top-level await) before the GTask completion arrives.
        const out = runChild(
            `import { requireGi } from ${JSON.stringify(giUrl)};\n` +
                `const Gio = requireGi('Gio', '2.0');\n` +
                `const file = Gio.File.new_for_path(process.argv[2]);\n` +
                `const [ok, contents] = await new Promise((resolve, reject) => {\n` +
                `  file.load_contents_async(null, (_source, res) => {\n` +
                `    try { resolve(file.load_contents_finish(res)); } catch (e) { reject(e); }\n` +
                `  });\n` +
                `});\n` +
                `console.log('ok:', ok, 'contents:', Buffer.from(contents).toString('utf8'));\n`,
            { args: [fixture] },
        );
        assert.equal(out.trim(), 'ok: true contents: kept alive by the in-flight async op');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('child: a top-level await on a GLib timeout survives to expiry and exits 0', () => {
    const out = runChild(
        `import { requireGi } from ${JSON.stringify(giUrl)};\n` +
            `const GLib = requireGi('GLib', '2.0');\n` +
            `const t0 = Date.now();\n` +
            `await new Promise((resolve) => {\n` +
            `  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => { resolve(); return false; });\n` +
            `});\n` +
            `console.log('waited-at-least-100ms:', Date.now() - t0 >= 100);\n`,
    );
    assert.equal(out.trim(), 'waited-at-least-100ms: true');
});

test('child: a purely-sync node-gi program exits promptly (the pump holds no ref)', () => {
    const t0 = Date.now();
    const out = runChild(
        `import { requireGi } from ${JSON.stringify(giUrl)};\n` +
            `const GLib = requireGi('GLib', '2.0');\n` +
            `console.log('host is a', typeof GLib.get_host_name());\n`,
        { timeout: 15000 },
    );
    assert.equal(out.trim(), 'host is a string');
    // Generous bound — the point is "exits by itself", not startup speed.
    assert.ok(Date.now() - t0 < 15000);
});

test('child: a removed GLib timeout releases the process (source_remove → exit)', () => {
    const out = runChild(
        `import { requireGi } from ${JSON.stringify(giUrl)};\n` +
            `const GLib = requireGi('GLib', '2.0');\n` +
            `// A repeating timeout would keep the process alive (setInterval\n` +
            `// semantics) — removing the source must release that hold.\n` +
            `const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => true);\n` +
            `await new Promise((resolve) => {\n` +
            `  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { resolve(); return false; });\n` +
            `});\n` +
            `GLib.source_remove(id);\n` +
            `console.log('removed');\n`,
    );
    assert.equal(out.trim(), 'removed');
});
