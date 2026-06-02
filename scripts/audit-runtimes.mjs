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
//   node scripts/audit-runtimes.mjs --check --strict
//                                                 # functional probes:
//                                                 # statically validate that
//                                                 # `native`/`polyfill` slots
//                                                 # have the mechanics they
//                                                 # claim (globals.mjs parses
//                                                 # + each re-export is
//                                                 # plausibly resolvable on
//                                                 # the target runtime; a
//                                                 # browser:"polyfill" slot
//                                                 # ships a `src/test.browser
//                                                 # .{mts,ts}` entry). Exit 1
//                                                 # on any probe failure, in
//                                                 # addition to the drift /
//                                                 # missing checks.
//   node scripts/audit-runtimes.mjs --check --quick
//                                                 # explicit forward-
//                                                 # compatible opt-out for
//                                                 # the functional probes.
//                                                 # Today `--check` and
//                                                 # `--check --quick` are
//                                                 # behaviorally identical
//                                                 # (probes opt-in); when the
//                                                 # default flips to strict
//                                                 # (PR-B follow-up, T-Plan
//                                                 # section 1d step 3) `--
//                                                 # quick` becomes the way to
//                                                 # pin the legacy "drift +
//                                                 # missing only" behavior.
//
// PR-B (T-Plan section 1d step 3) had planned to flip the `--check` default
// to strict mode in this PR. The flip is currently NOT performed because 26
// packages on the integration base (`feat/tooling-foundation-wave2-t` + the
// staged browser-polyfill PRs #392–#396) declare `browser:"polyfill"` but
// lack the required `src/test.browser.{mts,ts}` entry the probes look for.
// The flip is parked behind a follow-up PR; the unblock work is per-package
// `src/test.browser.mts` skeletons in the R1 wave. The `--quick` flag is
// wired today so callers already pinning the legacy behavior can switch to
// the forward-compatible spelling now; the constant is harmless until the
// default flips (it merely shadows `--strict` when both are present).
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
// `--quick` is the forward-compatible opt-out flag for the future default-
// strict mode (PR-B follow-up). Today the default is still legacy, so
// `--quick` is a no-op; the constant is wired now so callers can pin the
// legacy behavior with the forward-compatible spelling and stay green when
// the default flips.
const QUICK = args.has('--quick');
// `--strict` runs the functional probes during `--check`. The default-flip
// to strict mode is parked behind PR-B follow-up (gated on R1 closing the
// remaining `src/test.browser.{mts,ts}` gaps — 26 packages affected on
// the integration base today). `--quick` wins on conflict to keep the
// caller's opt-out intent unambiguous.
const STRICT = args.has('--strict') && !QUICK;

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
        has_browser_polyfill: existsSync(join(srcDir, 'browser.ts')) || existsSync(join(srcDir, 'browser.mts')),
        browser_src_is_partial: false,
        has_globals_mjs: existsSync(join(pkgDir, 'globals.mjs')),        globals_mjs_browser_safe: false,
        file_count: 0,
    };
    if (signals.has_browser_polyfill) {
        const browserSrc = existsSync(join(srcDir, 'browser.ts'))
            ? join(srcDir, 'browser.ts')
            : join(srcDir, 'browser.mts');
        try {
            const txt = await readFile(browserSrc, 'utf8');
            // Heuristic: a browser entry is `partial` when the file declares its
            // slot explicitly in a comment (`Slot is "browser:\"partial\""`) OR
            // when its impl throws ENOTSUP from MULTIPLE entry points (the
            // canonical dns/module/ws pattern — at least 2 method bodies
            // produce a code:'ENOTSUP' error). A single throw (e.g.
            // process.chdir throwing) does NOT downgrade an otherwise functional
            // polyfill to `partial`; that's the process-browserify shape.
            const slotDeclaredPartial = /Slot[^.\n]*partial/i.test(txt);
            const enotsupHits = (txt.match(/code\s*[:=]\s*['"]ENOTSUP['"]/g) ?? []).length;
            signals.browser_src_is_partial = slotDeclaredPartial || enotsupHits >= 2;
        } catch {
            // unreadable — treat as full polyfill (conservative for upgrade path)
        }
    }
    if (signals.has_globals_mjs) {
        try {
            const txt = await readFile(join(pkgDir, 'globals.mjs'), 'utf8');
            // Browser-safe iff the file ships actual exports AND none re-export
            // from a `node:` specifier — i.e. it routes through `globalThis.*`
            // (Wave-3 pattern) or otherwise stays runtime-agnostic. An empty
            // `export {};` file (the `@gjsify/node-polyfills` meta-pkg pattern)
            // is NOT a browser-native delegation path.
            const hasNonEmptyExport = /export\s+(?:const|let|var|function|class|default|\{[^}]*\w[^}]*\})/m.test(txt);
            signals.globals_mjs_browser_safe = hasNonEmptyExport && !/from\s+['"]node:/m.test(txt);
        } catch {
            // unreadable → treat as not-browser-safe (conservative)
        }
    }
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
    // `process` used to live here while it had no browser entry; it now ships
    // `src/browser.ts` (defunctzombie-style env / nextTick / stdio stubs) so
    // the legacy-none designation is no longer accurate. The heuristic now
    // honours the browser.ts via `has_browser_polyfill` instead.
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
                // A `globals.mjs` re-exporting the runtime-native value upgrades
                // the node slot to `native` — same logic the post-PR-#392 audit
                // already applies to the gjs-bound default below. Without this
                // check, packages like `@gjsify/process` (`gjs_imports_guard` +
                // a `globalThis.process` globals.mjs) get a spurious `polyfill`
                // suggestion that drifts from their honest `native` declaration.
                const nodeSlot = nativeMember || signals.has_globals_mjs ? 'native' : 'polyfill';
                const browserSlot = nativeMember ? 'native' : 'polyfill';
                return { gjs: 'polyfill', node: nodeSlot, browser: browserSlot };
            }
        }
        const nativeSlot = signals.has_globals_mjs ? 'native' : 'none';
        // Browser slot upgrade: a dedicated `src/browser.ts` entry indicates
        // a partial/polyfill browser-specific impl exists alongside the
        // GJS-bound default. The `browser_src_is_partial` heuristic distinguishes
        // a stub-shaped browser entry (ENOTSUP throws ≥2 OR `Slot ... partial`
        // comment) from a full polyfill.
        let browserSlot = nativeSlot;
        if (signals.has_browser_polyfill && !signals.has_globals_mjs) {
            browserSlot = signals.browser_src_is_partial ? 'partial' : 'polyfill';
        }
        return { gjs: 'polyfill', node: nativeSlot, browser: browserSlot };    }

    // (B) Pure-TS — portable on all three. Browser-native flag if a Web-API
    // surface has a same-named browser global (most do; the slot is 'native'
    // meaning "delegate via re-export"); when not certain, leave 'polyfill'
    // (our impl is correct fallback). When the package uses dynamic
    // `import('gi://X')` for graceful degradation, downgrade non-GJS slots to
    // `partial` — the package loads everywhere, but functionality drops on
    // non-GJS runtimes.
    //
    // Cross-runtime `globals.mjs`: a node-api pkg that ships a browser-safe
    // `globals.mjs` (re-exports `globalThis.*`, no `node:*` specifiers) has
    // a working `native` slot for both Node AND browser — the same file
    // serves both targets. This is the Wave-3 pattern for `console` / `timers`.
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
        // Node APIs are native on Node by definition; browser uses our polyfill,
        // unless globals.mjs is browser-safe — then browser is also `native`.
        // A dedicated `src/browser.ts` shipping ENOTSUP-throws on multiple
        // entries (or self-declared as partial) downgrades the slot from
        // `polyfill` to `partial` — pure-TS-but-functionally-partial pattern
        // used by `@gjsify/https` (server throws, client via fetch).
        let browserSlot;
        if (NODE_API_NO_BROWSER_SENSE.has(pkgSubpath)) {
            // cluster / inspector / readline / fs / net / tls / dgram / etc. —
            // semantics have no browser pendant. The `globals.mjs` they ship is
            // Node-only (`export * from 'node:cluster'`), so without this
            // explicit carve-out the per-axis heuristic would suggest `polyfill`
            // and produce false-positive drift on every CI run. The user-facing
            // package.json keeps `browser:"none"` as the honest declaration.
            browserSlot = 'none';
        } else if (gjsDynamicOnly) {
            browserSlot = 'partial';
        } else if (signals.globals_mjs_browser_safe) {
            browserSlot = 'native';
        } else if (signals.has_browser_polyfill && signals.browser_src_is_partial) {
            browserSlot = 'partial';
        } else {
            browserSlot = nonGjsSlot;
        }
        return {
            gjs: 'polyfill',
            node: gjsDynamicOnly ? 'partial' : 'native',
            browser: browserSlot,
        };
    }
    if (axis === 'dom') {
        return { gjs: 'polyfill', node: nonGjsSlot, browser: gjsDynamicOnly ? 'partial' : 'native' };
    }
    return null;
}

