#!/usr/bin/env node
// Cross-runtime node-gi CONSUMER harness — generalizes the proven
// `@gjsify/sqlite` "run its GJS test suite on Node via @gjsify/node-gi" leg
// (packages/node/sqlite `test:gjs-on-node`) into a reusable survey tool.
//
// For a given gjsify package it:
//   1. Picks a node-gi test ENTRY: a committed `src/test.node-gi.mts` (a proof
//      leg, hand-written like sqlite's) if present, else GENERATES a temporary
//      one from the package's `src/test.mts` — prepending a bare `print(...)`
//      call. That bare GJS ambient global is the genuine-GJS-source signal the
//      CLI's `detectNodeGiGlobals` looks for: it flips `nodeGiGlobalsInject`, so
//      `@gjsify/node-gi/globals` is auto-injected AND `@girs/*` value imports
//      resolve to their real bodies whose inner `gi://Ns?version=X` are rewritten
//      to `requireGi('Ns','X')` by the L2 `gjsGiNodePlugin` (see AGENTS.md
//      "Axis 5 active track"). Same mechanism sqlite's `test.node-gi.mts` uses.
//   2. Builds that entry `gjsify build --app node --alias node:<name>=@gjsify/<name>`
//      (the sqlite `--alias` pattern — the specs' `node:<name>` import is
//      retargeted onto the libgda/GLib-backed POLYFILL under test, not Node's
//      own builtin) under Node via a Node-runnable `gjsify` (npm rolldown).
//      The build ALSO forces every `runtimes.node === "native"` @gjsify/*
//      package in the target's transitive workspace-dep closure onto its
//      POLYFILL body (`--alias @gjsify/<dep>=<abs lib/esm/index.js>`): the
//      standard node routing rewrites those onto `<dep>/globals` native
//      re-exports, which lack the polyfill-only surface the polyfill under
//      test imports (the survey's P4/P7 — `@gjsify/buffer`'s
//      normalizeEncoding/checkEncoding helpers, `@gjsify/message-channel`'s
//      CONSTRUCTIBLE MessagePort vs Node's non-constructible global). Forcing
//      the closure reproduces the graph the suite runs against on gjs — the
//      thing this harness exists to measure.
//   3. Runs the ONE `--app node` bundle on node, and — reusing example/harness.mjs's
//      RUNTIMES map + PATH-skip — on bun and deno too (Node-API is their common ABI).
//   4. Captures build ok/fail, run exit code, the `@gjsify/unit` summary counts
//      (`✔ [rt] M completed` / `❌ [rt] N of M tests failed`), and the first error
//      line, then GROUPS the failure reason (needs-GTK-display / missing-typelib /
//      marshalling / mainloop-hang / build-error / …).
//
// TOLERATES failures — captures them. Emits a structured JSON report + a table.
//
// Usage:
//   node scripts/node-gi-consumer-harness.mjs <pkg> [<pkg> …]      # by @gjsify/<name> or <name>
//   node scripts/node-gi-consumer-harness.mjs --gjs-only           # every runtimes.node==="none" pkg with a test.mts
//   node scripts/node-gi-consumer-harness.mjs --list <file.json>   # {"packages":["@gjsify/crypto",…]}
//   Flags: --runtimes node,bun,deno  --timeout <ms>  --out <report.json>  --keep  --quiet
//
// Requires: a Node-runnable `gjsify` on PATH / node_modules/.bin (npm rolldown
// engine — the committed GJS bundle needs @gjsify/rolldown-native), each target
// package's `lib/` (+ transitive workspace-dep libs) already built (build them
// with `gjsify workspace @gjsify/<name> build:gjsify --with-dependencies`), and
// the `@gjsify/node-gi` addon built (packages/node-gi/node-gi, `npm install`).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// ── native typelib env (survey P5 fix) ───────────────────────────────────────
// A Vala-bridge consumer built `--app node` has a static `gi://GjsifyWebrtc` /
// `gi://GjsifyHttpSoupBridge` / `gi://Gwebgl` import; that typelib lives in a
// package's own (or a SIBLING bridge package's) `prebuilds/linux-<arch>/`, which
// is NOT on `GI_TYPELIB_PATH` by default → the gi:// load fails. `gjsify run`
// (via detectNativePackages) and `gjsify run/showcase --runtime node` (via
// runRuntimeBundle → computeNativeEnvForBundle) already prepend those dirs; this
// standalone harness did not (the survey's P5 gap). Reuse the SAME CLI walker so
// the transitive case works (@gjsify/http's typelib lives in
// @gjsify/http-soup-bridge, @gjsify/webrtc's in @gjsify/webrtc-native). Scan from
// ROOT — the workspace node_modules holds every @gjsify/* prebuild package.
// Degrades to the plain env if the CLI lib isn't built (the harness needs the CLI
// to build bundles anyway, so this only bites in a half-built tree).
let NATIVE_ENV = process.env;
try {
    const { detectNativePackages, buildNativeEnv } = await import(
        new URL('../packages/infra/cli/lib/utils/detect-native-packages.js', import.meta.url)
    );
    NATIVE_ENV = { ...process.env, ...buildNativeEnv(detectNativePackages(ROOT)) };
} catch (err) {
    console.warn(
        `[node-gi-consumer-harness] native typelib env unavailable (${err.message}); ` +
            'Vala-bridge consumers (webrtc/http/webgl) may report missing-typelib',
    );
}

