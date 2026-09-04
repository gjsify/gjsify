#!/usr/bin/env node
// Cross-runtime node-gi CONSUMER harness: runs a gjsify package's own GJS test
// suite on Node/Bun/Deno through `@gjsify/node-gi`, generalizing the
// `@gjsify/sqlite` `test:gjs-on-node` leg into a survey tool. Mechanism:
// packages/node-gi/AGENTS.md § Axis 5. Findings:
// docs/reports/node-gi-consumer-survey.md.
//
//   1. Entry: a committed `src/test.node-gi.mts` if present, else a temporary one
//      GENERATED from `src/test.mts` with a bare `print(...)` prepended. That bare
//      GJS ambient global is the genuine-GJS-source signal `detectNodeGiGlobals`
//      looks for; it flips `nodeGiGlobalsInject`, so `@gjsify/node-gi/globals` is
//      auto-injected and `@girs/*` value imports resolve to their real bodies,
//      whose inner `gi://Ns?version=X` the L2 `gjsGiNodePlugin` rewrites to
//      `requireGi('Ns','X')`.
//   2. Builds it `--app node --alias node:<name>=@gjsify/<name>` (the sqlite
//      pattern: the specs' `node:<name>` import is retargeted onto the POLYFILL
//      under test, not Node's builtin). It ALSO forces every
//      `runtimes.node === "native"` `@gjsify/*` in the transitive workspace-dep
//      closure onto its POLYFILL body, because the standard node routing rewrites
//      those onto `<dep>/globals` native re-exports which lack polyfill-only
//      surface (`@gjsify/buffer`'s normalizeEncoding/checkEncoding,
//      `@gjsify/message-channel`'s CONSTRUCTIBLE MessagePort vs Node's
//      non-constructible global). Forcing the closure reproduces the graph the
//      suite runs against on gjs — the thing this harness measures.
//   3. Runs the ONE `--app node` bundle on node, bun and deno (Node-API is their
//      common ABI), reusing example/harness.mjs's RUNTIMES map + PATH-skip.
//   4. Captures build/run outcome and the `@gjsify/unit` counts, then groups the
//      failure reason from the FAILED tests' messages ONLY, never the whole
//      stdout (see `REASON_RULES`).
//
// TOLERATES failures — captures them. Emits a structured JSON report + a table.
//
// Usage:
//   node scripts/node-gi-consumer-harness.mjs <pkg> [<pkg> …]      # by @gjsify/<name> or <name>
//   node scripts/node-gi-consumer-harness.mjs --gjs-only           # every runtimes.node==="none" pkg with a test.mts
//   node scripts/node-gi-consumer-harness.mjs --list <file.json>   # {"packages":["@gjsify/crypto",…]}
//   Flags: --runtimes node,bun,deno  --timeout <ms>  --out <report.json>  --keep  --quiet
//
// Requires: a Node-runnable `gjsify` on PATH / node_modules/.bin (the npm rolldown
// engine — the GJS bundle route needs @gjsify/rolldown-native), each target
// package's `lib/` plus its transitive workspace-dep libs built (`gjsify workspace
// @gjsify/<name> build:gjsify --with-dependencies`), and the `@gjsify/node-gi`
// addon built (packages/node-gi/node-gi, `npm install`).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// A Vala-bridge consumer built `--app node` has a static `gi://GjsifyWebrtc` /
// `gi://GjsifyHttpSoupBridge` / `gi://Gwebgl` import whose typelib lives in the
// package's own or a SIBLING bridge package's `prebuilds/linux-<arch>/`, which is
// NOT on `GI_TYPELIB_PATH` by default → the gi:// load fails. Reuse the CLI's own
// walker (as `gjsify run` does) so the transitive case works: @gjsify/http's
// typelib lives in @gjsify/http-soup-bridge, @gjsify/webrtc's in
// @gjsify/webrtc-native. Scan from ROOT — the workspace node_modules holds every
// @gjsify/* prebuild package. Degrades to the plain env when the CLI lib isn't
// built, which only bites in a half-built tree.
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