/**
 * Derive a default `nativescript` slot from an already-suggested
 * {gjs,node,browser} triplet + the source-tree signals. Foundation-time
 * heuristic; per-package Welle-5 PRs override with explicit declarations.
 *
 * Rules:
 * - GJS-bound (gi://, @girs/* value-import, imports.X) → 'none'.
 *   The package can't run on NS' V8 because it depends on GObject Introspection.
 * - Browser-native Web APIs that NS V8 also exposes (fetch, URL, WebSocket,
 *   crypto, etc.) → 'native'. Routed via /globals re-export on `--app nativescript`.
 * - Pure TS portable (slot=polyfill on >1 runtime) → 'polyfill'.
 *   Should run on NS V8 without modification; per-package Welle 5 confirms.
 * - DOM / framework-gjs → 'none'. NS has its own UI system; no DOM.
 * - Server-only Node-API (cluster, inspector, etc.) → 'none'.
 * - Fallback → 'none' (conservative default; consumers explicitly opt in).
 */
function deriveNativescriptSlot(axis, suggested, signals, pkgSubpath) {
    if (!suggested) return null;
    // GJS-bound packages can't run on NS' V8
    if (signals.girs_value || signals.gi_url || signals.imports_legacy) return 'none';
    // DOM/Framework are GJS+browser specific
    if (axis === 'dom' || axis === 'framework-gjs') return 'none';
    // Browser-native Web APIs are typically also NS-native (NS V8 ships fetch/URL/WebSocket/crypto/…)
    if (axis === 'web-api' && suggested.browser === 'native') return 'native';
    // Pure-TS Node-API polyfills with portable shapes → polyfill candidate
    if (axis === 'node-api') {
        // Server-only modules → none
        if (NODE_API_NO_BROWSER_SENSE.has(pkgSubpath)) return 'none';
        // If browser slot is polyfill/partial/native, we likely have a portable shape
        if (suggested.browser === 'polyfill' || suggested.browser === 'partial' || suggested.browser === 'native') return 'polyfill';
    }
    return 'none';
}

