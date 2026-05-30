#!/usr/bin/env node
// Audit script — classify every `packages/**/package.json` against the
// five-axis cross-runtime model declared in AGENTS.md `## Strategic direction`.
//
// For each package the script determines:
//   - axis       : 1 (node-api), 2 (web-api), 3 (dom), 4 (design-identity),
//                  5 (platform-bridge), or "infra" (build tooling, not a
//                  user-facing runtime polyfill).
//   - gjs_bound  : whether the impl pulls a GJS-only value-dep (`@girs/*`
//                  value-import, `gi://*` direct import, or a legacy
//                  `imports.X` global reference). Type-imports are ignored.
//   - native_hint: presence of a `globals.mjs` file (the Node-side native
//                  re-export pattern documented in AGENTS.md).
//   - browser    : presence of a `test.browser.mts` entry under `src/`
//                  (today's browser-shipping signal).
//
// From those signals it suggests a default `gjsify.runtimes` triplet
// (`gjs` × `node` × `browser`, each slot ∈ {polyfill, native, partial, none}),
// and compares it to whatever `gjsify.runtimes` is declared in package.json
// today.
//
// Usage:
//   node scripts/audit-runtimes.mjs               # human-readable table
//   node scripts/audit-runtimes.mjs --json        # machine-readable
//   node scripts/audit-runtimes.mjs --markdown    # paste into STATUS.md
//   node scripts/audit-runtimes.mjs --apply       # write the SUGGESTED
//                                                 # runtimes triplet back
//                                                 # into each package.json
//                                                 # (only when absent)
//   node scripts/audit-runtimes.mjs --check       # exit 1 if any declared
//                                                 # triplet drifts from what
//                                                 # the signal-based detection
//                                                 # would suggest (CI guard)
//
// Pure read-only by default. `--apply` only fills in missing declarations;
// existing `gjsify.runtimes` values are NEVER overwritten — the human stays
// in charge of every non-default decision. `--check` is read-only; it never
// edits package.json — it only reports drift.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PACKAGES_DIR = resolve(ROOT, 'packages');

const args = new Set(process.argv.slice(2));
const FORMAT = args.has('--json') ? 'json' : args.has('--markdown') ? 'markdown' : 'table';
const APPLY = args.has('--apply');
const CHECK = args.has('--check');

// ─── Discovery ──────────────────────────────────────────────────────────────

/** Recursively find every package.json under packages/**, returning [absDir]. */
async function findPackages(dir, out = []) {
    const entries = await readdir(dir, { withFileTypes: true });
    // A directory containing package.json IS a package — don't descend further.
    if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
        out.push(dir);
        return out;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue;
        await findPackages(join(dir, entry.name), out);
    }
    return out;
}

// ─── Source-tree probes ─────────────────────────────────────────────────────