// Mirrors packages/node-gi/example/harness.mjs. node/bun/deno all run the SAME
// `--app node` node-gi bundle.
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

// Forced sibling-polyfill aliases. The self-retarget bundles the POLYFILL under
// test, but its sibling `@gjsify/*` imports still get the standard node routing,
// so a `runtimes.node === "native"` sibling rewrites to its `<pkg>/globals` native
// re-export. That mixed graph is not the one the suite exercises on gjs and lacks
// polyfill-only surface: `@gjsify/buffer/globals` (= `node:buffer`) has no
// normalizeEncoding/checkEncoding, and `@gjsify/message-channel/globals`
// re-exports Node's NON-CONSTRUCTIBLE global MessagePort. So walk the transitive
// workspace-dep closure and force every native-slot member onto its polyfill entry
// via a user alias (user aliases override the derived runtime-aliases map). Only
// built entries are forced — an unbuilt sibling keeps the default routing rather
// than a dead path.
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

// A suite that touches on-disk assets resolves them RELATIVE TO THE BUNDLE, and
// the package's own test bundle sits at the PACKAGE ROOT while this harness builds
// into `<pkg>/dist` — so `join(__dirname, 'test/…')` lands on `<pkg>/dist/test`
// and the asset is not there. That is a HARNESS artifact, never a defect in the
// package under test: bridging only `fixtures/` recorded `@gjsify/fs` as a hard
// fail (survey gap 7), so every asset dir is bridged rather than one name at a
// time.
//
// Symlinks, not copies: the suites WRITE into these dirs, and a copy would leave
// the harness run and the package's own `test:gjs` run disagreeing about disk.
const STAGED_ASSET_DIRS = ['fixtures', 'test'];

function stageTestAssets(dir, distDir, gjsify, timeout) {
    const pkg = readPkgJson(dir);
    if (pkg?.scripts?.['prebuild:test:fixtures']) {
        exec(gjsify, ['run', 'prebuild:test:fixtures'], { cwd: dir, timeout });
    }
    for (const name of STAGED_ASSET_DIRS) {
        const source = join(dir, name);
        const staged = join(distDir, name);
        if (!existsSync(source) || existsSync(staged)) continue;
        try {
            symlinkSync(`../${name}`, staged, 'dir');
        } catch {
            /* best-effort — a broken link surfaces as the asset-load failure it bridges */
        }
    }
}

// PRECEDENCE IS THE ARRAY ORDER — first match wins: a NAMED typelib beats the
// generic "typelib" catch-all, an engine marshalling error beats the generic
// TypeError shape, a timed-out test beats an assertion (it never reached its
// assertion). An ordered ARRAY and never an object, so precedence cannot drift
// with key-insertion order; `tests/e2e/node-gi-consumer-harness/run.mjs` pins the
// order and the scope.
//
// SCOPE — matched against the FAILURE REGION ONLY (the failed tests' messages, or
// the build/load error lines when a run produced no per-test markers), never the
// whole stdout: a 95%-green suite prints hundreds of PASSING test names, and one
// mentioning "microtask"/"assert"/"typelib" decides the bucket for the few that
// did fail — that is how `@gjsify/node-globals`'s three `structuredClone`
// assertion failures landed under `mainloop-drain`. The failing test's NAME is
// user prose for the same reason, so it is a last resort, and double-quoted spans
// are blanked because `@gjsify/unit`'s TimeoutError quotes the name into its
// message.
//
// A real process timeout is NOT here — it comes from the spawn error (`ETIMEDOUT`)
// as its own `timeout` status, so a test merely NAMED "timeout" cannot mis-bucket.
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
        // `Timeout: "<test>" exceeded <n>ms` is `@gjsify/unit`'s TimeoutError:
        // nothing pumps the default GLib main context in a bare `node bundle.mjs`,
        // the same root cause as the wall-clock `timeout` status but per-test. It
        // must be listed EXPLICITLY — the whole-stdout haystack used to catch these
        // by accident via an unrelated `MainLoop`/`microtask` mention, so scoping to
        // the failure region would drop them to `other`.
        /Timeout:[^\n]*exceeded \d+\s*ms|hang|did not exit|still running after|deadlock|main-?loop|MainLoop|g_main|microtask|promise.*not.*drain/i,
        'mainloop-drain',
    ],
    [/expect|toBe|toEqual|toContain|toThrow|assert|AssertionError|Expected/i, 'assertion-mismatch'],
    [
        /Module not found|Cannot find module|Could not resolve|Cannot find package|ERR_MODULE_NOT_FOUND|failed to load|rolldown|esbuild|build failed|SyntaxError/i,
        'build-error',
    ],
];