// ─── Functional probes (opt-in via `--check --strict`) ─────────────────────
//
// The probes statically validate that the DECLARED `gjsify.runtimes` triplet
// is backed by actual mechanics on disk — independent from the drift check,
// which only compares the declared triplet against the signal-based suggestion.
//
// Three probe kinds today:
//   - `globals-broken` (slot=`native` on node/browser): `globals.mjs` exists,
//     parses, and every `export {…} from '<spec>'` re-export source is
//     recognisable as a runtime-resolvable specifier (Node built-ins for
//     `node` target, curated browser-native set for `browser`, plus
//     `@gjsify/<X>/globals` self-delegation either way). NO runtime evaluation
//     — we run inside Node and must not crash on a browser-only re-export.
//   - `no-browser-test` (slot=`browser:"polyfill"`): a `src/test.browser.mts`
//     or `src/test.browser.ts` entry exists so the package can be validated
//     against Firefox/SpiderMonkey via the `tests/browser/` Playwright suite.
//     NO actual build — too expensive for `--check`. The static existence of
//     the entry is the contract.
//
// `BROWSER_NATIVE_RE_EXPORTS` is sourced from `BROWSER_NATIVE_IDENTS` in
// `@gjsify/resolve-npm/globals-map` (T-Plan Sektion 5b-i landed via PR-G).
// Each identifier doubles as the canonical bare specifier a `globals.mjs`
// would re-export from on a browser target — `export { X } from 'X'` mirrors
// the pattern used today on Node (`export { default as X } from 'node:X'`).