// ── runtimes — mirror packages/node-gi/example/harness.mjs ───────────────────
// gjs runs the native `--app gjs` bundle (not used here — we build `--app node`);
// node/bun/deno all run the SAME `--app node` node-gi bundle.
const RUNTIMES = {
    node: { probe: 'node', on: (entry) => ['node', [entry]] },
    bun: { probe: 'bun', on: (entry) => ['bun', [entry]] },
    // manual: use the existing node_modules as-is (auto would re-resolve the heavy
    // build-time tree and hang; the bundle only needs the linked @gjsify/node-gi).
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

// ── package discovery ────────────────────────────────────────────────────────
const PKG_ROOTS = [
    'packages/node',
    'packages/web',
    'packages/dom',
    'packages/framework',
    'packages/gjs',
    'packages/infra',
];

function findPackageDir(name) {
    const bare = name.replace(/^@gjsify\//, '');
    for (const r of PKG_ROOTS) {
        const d = join(ROOT, r, bare);
        if (existsSync(join(d, 'package.json'))) return d;
    }
    // fall back to a full scan (handles nested / renamed dirs)
    for (const r of PKG_ROOTS) {
        const base = join(ROOT, r);
        let entries;
        try {
            entries = readdirSync(base, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const pj = join(base, e.name, 'package.json');
            if (!existsSync(pj)) continue;
            try {
                if (JSON.parse(readFileSync(pj, 'utf-8')).name === name) return join(base, e.name);
            } catch {
                /* ignore */
            }
        }
    }
    return null;
}

function enumerateGjsOnly() {
    const out = [];
    for (const r of PKG_ROOTS) {
        const base = join(ROOT, r);
        let entries;
        try {
            entries = readdirSync(base, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const dir = join(base, e.name);
            const pj = join(dir, 'package.json');
            if (!existsSync(pj)) continue;
            let j;
            try {
                j = JSON.parse(readFileSync(pj, 'utf-8'));
            } catch {
                continue;
            }
            if (!j.name?.startsWith('@gjsify/')) continue;
            const node = j.gjsify?.runtimes?.node;
            if (node !== 'none') continue;
            if (!existsSync(join(dir, 'src', 'test.mts')) && !existsSync(join(dir, 'src', 'test.node-gi.mts')))
                continue;
            out.push(j.name);
        }
    }
    return out.sort();
}

// ── forced sibling-polyfill aliases (survey P4/P7 fix) ───────────────────────
// The `--alias node:<self>=@gjsify/<self>` retarget bundles the POLYFILL under
// test, but its sibling `@gjsify/*` imports still get the standard node-target
// routing: a `runtimes.node === "native"` sibling rewrites to its
// `<pkg>/globals` native re-export. That mixed polyfill/native graph is NOT the
// graph the suite exercises on gjs, and it demonstrably lacks polyfill-only
// surface — `@gjsify/buffer/globals` (= `node:buffer`) has no
// normalizeEncoding/checkEncoding (broke crypto 526/570 + string_decoder 0/…),
// and `@gjsify/message-channel/globals` re-exports Node's NON-CONSTRUCTIBLE
// global MessagePort (broke worker_threads 0/… with "Constructor cannot be
// called"). So: walk the target's transitive workspace-dep closure
// (dependencies + optionalDependencies) and force every native-slot @gjsify/*
// member onto its polyfill entry via a user alias (user aliases override the
// derived runtime-aliases map). Only built entries are forced — an unbuilt
// sibling keeps the default routing rather than a dead path.
const pkgJsonCache = new Map();
function readPkgJson(dir) {
    if (!pkgJsonCache.has(dir)) {
        try {
            pkgJsonCache.set(dir, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')));
        } catch {
            pkgJsonCache.set(dir, null);
        }
    }
    return pkgJsonCache.get(dir);
}

function polyfillEntryOf(pkgDir, pkgJson) {
    const dot = pkgJson.exports?.['.'];
    const rel = (typeof dot === 'object' && dot !== null ? dot.default : dot) ?? pkgJson.main ?? 'lib/esm/index.js';
    const abs = join(pkgDir, rel);
    return existsSync(abs) ? abs : null;
}

function collectForcedPolyfillAliases(startDir) {
    const aliases = [];
    const visited = new Set();
    const queue = [startDir];
    while (queue.length) {
        const dir = queue.shift();
        if (visited.has(dir)) continue;
        visited.add(dir);
        const pkg = readPkgJson(dir);
        if (!pkg) continue;
        const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
        for (const depName of Object.keys(deps)) {
            if (!depName.startsWith('@gjsify/')) continue;
            const depDir = findPackageDir(depName);
            if (!depDir || visited.has(depDir)) continue;
            queue.push(depDir);
            const depPkg = readPkgJson(depDir);
            if (depPkg?.gjsify?.runtimes?.node !== 'native') continue;
            const entry = polyfillEntryOf(depDir, depPkg);
            if (entry) aliases.push(`${depName}=${entry}`);
        }
    }
    return aliases;
}

// ── test fixtures ────────────────────────────────────────────────────────────
// Packages with on-disk worker/data fixtures (e.g. worker_threads'
// `fixtures/echo-worker.mjs`) stage them via a `prebuild:test:fixtures` script
// into `<pkg>/fixtures/` and resolve them RELATIVE TO THE BUNDLE
// (`new URL('./fixtures/…', import.meta.url)`). The package's own test bundles
// live at the package root, this harness's live in `dist/` — so stage the
// fixtures and bridge `dist/fixtures` → `../fixtures` with a symlink.
function stageFixtures(dir, distDir, gjsify, timeout) {
    const pkg = readPkgJson(dir);
    if (pkg?.scripts?.['prebuild:test:fixtures']) {
        exec(gjsify, ['run', 'prebuild:test:fixtures'], { cwd: dir, timeout });
    }
    const fixtures = join(dir, 'fixtures');
    const distFixtures = join(distDir, 'fixtures');
    if (existsSync(fixtures) && !existsSync(distFixtures)) {
        try {
            symlinkSync('../fixtures', distFixtures, 'dir');
        } catch {
            /* best-effort — a broken link surfaces as the fixture-load failure it bridges */
        }
    }
}

// ── failure-reason grouping ──────────────────────────────────────────────────
// Ordered, first-match-wins. Each rule maps a failure-signature (drawn from the
// FAILED-test messages + stderr, NOT arbitrary stdout) to a group. A real
// process timeout is NOT here — it is detected via `killed` and reported as its
// own `timeout` status, so a test merely NAMED "timeout" can't mis-bucket.
const REASON_RULES = [
    [
        /Typelib file for namespace '?(Gtk|Gdk|Adw|Gsk)'?|namespace (Gtk|Gdk|Adw)|cannot open display|GDK_BACKEND|Gtk-WARNING|gtk_init|could not (find|open) display/i,
        'needs-GTK-display',
    ],
    [/Typelib file for namespace '?(Gst|GstApp|GstWebRTC|GstSdp)'?|gstreamer|gst_init/i, 'needs-GStreamer'],
    [/Typelib file for namespace '?Soup'?/i, 'needs-Soup-typelib'],
    [/Typelib file for namespace '?(WebKit|WebKit2)'?/i, 'needs-WebKit'],
    [/Typelib file for namespace '?Manette'?/i, 'needs-Manette'],
    [
        /Typelib file for namespace|Requiring \w+, version|could not be found in the typelib|No typelib|typelib/i,
        'missing-typelib',
    ],
    // GJS-runtime CJS/legacy-imports internals node-gi's globals shim does not seed.
    [
        /imports\.searchPath|imports\.byteArray|imports\.\w+|\bsearchPath\b|createRequire|CommonJS|module\.exports|globalThis\.exports/i,
        'needs-gjs-imports-runtime',
    ],
    [
        /GByteArray|GBytes|byte array|Uint8Array.*GValue|GValue.*Uint8Array|marshal|GIArgument|out-param|\binout\b|cannot convert|expected type/i,
        'marshalling-gap',
    ],
    [
        /Class extends value undefined|extends undefined|is not a constructor|is not a function|has no member|undefined is not|Cannot read propert|no such|not implemented|is undefined/i,
        'runtime-typeerror-or-unimpl',
    ],
    [
        /hang|did not exit|still running after|deadlock|main-?loop|MainLoop|g_main|microtask|promise.*not.*drain/i,
        'mainloop-drain',
    ],
    [/expect|toBe|toEqual|toContain|toThrow|assert|AssertionError|Expected/i, 'assertion-mismatch'],
    [
        /Module not found|Cannot find module|Could not resolve|Cannot find package|ERR_MODULE_NOT_FOUND|failed to load|rolldown|esbuild|build failed|SyntaxError/i,
        'build-error',
    ],
];

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Pull up to `max` representative FAILURE lines: each failing `it()` prints
// `  ❌ <name>` then the error message on the next line (see @gjsify/unit). We
// pair name+message; fall back to raw error/throw lines (build/load failures).
function collectFailSamples(text, max = 4) {
    const lines = text.split('\n').map(stripAnsi);
    const out = [];
    for (let i = 0; i < lines.length && out.length < max; i++) {
        const t = lines[i].trim();
        const m = t.match(/^(?:❌|⏱|✗|✘)\s+(.*)$/);
        if (m) {
            const name = m[1].replace(/\s*\(\d.*\)\s*$/, '').trim();
            const msg = (lines[i + 1] || '').trim().slice(0, 160);
            out.push(msg ? `${name} — ${msg}` : name);
        }
    }
    if (out.length) return out;
    // no per-test markers → build/load failure: grab error-ish lines
    for (const raw of lines) {
        const t = raw.trim();
        if (!t) continue;
        if (/error|throw|not found|undefined|typelib|cannot|failed|Exception|Requiring/i.test(t)) {
            out.push(t.slice(0, 200));
            if (out.length >= max) break;
        }
    }
    if (out.length) return out;
    const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
    return nonEmpty.length ? [nonEmpty[nonEmpty.length - 1].slice(0, 200)] : [];
}

function classify(samples, fullText) {
    const hay = (samples.join('\n') + '\n' + fullText).slice(0, 8000);
    for (const [re, group] of REASON_RULES) if (re.test(hay)) return group;
    return 'other';
}

// Parse the @gjsify/unit summary line for pass/fail counts.
function parseSummary(out) {
    const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
    let m = clean.match(/❌\s*(?:\[[^\]]*\]\s*)?(\d+)\s+of\s+(\d+)\s+tests failed/);
    if (m) {
        // `failed` can EXCEED `total` when @gjsify/unit also counts assertions that
        // fired outside any it() (leaked timers / a broken constructor spamming a
        // loop) — so clamp `passed` at 0 rather than report a negative.
        const total = +m[2];
        const failed = +m[1];
        return { total, failed, passed: Math.max(0, total - failed) };
    }
    m = clean.match(/✔\s*(?:\[[^\]]*\]\s*)?(\d+)\s+completed/);
    if (m) return { total: +m[1], failed: 0, passed: +m[1] };
    return null;
}

// ── build + run one package ──────────────────────────────────────────────────
function resolveGjsify() {
    const local = join(ROOT, 'node_modules', '.bin', 'gjsify');
    if (existsSync(local)) return local;
    return 'gjsify'; // PATH
}

function exec(cmd, args, opts) {
    try {
        const stdout = execFileSync(cmd, args, {
            cwd: opts.cwd ?? ROOT,
            timeout: opts.timeout,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024,
            env: opts.env ?? process.env,
        });
        return { ok: true, code: 0, stdout, stderr: '' };
    } catch (err) {
        return {
            ok: false,
            code: err.status ?? err.code ?? -1,
            stdout: (err.stdout || '').toString(),
            stderr: (err.stderr || '').toString(),
            killed: !!err.killed,
        };
    }
}

function runPackage(name, { runtimes, timeout, keep, gjsify }) {
    const bare = name.replace(/^@gjsify\//, '');
    const dir = findPackageDir(name);
    const result = { name, dir: dir ? dir.replace(ROOT + '/', '') : null, build: null, runtimes: {} };
    if (!dir) {
        result.build = { ok: false, reason: 'package-not-found', detail: `no package dir for ${name}` };
        return result;
    }

    // 1. pick / generate the entry
    const committed = join(dir, 'src', 'test.node-gi.mts');
    const testMts = join(dir, 'src', 'test.mts');
    let entrySrc;
    let generated = null;
    if (existsSync(committed)) {
        entrySrc = committed;
        result.entry = 'committed test.node-gi.mts';
    } else if (existsSync(testMts)) {
        const orig = readFileSync(testMts, 'utf-8');
        const banner = `// AUTO-GENERATED by scripts/node-gi-consumer-harness.mjs — safe to delete.\nprint(${JSON.stringify(`${name} suite on @gjsify/node-gi`)});\n`;
        generated = join(dir, 'src', 'test.node-gi.harness.mts');
        writeFileSync(generated, banner + orig);
        entrySrc = generated;
        result.entry = 'generated from test.mts';
    } else {
        result.build = { ok: false, reason: 'no-test-entry', detail: 'neither src/test.node-gi.mts nor src/test.mts' };
        return result;
    }

    const distDir = join(dir, 'dist');
    const outfile = join('dist', `test.node-gi.harness.${bare}.mjs`);
    const outAbs = join(dir, outfile);

    try {
        mkdirSync(distDir, { recursive: true });
        // 2. build --app node with the sqlite --alias pattern, plus the forced
        // sibling-polyfill closure (see collectForcedPolyfillAliases above).
        const relEntry = entrySrc.replace(dir + '/', '');
        const forcedAliases = collectForcedPolyfillAliases(dir);
        const b = exec(
            gjsify,
            [
                'build',
                relEntry,
                '--app',
                'node',
                '--alias',
                `node:${bare}=${name}`,
                ...forcedAliases.flatMap((a) => ['--alias', a]),
                '--outfile',
                outfile,
            ],
            { cwd: dir, timeout },
        );
        if (!b.ok || !existsSync(outAbs)) {
            const text = b.stdout + '\n' + b.stderr;
            const samples = collectFailSamples(text);
            result.build = { ok: false, reason: classify(samples, text), samples };
            return result;
        }
        result.build = { ok: true };
        stageFixtures(dir, distDir, gjsify, timeout);

        // 3+4. run on each requested runtime, capture + classify
        for (const rt of runtimes) {
            if (!RUNTIMES[rt]) continue;
            if (rt !== 'node' && !isOnPath(RUNTIMES[rt].probe)) {
                result.runtimes[rt] = { status: 'skipped', reason: 'not-on-PATH' };
                continue;
            }
            const [cmd, baseArgs] = RUNTIMES[rt].on(outAbs);
            // NATIVE_ENV prepends each consumed package's prebuilds/ to
            // GI_TYPELIB_PATH/LD_LIBRARY_PATH so a Vala-bridge gi:// import loads.
            const r = exec(cmd, baseArgs, { cwd: dir, timeout, env: NATIVE_ENV });
            const text = r.stdout + '\n' + r.stderr;
            const summary = parseSummary(r.stdout);
            if (r.killed) {
                // A genuine wall-clock timeout — likely a blocking mainloop that
                // never returns (an async-Gio consumer, unlike synchronous sqlite).
                result.runtimes[rt] = {
                    status: 'timeout',
                    reason: 'mainloop-hang-or-timeout',
                    samples: collectFailSamples(text),
                };
            } else if (r.ok && summary && summary.failed === 0) {
                result.runtimes[rt] = { status: 'pass', ...summary };
            } else if (summary && summary.failed > 0) {
                const samples = collectFailSamples(text);
                result.runtimes[rt] = { status: 'partial', ...summary, reason: classify(samples, text), samples };
            } else if (r.ok && !summary) {
                // Ran clean but produced no unit summary (bespoke entry w/o run()).
                result.runtimes[rt] = {
                    status: 'ran-no-summary',
                    reason: 'no-unit-summary',
                    samples: collectFailSamples(text),
                };
            } else {
                // Non-zero exit with no parseable summary — threw at import/eval.
                const samples = collectFailSamples(text);
                result.runtimes[rt] = { status: 'fail', reason: classify(samples, text), samples };
            }
        }
    } finally {
        if (generated && !keep) {
            try {
                unlinkSync(generated);
            } catch {
                /* ignore */
            }
        }
    }
    return result;
}

// ── cli ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const o = {
        packages: [],
        runtimes: ['node', 'bun', 'deno'],
        timeout: 120000,
        out: null,
        keep: false,
        quiet: false,
        requirePass: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--gjs-only') o.gjsOnly = true;
        else if (a === '--list') o.listFile = argv[++i];
        else if (a === '--runtimes') o.runtimes = argv[++i].split(',').map((s) => s.trim());
        else if (a === '--timeout') o.timeout = +argv[++i];
        else if (a === '--out') o.out = argv[++i];
        else if (a === '--keep') o.keep = true;
        else if (a === '--quiet') o.quiet = true;
        // CI gate: exit non-zero unless every listed package PASSES on node (the
        // always-present leg). bun/deno stay best-effort (runtime quirks are noise
        // for a gate). Use this for the proof-leg CI job; omit it for a survey.
        else if (a === '--require-pass') o.requirePass = true;
        else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
        else o.packages.push(a);
    }
    return o;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    let names = [...opts.packages];
    if (opts.gjsOnly) names.push(...enumerateGjsOnly());
    if (opts.listFile) names.push(...(JSON.parse(readFileSync(opts.listFile, 'utf-8')).packages || []));
    names = [...new Set(names.map((n) => (n.startsWith('@gjsify/') ? n : `@gjsify/${n}`)))];
    if (!names.length) {
        console.error('no packages — pass names, --gjs-only, or --list <file.json>');
        process.exit(2);
    }

    const gjsify = resolveGjsify();
    const results = [];
    for (const name of names) {
        if (!opts.quiet) process.stderr.write(`\n▶ ${name} … `);
        const r = runPackage(name, { runtimes: opts.runtimes, timeout: opts.timeout, keep: opts.keep, gjsify });
        results.push(r);
        if (!opts.quiet) {
            const s = !r.build?.ok
                ? `BUILD-FAIL(${r.build?.reason})`
                : opts.runtimes.map((rt) => `${rt}:${r.runtimes[rt]?.status ?? '-'}`).join(' ');
            process.stderr.write(s);
        }
    }
    if (!opts.quiet) process.stderr.write('\n');

    // ── table ──
    const cols = opts.runtimes;
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + pad('package', 30) + pad('build', 12) + cols.map((c) => pad(c, 18)).join('') + 'reason');
    console.log('-'.repeat(30 + 12 + cols.length * 18 + 24));
    for (const r of results) {
        const build = r.build?.ok ? 'ok' : `FAIL`;
        const cells = cols.map((c) => {
            const x = r.runtimes[c];
            if (!x) return pad('-', 18);
            if (x.status === 'pass') return pad(`pass ${x.passed}/${x.total}`, 18);
            if (x.status === 'partial') return pad(`part ${x.passed}/${x.total}`, 18);
            return pad(x.status, 18);
        });
        const reason = r.build?.ok ? cols.map((c) => r.runtimes[c]?.reason).find(Boolean) || '' : r.build?.reason || '';
        console.log(pad(r.name, 30) + pad(build, 12) + cells.join('') + reason);
    }

    // ── grouped summary ──
    const groups = {};
    for (const r of results) {
        const rep = !r.build?.ok
            ? r.build.reason
            : cols.map((c) => r.runtimes[c]).find((x) => x && x.status !== 'pass' && x.status !== 'skipped')?.reason;
        const key = rep || (Object.values(r.runtimes).some((x) => x.status === 'pass') ? 'PASS' : 'unknown');
        (groups[key] ??= []).push(r.name);
    }
    console.log('\n=== grouped ===');
    for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${pad(k, 26)} ${v.length}  ${v.join(', ')}`);
    }

    const report = { generatedAt: new Date().toISOString(), runtimes: cols, results, groups };
    if (opts.out) {
        mkdirSync(dirname(opts.out), { recursive: true });
        writeFileSync(opts.out, JSON.stringify(report, null, 2));
        console.log(`\nwrote ${opts.out}`);
    }

    if (opts.requirePass) {
        const notPassing = results.filter((r) => r.runtimes.node?.status !== 'pass');
        if (notPassing.length) {
            console.error(
                `\n✗ --require-pass: ${notPassing.length} package(s) did not PASS on node:\n` +
                    notPassing
                        .map(
                            (r) =>
                                `  ${r.name} — ${r.build?.ok ? (r.runtimes.node?.status ?? 'no-node-run') : `build ${r.build?.reason}`}`,
                        )
                        .join('\n'),
            );
            process.exit(1);
        }
        console.log(`\n✓ --require-pass: all ${results.length} package(s) pass on node.`);
    }
}

main();