// oxlint-disable-next-line eslint/no-control-regex -- matching the ESC control character IS the point: this strips ANSI SGR colour codes from a runtime's captured output
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// `@gjsify/unit`'s SUMMARY line also starts with ❌. It is a counter, not a
// failure, so it must not enter the failure region.
const SUMMARY_MARKER = /^(?:\[[^\]]*\]\s*)?\d+\s+of\s+\d+\s+tests failed/;

/**
 * Pull up to `max` structured FAILURE records — the failure region of a run.
 *
 * `@gjsify/unit`'s reporter prints `❌ <name>` (or `⏱ <name>` on timeout) with the
 * message on the next line, so a record is `{ name, message }`. When a run produced
 * no per-test markers at all (build or load failure), the error-ish lines ARE the
 * failure and become records with an empty `name`.
 */
function collectFailures(text, max = 4) {
    const lines = text.split('\n').map(stripAnsi);
    const out = [];
    for (let i = 0; i < lines.length && out.length < max; i++) {
        const t = lines[i].trim();
        const m = t.match(/^(?:❌|⏱|✗|✘)\s+(.*)$/);
        if (!m) continue;
        const name = m[1].replace(/\s*\(\d.*\)\s*$/, '').trim();
        if (SUMMARY_MARKER.test(name)) continue;
        out.push({ name, message: (lines[i + 1] || '').trim().slice(0, 160) });
    }
    if (out.length) return out;
    // no per-test markers → build/load failure: grab error-ish lines
    for (const raw of lines) {
        const t = raw.trim();
        if (!t) continue;
        if (/error|throw|not found|undefined|typelib|cannot|failed|Exception|Requiring/i.test(t)) {
            out.push({ name: '', message: t.slice(0, 200) });
            if (out.length >= max) break;
        }
    }
    if (out.length) return out;
    const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
    return nonEmpty.length ? [{ name: '', message: nonEmpty[nonEmpty.length - 1].slice(0, 200) }] : [];
}

/** Render a failure record the way the report stores it. */
const formatFailure = (f) => (f.name && f.message ? `${f.name} — ${f.message}` : f.name || f.message);

/**
 * What `--require-pass` prints for ONE package that did not pass: the verdict, the
 * counts, the bucket, and the failure SAMPLES.
 *
 * As a CI gate this runs on a runner whose `--out` report goes to `/tmp` and is
 * never uploaded, so a bare `@gjsify/zlib — partial` was the entire evidence a
 * reader got — "1 of 53375 tests failed" with nothing saying which one. Getting the
 * name then meant building the native addon locally, which is the expensive step
 * this replaces.
 *
 * Counts are printed as `passed/total` AND `failed`, because the first two alone
 * mislead. `@gjsify/unit` bumps `countTestsFailed` without bumping
 * `countTestsOverall` for three cases — an `it.failing` marker that started
 * passing, an unexercised declared axis, and an assertion that fired outside any
 * `it()` — so a run can report a SMALLER total than the same suite standalone. Read
 * as "a test went missing", that looks like flake; it is one of those three, all of
 * which are deterministic. Measured on zlib: 53375 through the bridge vs 53376
 * standalone, which cost a wrong flake diagnosis before the accounting was checked.
 *
 * A package with no samples says so explicitly: `collectFailures` keys off a fixed
 * marker set (`❌ ⏱ ✗ ✘`), and a reporter emitting anything else produces an empty
 * list. Silence there means "the collector missed it", not "no failures".
 */