import { BROWSER_NATIVE_IDENTS } from '../packages/infra/resolve-npm/lib/globals-map.mjs';

/**
 * Curated set of bare specifiers that are safe to re-export from a
 * `globals.mjs` aimed at the browser target. Populated from
 * `BROWSER_NATIVE_IDENTS` (T-Plan Sektion 5b-i): every identifier the curated
 * map declares as browser-native is, by definition, a specifier the browser
 * resolves natively when a `globals.mjs` does `export { Foo } from 'Foo'`.
 * `@gjsify/<X>/globals` self-delegation chains are recognised separately in
 * `probeGlobalsExports`.
 */
const BROWSER_NATIVE_RE_EXPORTS = new Set(BROWSER_NATIVE_IDENTS);

/**
 * Statically extract every `export {…} from '<src>'` / `export * from
 * '<src>'` specifier from a `globals.mjs` file. Regex-based — no full ESM
 * parser. Conservative: anything ambiguous fails-open (the regex either
 * matches the canonical re-export form or it does not, the probe never
 * silently passes a malformed file because `existsSync` + `readFile` already
 * gate that).
 */
async function probeGlobalsExports(pkgDir, target) {
    const filePath = join(pkgDir, 'globals.mjs');
    if (!existsSync(filePath)) {
        return { ok: false, reason: 'globals.mjs missing' };
    }
    let src;
    try {
        src = await readFile(filePath, 'utf8');
    } catch (err) {
        return { ok: false, reason: `globals.mjs unreadable: ${err.message}` };
    }
    const reExports = [...src.matchAll(/export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)].map(
        (m) => m[1],
    );
    for (const spec of reExports) {
        // `@gjsify/<X>/globals` self-delegation is always OK on either target —
        // the chain terminates at a package that has its own probe applied.
        if (spec.startsWith('@gjsify/') && spec.endsWith('/globals')) continue;
        if (target === 'node') {
            // Node built-ins: either `node:*` prefix or bare specifier in the
            // hardcoded EXTERNALS_NODE list (which mirrors the `module.builtinModules`
            // surface that resolve-npm treats as native on Node).
            if (spec.startsWith('node:')) continue;
            if (EXTERNALS_NODE.includes(spec)) continue;
        }
        if (target === 'browser') {
            if (BROWSER_NATIVE_RE_EXPORTS.has(spec)) continue;
        }
        return { ok: false, reason: `unrecognised re-export source for target=${target}: ${spec}` };
    }
    return { ok: true };
}

/**
 * Static existence-only check for a browser test entry. NO actual build —
 * the bundle build is `--app browser` and prohibitively expensive for the
 * audit script. The presence of `src/test.browser.{mts,ts}` is the contract
 * between the package and the `tests/browser/` Playwright discovery.
 */
async function probeBrowserBuildable(pkgDir) {
    // Carve-out: a `src/test.browser.{mts,ts}` mirrors the package's standard
    // `src/test.{mts,ts}` suite. Packages that ship NO standard test entry have
    // nothing to derive a browser test from, so the `no-browser-test` probe does
    // not apply: dependency-only meta packages (`@gjsify/node-polyfills`,
    // `@gjsify/browser-node-polyfills` — no `src/` at all) and design-asset
    // packages (`@gjsify/adwaita-{fonts,icons,web}` — CSS / fonts / icons / Web
    // Components, no `@gjsify/unit` test harness). Without this, flipping the
    // default `--check` to strict would gate every CI run on test entries that
    // cannot meaningfully exist.
    const hasStandardTest =
        existsSync(join(pkgDir, 'src', 'test.mts')) || existsSync(join(pkgDir, 'src', 'test.ts'));
    if (!hasStandardTest) return { ok: true };

    const candidates = [
        join(pkgDir, 'src', 'test.browser.mts'),
        join(pkgDir, 'src', 'test.browser.ts'),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) return { ok: true };
    }
    return {
        ok: false,
        reason: 'browser:"polyfill" declared but no src/test.browser.{mts,ts} entry',
    };
}

/**
 * Run the probe set for a single row. Only the DECLARED triplet drives the
 * probe selection — drift (declared ≠ suggested) is reported separately by
 * `diffDeclared`. A row with no `declared` triplet skips probes entirely
 * (the missing-declaration path already surfaces the issue).
 *
 * Returns an array of `{ slot, kind, detail }` failures (empty = ok).
 */