const GIRS_VALUE_RE = /^\s*import\s+(?!type\b)[^;]*from\s+['"]@girs\//m;
const GI_URL_RE = /from\s+['"]gi:\/\//;
// Dynamic `await import('gi://X')` / `import('@girs/X')` — the gamepad /
// terminal-native / sab-native graceful-degradation pattern. The package
// stays loadable everywhere; on non-GJS the await throws and the catch
// branch supplies a no-op fallback. Treated as `partial` slot for
// node/browser when no static GJS-binding exists, otherwise the static
// binding dominates.
const DYNAMIC_GI_RE = /import\s*\(\s*['"](?:gi:\/\/|@girs\/)/;
// `imports.X` reads — exclude common comment-context appearances by checking
// the rest of the line doesn't begin with a comment marker. Imperfect but
// catches the canonical `const x = imports.byteArray` / `imports.gi.Foo`
// pattern without hand-rolling a TS parser.
const IMPORTS_LEGACY_RE = /(?<!\/\/.*)(?<!\*.*)\bimports\.(?:byteArray|gi|system|signals|cairo|gettext|format|misc|jsUnit|searchPath)/;
// `<obj>.imports?.gi` / `<obj>.imports.gi` — the "safe" access pattern used
// by `@gjsify/{terminal-native,tls-native,sab-native}` and similar Vala
// bridges. Reads `imports` via a typed view of a runtime host (`globalThis`,
// `_runtime`, etc.) and short-circuits to `undefined` on Node where the
// global doesn't exist. Package is *loadable* everywhere but the
// GJS-binding is the entire impl — outside GJS the surface returns null /
// false / undefined. Treated as `none` slot on non-GJS (functionally
// indistinguishable from a hard GJS-bound package: every call goes through
// the unavailable bridge).
const GJS_IMPORTS_GUARD_RE = /\.imports\??\.gi\b/;

async function scanSourceTree(pkgDir) {
    const srcDir = join(pkgDir, 'src');
    const signals = {
        girs_value: false,
        gi_url: false,
        dynamic_gi: false,
        imports_legacy: false,
        gjs_imports_guard: false,
        has_browser_entry: false,
        has_globals_mjs: existsSync(join(pkgDir, 'globals.mjs')),
        file_count: 0,
    };
    if (!existsSync(srcDir)) return signals;
    await walkSource(srcDir, signals);
    return signals;
}

async function walkSource(dir, signals) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue;
            await walkSource(full, signals);
            continue;
        }
        if (!entry.isFile()) continue;
        if (entry.name === 'test.browser.mts' || entry.name === 'test.browser.ts') {
            signals.has_browser_entry = true;
        }
        // Only scan TS / MTS sources; skip spec/test files (they're allowed to
        // exercise GJS-only paths via *.gjs.spec.ts).
        if (!/\.(ts|mts)$/.test(entry.name)) continue;
        if (/\.gjs\.spec\.(ts|mts)$/.test(entry.name)) continue;
        signals.file_count++;
        const text = await readFile(full, 'utf8');
        if (GIRS_VALUE_RE.test(text)) signals.girs_value = true;
        if (GI_URL_RE.test(text)) signals.gi_url = true;
        if (DYNAMIC_GI_RE.test(text)) signals.dynamic_gi = true;
        if (IMPORTS_LEGACY_RE.test(text)) signals.imports_legacy = true;
        if (GJS_IMPORTS_GUARD_RE.test(text)) signals.gjs_imports_guard = true;
    }
}

// ─── Classification ─────────────────────────────────────────────────────────

function classifyAxis(relativeDir, pkgName) {
    // Path-based axis. The strategic-direction section defines five axes;
    // packages/infra/* and packages/gjs/* are infra (build tooling / GJS
    // runtime helpers), not user-facing polyfills — flagged as 'infra'.
    const [pillar, subpath] = relativeDir.split('/');
    if (pillar === 'infra') return 'infra';
    if (pillar === 'gjs') return 'infra';
    if (pillar === 'node') return 'node-api';
    if (pillar === 'dom') return 'dom';
    if (pillar === 'framework') {
        // Today only iframe straddles a platform-bridge case via WebKit.WebView;
        // the rest is GJS-only framework composition glue.
        if (subpath === 'iframe') return 'platform-bridge';
        return 'framework-gjs';
    }
    if (pillar === 'web') {
        if (/^adwaita/.test(subpath ?? pkgName)) return 'design-identity';
        return 'web-api';
    }
    return 'unknown';
}

/**
 * Node-API packages that have NO meaningful browser pendant (POSIX-fork,
 * V8 debugger protocol, TTY readline, …). The R1 audit (Quick-Wins 11–13)
 * downgrades these to `browser: "none"` instead of the empty-stub polyfill
 * that would otherwise be the heuristic default — shipping an "empty stub"
 * as a polyfill is dishonest, the slot should reflect "no sensible browser
 * surface exists". The heuristic recognises these by name.
 */
const NODE_API_NO_BROWSER_SENSE = new Set([
    'cluster',
    'inspector',
    'readline',
    'child_process',
    'dgram',
    'fs',
    'net',
    'tls',
    'v8',
    'globals',
]);

/**
 * Node-API packages that are GJS-only by design (native Vala+C bridges via
 * a `gi://Gjsify*` typelib): they ship `.so`+`.typelib` prebuilds and have
 * no meaningful surface anywhere except GJS. They keep `node:"none"` +
 * `browser:"none"` even though they may have a `.imports?.gi` guard the
 * scanner picks up — the prebuild is the impl, not a polyfill.
 */
const NODE_API_GJS_ONLY = new Set([
    'tls-native',
    'sab-native',
    'terminal-native',
    'http2-native',
    'http-soup-bridge',
]);

/**
 * Pre-existing declared `node:"none"` packages that the heuristic would
 * suggest `polyfill` for, but which a dedicated PR still needs to lift —
 * out of scope for the Wave 2-W slot pass. The audit recognises the
 * existing declaration so CI stays green.
 */
const NODE_API_LEGACY_NONE = new Set([
    'process',
]);

/**
 * Node-API packages whose Node-native value IS also a browser native value
 * (different identity, same shape). Per R1 Quick-Wins 2–5 + R2 §5.3 / §6.1
 * these packages get `browser: "native"`:
 *   - `url`        → `URL` / `URLSearchParams` global
 *   - `perf_hooks` → `performance` / `PerformanceObserver` global
 * The heuristic recognises these by name. Other node-api packages with a
 * `globals.mjs` keep `browser: "polyfill"` because globals.mjs there is
 * the Node-native `node:<pkg>` re-export (no browser equivalent).
 */
const NODE_API_BROWSER_NATIVE = new Set([
    'url',
    'perf_hooks',
]);

/**
 * Web-API packages whose impl is GJS-bound AND has NO Node-native pendant
 * (e.g. AudioContext / RTCPeerConnection / XMLHttpRequest / Gamepad —
 * browser-only Web APIs). globals.mjs presence here only signals browser
 * native-delegation; Node-target stays `none` since there is no `node:`
 * equivalent to re-export.
 */
const WEB_API_NODE_NONE = new Set([
    'webaudio',
    'webrtc',
    'xmlhttprequest',
    'gamepad',
]);

/**
 * Pure-TS Web-API packages with a globals.mjs AND a Node-native pendant
 * stable enough for slot=`native` on Node ≥22 LTS (R2 §5.1). For other
 * Pure-TS Web-API packages (dom-events with `CustomEvent` <23, EventSource
 * experimental, DOMParser absent on Node, navigator/Storage experimental)
 * the slot stays `polyfill` on Node — see the per-package floor notes in
 * `.gjsify-native-audit-R2.md` §1.
 */
const WEB_API_NODE_NATIVE = new Set([
    'abort-controller',
    'dom-exception',
    'formdata',
    'message-channel',
    'streams',
    'webassembly',
    'webcrypto',
    'compression-streams',
]);

/** Suggest a default {gjs, node, browser} triplet from the signals + axis. */
function suggestRuntimes(axis, signals, pkgSubpath) {
    const gjsBound =
        signals.girs_value || signals.gi_url || signals.imports_legacy || signals.gjs_imports_guard;
    // Dynamic-only GJS binding: package is portable, GJS path supplies the
    // real impl, other runtimes get a degraded no-op fallback. Slot = partial.
    const gjsDynamicOnly = !gjsBound && signals.dynamic_gi;

    // Infra packages: build tooling, not runtime polyfills. Excluded from the
    // triplet model — they ship the toolchain itself, not a polyfill.
    if (axis === 'infra') return null;

    // GJS-only by construction.
    if (axis === 'framework-gjs') return { gjs: 'polyfill', node: 'none', browser: 'none' };

    // Design-identity (adwaita-*): GJS already has Libadwaita native, browser
    // gets our polyfill, Node n/a (no UI in headless Node).
    if (axis === 'design-identity') {
        return { gjs: 'none', node: 'none', browser: 'polyfill' };
    }

    // Platform-bridge: today's iframe is GJS-only (wraps WebKit.WebView).
    // Browser/Node have no equivalent — would need a different bridge entirely.
    if (axis === 'platform-bridge') {
        return { gjs: 'polyfill', node: 'none', browser: 'none' };
    }

    // Node-API, Web-API, DOM — three-pillar polyfills.
    // (A) GJS-bound — polyfill on GJS, other slots depend on whether the
    // package ships a `globals.mjs` re-export pointing at the runtime's
    // native equivalent. Examples:
    //   - `@gjsify/websocket` is gjs-bound (Soup impl) AND ships globals.mjs
    //     re-exporting globalThis.WebSocket — Node 22+ and modern browsers
    //     have native WebSocket. Slot = `native` on Node/browser.
    //   - `@gjsify/webrtc-native` is gjs-bound and ships NO globals.mjs —
    //     no native equivalent on Node/browser. Slot = `none` on both.
    // Convention: `globals.mjs` presence is the signal that the package
    // has a workable native-delegation path on the non-GJS runtimes it
    // re-exports for. Where present, suggest `native`; otherwise `none`.
    if (gjsBound) {
        // DOM is native on browser even when impl is GJS-bound (the browser
        // doesn't need our impl; logically the slot is 'native').
        if (axis === 'dom') {
            return { gjs: 'polyfill', node: 'none', browser: 'native' };
        }
        // Web-API gjs-bound: globals.mjs presence signals native-delegation on
        // both Node + browser when the package's source-shipped impl is
        // GJS-bound but the runtime-native value is available on both other
        // runtimes (fetch, websocket via globalThis.{fetch,WebSocket} on
        // Node ≥21/22 + every modern browser). For packages whose value is
        // browser-only (webaudio/webrtc/xmlhttprequest/gamepad — no Node
        // pendant), the curated WEB_API_NODE_NONE set keeps node=`none`.
        if (axis === 'web-api' && signals.has_globals_mjs) {
            const nodeSlot = WEB_API_NODE_NONE.has(pkgSubpath) ? 'none' : 'native';
            return { gjs: 'polyfill', node: nodeSlot, browser: 'native' };
        }
        // Node-API gjs-bound — split by reason:
        //   - GJS-only native-bridge (NODE_API_GJS_ONLY): node=`none`, browser=`none`.
        //   - Legacy `node:"none"` packages (NODE_API_LEGACY_NONE) kept as-is until
        //     a dedicated follow-up declares them properly.
        //   - Otherwise (e.g. `path` — guarded `imports?.gi` fallback, runs fine in
        //     a browser bundler) → use the per-package WEB-style mapping:
        //     NODE_API_BROWSER_NATIVE → native/native, others → polyfill/polyfill.
        //     R1 Quick-Win 1 + Quick-Wins 2–5 + R2 §5.3.
        if (axis === 'node-api') {
            if (NODE_API_GJS_ONLY.has(pkgSubpath)) {
                return { gjs: 'polyfill', node: 'none', browser: 'none' };
            }
            if (NODE_API_LEGACY_NONE.has(pkgSubpath)) {
                return { gjs: 'polyfill', node: 'none', browser: 'none' };
            }
            // path / perf_hooks etc.: gjs_imports_guard only (no static gi:// /
            // @girs/* value-import / legacy imports.X). Pure-TS portable.
            if (
                signals.gjs_imports_guard &&
                !signals.girs_value &&
                !signals.gi_url &&
                !signals.imports_legacy
            ) {
                const nativeMember = NODE_API_BROWSER_NATIVE.has(pkgSubpath);
                const nodeSlot = nativeMember ? 'native' : 'polyfill';
                const browserSlot = nativeMember ? 'native' : 'polyfill';
                return { gjs: 'polyfill', node: nodeSlot, browser: browserSlot };
            }
        }
        const nativeSlot = signals.has_globals_mjs ? 'native' : 'none';
        return { gjs: 'polyfill', node: nativeSlot, browser: nativeSlot };
    }

    // (B) Pure-TS — portable on all three. Browser-native flag if a Web-API
    // surface has a same-named browser global (most do; the slot is 'native'
    // meaning "delegate via re-export"); when not certain, leave 'polyfill'
    // (our impl is correct fallback). When the package uses dynamic
    // `import('gi://X')` for graceful degradation, downgrade non-GJS slots to
    // `partial` — the package loads everywhere, but functionality drops on
    // non-GJS runtimes.
    const nonGjsSlot = gjsDynamicOnly ? 'partial' : 'polyfill';
    if (axis === 'web-api') {
        // Web APIs are native on browser by definition. For Node, the slot
        // is `native` when (a) the package ships a `globals.mjs` re-export
        // AND (b) the package is in the WEB_API_NODE_NATIVE curated set —
        // Node ≥22 LTS makes most Web-API globals stable (R2 §5.1), but a
        // handful (CustomEvent in dom-events <23, EventSource still
        // experimental, DOMParser absent on Node, navigator/Storage
        // experimental — see R2 §1) keep `polyfill` as the safer default.
        const nodeNativeEligible = WEB_API_NODE_NATIVE.has(pkgSubpath);
        const nodeSlot = gjsDynamicOnly
            ? 'partial'
            : signals.has_globals_mjs && nodeNativeEligible
                ? 'native'
                : 'polyfill';
        // Browser: gjsDynamicOnly means the package falls back to a graceful
        // no-op when its GJS backend is missing. If it ships a globals.mjs
        // pointing at a native browser value (gamepad → Gamepad/GamepadEvent),
        // the browser-slot upgrades to `native` per R2 §5.2 — the dynamic
        // backend simply never loads in a browser bundle.
        const browserSlot = gjsDynamicOnly
            ? signals.has_globals_mjs
                ? 'native'
                : 'partial'
            : 'native';
        return { gjs: 'polyfill', node: nodeSlot, browser: browserSlot };
    }
    if (axis === 'node-api') {
        // Node APIs are native on Node by definition. For browser:
        //   - NODE_API_NO_BROWSER_SENSE (cluster/inspector/readline/dgram/fs/…)
        //     → slot=`none` per R1 Quick-Wins 11–13 (no sensible browser surface).
        //   - NODE_API_BROWSER_NATIVE (url/perf_hooks) → slot=`native` per R1
        //     Quick-Wins 2–5 + R2 §5.3 (Node-native value is also browser-native).
        //   - Everything else → our polyfill is the fallback (slot=`polyfill`).
        // globals.mjs presence is NOT used to flip browser-slot here — most
        // node-api globals.mjs files re-export `node:<pkg>` which has no
        // browser equivalent; only the curated `NODE_API_BROWSER_NATIVE` set
        // genuinely has globalThis re-exports that work in both runtimes.
        const browserSlot = gjsDynamicOnly
            ? 'partial'
            : NODE_API_NO_BROWSER_SENSE.has(pkgSubpath)
                ? 'none'
                : NODE_API_BROWSER_NATIVE.has(pkgSubpath)
                    ? 'native'
                    : 'polyfill';
        return { gjs: 'polyfill', node: gjsDynamicOnly ? 'partial' : 'native', browser: browserSlot };
    }
    if (axis === 'dom') {
        return { gjs: 'polyfill', node: nonGjsSlot, browser: gjsDynamicOnly ? 'partial' : 'native' };
    }
    return null;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

async function buildReport() {
    const pkgDirs = await findPackages(PACKAGES_DIR);
    const rows = [];
    for (const pkgDir of pkgDirs) {
        const pkgJsonPath = join(pkgDir, 'package.json');
        const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
        const rel = relative(PACKAGES_DIR, pkgDir);
        const signals = await scanSourceTree(pkgDir);
        const axis = classifyAxis(rel, pkgJson.name ?? '');
        const subpath = rel.split('/')[1] ?? '';
        const suggested = suggestRuntimes(axis, signals, subpath);
        const declared = pkgJson.gjsify?.runtimes ?? null;
        rows.push({
            name: pkgJson.name,
            path: rel,
            axis,
            gjs_bound: signals.girs_value || signals.gi_url || signals.imports_legacy,
            signals,
            declared,
            suggested,
        });
    }
    rows.sort((a, b) => a.path.localeCompare(b.path));
    return rows;
}

// ─── Output ─────────────────────────────────────────────────────────────────

function fmtSlot(slot) {
    if (!slot) return ' — ';
    return `${slot.gjs.padEnd(8)} ${slot.node.padEnd(8)} ${slot.browser}`;
}

function renderTable(rows) {
    const header = ['package', 'axis', 'gjs', 'node', 'browser', 'declared', 'src/'];
    const widths = header.map((h) => h.length);
    const cells = rows.map((r) => {
        const sg = r.suggested ?? { gjs: '—', node: '—', browser: '—' };
        const declared = r.declared ? 'yes' : '—';
        const c = [
            r.name ?? r.path,
            r.axis,
            sg.gjs,
            sg.node,
            sg.browser,
            declared,
            `${r.signals.file_count}f${r.gjs_bound ? '+gjs' : ''}`,
        ];
        c.forEach((v, i) => {
            widths[i] = Math.max(widths[i], String(v).length);
        });
        return c;
    });
    const sep = widths.map((w) => '─'.repeat(w)).join('─┬─');
    const fmt = (row) => row.map((v, i) => String(v).padEnd(widths[i])).join(' │ ');
    return [fmt(header), sep, ...cells.map(fmt)].join('\n');
}

function renderMarkdown(rows) {
    const lines = ['| package | axis | gjs | node | browser | declared | src |', '|---|---|---|---|---|---|---|'];
    for (const r of rows) {
        const sg = r.suggested ?? { gjs: '—', node: '—', browser: '—' };
        const declared = r.declared
            ? '✓'
            : r.suggested
              ? '—'
              : 'n/a';
        lines.push(
            `| \`${r.name ?? r.path}\` | ${r.axis} | ${sg.gjs} | ${sg.node} | ${sg.browser} | ${declared} | ${r.signals.file_count}${r.gjs_bound ? ' +gjs' : ''} |`,
        );
    }
    return lines.join('\n');
}

function renderJson(rows) {
    return JSON.stringify(rows, null, 2);
}

/**
 * Compare declared vs suggested triplets and return a list of drifted rows.
 * Only rows where BOTH `declared` and `suggested` exist are checked; infra /
 * unknown axes (suggested === null) are skipped — the script has nothing to
 * say about them. A row where `declared` is missing but `suggested` exists is
 * also flagged (a new package landed without declaring its triplet).
 */
function diffDeclared(rows) {
    const drifted = [];
    const missing = [];
    for (const r of rows) {
        if (!r.suggested) continue; // infra / unknown — out of scope
        if (!r.declared) {
            missing.push(r);
            continue;
        }
        const slots = ['gjs', 'node', 'browser'];
        const mismatches = slots.filter((s) => r.declared[s] !== r.suggested[s]);
        if (mismatches.length > 0) {
            drifted.push({ row: r, mismatches });
        }
    }
    return { drifted, missing };
}

/** Short human-readable signal summary for a row — what drove the suggestion. */
function summarizeSignals(r) {
    const s = r.signals;
    const flags = [];
    if (s.girs_value) flags.push('@girs/* value-import');
    if (s.gi_url) flags.push('gi:// URL import');
    if (s.dynamic_gi) flags.push('dynamic import(gi://)');
    if (s.imports_legacy) flags.push('legacy imports.X');
    if (s.gjs_imports_guard) flags.push('.imports?.gi guard');
    if (s.has_browser_entry) flags.push('test.browser entry');
    if (s.has_globals_mjs) flags.push('globals.mjs');
    if (flags.length === 0) flags.push('pure TS (no GJS-binding signal)');
    return `axis=${r.axis}, signals: ${flags.join(', ')}`;
}

function fmtTriplet(t) {
    return `{gjs:${t.gjs}, node:${t.node}, browser:${t.browser}}`;
}

async function apply(rows) {
    let updated = 0;
    let skipped = 0;
    for (const r of rows) {
        if (!r.suggested) {
            skipped++;
            continue;
        }
        if (r.declared) {
            skipped++;
            continue;
        }
        const pkgJsonPath = join(PACKAGES_DIR, r.path, 'package.json');
        const text = await readFile(pkgJsonPath, 'utf8');
        const pkg = JSON.parse(text);
        pkg.gjsify ??= {};
        pkg.gjsify.runtimes = r.suggested;
        // Preserve trailing newline + 4-space indent (matches repo style).
        await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 4) + '\n');
        updated++;
    }
    return { updated, skipped };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const rows = await buildReport();

if (APPLY) {
    const { updated, skipped } = await apply(rows);
    console.log(`audit-runtimes: applied ${updated} package(s), skipped ${skipped} (already-declared / infra / unknown).`);
    process.exit(0);
}

if (CHECK) {
    const { drifted, missing } = diffDeclared(rows);
    const declarable = rows.filter((r) => r.suggested).length;
    if (drifted.length === 0 && missing.length === 0) {
        console.log(
            `audit-runtimes --check: OK. ${declarable} declarable package(s) match the signal-based suggestion (${rows.length - declarable} infra/unknown skipped).`,
        );
        process.exit(0);
    }
    console.error('audit-runtimes --check: DRIFT DETECTED.\n');
    if (missing.length > 0) {
        console.error(`Missing gjsify.runtimes declaration on ${missing.length} package(s):`);
        for (const r of missing) {
            console.error(`  - ${r.name ?? r.path}  (path: packages/${r.path})`);
            console.error(`      suggested: ${fmtTriplet(r.suggested)}`);
            console.error(`      reason:    ${summarizeSignals(r)}`);
        }
        console.error('');
    }
    if (drifted.length > 0) {
        console.error(`Declared triplet drifts from source-code signals on ${drifted.length} package(s):`);
        for (const { row: r, mismatches } of drifted) {
            console.error(`  - ${r.name ?? r.path}  (path: packages/${r.path})`);
            console.error(`      declared:  ${fmtTriplet(r.declared)}`);
            console.error(`      suggested: ${fmtTriplet(r.suggested)}`);
            console.error(`      slots:     ${mismatches.join(', ')}`);
            console.error(`      reason:    ${summarizeSignals(r)}`);
        }
        console.error('');
    }
    console.error(
        'Either update the package\'s source-code signals (the GJS-binding shape changed) or update its package.json#gjsify.runtimes to match the new reality. See AGENTS.md `## Strategic direction — cross-runtime portability` for the slot model.',
    );
    process.exit(1);
}

if (FORMAT === 'json') {
    console.log(renderJson(rows));
} else if (FORMAT === 'markdown') {
    console.log(renderMarkdown(rows));
} else {
    console.log(renderTable(rows));
    const counts = rows.reduce((acc, r) => {
        acc[r.axis] = (acc[r.axis] ?? 0) + 1;
        return acc;
    }, {});
    console.log('\nAxis counts:', counts);
    const declaredCount = rows.filter((r) => r.declared).length;
    const declarableCount = rows.filter((r) => r.suggested).length;
    console.log(`Declared: ${declaredCount} / ${declarableCount} declarable (${rows.length - declarableCount} infra/unknown).`);
}