function formatGateFailure(r) {
    const node = r.runtimes?.node;
    const verdict = r.build?.ok ? (node?.status ?? 'no-node-run') : `build ${r.build?.reason}`;
    const lines = [`  ${r.name} — ${verdict}`];
    if (node && node.total !== undefined) {
        lines.push(
            `      ${node.passed}/${node.total} passed, ${node.failed} failed · bucket: ${node.reason ?? 'n/a'}`,
        );
    }
    const samples = (node?.samples?.length ? node.samples : r.build?.samples) ?? [];
    for (const s of samples) lines.push(`      ✖ ${s}`);
    if (!samples.length) {
        lines.push(`      (no failure samples captured — collectFailures matches ❌ ⏱ ✗ ✘ only)`);
    }
    return lines.join('\n');
}

// The failure's MESSAGE (name only as a last resort), with double-quoted spans
// blanked so a test NAME quoted into a message cannot decide the bucket.
const signatureOf = (f) => (f.message || f.name).replace(/"[^"\n]*"/g, '""');

/**
 * Bucket a failure by root cause, first `REASON_RULES` match winning. Matched ONLY
 * against the failure records the report stores next to the reason, so an
 * attribution is verifiable by eye: if no printed sample carries the signature,
 * the bucket is wrong.
 *
 * @param {{ name: string, message: string }[]} failures
 */
function classify(failures) {
    const hay = failures.map(signatureOf).join('\n').slice(0, 8000);
    for (const [re, group] of REASON_RULES) if (re.test(hay)) return group;
    return 'other';
}

function parseSummary(out) {
    const clean = stripAnsi(out);
    let m = clean.match(/❌\s*(?:\[[^\]]*\]\s*)?(\d+)\s+of\s+(\d+)\s+tests failed/);
    if (m) {
        // `failed` can EXCEED `total`: three paths raise it without a test having
        // run — a stray assertion from a leaked timer, an unexercised declared axis,
        // and an `it.failing` marker that passed. So clamp `passed` at 0 rather than
        // report a negative.
        const total = +m[2];
        const failed = +m[1];
        return { total, failed, passed: Math.max(0, total - failed) };
    }
    // BOTH SPELLINGS. `N tests passed` is what @gjsify/unit prints since #1557;
    // `N completed` is what a consumer resolving a PUBLISHED @gjsify/unit still
    // prints, and that number was ASSERTIONS — which is why the wording changed.
    // Reading it as a test total over-reports there, and refusing to read it at all
    // would report the run as unparseable, which is worse: the summary is how this
    // harness knows the suite ran.
    m = clean.match(/✔\s*(?:\[[^\]]*\]\s*)?(\d+)\s+(?:tests? passed|completed)/);
    if (m) return { total: +m[1], failed: 0, passed: +m[1] };
    return null;
}

// KNOWN-WRONG ON WINDOWS, deliberately left: `existsSync` hits the `sh` member of
// npm's shim trio, the one member Windows cannot execute, so `execFileSync` gets
// ENOENT. `scripts/resolve-gjsify.mjs` is the fix but not a one-line change here —
// the cmd.exe form embeds the arguments inside the quoted `/c "…"` line, so the
// resolved command cannot be threaded through as the bare string every
// `exec(gjsify, …)` site passes around. Left because the harness needs
// GObject-Introspection and is Linux-only in practice. Recorded in
// `status/open-todos.md`.
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
            // A wall-clock kill by `execFileSync`'s own `timeout` does NOT set
            // `killed` — Node reports `code:'ETIMEDOUT'`, `signal:'SIGTERM'`,
            // `status:null`. Keying only on `killed` made the `timeout` status
            // unreachable, so a suite that PASSES and then never exits was recorded
            // as a plain `fail` and bucketed by whatever its output said.
            timedOut: err.code === 'ETIMEDOUT' || !!err.killed,
        };
    }
}