async function functionalProbe(row) {
    const failures = [];
    const declared = row.declared;
    if (!declared) return failures;

    if (declared.node === 'native') {
        const r = await probeGlobalsExports(row.pkgDir, 'node');
        if (!r.ok) failures.push({ slot: 'node', kind: 'globals-broken', detail: r.reason });
    }
    if (declared.browser === 'native') {
        const r = await probeGlobalsExports(row.pkgDir, 'browser');
        if (!r.ok) failures.push({ slot: 'browser', kind: 'globals-broken', detail: r.reason });
    }
    if (declared.browser === 'polyfill') {
        const r = await probeBrowserBuildable(row.pkgDir);
        if (!r.ok) failures.push({ slot: 'browser', kind: 'no-browser-test', detail: r.reason });
    }
    return failures;
}

/** Run `functionalProbe` over every row, returning the rows that failed. */
async function runProbes(rows) {
    const probeFailures = [];
    for (const row of rows) {
        const failures = await functionalProbe(row);
        if (failures.length > 0) {
            probeFailures.push({ row, failures });
        }
    }
    return probeFailures;
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
        if (suggested) {
            // Quadruplet: append the `nativescript` slot suggestion via the
            // foundation-time heuristic (Welle 4-T). Per-package Welle-5 PRs
            // override with explicit declarations.
            suggested.nativescript = deriveNativescriptSlot(axis, suggested, signals, subpath);
        }
        const declared = pkgJson.gjsify?.runtimes ?? null;
        rows.push({
            name: pkgJson.name,
            path: rel,
            pkgDir,
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
        const slots = ['gjs', 'node', 'browser', 'nativescript'];
        const mismatches = slots.filter((s) => {
            // `nativescript` is a Foundation-time addition (Welle 4-T). Existing
            // packages declared their triplet before NS was an axis; treat the
            // 4th slot as OPTIONAL until per-package Welle-5 PRs backfill it.
            // If the package doesn't declare `nativescript`, skip drift check
            // on that slot (the suggestion is just a hint, not a hard target).
            if (s === 'nativescript' && r.declared[s] === undefined) return false;
            return r.declared[s] !== r.suggested[s];
        });
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
    const ns = t?.nativescript !== undefined ? `, nativescript:${t.nativescript}` : '';
    return `{gjs:${t?.gjs}, node:${t?.node}, browser:${t?.browser}${ns}}`;
}

/** Read the declared slot for a single target on a row, defaulting to `?`. */
function declaredSlot(row, slot) {
    return row.declared?.[slot] ?? '?';
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
    // Functional probes only run under `--check --strict`. The default
    // `--check` path stays byte-identical to its pre-strict behavior so the
    // existing audit-runtimes CI workflow does not start failing the moment
    // this script lands. Strict mode will become the default once R1 has
    // closed the remaining `globals.mjs` gaps (T-Plan Sektion 1d step 3).
    const probeFailures = STRICT ? await runProbes(rows) : [];
    const ok = drifted.length === 0 && missing.length === 0 && probeFailures.length === 0;
    if (ok) {
        const suffix = STRICT
            ? ` (functional probes passed on every declared slot)`
            : '';
        console.log(
            `audit-runtimes --check${STRICT ? ' --strict' : ''}: OK. ${declarable} declarable package(s) match the signal-based suggestion (${rows.length - declarable} infra/unknown skipped).${suffix}`,
        );
        process.exit(0);
    }
    console.error(`audit-runtimes --check${STRICT ? ' --strict' : ''}: DRIFT DETECTED.\n`);
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
    if (probeFailures.length > 0) {
        console.error(
            `FUNCTIONAL PROBE FAILURES on ${probeFailures.length} package(s):`,
        );
        for (const { row: r, failures } of probeFailures) {
            console.error(`  - ${r.name ?? r.path}  (path: packages/${r.path})`);
            console.error(`      declared:  ${fmtTriplet(r.declared)}`);
            const lines = failures.map((f) => `${f.slot}-${declaredSlot(r, f.slot)}: ${f.kind} — ${f.detail}`);
            for (const line of lines) {
                console.error(`      problem:   ${line}`);
            }
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