function runPackage(name, { runtimes, timeout, keep, gjsify }) {
    const bare = name.replace(/^@gjsify\//, '');
    const dir = findPackageDir(name);
    // `relative` + a POSIX spelling rather than stripping a `/`-suffixed
    // prefix: `dir` is host-native, so on Windows the strip matched nothing and
    // the host's absolute build path ended up verbatim in the survey JSON.
    const result = { name, dir: dir ? relative(ROOT, dir).split(sep).join('/') : null, build: null, runtimes: {} };
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
        // When the package under test declares `node: "native"` itself, the
        // self-retarget must name the POLYFILL BODY rather than the package:
        // aliasing `node:<bare>` to `@gjsify/<bare>` routes back through the slot
        // rule to `<pkg>/globals`, whose job is to re-export `node:<bare>` — a cycle
        // the bundler reports as `[CIRCULAR_REEXPORT]`, or with globals.mjs's
        // `export *` spelling as the more cryptic `[MISSING_EXPORT]`. Same rule
        // `collectForcedPolyfillAliases` applies to every native-slotted sibling.
        const selfPkg = readPkgJson(dir);
        const selfEntry = selfPkg?.gjsify?.runtimes?.node === 'native' ? polyfillEntryOf(dir, selfPkg) : null;
        const selfTarget = selfEntry ?? name;
        const b = exec(
            gjsify,
            [
                'build',
                relEntry,
                '--app',
                'node',
                '--alias',
                `node:${bare}=${selfTarget}`,
                ...forcedAliases.flatMap((a) => ['--alias', a]),
                '--outfile',
                outfile,
            ],
            { cwd: dir, timeout },
        );
        if (!b.ok || !existsSync(outAbs)) {
            const failures = collectFailures(b.stdout + '\n' + b.stderr);
            result.build = { ok: false, reason: classify(failures), samples: failures.map(formatFailure) };
            return result;
        }
        result.build = { ok: true };
        stageTestAssets(dir, distDir, gjsify, timeout);

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
            // ONE failure region per run — the reason and the reported samples
            // are drawn from the same records, never from the whole stdout.
            const failures = collectFailures(text);
            const samples = failures.map(formatFailure);
            if (r.timedOut) {
                // A genuine wall-clock kill. Distinguish a suite that never got
                // to report from one that reported cleanly and then refused to
                // exit — the latter is a process-lifetime bug, not a test
                // failure, and filing both under one reason hides it.
                const cleanThenHung = summary && summary.failed === 0;
                result.runtimes[rt] = {
                    status: 'timeout',
                    reason: cleanThenHung ? 'no-exit-after-pass' : 'mainloop-hang-or-timeout',
                    ...(cleanThenHung ? summary : {}),
                    samples,
                };
            } else if (r.ok && summary && summary.failed === 0) {
                result.runtimes[rt] = { status: 'pass', ...summary };
            } else if (summary && summary.failed > 0) {
                result.runtimes[rt] = { status: 'partial', ...summary, reason: classify(failures), samples };
            } else if (r.ok && !summary) {
                // Ran clean but produced no unit summary (bespoke entry w/o run()).
                result.runtimes[rt] = { status: 'ran-no-summary', reason: 'no-unit-summary', samples };
            } else {
                // Non-zero exit with no parseable summary — threw at import/eval.
                result.runtimes[rt] = { status: 'fail', reason: classify(failures), samples };
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
                    notPassing.map(formatGateFailure).join('\n'),
            );
            process.exit(1);
        }
        console.log(`\n✓ --require-pass: all ${results.length} package(s) pass on node.`);
    }
}

// Only run when invoked directly, so the pure helpers stay unit-testable
// (`tests/e2e/node-gi-consumer-harness/run.mjs` imports them).
if (process.argv[1] && resolve(process.argv[1]).endsWith('node-gi-consumer-harness.mjs')) main();

export {
    REASON_RULES,
    STAGED_ASSET_DIRS,
    classify,
    collectFailures,
    formatFailure,
    formatGateFailure,
    parseSummary,
    stageTestAssets,
};
