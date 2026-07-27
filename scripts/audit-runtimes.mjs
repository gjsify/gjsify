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
//   node scripts/audit-runtimes.mjs --platforms   # the OS × native-package
//                                                 # matrix: which `<os>-<arch>`
//                                                 # prebuild each native
//                                                 # package declares, ships
//                                                 # and actually gets built
//                                                 # for in CI. Combine with
//                                                 # --markdown / --json.
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
//
// Tier audit (ADR 0003 + ADR 0005) — always part of `--check` (both quick
// and strict): every PUBLISHED workspace package (packages/** + showcases/**
// + any other workspace root, `private: true` exempt) must declare
// `gjsify.tier` ∈ {1,2,3}; walking `dependencies` + `optionalDependencies`
// (NOT devDependencies / peerDependencies — optional peers are the
// sanctioned looseness), every `@gjsify/*` workspace edge A→B must satisfy
// tier(B) <= tier(A) (a stability-promised package must not inherit an
// experiment's breakage); and per ADR 0005 no Tier-1/2 package may take a
// hard dependency on `@gjsify/node-gi` (devDependency is the sanctioned
// seam).
//
// Platform audit (OS axis) — also always part of `--check`. `gjsify.runtimes`
// declares which RUNTIMES a package reaches; it is silent about OPERATING
// SYSTEMS, which is how the entire native-bridge set stayed Linux-only while
// the project described itself as platform-independent. Every package with a
// native build system (meson / node-gyp) or a prebuild directory must declare
// `gjsify.platforms` — the `<os>-<arch>` targets it promises a prebuild for —
// and the audit holds three invariants: a committed `prebuilds/<target>/` is
// declared; a declared target is actually produced by a CI job; and a package
// that ships prebuilds has at least one workflow that reproduces them (a
// hand-built binary nothing rebuilds drifts from its sources in silence).
// `--platforms` renders the same data as a matrix for documentation.
//
// Headless audit (ADR 0015) — also always part of `--check`. Everything above
// models CROSS-RUNTIME reach; this is the one check on intra-GJS LAYERING.
// `package.json#gjsify.headless` (either `true` = "the root entry reaches no
// typelib at all", or a list of typelib namespaces it promises not to reach)
// is verified against the ROOT import graph — from `exports["."]`, across
// relative imports and `@gjsify/*` workspace edges. Root-entry-only is the
// point: a side-effect SUBPATH may legitimately reach the forbidden typelibs
// (`@gjsify/canvas2d-core/gdk`), which is precisely why scanning `src/**`
// would be wrong here.

import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The ONE binary-artifact parser (Mach-O / ELF / PE / GI typelib). Reused
// rather than reimplemented: a second parser is a second thing to keep
// correct, and the whole reason a Linux host can verify a darwin prebuild at
// all is that this one reads the formats directly instead of shelling out to
// `otool`/`readelf`.
import { checkPrebuildDir, readLibrary, readTypelibSharedLibraries } from './check-prebuild-loader-path.mjs';

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
/** Print only the OS × native-package matrix (the platform-support report). */
const PLATFORMS = args.has('--platforms');
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
const IMPORTS_LEGACY_RE =
    /(?<!\/\/.*)(?<!\*.*)\bimports\.(?:byteArray|gi|system|signals|cairo|gettext|format|misc|jsUnit|searchPath)/;
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
        // Standard cross-runtime test harness (`src/test.{mts,ts}`) — the signal
        // that a package's behavior is exercised by `@gjsify/unit` across
        // runtimes. Distinguishes headless behavior CONTRACTS from design-ASSET
        // packages on the design-identity axis (see `suggestRuntimes`).
        has_test_entry: existsSync(join(srcDir, 'test.mts')) || existsSync(join(srcDir, 'test.ts')),
        has_browser_polyfill: existsSync(join(srcDir, 'browser.ts')) || existsSync(join(srcDir, 'browser.mts')),
        browser_src_is_partial: false,
        has_globals_mjs: existsSync(join(pkgDir, 'globals.mjs')),
        globals_mjs_browser_safe: false,
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
        if ((subpath ?? pkgName).startsWith('adwaita')) return 'design-identity';
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
const NODE_API_GJS_ONLY = new Set(['tls-native', 'sab-native', 'terminal-native', 'http2-native', 'http-soup-bridge']);

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
const NODE_API_BROWSER_NATIVE = new Set(['url', 'perf_hooks']);

/**
 * Web-API packages whose impl is GJS-bound AND has NO Node-native pendant
 * (e.g. AudioContext / RTCPeerConnection / XMLHttpRequest / Gamepad —
 * browser-only Web APIs). globals.mjs presence here only signals browser
 * native-delegation; Node-target stays `none` since there is no `node:`
 * equivalent to re-export.
 */
const WEB_API_NODE_NONE = new Set(['webaudio', 'webrtc', 'xmlhttprequest', 'gamepad']);

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
    const gjsBound = signals.girs_value || signals.gi_url || signals.imports_legacy || signals.gjs_imports_guard;
    // Dynamic-only GJS binding: package is portable, GJS path supplies the
    // real impl, other runtimes get a degraded no-op fallback. Slot = partial.
    const gjsDynamicOnly = !gjsBound && signals.dynamic_gi;

    // Infra packages: build tooling, not runtime polyfills. Excluded from the
    // triplet model — they ship the toolchain itself, not a polyfill.
    if (axis === 'infra') return null;

    // GJS-only by construction. (A PURE-TS framework contract — no GJS-binding
    // signal at all, e.g. `@gjsify/stories` / `@gjsify/storybook-core` — may
    // legitimately opt the node/browser/nativescript slots INTO `polyfill` since
    // it runs unmodified on those runtimes; `diffDeclared` tolerates both the
    // conservative `none` suggested here and the opt-in `polyfill`.)
    if (axis === 'framework-gjs') return { gjs: 'polyfill', node: 'none', browser: 'none' };

    // Design-identity (adwaita-*). Two shapes share the axis:
    //   - Asset / component packages (`adwaita-{web,fonts,icons,storybook}`):
    //     GJS already has Libadwaita native, browser gets our polyfill, Node
    //     n/a (no UI in headless Node). No cross-runtime test harness.
    //   - Headless behavior CONTRACT (`adwaita-core`, ADR 0004): pure TS with
    //     the standard `src/test.mts` cross-runtime harness — the design-axis
    //     twin of the pure-TS framework contracts (`stories`/`storybook-core`).
    //     It runs unmodified everywhere and is a runtime DEPENDENCY of the
    //     renderers (`adwaita-nativescript` re-exports its surface), so `none`
    //     slots would be dishonest — and actively harmful on NS, where `none`
    //     aliases the package to `@gjsify/empty` inside consumer bundles.
    //     Suggest the conservative GJS-first triplet and let `diffDeclared`'s
    //     pure-TS-contract tolerance accept the all-`polyfill` opt-in, exactly
    //     like the framework contracts.
    if (axis === 'design-identity') {
        if (!gjsBound && !signals.dynamic_gi && signals.has_test_entry) {
            return { gjs: 'polyfill', node: 'none', browser: 'none' };
        }
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
            if (signals.gjs_imports_guard && !signals.girs_value && !signals.gi_url && !signals.imports_legacy) {
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
        return { gjs: 'polyfill', node: nativeSlot, browser: browserSlot };
    }

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
        const browserSlot = gjsDynamicOnly ? (signals.has_globals_mjs ? 'native' : 'partial') : 'native';
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
        if (suggested.browser === 'polyfill' || suggested.browser === 'partial' || suggested.browser === 'native')
            return 'polyfill';
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
import { EXTERNALS_NODE } from '../packages/infra/resolve-npm/lib/index.mjs';

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
    const reExports = [...src.matchAll(/export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
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
    const hasStandardTest = existsSync(join(pkgDir, 'src', 'test.mts')) || existsSync(join(pkgDir, 'src', 'test.ts'));
    if (!hasStandardTest) return { ok: true };

    const candidates = [join(pkgDir, 'src', 'test.browser.mts'), join(pkgDir, 'src', 'test.browser.ts')];
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

// ─── Cross-runtime reachability audit (ADR 0014) ────────────────────────────
//
// The probes above validate a slot's MECHANICS (does `globals.mjs` exist and
// re-export something resolvable; is there a browser test entry). They say
// nothing about what the slot's code actually REACHES — which is where the
// latent class of bug this audit was extended for lives:
//
//   `@gjsify/os` declared `browser: "polyfill"` while `src/index.ts`
//   statically imported `@gjsify/utils`, a GJS-runtime package whose `cli` /
//   `getPathSeparator` helpers call `GLib.spawn_command_line_sync` /
//   `GLib.get_current_dir`. Nothing failed at build time: the browser target's
//   `gjsImportsEmptyPlugin` substitutes `{}` for `@girs/*`, so the leak only
//   surfaced as a `TypeError` the first time a consumer CALLED `os.cpus()`.
//
// The invariant enforced here: **a package declaring `polyfill` for a target
// must not, on that target, resolve to code that reaches GLib/Gio** — neither
// directly (`@girs/*` value import / `gi://` / bare `imports.*`) nor
// transitively through a `@gjsify/*` package declared `none` for that target.
//
// Why this is part of EVERY `--check` and not gated behind `--strict`: like
// the tier and platform audits it is declaration-driven and cheap (no build,
// no evaluation — a static import scan), it passes on the current tree, and a
// guard that only runs in a mode CI does not use is not a guard.
//
// Three checks:
//
//   1. `gjs-only-reach`   — the target-resolved source of a `polyfill` slot
//                           has a direct `@girs/*` / `gi://` / unguarded
//                           `imports.*` binding, or imports a `@gjsify/*`
//                           package that is BOTH declared `none` for the
//                           target AND itself hard-bound to GJS. FATAL on
//                           browser + nativescript (see below).
//                           The same finding on a `partial` slot is REPORTED,
//                           not fatal: `partial` explicitly promises only
//                           graceful degradation, and a structured failure
//                           inside a GJS-only code path IS that contract (see
//                           the `none` rationale in
//                           `resolve-npm/lib/runtime-aliases.mjs`).
//
//                           "Hard-bound" is load-bearing and excludes the
//                           sanctioned graceful-degradation shape: a bridge
//                           like `@gjsify/terminal-native` reaches GJS only
//                           through a guarded `globalThis.imports?.gi` probe
//                           and exports `null` off GJS. Importing it from a
//                           `polyfill` slot is correct, not a leak — the same
//                           distinction `scanSourceTree`'s
//                           `GJS_IMPORTS_GUARD_RE` / `DYNAMIC_GI_RE` already
//                           encode for the drift check.
//
//                           FATAL SCOPE — `browser` + `nativescript` only.
//                           This is not squeamishness, it is the failure mode:
//                           on those two targets `gjsImportsEmptyPlugin`
//                           substitutes `{}` for `@girs/*` AND `gi://*`, so a
//                           leak is SILENT until a consumer calls the helper
//                           and gets a `TypeError` — precisely the bug class
//                           this audit exists to kill. On `--app node` a
//                           `gi://` specifier is claimed FIRST by
//                           `gjsGiNodePlugin` and rewritten to `requireGi(…)`
//                           against the EXTERNAL `@gjsify/node-gi`, so the
//                           same leak either resolves through the supported
//                           Axis-5 reverse bridge or fails LOUDLY at module
//                           load. A loud load-time failure needs no static
//                           guard; a silent call-time one does. `node`
//                           findings are therefore printed on every run
//                           instead of being enforced.
//   2. `platform-entry-unreachable`
//                         — `src/<target>.ts` exists but the `exports` map has
//                           no `./<target>` subpath, so nothing can ever route
//                           to it. A dead platform variant reads as coverage
//                           that does not exist. FATAL.
//   3. `platform-entry-parity`
//                         — when a slot ROUTES to `src/<target>.ts`
//                           (`polyfill` + declared subpath, per ADR 0014), the
//                           platform entry must re-export every VALUE export
//                           of the root entry, or the routed bundle dies with
//                           MISSING_EXPORT. FATAL. Type-only exports are
//                           ignored: the `types` condition still points at the
//                           root `.d.ts`, so they are unaffected by routing.
//   4. `curated-alias-routing`
//                         — a curated bare-specifier alias in
//                           `ALIASES_NODE_FOR_BROWSER` may not resolve to the
//                           ROOT of a package that ships a `./browser` entry.
//                           `partial` is not rewritten by the derived layer, so
//                           such a value hands the bundler the GJS body and
//                           `partial` silently means "crashes at first use"
//                           instead of "degrades at call time". FATAL. Full
//                           rationale at `auditCuratedAliasRouting`.
//
// Unrouted-but-exported platform entries (today: the ten `partial` packages)
// are listed as an informational line on every run. Check 3 gates the
// `partial` → `polyfill` promotion, but it is NECESSARY, NOT SUFFICIENT: eight
// of those ten already pass it while remaining un-promotable because a named
// export is unavailable on the browser platform itself (each package's row in
// AGENTS.md names it). A green parity check is permission to look, not a
// mandate to promote — a routed entry must also have no unconditionally
// throwing value export.

/** Targets that can carry a per-runtime platform entry. `gjs` never can. */
const REACH_TARGETS = ['browser', 'nativescript', 'node'];

/**
 * Targets where a GJS leak is SILENT (`gjsImportsEmptyPlugin` → `{}`) and must
 * therefore be caught statically. `node` is excluded on purpose — see the
 * "FATAL SCOPE" note in this section's header.
 */
const REACH_FATAL_TARGETS = new Set(['browser', 'nativescript']);

/** Slots whose promise implies the target-resolved code must be GJS-free. */
const REACH_FATAL_SLOT = 'polyfill';

/**
 * Read the `gjsify` metadata this audit needs from every workspace package,
 * keyed by package name. Separate from `buildReport`'s rows because the
 * reachability audit must look up the slot of an IMPORTED package (and of an
 * imported SUBPATH), not just of the package being scanned.
 */
async function collectReachMeta() {
    const pkgDirs = await findPackages(PACKAGES_DIR);
    /** @type {Map<string, {name:string,pkgDir:string,rel:string,runtimes:object|null,
     *                      subpaths:object,exportKeys:Set<string>}>} */
    const byName = new Map();
    for (const pkgDir of pkgDirs) {
        let pkgJson;
        try {
            pkgJson = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
        } catch {
            continue;
        }
        if (typeof pkgJson.name !== 'string') continue;
        // `hardGjs` reuses the drift check's own signal vocabulary: a package
        // is hard-bound iff it takes a `@girs/*` VALUE import, a `gi://`
        // import, or an UNGUARDED `imports.*` read. A package whose only GJS
        // contact is the guarded `globalThis.imports?.gi` probe or a dynamic
        // `await import('gi://…')` is a graceful-degradation bridge — it
        // exports null/false off GJS and is safe to import from any slot.
        const sig = await scanSourceTree(pkgDir);
        const hardGjs =
            sig.girs_value || sig.gi_url || (sig.imports_legacy && !sig.gjs_imports_guard && !sig.dynamic_gi);
        byName.set(pkgJson.name, {
            name: pkgJson.name,
            pkgDir,
            rel: relative(PACKAGES_DIR, pkgDir),
            runtimes: pkgJson.gjsify?.runtimes ?? null,
            subpaths: pkgJson.gjsify?.runtimeSubpaths ?? {},
            // The headless audit needs the export TARGETS (not just the keys)
            // to find the source behind `exports["."]` and to follow a
            // workspace import into the subpath it actually resolves.
            headless: pkgJson.gjsify?.headless,
            exports: pkgJson.exports && typeof pkgJson.exports === 'object' ? pkgJson.exports : null,
            hardGjs,
            exportKeys: new Set(
                pkgJson.exports && typeof pkgJson.exports === 'object' ? Object.keys(pkgJson.exports) : [],
            ),
        });
    }
    return byName;
}

/**
 * Resolve the slot a specifier presents on `target`.
 *
 * A subpath import is resolved against the imported package's
 * `gjsify.runtimeSubpaths` map first — that is how a GJS-runtime package can
 * expose a genuinely cross-runtime slice (`@gjsify/utils/core`) without the
 * whole package having to claim a slot it cannot keep. An undeclared subpath
 * falls back to the package-level slot, which is the conservative reading.
 *
 * @returns {{slot:string|undefined, via:string}|null} `null` when the
 *          specifier is not a workspace `@gjsify/*` package (nothing to say).
 */
function slotOfSpecifier(spec, target, meta) {
    if (!spec.startsWith('@gjsify/')) return null;
    const parts = spec.split('/');
    const pkgName = `${parts[0]}/${parts[1]}`;
    const rec = meta.get(pkgName);
    if (!rec) return null;
    const subpath = parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.';
    if (subpath !== '.') {
        const declared = rec.subpaths?.[subpath];
        if (declared && typeof declared === 'object') {
            return { slot: declared[target], via: `${pkgName} subpath ${subpath}`, hardGjs: false };
        }
    }
    return { slot: rec.runtimes?.[target], via: pkgName, hardGjs: rec.hardGjs };
}

/** Source files that never ship in a target bundle. */
function isNonShippingSource(fileName) {
    return /\.spec\.(ts|mts)$/.test(fileName) || /^test(\..*)?\.(ts|mts)$/.test(fileName) || fileName.endsWith('.d.ts');
}

/** Every `.ts`/`.mts` file under `dir`, recursively (skips node_modules). */
async function listSourceFiles(dir, out = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const ent of entries) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules') continue;
            await listSourceFiles(full, out);
            continue;
        }
        if (!ent.isFile() || !/\.(ts|mts)$/.test(ent.name)) continue;
        if (isNonShippingSource(ent.name)) continue;
        out.push(full);
    }
    return out;
}

/** Resolve a relative ESM specifier (`./x.js`) to an on-disk TS source. */
function resolveLocalSource(fromFile, spec) {
    const base = resolve(fromFile, '..', spec).replace(/\.(js|mjs)$/, '');
    for (const cand of [`${base}.ts`, `${base}.mts`, join(base, 'index.ts'), join(base, 'index.mts')]) {
        if (existsSync(cand)) return cand;
    }
    return null;
}

const REACH_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g;
const REACH_SIDE_EFFECT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
/** `import type … from` / `export type { … } from` erase at compile time. */
const REACH_TYPE_ONLY_RE = /(?:^|\n)\s*(?:import|export)\s+type\s/;

/**
 * Walk the module graph rooted at `entryFiles`, following RELATIVE imports
 * inside the package only, and collect every bare specifier reached plus any
 * direct GJS binding.
 */
async function walkEntryGraph(entryFiles) {
    const seen = new Set();
    /** @type {Array<{spec:string, file:string}>} */
    const bare = [];
    /** @type {Array<{kind:string, file:string}>} */
    const direct = [];
    const queue = [...entryFiles];
    while (queue.length) {
        const file = queue.shift();
        if (!file || seen.has(file)) continue;
        seen.add(file);
        let text;
        try {
            text = await readFile(file, 'utf8');
        } catch {
            continue;
        }
        if (GIRS_VALUE_RE.test(text)) direct.push({ kind: '@girs/* value import', file });
        if (GI_URL_RE.test(text)) direct.push({ kind: 'gi:// import', file });
        if (IMPORTS_LEGACY_RE.test(text) && !GJS_IMPORTS_GUARD_RE.test(text)) {
            direct.push({ kind: 'unguarded `imports.*` read', file });
        }
        for (const re of [REACH_IMPORT_RE, REACH_SIDE_EFFECT_RE]) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                const spec = m[1];
                if (spec.startsWith('.')) {
                    const local = resolveLocalSource(file, spec);
                    if (local) queue.push(local);
                    continue;
                }
                // Skip pure type imports — they erase before the bundler runs.
                if (re === REACH_IMPORT_RE && REACH_TYPE_ONLY_RE.test(m[0])) continue;
                bare.push({ spec, file });
            }
        }
    }
    return { bare, direct, files: seen };
}

/** Extract VALUE export names from a TS entry, following local `export *`. */
async function collectValueExports(file, seen = new Set()) {
    const out = new Set();
    if (!file || seen.has(file) || !existsSync(file)) return out;
    seen.add(file);
    let text;
    try {
        text = await readFile(file, 'utf8');
    } catch {
        return out;
    }
    // `export const|function|class|enum X` — `type`/`interface` deliberately excluded.
    for (const m of text.matchAll(
        /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|abstract\s+class|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
        out.add(m[1]);
    }
    // `export { a, b as c }` (optionally `from '…'`) — drop `type` members.
    // Comments must be stripped BEFORE splitting on `,`: a multi-line export
    // block that groups its members under `// Sync API`-style headings would
    // otherwise yield the heading glued to the next name as a phantom export
    // (`@gjsify/fs` alone produced five). That only surfaces once a slot is
    // flipped to `polyfill` — i.e. exactly when someone reads the list.
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"]\s*)?;?/gm)) {
        const members = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        for (const raw of members.split(',')) {
            const t = raw.trim();
            if (!t || /^type\s/.test(t)) continue;
            const parts = t.split(/\s+as\s+/);
            out.add((parts[1] ?? parts[0]).trim().replace(/^['"]|['"]$/g, ''));
        }
    }
    if (/^export\s+default\s/m.test(text)) out.add('default');
    for (const m of text.matchAll(/^export\s*\*\s*from\s*['"](\.[^'"]+)['"]/gm)) {
        const local = resolveLocalSource(file, m[1]);
        for (const e of await collectValueExports(local, seen)) out.add(e);
    }
    return out;
}

/**
 * Run the reachability audit across the workspace.
 *
 * @param {Awaited<ReturnType<typeof collectReachMeta>>} meta — collected ONCE
 *        by the caller and shared with the headless audit; `collectReachMeta`
 *        runs `scanSourceTree` over every package, which is the bulk of what
 *        `--check` costs, and it is the same answer for both.
 * @returns {Promise<{failures:string[], warnings:string[], unrouted:string[],
 *                    aliasFailures:string[], checked:number}>}
 */
async function auditReachability(meta) {
    const aliasFailures = await auditCuratedAliasRouting(meta);
    const failures = [];
    const warnings = [];
    const unrouted = [];
    let checked = 0;

    for (const rec of [...meta.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
        const srcDir = join(rec.pkgDir, 'src');
        if (!rec.runtimes || !existsSync(srcDir)) continue;

        for (const target of REACH_TARGETS) {
            const slot = rec.runtimes[target];
            if (slot !== 'polyfill' && slot !== 'partial') continue;

            const entryFile = join(srcDir, `${target}.ts`);
            const hasEntryFile = existsSync(entryFile);
            const hasEntryExport = rec.exportKeys.has(`./${target}`);

            // Check 2 — a platform entry nothing can route to.
            if (hasEntryFile && !hasEntryExport) {
                failures.push(
                    `${rec.name}: src/${target}.ts exists but package.json#exports declares no "./${target}" subpath — ` +
                        `nothing can route to it (platform-entry-unreachable). Add the subpath or delete the file.`,
                );
            }

            // ADR 0014 routing: `polyfill` + declared subpath → the platform
            // entry IS what the target resolves.
            const routes = slot === REACH_FATAL_SLOT && hasEntryExport && hasEntryFile;

            if (hasEntryFile && hasEntryExport && !routes) {
                unrouted.push(`${rec.name} (${target}, slot=${slot})`);
            }

            // Check 3 — parity, only where routing is live.
            if (routes) {
                const rootExports = await collectValueExports(join(srcDir, 'index.ts'));
                const entryExports = await collectValueExports(entryFile);
                const missingExports = [...rootExports].filter((e) => !entryExports.has(e)).sort();
                if (missingExports.length > 0) {
                    failures.push(
                        `${rec.name}: runtimes.${target}="${slot}" routes to src/${target}.ts (ADR 0014) but that entry is ` +
                            `missing ${missingExports.length} value export(s) present on the root entry ` +
                            `(platform-entry-parity): ${missingExports.slice(0, 12).join(', ')}` +
                            `${missingExports.length > 12 ? ` … (+${missingExports.length - 12})` : ''}.`,
                    );
                }
            }

            // Check 1 — what does the target-resolved code actually reach?
            const entryFiles = routes ? [entryFile] : await listSourceFiles(srcDir);
            // A non-routing package must not be judged on OTHER targets' entries.
            const scanFiles = routes
                ? entryFiles
                : entryFiles.filter((f) => !REACH_TARGETS.some((t) => t !== target && f === join(srcDir, `${t}.ts`)));
            const { bare, direct } = await walkEntryGraph(scanFiles);
            checked++;

            const problems = [];
            for (const d of direct) {
                problems.push(`${d.kind} in ${relative(rec.pkgDir, d.file)}`);
            }
            const reported = new Set();
            for (const b of bare) {
                const res = slotOfSpecifier(b.spec, target, meta);
                if (!res || res.slot !== 'none') continue;
                // A `none` slot alone is not a leak: `none` also covers the
                // graceful-degradation bridges that export null off GJS. Only
                // a HARD GJS binding actually reaches GLib/Gio.
                if (!res.hardGjs) continue;
                const key = `${b.spec}|${b.file}`;
                if (reported.has(key)) continue;
                reported.add(key);
                problems.push(
                    `imports '${b.spec}' (${res.via} declares ${target}:"none" and is hard-bound to GJS) from ${relative(rec.pkgDir, b.file)}`,
                );
            }
            if (problems.length === 0) continue;

            const where = routes ? `src/${target}.ts` : 'src/**';
            const enforced = slot === REACH_FATAL_SLOT && REACH_FATAL_TARGETS.has(target);
            const why = !REACH_FATAL_TARGETS.has(target)
                ? `target="${target}" → reported: a GJS leak fails LOUDLY at module load here (gjs:// routes to the external @gjsify/node-gi), it is not silently swallowed`
                : 'slot="partial" → reported, not enforced';
            const line =
                `${rec.name}: runtimes.${target}="${slot}" but the ${target}-resolved code (${where}) reaches GJS-only code — ` +
                problems.join('; ');
            if (enforced) failures.push(`${line} (gjs-only-reach)`);
            else warnings.push(`${line} (gjs-only-reach, ${why})`);
        }
    }
    return { failures, warnings, unrouted, aliasFailures, checked };
}

// ─── Curated-alias routing (the `partial`-slot crash gap) ───────────────────
//
// `withDerivedSlotRouting` only rewrites a curated alias VALUE when the target
// package's slot is `polyfill` (ADR 0014). A `partial` package therefore keeps
// whatever the curated table names — and if that is the package ROOT, the
// bundler is handed the GJS body, whose `@girs/*` imports `gjsImportsEmptyPlugin`
// replaces with `{}`. The result is the silent `GLib.Checksum is not a
// constructor` failure mode, i.e. `partial` means "crashes at first use" rather
// than "degrades at call time". That is not a weaker promise, it is a false one.
//
// Invariant: no curated bare-specifier alias may resolve to the ROOT of a
// package that ships a `./<target>` platform entry. Either the slot is
// `polyfill` (and the derived layer rewrites it for you) or the curated value
// names the subpath explicitly. FATAL — this is a shipping-bug class, not a
// style preference.
//
// `browser` only today: it is the one target whose curated table is composed
// through `withDerivedSlotRouting` (see the `ALIASES_NODE_FOR_NATIVESCRIPT`
// note in resolve-npm — composing the NS table is blocked on the `native`-slot
// vocabulary decision, so auditing it here would report a gap whose fix is not
// available yet).

/**
 * @returns {Promise<string[]>} one failure line per offending alias entry.
 */
async function auditCuratedAliasRouting(meta) {
    /** @type {Record<string,string>} */
    let table;
    try {
        ({ ALIASES_NODE_FOR_BROWSER: table } = await import('../packages/infra/resolve-npm/lib/index.mjs'));
    } catch (err) {
        return [
            `curated-alias-routing: could not load @gjsify/resolve-npm's browser alias table (${err?.message ?? err}).`,
        ];
    }
    const failures = [];
    for (const [bare, value] of Object.entries(table)) {
        if (typeof value !== 'string' || !value.startsWith('@gjsify/')) continue;
        // Already a subpath (`@gjsify/path/posix`, `@gjsify/os/browser`, …) —
        // the curated value has made its routing explicit, nothing to check.
        if (value.split('/').length > 2) continue;
        const rec = meta.get(value);
        if (!rec || !rec.exportKeys.has('./browser')) continue;
        failures.push(
            `'${bare}' → ${value}: ${value} declares runtimes.browser="${rec.runtimes?.browser ?? 'undeclared'}" and ships a "./browser" ` +
                `platform entry, but the curated alias names the package ROOT — a --app browser bundle gets the GJS body with ` +
                `@girs/* emptied to {} (curated-alias-routing). Point the value at '${value}/browser', or promote the slot to ` +
                `"polyfill" so ADR-0014 routing does it.`,
        );
    }
    return failures;
}

/**
 * Print the two informational sections of the reachability audit: `partial`
 * slots that reach GJS-only code (reported, never fatal) and platform entries
 * that exist + are exported but that no slot routes to. Both are deliberately
 * non-fatal, and both must stay VISIBLE on every run — a dead platform variant
 * that nobody prints is exactly how `src/browser.ts` sat unrouted for a whole
 * release cycle while reading as browser coverage.
 */
function renderReachabilityNotes(reach) {
    if (reach.warnings.length > 0) {
        console.error(
            `\nreachability notes — ${reach.warnings.length} \`partial\` slot(s) reach GJS-only code (reported, not enforced):`,
        );
        for (const line of reach.warnings) console.error(`  · ${line}`);
    }
    if (reach.unrouted.length > 0) {
        console.error(
            `\nreachability notes — ${reach.unrouted.length} exported platform entr(y|ies) that no slot routes to.`,
        );
        console.error(
            '  These are the promotion path from `partial` to `polyfill`: reach export parity with the root entry, flip the slot to `polyfill`, and ADR-0014 routing picks the entry up automatically (the `platform-entry-parity` check gates it).',
        );
        for (const line of reach.unrouted) console.error(`  · ${line}`);
    }
}

// ─── Headless-contract audit (intra-GJS layering, ADR 0015) ─────────────────
//
// Everything above models CROSS-RUNTIME portability: which of gjs × node ×
// browser × nativescript a package reaches, and whether the code a slot
// resolves to can keep that promise. None of it says anything about layering
// WITHIN the GJS runtime — headless vs toolkit-bound — and that is a real,
// documented contract that had no machine check at all:
//
//   `@gjsify/canvas2d-core` documents itself as "**Headless** … NO GTK
//   dependency in the ROOT entry", which is the entire reason it was split out
//   of `@gjsify/canvas2d` (breaking the dom-elements↔canvas2d cycle). It
//   nevertheless imported `gi://Gdk` from five call sites, and in GTK4 GDK
//   lives inside `libgtk-4.so` — so the "headless" core dlopened the whole GTK
//   stack on import.
//
// The existing audits structurally COULD NOT catch that:
//
//   · The drift check feeds `gi_url` into `suggestRuntimes()` as an INPUT, so
//     the Gdk import made the declaration agree BETTER, not worse. It produced
//     agreement, not drift.
//   · The ADR-0014 reachability pass is gated on `slot === 'polyfill' ||
//     slot === 'partial'` over `REACH_TARGETS`. canvas2d-core's non-GJS slots
//     are node:"none" / browser:"native" / nativescript:"none", so every slot
//     was skipped and `src/**` was never examined.
//
// So the contract lived only in prose, and prose does not fail a build.
//
// ── The declaration ──
//
// `package.json#gjsify.headless` — an EXPLICIT declaration, never a heuristic.
// A name heuristic (`*-core`) is guessable but wrong by construction:
// `@gjsify/adwaita-core` and `@gjsify/storybook-core` are headless for entirely
// different reasons, `@gjsify/webrtc-native` is a `-native` package that is the
// most toolkit-bound thing in the tree, and a future `-core` may be headless in
// neither sense. A declaration is honest (the package states its own promise),
// greppable, and reviewable in the diff that introduces it.
//
// Two spellings, because there are two genuinely different promises:
//
//   "headless": true                       — the CLOSED promise: the root entry
//                                            reaches NO typelib at all (no
//                                            `gi://`, no `@girs/*` value
//                                            import, no bare `cairo`/`system`/
//                                            `gettext`, no legacy `imports.*`).
//                                            This is `@gjsify/adwaita-core`'s
//                                            "pure TS, NO platform imports".
//   "headless": ["Gdk", "Gtk"]             — the SCOPED promise: the root entry
//                                            reaches none of the LISTED
//                                            typelibs; others are fine. This is
//                                            `@gjsify/canvas2d-core`, which is
//                                            headless of GTK while legitimately
//                                            binding Cairo + PangoCairo.
//
// A boolean-only field would force canvas2d-core — the package the invariant
// exists for — to either lie or opt out. A list-only field would force
// adwaita-core to enumerate an open-world set ("every typelib that exists"),
// which is unmaintainable and silently under-specifies. The field therefore
// carries the SHAPE of the promise, and the check reads it literally.
//
// ── What is checked ──
//
// For each declaring package, the ROOT import graph — starting at the source
// behind `exports["."]`, following relative imports inside the package AND
// crossing into the root/subpath entry of every `@gjsify/*` workspace import —
// must not reach a forbidden typelib.
//
// ROOT-ENTRY-ONLY IS THE POINT, and it is the subtlety that made the original
// bug invisible in the first place. A side-effect SUBPATH may legitimately
// reach the forbidden typelibs: the fix for canvas2d-core was to move the GDK
// code behind `@gjsify/canvas2d-core/gdk`, which `@gjsify/dom-elements/register
// /canvas` and `@gjsify/canvas2d` import EXPLICITLY. Scanning `src/**` (what
// the reachability pass does for a non-routing slot) would flag that subpath
// and make the fixed tree red; scanning only what the root entry pulls in is
// exactly the promise the prose makes.
//
// Failure to RESOLVE the root entry is itself a failure — a check that silently
// passes when it cannot find what it is supposed to inspect is decorative.

/** GJS bare built-in specifiers that are typelib-backed bindings, not npm packages. */
const GJS_BARE_BINDINGS = new Set(['cairo', 'system', 'gettext']);

/** Compare namespaces case-insensitively: `@girs/gdkpixbuf-2.0` ≡ `GdkPixbuf`. */
function normalizeTypelib(ns) {
    return String(ns).trim().toLowerCase();
}

/**
 * The typelib namespace a bare specifier binds, or `null` when the specifier
 * is not a GI binding at all.
 *
 * `@girs/*` is the TYPE package for a namespace, but a VALUE import of it
 * resolves to a body that re-exports the `gi://` default — so it binds the
 * typelib just as directly. (The caller filters `import type` first.)
 */
function typelibOfSpecifier(spec) {
    let m = /^gi:\/\/([^?/]+)/.exec(spec);
    if (m) return { ns: m[1], form: `gi://${m[1]}` };
    // `@girs/gdk-4.0`, `@girs/gjs`, and any future `@girs/<ns>-<ver>/<subpath>`
    // — the namespace is what binds, the subpath does not change that.
    m = /^@girs\/([A-Za-z0-9_]+)(?:-[\d.]+)?(?:\/|$)/.exec(spec);
    if (m) return { ns: m[1], form: spec };
    if (GJS_BARE_BINDINGS.has(spec)) return { ns: spec, form: `bare '${spec}'` };
    return null;
}

/** The `default` (or single-string) target an `exports` subpath resolves to. */
function exportTarget(exportsObj, subpath) {
    const entry = exportsObj?.[subpath];
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') return entry.default ?? entry.import ?? entry.node ?? null;
    return null;
}

/** Map a package-relative BUILT path (`./lib/esm/x.js`) back to its TS source. */
function sourceForBuiltPath(pkgDir, rel) {
    if (typeof rel !== 'string') return null;
    const stripped = rel
        .replace(/^\.\//, '')
        .replace(/^(?:lib\/esm|lib\/types|lib|dist)\//, '')
        .replace(/\.d\.ts$/, '')
        .replace(/\.(js|mjs)$/, '');
    for (const cand of [`${stripped}.ts`, `${stripped}.mts`, join(stripped, 'index.ts')]) {
        const abs = join(pkgDir, 'src', cand);
        if (existsSync(abs)) return abs;
    }
    return null;
}

/** The source file behind a package's `exports["."]` (the ROOT entry). */
function rootEntrySource(rec) {
    const declared = exportTarget(rec.exports, '.');
    const fromExports = declared ? sourceForBuiltPath(rec.pkgDir, declared) : null;
    if (fromExports) return fromExports;
    const fallback = join(rec.pkgDir, 'src', 'index.ts');
    return existsSync(fallback) ? fallback : null;
}

/** The source a `@gjsify/<pkg>[/<subpath>]` specifier resolves to, or `null`. */
function workspaceEntrySource(spec, meta) {
    const parts = spec.split('/');
    const rec = meta.get(`${parts[0]}/${parts[1]}`);
    if (!rec) return null;
    if (parts.length === 2) return rootEntrySource(rec);
    const rest = parts.slice(2).join('/');
    const declared = exportTarget(rec.exports, `./${rest}`);
    const fromExports = declared ? sourceForBuiltPath(rec.pkgDir, declared) : null;
    if (fromExports) return fromExports;
    // Undeclared subpath (or one whose target is not a TS-backed file): fall
    // back to the conventional source layout rather than losing the edge.
    return sourceForBuiltPath(rec.pkgDir, rest);
}

/**
 * Walk the ROOT import graph and collect every GI binding it reaches.
 *
 * Follows relative imports within a package and crosses `@gjsify/*` workspace
 * edges into the entry the specifier actually resolves to — a headless root
 * that reaches GTK through a sibling package is no less GTK-bound than one that
 * imports `gi://Gtk` itself.
 *
 * Two deliberate limits, both shared with the ADR-0014 reachability walk: only
 * STATIC ESM imports are followed (a `await import('gi://Gtk')` behind a
 * runtime branch is the sanctioned graceful-degradation shape, not a leak), and
 * a `@gjsify/*` edge whose entry has no TS source behind it (`@gjsify/empty`,
 * a `.mjs`-only subpath) is dropped rather than guessed at.
 */
async function walkHeadlessGraph(entryFile, meta) {
    const seen = new Set([entryFile]);
    /** child file → the file that imported it, for rendering the reach path. */
    const parents = new Map();
    const hits = [];
    const queue = [entryFile];
    while (queue.length) {
        const file = queue.shift();
        let text;
        try {
            text = await readFile(file, 'utf8');
        } catch {
            continue;
        }
        if (IMPORTS_LEGACY_RE.test(text) && !GJS_IMPORTS_GUARD_RE.test(text)) {
            hits.push({ ns: 'imports', form: 'legacy `imports.*` read', file });
        }
        for (const re of [REACH_IMPORT_RE, REACH_SIDE_EFFECT_RE]) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                // `import type` / `export type … from` erase before the bundler runs.
                if (re === REACH_IMPORT_RE && REACH_TYPE_ONLY_RE.test(m[0])) continue;
                const spec = m[1];
                const next = spec.startsWith('.')
                    ? resolveLocalSource(file, spec)
                    : spec.startsWith('@gjsify/')
                      ? workspaceEntrySource(spec, meta)
                      : null;
                if (next) {
                    if (seen.has(next)) continue;
                    seen.add(next);
                    parents.set(next, file);
                    queue.push(next);
                    continue;
                }
                if (spec.startsWith('.')) continue;
                const binding = typelibOfSpecifier(spec);
                if (binding) hits.push({ ...binding, file });
            }
        }
    }
    return { hits, parents };
}

/**
 * `src/index.ts → src/context/text-rendering.ts` — how the root reaches `file`.
 *
 * Files inside the declaring package render package-relative; a file the graph
 * reached across a workspace edge renders repo-relative, so a cross-package
 * leak reads as one at a glance instead of as a `../../` puzzle.
 */
function renderReachPath(entryFile, file, parents, pkgDir) {
    const chain = [file];
    let cur = file;
    while (parents.has(cur) && chain.length < 12) {
        cur = parents.get(cur);
        chain.push(cur);
    }
    if (chain[chain.length - 1] !== entryFile) chain.push(entryFile);
    return chain
        .reverse()
        .map((f) => (f.startsWith(`${pkgDir}/`) ? relative(pkgDir, f) : relative(ROOT, f)))
        .join(' → ');
}

/**
 * Run the headless-contract audit across the workspace.
 *
 * `checked` counts declarations whose root entry actually got walked; a
 * declaration that did not (bad shape, unresolvable entry) is a failure, so on
 * the OK path `checked` IS the number of declaring packages.
 *
 * @param {Awaited<ReturnType<typeof collectReachMeta>>} meta — shared with the
 *        reachability audit (see its note); the headless walk also needs it to
 *        follow a `@gjsify/*` import into the entry that specifier resolves to.
 * @returns {Promise<{failures:string[], checked:number}>}
 */
async function auditHeadless(meta) {
    const failures = [];
    let checked = 0;

    for (const rec of [...meta.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
        if (rec.headless === undefined) continue;

        // Declaration shape. An unreadable declaration must fail loudly rather
        // than degrade to "nothing forbidden", which would pass on anything.
        /** @type {Set<string>|null} `null` = the closed promise (no typelib at all). */
        let forbidden;
        if (rec.headless === true) {
            forbidden = null;
        } else if (
            Array.isArray(rec.headless) &&
            rec.headless.length > 0 &&
            rec.headless.every((n) => typeof n === 'string' && n.trim().length > 0)
        ) {
            forbidden = new Set(rec.headless.map(normalizeTypelib));
        } else {
            failures.push(
                `${rec.name}: invalid \`gjsify.headless\` — expected \`true\` (the root entry reaches NO typelib) or a ` +
                    `non-empty array of typelib namespaces it promises not to reach (e.g. ["Gdk","Gtk"]). ` +
                    `Got ${JSON.stringify(rec.headless)} (headless-declaration-invalid).`,
            );
            continue;
        }

        const entryFile = rootEntrySource(rec);
        if (!entryFile) {
            failures.push(
                `${rec.name}: declares \`gjsify.headless\` but its root entry source could not be resolved from ` +
                    `package.json#exports["."] (${JSON.stringify(exportTarget(rec.exports, '.'))}) and no src/index.ts exists — ` +
                    `nothing to check, so the promise is unverifiable (headless-entry-unresolvable).`,
            );
            continue;
        }
        checked++;

        const { hits, parents } = await walkHeadlessGraph(entryFile, meta);
        const reported = new Set();
        for (const hit of hits) {
            if (forbidden !== null && !forbidden.has(normalizeTypelib(hit.ns))) continue;
            const key = `${hit.form}|${hit.file}`;
            if (reported.has(key)) continue;
            reported.add(key);
            const promise =
                forbidden === null
                    ? 'gjsify.headless=true (the root entry must reach NO typelib)'
                    : `gjsify.headless=[${rec.headless.join(', ')}]`;
            failures.push(
                `${rec.name}: ${promise} but the ROOT entry graph reaches ${hit.form} — ` +
                    `via ${renderReachPath(entryFile, hit.file, parents, rec.pkgDir)} ` +
                    `(headless-contract-violated).`,
            );
        }
    }
    return { failures, checked };
}

// ─── Tier audit (ADR 0003 + ADR 0005) ───────────────────────────────────────
//
// Independent from the runtimes-triplet checks above: the tier contract
// covers EVERY published workspace package (showcases included, not just
// `packages/**`), and its rules are declaration-driven (`gjsify.tier`), not
// signal-driven. Three checks, all hard failures under `--check`:
//
//   1. tier-missing   : a published package lacks `gjsify.tier` ∈ {1,2,3}.
//   2. tier-direction : a dep edge A→B (deps/optionalDeps, both @gjsify
//                       workspace packages) where tier(B) > tier(A) — a
//                       stability-promised package must not inherit a less
//                       stable package's breakage (ADR 0003 rule 1).
//                       devDependencies and (optional) peerDependencies are
//                       exempt by design — they encode exactly this looseness.
//   3. node-gi-isolation: ADR 0005 names `@gjsify/node-gi` explicitly — no
//                       Tier-1/2 package may take a hard dependency on it.
//                       (Subsumed by 2 while node-gi is Tier 3, but asserted
//                       by name so the invariant survives a tier edit.)

const VALID_TIERS = new Set([1, 2, 3]);
/** Workspace roots that may contain published packages (root package.json
 * `workspaces` globs). templates/examples/tests are all-private today, but
 * walking them is cheap and catches a future accidentally-published one. */
const TIER_AUDIT_ROOTS = ['packages', 'showcases', 'templates', 'examples', 'tests', 'website'];

/** Collect every PUBLISHED workspace package with its tier + @gjsify/* edges. */
async function collectPublishedPackages() {
    const dirs = [];
    for (const root of TIER_AUDIT_ROOTS) {
        const abs = resolve(ROOT, root);
        if (existsSync(abs)) await findPackages(abs, dirs);
    }
    const published = new Map();
    for (const dir of dirs) {
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
        if (pkg.private || !pkg.name) continue;
        const edges = [];
        for (const field of ['dependencies', 'optionalDependencies']) {
            for (const dep of Object.keys(pkg[field] ?? {})) {
                if (dep.startsWith('@gjsify/')) edges.push({ dep, field });
            }
        }
        published.set(pkg.name, { path: relative(ROOT, dir), tier: pkg.gjsify?.tier, edges });
    }
    return published;
}

/** Run the three tier checks; returns human-readable failure lines (empty = ok). */
function auditTiers(published) {
    const failures = [];
    for (const [name, info] of published) {
        if (!VALID_TIERS.has(info.tier)) {
            failures.push(
                `${name} (${info.path}): missing or invalid \`gjsify.tier\` — every published package must declare a tier ∈ {1,2,3} (ADR 0003).`,
            );
        }
    }
    for (const [name, info] of published) {
        if (!VALID_TIERS.has(info.tier)) continue; // already reported above
        for (const { dep, field } of info.edges) {
            const target = published.get(dep);
            // Not a published workspace package (private example or external
            // @gjsify/* pkg) — out of tier-contract scope. A published package
            // depending on a private one is a publish-tooling failure, not a
            // tier failure.
            if (!target || !VALID_TIERS.has(target.tier)) continue;
            if (dep === '@gjsify/node-gi' && info.tier < 3) {
                failures.push(
                    `${name} (Tier ${info.tier}) → @gjsify/node-gi via ${field}: forbidden by ADR 0005 — node-gi is experimental (Tier 3) and dependency-isolated; the sanctioned seams are a devDependency (\`--runtime node\` dev flows) and the conditional \`--app node\` build injection.`,
                );
                continue;
            }
            if (target.tier > info.tier) {
                failures.push(
                    `dependency-direction violation: ${name} (Tier ${info.tier}) → ${dep} (Tier ${target.tier}) via ${field} — a package must not hard-depend on a higher (less stable) tier (ADR 0003 rule 1; optional peers / devDeps are the sanctioned seams).`,
                );
            }
        }
    }
    return failures;
}

// ─── Platform audit (native prebuilds) ──────────────────────────────────────

// `gjsify.runtimes` declares the RUNTIME reach of a package (gjs × node ×
// browser × nativescript). It says nothing about OPERATING SYSTEMS — so a
// package could declare `gjs: "polyfill"` and still have no loadable artifact
// on macOS or Windows, because the native bridge it needs only ever built on
// Linux. That blind spot is exactly how the whole native-bridge set stayed
// Linux-only while the project described itself as platform-independent.
//
// `package.json#gjsify.platforms` closes it: the list of `<os>-<arch>` targets
// a native package PROMISES a prebuild for. It is the OS-axis sibling of
// `gjsify.runtimes`, and the checks below keep the promise, the committed
// artifacts and the CI that produces them from drifting apart.

// There is exactly ONE spelling for a target: `${process.platform}-${process.arch}`.
// A declaration in the old uname style (`linux-x86_64`, `linux-aarch64`) is
// REJECTED here rather than silently canonicalised, so the invariant fails on
// the package.json that is wrong instead of hours later as a "typelib not
// found" at some consumer's runtime.
const PLATFORM_RE = /^(linux|darwin|win32)-(x64|arm64|ppc64|s390x|riscv64)$/;

/**
 * Legacy uname-style arch spellings folded onto the node one. Kept ONLY so a
 * workflow that still says `arch: x86_64` and a pre-rename tarball's shipped
 * directory both compare equal to the canonical declaration. Mirrors
 * `ARCH_ALIASES` in `packages/infra/cli/src/utils/detect-native-packages.ts`;
 * a divergence would let a package pass the audit while the CLI misses its dir.
 */
const ARCH_ALIASES = { x86_64: 'x64', amd64: 'x64', aarch64: 'arm64' };

/**
 * Every token `parseCiPlatforms` accepts as naming a CPU — the canonical
 * `process.arch` spellings plus the legacy aliases above.
 */
const KNOWN_ARCH_TOKENS = new Set(['x64', 'arm64', 'ppc64', 's390x', 'riscv64', ...Object.keys(ARCH_ALIASES)]);

/** Canonical (node-spelling) form so `linux-x86_64` and `linux-x64` compare equal. */
function canonicalPlatform(token) {
    const [os, arch] = String(token).split('-');
    return `${os}-${ARCH_ALIASES[arch] ?? arch}`;
}

/** Default arch a bare runner label implies, keyed by the OS it maps to. */
const RUNNER_DEFAULT_ARCH = { linux: 'x64', darwin: 'arm64', win32: 'x64' };

function osFromRunner(runsOn) {
    if (/macos/i.test(runsOn)) return 'darwin';
    if (/windows/i.test(runsOn)) return 'win32';
    return 'linux';
}

/**
 * Every package that carries a native build system or ships a prebuild
 * directory. These are the packages whose reach is bounded by what CI builds
 * — the ones `gjsify.platforms` applies to.
 */
async function collectNativePackages() {
    const dirs = await findPackages(PACKAGES_DIR);
    const out = [];
    for (const dir of dirs) {
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
        const hasMeson = existsSync(join(dir, 'meson.build'));
        const hasGyp = existsSync(join(dir, 'binding.gyp'));
        const prebuildField = pkg.gjsify?.prebuilds;
        if (!hasMeson && !hasGyp && typeof prebuildField !== 'string') continue;
        const prebuildDir = join(dir, typeof prebuildField === 'string' ? prebuildField : 'prebuilds');
        let shipped = [];
        if (existsSync(prebuildDir)) {
            shipped = (await readdir(prebuildDir, { withFileTypes: true }))
                .filter((e) => e.isDirectory())
                .map((e) => e.name)
                .sort();
        }
        const declared = Array.isArray(pkg.gjsify?.platforms) ? [...pkg.gjsify.platforms].sort() : null;
        out.push({
            name: pkg.name,
            path: relative(ROOT, dir),
            tier: pkg.gjsify?.tier,
            builder: hasGyp ? 'node-gyp' : 'meson',
            declared,
            shipped,
            // `gjsify.prebuilds` is what makes a package's artifacts THIS
            // repo's responsibility: it names the committed directory. A
            // native package without it (today `@gjsify/node-gi`, node-gyp)
            // builds its binary at install time or ships it straight from a
            // release artifact, so there is nothing here to hold to a
            // per-target existence contract.
            prebuildsField: typeof prebuildField === 'string' ? prebuildField : null,
            prebuildDir,
            // The escape hatch — see `auditPrebuildArtifacts`. Raw on purpose:
            // its own shape is validated there, so a malformed value produces
            // a named failure rather than a crash here.
            uncommitted: pkg.gjsify?.platformsUncommitted ?? null,
        });
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return out;
}

/** Group a job's lines into step blocks (a step starts at `- name:`/`- uses:`/`- run:`). */
function splitSteps(lines) {
    const steps = [];
    let current = [];
    for (const line of lines) {
        if (/^\s*-\s+(name|uses|run):/.test(line) && current.length > 0) {
            steps.push(current.join('\n'));
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) steps.push(current.join('\n'));
    return steps;
}

/**
 * Which `<os>-<arch>` targets CI actually produces, per package name.
 *
 * Deliberately a lightweight structural read of the workflow files rather
 * than a full YAML parse: split `jobs:` into its 2-space-indented job blocks,
 * take each job's `runs-on` (→ OS) and any `arch:` matrix entries (→ arch),
 * and attribute those targets to the packages that job actually PRODUCES an
 * artifact for.
 *
 * "Produces" is deliberately narrow — a package name has to appear on a line
 * that also carries a production verb (build / collect / stage / prebuild /
 * upload). A bare mention does not count, because the workflows are full of
 * explanatory comments naming packages they merely depend on ("…whose
 * `gjsify build` needs `@gjsify/rolldown-native`"), and crediting those would
 * manufacture platform support that does not exist. Comment lines are dropped
 * outright for the same reason.
 *
 * Jobs gated on `github.event_name == 'workflow_dispatch'` are EXCLUDED: a
 * manually-dispatched exploratory job (today: napi's blocked Windows attempt)
 * is not a platform CI produces, and counting it would let a package declare
 * a target no user will ever receive.
 *
 * The result is ADVISORY — a package the parser finds no job for is reported
 * as unverified rather than failed, so a build wired up in a workflow shape
 * this parser does not understand can never produce a false CI failure.
 */
async function parseCiPlatforms(
    nativePkgs,
    workflowFiles = ['prebuilds.yml', 'napi.yml', 'node-gi.yml', 'release.yml'],
) {
    const byPackage = new Map();
    // A step identifies its package either by npm name or by the workspace
    // path it builds in (`working-directory: packages/node-gi/node-gi`) — the
    // macOS/arm64 jobs use the latter exclusively, so name-only matching would
    // silently under-report their coverage.
    const identifiers = nativePkgs.map((p) => ({ name: p.name, name_re: p.name, path_re: p.path }));
    for (const file of workflowFiles) {
        const abs = resolve(ROOT, '.github', 'workflows', file);
        if (!existsSync(abs)) continue;
        const text = await readFile(abs, 'utf8');
        const lines = text.split('\n');
        let current = null;
        const jobs = [];
        let inJobs = false;
        for (const line of lines) {
            if (/^jobs:\s*$/.test(line)) {
                inJobs = true;
                continue;
            }
            if (!inJobs) continue;
            const header = /^ {2}([A-Za-z0-9][\w-]*):\s*$/.exec(line);
            if (header) {
                current = { job: header[1], file, runsOn: '', archs: new Set(), body: [] };
                jobs.push(current);
                continue;
            }
            if (!current) continue;
            if (/^\s*#/.test(line)) continue; // explanatory comment — never a production step
            current.body.push(line);
            const runsOn = /^\s*runs-on:\s*(.+?)\s*$/.exec(line);
            if (runsOn) current.runsOn = runsOn[1];
            const arch = /^\s*-?\s*arch:\s*['"]?([\w]+)['"]?\s*$/.exec(line);
            // Only tokens that NAME a CPU count. `arch:` is not exclusively a
            // matrix key — it is also an input of `uraimo/run-on-arch-action`,
            // where the documented value for a custom `base_image` is the
            // literal `none`. Without this filter that `none` would be read as
            // a target, and every package the emulated job builds would fail
            // the declared-vs-built contract on a phantom `linux-none`.
            if (arch && KNOWN_ARCH_TOKENS.has(arch[1])) current.archs.add(arch[1]);
            if (/^\s*if:\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(line)) current.manualOnly = true;
        }
        for (const job of jobs) {
            if (job.manualOnly) continue;
            const os = osFromRunner(job.runsOn);
            // `ubuntu-24.04-arm` and friends carry the arch in the label.
            const labelArm = /-arm\b|-arm64\b/.test(job.runsOn);
            const archs = job.archs.size > 0 ? [...job.archs] : [labelArm ? 'arm64' : RUNNER_DEFAULT_ARCH[os]];
            // Attribute per STEP, not per line: a step's package identity and
            // its production verb usually sit on different lines (`- name:
            // Build native addon` + `working-directory: packages/…`).
            for (const step of splitSteps(job.body)) {
                if (!/\b(build|collect|stage|prebuild|upload)/i.test(step)) continue;
                for (const id of identifiers) {
                    if (!step.includes(id.name_re) && !step.includes(id.path_re)) continue;
                    const set = byPackage.get(id.name) ?? new Set();
                    for (const arch of archs) set.add(canonicalPlatform(`${os}-${arch}`));
                    byPackage.set(id.name, set);
                }
            }
        }
    }
    return byPackage;
}

/**
 * Keep promise, artifact and CI in sync. Returns human-readable failure lines
 * (empty = ok) plus the per-package rows the reporters render.
 */
function auditPlatforms(nativePkgs, ciPlatforms) {
    const failures = [];
    const rows = [];
    for (const pkg of nativePkgs) {
        const ci = ciPlatforms.get(pkg.name);
        const ciList = ci ? [...ci].sort() : null;
        rows.push({ ...pkg, ci: ciList });

        if (!pkg.declared) {
            failures.push(
                `${pkg.name} (${pkg.path}): missing \`gjsify.platforms\` — every package with a native build system must declare the \`<os>-<arch>\` targets it ships a prebuild for. \`gjsify.runtimes\` covers runtimes, not operating systems; without this the package's OS reach is undocumented and unverifiable.`,
            );
            continue;
        }
        const bad = pkg.declared.filter((p) => !PLATFORM_RE.test(p));
        if (bad.length > 0) {
            failures.push(
                `${pkg.name} (${pkg.path}): invalid \`gjsify.platforms\` entr${bad.length === 1 ? 'y' : 'ies'} ${bad.join(', ')} — expected \`\${process.platform}-\${process.arch}\`, i.e. os ∈ {linux, darwin, win32} and arch ∈ {x64, arm64, ppc64, s390x, riscv64}. The uname spelling (\`linux-x86_64\`, \`linux-aarch64\`) is no longer accepted: one spelling, and it is the one a running process can compute about itself.`,
            );
            continue;
        }
        const declaredCanon = new Set(pkg.declared.map(canonicalPlatform));

        // A committed artifact nobody declared: either the declaration is
        // stale or the artifact is. Both are silent-wrongness risks — a
        // consumer resolving `prebuilds/<p>/` finds something the package
        // does not promise to keep working.
        for (const shipped of pkg.shipped) {
            if (!declaredCanon.has(canonicalPlatform(shipped))) {
                failures.push(
                    `${pkg.name} (${pkg.path}): ships \`prebuilds/${shipped}/\` but does not declare it in \`gjsify.platforms\` (${pkg.declared.join(', ')}).`,
                );
            }
        }

        // The promise and the build must agree in BOTH directions, so that
        // whoever changes one is forced to change the other:
        //   declared ⊄ CI  → a platform users are promised but never receive
        //   CI ⊄ declared  → a platform CI pays to build that nothing claims,
        //                    and that no consumer-facing document mentions
        // Only enforced when the parser found CI jobs for this package at all
        // — see parseCiPlatforms' contract.
        if (ci) {
            for (const declared of pkg.declared) {
                if (!ci.has(canonicalPlatform(declared))) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): declares \`${declared}\` in \`gjsify.platforms\` but no CI job produces that target — a promised platform with no build is a prebuild consumers will never receive.`,
                    );
                }
            }
            for (const built of ci) {
                if (!declaredCanon.has(built)) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): CI builds \`${built}\` but \`gjsify.platforms\` (${pkg.declared.join(', ')}) does not declare it — an artifact the package does not promise is invisible to consumers and to every platform-support document generated from this field.`,
                    );
                }
            }
        } else if (pkg.shipped.length > 0) {
            // Committed binaries that no workflow reproduces. They were built
            // by hand once and drift silently from their sources forever after
            // — nothing rebuilds them when the Vala/Rust changes, and nothing
            // proves they still match. Wire the package into a prebuild
            // workflow, or stop shipping the artifact.
            failures.push(
                `${pkg.name} (${pkg.path}): ships prebuilds (${pkg.shipped.join(', ')}) but no CI job produces any of them — a hand-built binary nothing reproduces. Wire it into .github/workflows/prebuilds.yml.`,
            );
        }
    }
    return { failures, rows };
}

// ─── Prebuild-artifact audit (does the promise have a body?) ────────────────

// `auditPlatforms` above compares three DECLARATIONS: the package's promise,
// the directory names it happens to carry, and the targets a CI job produces.
// All three can agree while the promise is empty — `@gjsify/oxfmt-native`
// declared `darwin-arm64` for weeks with no artifact behind it and every one
// of those checks stayed green, because a target with no `prebuilds/<t>/`
// directory is simply absent from the "shipped" set it compares against.
//
// This audit closes that, in two halves. Only the first is obvious.
//
// 1. EXISTENCE — for every package that names a committed prebuild directory
//    (`gjsify.prebuilds`), every declared target must have that directory,
//    and the directory must hold the artifacts a consumer needs: a shared
//    library in the host format for that OS, and the GI typelib without which
//    `GI_TYPELIB_PATH` resolves nothing.
//
// 2. LOADABILITY — a directory that exists proves nothing. The macOS lesson
//    (#832) was that a required job built two bridges for darwin-arm64 and
//    only COPIED them; the bug that hid there for weeks was a missing sibling
//    file that read exactly like a broken rpath. So every committed artifact
//    is verified as far as this host allows:
//
//      • ALWAYS, on any host, for any target — STRUCTURAL: the image's own
//        machine must match the directory it sits in; every `libgjsify*`
//        sibling it records must be staged beside it and reachable through
//        `@loader_path`/`$ORIGIN` (`scripts/check-prebuild-loader-path.mjs`,
//        which parses Mach-O and ELF directly); and every library leaf the
//        typelib names must be present, because that leaf is what GI hands to
//        `dlopen` the moment a consumer resolves a class.
//
//      • ONLY for the host's own target — FUNCTIONAL: the library is actually
//        `dlopen`ed, with every library-path environment variable stripped, so
//        the self-relative sibling hop is proven rather than inferred.
//
//    A cross-arch prebuild CANNOT be loaded here and this audit does not
//    pretend otherwise: it reports, per run, which targets got the functional
//    probe and which got structure only. Being loud about the boundary is the
//    point — a check that claims more than it did is worse than no check.
//
// The ESCAPE HATCH is `gjsify.platformsUncommitted`: a target → reason map for
// a platform that is genuinely declared and genuinely built by CI, but whose
// artifact this repo does not commit (today `@gjsify/napi`'s darwin-arm64,
// which `napi.yml` builds, load-tests and uploads for a release to ship). It
// makes an honest "promised, not committed here" statable in ONE place that
// the audit reads, so the alternative — a silent gap — stops being available.
// It is deliberately awkward to abuse: the reason is mandatory, the target
// must already be in `gjsify.platforms`, and the entry becomes a FAILURE the
// moment the directory does appear, so it cannot ossify past its usefulness.

/** `${process.platform}-${process.arch}` — the one target this host can load. */
const HOST_TARGET = `${process.platform}-${process.arch}`;

/** Shared-library file extension per `process.platform` token. */
const LIB_EXT = { linux: '.so', darwin: '.dylib', win32: '.dll' };

/**
 * `dlopen` one library with every library-path variable stripped.
 *
 * Driven through `python3`'s `ctypes` — the same env-free probe the macOS
 * prebuild jobs use (#832), and the only dlopen available to a pure-Node
 * script with no addon of its own. Stripping the environment is the whole
 * point: `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH` from `buildNativeEnv()` only
 * has to find the bare leaf the typelib records, so the library's own hop to
 * its Rust cdylib sibling must need nothing at all.
 *
 * @param {string} file absolute path to the library
 * @returns {{status: 'loaded'|'unavailable'|'failed', detail?: string}}
 *   `unavailable` = no python3 on this host (nothing was tested).
 */
function dlopenProbe(file) {
    const env = { ...process.env };
    for (const key of ['LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH']) delete env[key];
    const res = spawnSync('python3', ['-c', 'import ctypes,sys; ctypes.CDLL(sys.argv[1])', file], {
        env,
        encoding: 'utf8',
        timeout: 60_000,
    });
    if (res.error) return { status: 'unavailable', detail: String(res.error.message ?? res.error) };
    if (res.status === 0) return { status: 'loaded' };
    const detail = String(res.stderr ?? '')
        .trim()
        .split('\n')
        .filter((l) => !/^\s*(File "|  |Traceback)/.test(l))
        .join(' ')
        .trim();
    return { status: 'failed', detail: detail || `python3 exited ${res.status}` };
}

/**
 * Hold the existence + loadability invariant over every committed prebuild.
 *
 * @param {Array<object>} nativePkgs rows from `collectNativePackages()`
 * @returns {{failures: string[], notes: string[], stats: object}}
 */
function auditPrebuildArtifacts(nativePkgs) {
    /** @type {string[]} */ const failures = [];
    /** @type {string[]} */ const notes = [];
    const stats = { dirs: 0, packages: 0, loaded: 0, structuralOnly: 0, uncommitted: 0, hostSkipped: 0 };
    let pythonUnavailable = false;

    for (const pkg of nativePkgs) {
        if (!pkg.declared) continue; // already a failure in `auditPlatforms`
        const declaredCanon = pkg.declared.map(canonicalPlatform);

        // ── The escape hatch, validated before it is honoured ──────────────
        const uncommitted = new Set();
        /** @type {Map<string, string[]>} reason → the targets deferred for it */
        const exemptByReason = new Map();
        if (pkg.uncommitted != null) {
            const isPlainObject =
                typeof pkg.uncommitted === 'object' && !Array.isArray(pkg.uncommitted) && pkg.uncommitted !== null;
            if (!isPlainObject) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` must be an object mapping each not-committed \`<os>-<arch>\` target to the REASON it is not committed, e.g. {"darwin-arm64": "built + load-tested by napi.yml; a release ships it from the uploaded artifact"}.`,
                );
            } else if (!pkg.prebuildsField) {
                failures.push(
                    `${pkg.name} (${pkg.path}): declares \`gjsify.platformsUncommitted\` but has no \`gjsify.prebuilds\` directory — the field exempts a target from the committed-artifact contract, and this package is not under that contract at all. Remove it.`,
                );
            } else {
                for (const [target, reason] of Object.entries(pkg.uncommitted)) {
                    if (!PLATFORM_RE.test(target)) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` key \`${target}\` is not a valid \`\${process.platform}-\${process.arch}\` target.`,
                        );
                        continue;
                    }
                    if (typeof reason !== 'string' || reason.trim() === '') {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted["${target}"]\` needs a non-empty reason. An unexplained exemption is the silent gap this field exists to replace.`,
                        );
                        continue;
                    }
                    if (!declaredCanon.includes(canonicalPlatform(target))) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` exempts \`${target}\`, which \`gjsify.platforms\` (${pkg.declared.join(', ')}) does not declare — you can only defer shipping something you promise. Add it to \`platforms\` or drop the exemption.`,
                        );
                        continue;
                    }
                    if (pkg.shipped.some((s) => canonicalPlatform(s) === canonicalPlatform(target))) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.platformsUncommitted\` still exempts \`${target}\`, but \`${pkg.prebuildsField}/${target}/\` IS committed now. Delete the exemption so the artifact is held to the full contract.`,
                        );
                        continue;
                    }
                    uncommitted.add(canonicalPlatform(target));
                    stats.uncommitted++;
                    exemptByReason.set(reason.trim(), [...(exemptByReason.get(reason.trim()) ?? []), target]);
                }
                // One note per REASON, not per target: the packages that defer
                // a whole emulated matrix defer it for one cause, and 24
                // identical lines bury the one entry that says something else.
                for (const [reason, targets] of exemptByReason) {
                    notes.push(`${pkg.name}: \`${targets.join('`, `')}\` declared but not committed — ${reason}`);
                }
            }
        }

        // A package that does not name a committed prebuild directory
        // (`@gjsify/node-gi`: node-gyp, built on install / shipped from a
        // release artifact) is out of scope for everything below.
        if (!pkg.prebuildsField) continue;
        stats.packages++;

        for (const target of pkg.declared) {
            const canon = canonicalPlatform(target);
            if (uncommitted.has(canon)) continue;
            const [os, arch] = canon.split('-');
            const dir = join(pkg.prebuildDir, target);

            // ── Half 1: existence ─────────────────────────────────────────
            if (!existsSync(dir)) {
                failures.push(
                    `${pkg.name} (${pkg.path}): declares \`${target}\` but ships no \`${pkg.prebuildsField}/${target}/\` — a promised platform with no artifact behind it. Either commit the prebuild (\`gjsify workspace ${pkg.name} build:prebuilds\` on that target, or the workflow that produces it), or record the gap honestly in \`gjsify.platformsUncommitted\` with the reason.`,
                );
                continue;
            }
            stats.dirs++;
            const files = readdirSync(dir);
            const ext = LIB_EXT[os];
            const libs = files.filter((f) => f.endsWith(ext));
            const typelibs = files.filter((f) => f.endsWith('.typelib'));
            if (libs.length === 0) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` holds no \`${ext}\` — a ${os} consumer has nothing to load (present: ${files.join(', ') || 'nothing'}).`,
                );
                continue;
            }
            if (typelibs.length === 0) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` holds no \`.typelib\` — every package under this contract is a GI bridge reached through \`GI_TYPELIB_PATH\`, so a shared library alone is unreachable (present: ${files.join(', ')}).`,
                );
                continue;
            }

            // ── Half 2a: structural loadability (any host, any target) ────
            let structurallySound = true;
            for (const lib of libs.sort()) {
                const path = join(dir, lib);
                let info = null;
                try {
                    info = readLibrary(path);
                } catch (err) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${lib}\` is not a readable shared library — ${err instanceof Error ? err.message : String(err)}.`,
                    );
                    structurallySound = false;
                    continue;
                }
                if (!info) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${lib}\` has a \`${ext}\` name but is neither ELF, Mach-O nor PE — a stray or truncated file in a prebuild directory is what a consumer will try to load.`,
                    );
                    structurallySound = false;
                    continue;
                }
                if (info.os !== os || (info.arch !== null && info.arch !== arch)) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${lib}\` is a ${info.os}/${info.arch ?? 'unknown'} image in a \`${target}\` directory — it can never load on the platform it is published for. This is the one prebuild defect a cross-arch target CAN be caught for from any host, because the machine is in the file header; a build that silently ran on the runner's own architecture instead of the emulated one produces exactly this.`,
                    );
                    structurallySound = false;
                }
            }
            const loaderProblems = checkPrebuildDir(dir, { verbose: false });
            if (loaderProblems.length > 0) {
                structurallySound = false;
                for (const p of loaderProblems) failures.push(`${pkg.name} (${pkg.path}): ${p}`);
            }
            // The leaf GI itself will ask the loader for.
            const present = new Set(files);
            /** @type {Set<string>} */ const recorded = new Set();
            for (const tl of typelibs) {
                let leaves = null;
                try {
                    leaves = readTypelibSharedLibraries(join(dir, tl));
                } catch (err) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${tl}\` is not a readable typelib — ${err instanceof Error ? err.message : String(err)}.`,
                    );
                    structurallySound = false;
                    continue;
                }
                if (leaves === null) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${tl}\` does not carry the GI typelib magic — it is not a typelib, whatever its name says.`,
                    );
                    structurallySound = false;
                    continue;
                }
                for (const leaf of leaves) {
                    recorded.add(leaf);
                    if (!present.has(leaf)) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${tl}\` records shared library \`${leaf}\`, which is NOT staged in that directory (present: ${files.join(', ')}). GI hands that exact leaf to the loader as soon as a consumer resolves a class in the namespace, so the typelib resolves and the class access throws.`,
                        );
                        structurallySound = false;
                    }
                }
            }

            // ── Half 2b: functional loadability (host target only) ────────
            if (canon !== HOST_TARGET) {
                stats.structuralOnly++;
                continue;
            }
            if (!structurallySound) {
                // Loading a directory already known to be malformed adds a
                // second, derivative error message and no information.
                stats.hostSkipped++;
                continue;
            }
            for (const leaf of [...recorded].sort()) {
                const probe = dlopenProbe(join(dir, leaf));
                if (probe.status === 'loaded') {
                    stats.loaded++;
                    continue;
                }
                if (probe.status === 'unavailable') {
                    pythonUnavailable = true;
                    stats.hostSkipped++;
                    continue;
                }
                // A dependency of OUR OWN is a defect in the prebuild. A
                // third-party one the host does not have is a fact about the
                // host — this audit runs on a bare Node runner that has glib
                // but not libsoup/GStreamer/libgda, and failing there would
                // make the guard report the runner's package list rather than
                // anything about the artifact.
                const ownLeaves = new Set([...present].filter((f) => f.endsWith(ext)));
                const blamesOwn = [...ownLeaves].some((f) => probe.detail?.includes(f));
                if (blamesOwn) {
                    failures.push(
                        `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/${leaf}\` fails to load on this host with no library-path variable set — ${probe.detail}. The unresolved object is one this package stages itself, so the prebuild cannot resolve its own siblings from its own directory (\`$ORIGIN\`/\`@loader_path\`).`,
                    );
                    stats.hostSkipped++;
                } else {
                    stats.hostSkipped++;
                    notes.push(
                        `${pkg.name}: \`${target}/${leaf}\` not load-tested — this host lacks a system dependency it links against (${probe.detail}). Structure was verified; the functional load was not.`,
                    );
                }
            }
        }
    }
    if (pythonUnavailable) {
        notes.push(
            'no `python3` on this host, so NO artifact was actually loaded — every committed prebuild was verified structurally only. The functional half runs wherever python3 exists (every CI runner, every Fedora/Debian developer machine).',
        );
    }
    return { failures, notes, stats };
}

/**
 * What the prebuild audit actually verified, and — the load-bearing half —
 * what it did NOT.
 *
 * Printed on success as well as failure, on purpose. "Structure verified on
 * 47 directories, 11 of them actually loaded" is a different claim from "47
 * prebuilds work", and a reader who is never told the difference will assume
 * the second one. The cross-arch boundary is not an apology, it is the result.
 *
 * @param {{failures: string[], notes: string[], stats: object}} result
 */
function renderPrebuildSummary({ notes, stats }) {
    const lines = [
        `prebuild-artifact audit: ${stats.dirs} committed prebuild director(y|ies) across ${stats.packages} package(s) verified STRUCTURALLY ` +
            `(machine matches the directory, typelib-named libraries staged, self-relative sibling resolution recorded).`,
        `  functional load (env-free \`dlopen\`, proving the sibling hop for real): ${stats.loaded} librar(y|ies) on this host's own target \`${HOST_TARGET}\`` +
            `; ${stats.structuralOnly} director(y|ies) are for OTHER targets and CANNOT be loaded here — a cross-arch prebuild is verifiable only from its file headers, and this audit does not pretend otherwise.` +
            (stats.hostSkipped > 0 ? ` ${stats.hostSkipped} host-target load(s) skipped (see notes).` : ''),
    ];
    if (stats.uncommitted > 0) {
        lines.push(
            `  ${stats.uncommitted} declared target(s) are exempt via \`gjsify.platformsUncommitted\` — declared and CI-built, artifact deliberately not committed here.`,
        );
    }
    for (const n of notes) lines.push(`  · ${n}`);
    return lines.join('\n');
}

/** The OS × package matrix — the honest answer to "where does this run?". */
function renderPlatformMatrix(rows, { markdown = false } = {}) {
    const all = new Set();
    for (const r of rows) {
        for (const p of r.declared ?? []) all.add(canonicalPlatform(p));
        for (const p of r.shipped) all.add(canonicalPlatform(p));
        for (const p of r.ci ?? []) all.add(canonicalPlatform(p));
    }
    const platforms = [...all].sort();
    const mark = (r, p) => {
        const declared = (r.declared ?? []).some((d) => canonicalPlatform(d) === p);
        const shipped = r.shipped.some((s) => canonicalPlatform(s) === p);
        const built = (r.ci ?? []).some((c) => canonicalPlatform(c) === p);
        // A declared target the package itself records as not-committed is a
        // distinct state from "shipped" — the matrix is the document people
        // read to answer "can I install this there?", and collapsing the two
        // is how "declared" came to look like "delivered" in the first place.
        const exempt =
            r.prebuildsField != null &&
            r.uncommitted != null &&
            typeof r.uncommitted === 'object' &&
            Object.keys(r.uncommitted).some((t) => canonicalPlatform(t) === p);
        if (declared && exempt) return built ? '○' : '!';
        if (declared && built) return '✓';
        if (declared && shipped) return '⚠'; // committed once, nothing rebuilds it
        if (declared) return '!'; // promised, nothing produces it at all
        if (shipped || built) return '?'; // produced, never promised
        return '·';
    };
    const legendParts = [
        '✓ declared + built by CI',
        '○ declared + built, artifact not committed here',
        '⚠ committed artifact, no CI job rebuilds it',
        '! declared, nothing produces it',
        '? produced, undeclared',
        '· unsupported',
    ];
    if (markdown) {
        const lines = [
            `| package | tier | ${platforms.join(' | ')} |`,
            `|---|---|${platforms.map(() => '---').join('|')}|`,
        ];
        for (const r of rows) {
            lines.push(`| \`${r.name}\` | ${r.tier ?? '—'} | ${platforms.map((p) => mark(r, p)).join(' | ')} |`);
        }
        lines.push('');
        lines.push(legendParts.map((l) => `\`${l.slice(0, 1)}\`${l.slice(1)}`).join(' · '));
        return lines.join('\n');
    }
    const nameWidth = Math.max(...rows.map((r) => String(r.name).length), 'package'.length);
    const head = `${'package'.padEnd(nameWidth)} │ ${platforms.map((p) => p.padEnd(14)).join(' │ ')}`;
    const sep = `${'─'.repeat(nameWidth)}─┼─${platforms.map(() => '─'.repeat(14)).join('─┼─')}`;
    const body = rows.map(
        (r) => `${String(r.name).padEnd(nameWidth)} │ ${platforms.map((p) => mark(r, p).padEnd(14)).join(' │ ')}`,
    );
    return [head, sep, ...body, '', legendParts.join('   ')].join('\n');
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
        const declared = r.declared ? '✓' : r.suggested ? '—' : 'n/a';
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
        // A pure-TS contract (no `.imports?.gi` guard and none of the hard
        // GJS-binding signals) is platform-agnostic: it runs unmodified on
        // Node, the browser and NS' V8 (resolving to its real
        // `lib/esm/index.js`), so it can legitimately opt the node / browser /
        // nativescript slots INTO `"polyfill"` even though the conservative
        // heuristic suggests `none`. Both `none` (opt-out, GJS-only) and
        // `polyfill` (opt-in, cross-runtime) are honest for these slots — do
        // not flag either as drift. The GJS slot stays enforced as usual;
        // GJS-bound packages get no tolerance. Two axes carry this shape:
        //   - framework-gjs: `@gjsify/stories` + `@gjsify/storybook-core`
        //     (all-polyfill, shared by the GTK/browser/NS renderers).
        //   - design-identity: `@gjsify/adwaita-core` (ADR 0004 — headless
        //     widget behavior consumed by the web/NS renderers), recognised by
        //     the standard cross-runtime test harness (`src/test.mts`), which
        //     the design-ASSET packages (fonts/icons/web components) never ship.
        const isPureTsContract =
            (r.axis === 'framework-gjs' || (r.axis === 'design-identity' && r.signals.has_test_entry)) &&
            !r.signals.gjs_imports_guard &&
            !r.signals.girs_value &&
            !r.signals.gi_url &&
            !r.signals.imports_legacy &&
            !r.signals.dynamic_gi;
        const portableContractSlot = (s) => s === 'node' || s === 'browser' || s === 'nativescript';
        const mismatches = slots.filter((s) => {
            // `nativescript` is a Foundation-time addition (Welle 4-T). Existing
            // packages declared their triplet before NS was an axis; treat the
            // 4th slot as OPTIONAL until per-package Welle-5 PRs backfill it.
            // If the package doesn't declare `nativescript`, skip drift check
            // on that slot (the suggestion is just a hint, not a hard target).
            if (s === 'nativescript' && r.declared[s] === undefined) return false;
            // Pure-TS contract: `none` (opt-out) and `polyfill` (opt-in) are
            // both valid choices for the portable node/browser/nativescript
            // slots (see above) — neither drifts.
            if (
                isPureTsContract &&
                portableContractSlot(s) &&
                (r.declared[s] === 'polyfill' || r.declared[s] === 'none')
            ) {
                return false;
            }
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

// Everything below runs only when this file IS the program. Importing it
// otherwise (`tests/e2e/prebuild-declaration-invariant`) would re-audit the
// whole workspace as a side effect of loading a function.
//
// The prebuild invariant is the one part of this script whose test cannot use
// the repository as its fixture: proving that a MISSING prebuild directory
// fails means removing one, and the e2e suites run four-at-a-time against a
// single shared checkout. So `auditPrebuildArtifacts` takes its rows as an
// argument and is exported, and its suite builds synthetic packages (with real
// linked binaries copied out of the committed prebuilds) in a temp directory.
const IS_ENTRY = Boolean(process.argv[1]) && resolve(process.argv[1]).endsWith('audit-runtimes.mjs');

export { auditPrebuildArtifacts, collectNativePackages, renderPrebuildSummary };

if (IS_ENTRY) {
    await main();
}

async function main() {
    const rows = await buildReport();

    if (PLATFORMS) {
        const nativePkgs = await collectNativePackages();
        const ciPlatforms = await parseCiPlatforms(nativePkgs);
        const { rows: platformRows } = auditPlatforms(nativePkgs, ciPlatforms);
        if (FORMAT === 'json') {
            console.log(JSON.stringify(platformRows, null, 2));
        } else {
            console.log(renderPlatformMatrix(platformRows, { markdown: FORMAT === 'markdown' }));
        }
        process.exit(0);
    }

    if (APPLY) {
        const { updated, skipped } = await apply(rows);
        console.log(
            `audit-runtimes: applied ${updated} package(s), skipped ${skipped} (already-declared / infra / unknown).`,
        );
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
        // Tier audit (ADR 0003 + ADR 0005) is part of EVERY `--check` run —
        // declaration-driven, so there is no strict/quick split to respect.
        const published = await collectPublishedPackages();
        const tierFailures = auditTiers(published);
        // Platform audit (OS axis) — always part of `--check`, like the tier
        // audit: declaration-driven, cheap, and the only guard that a native
        // package's promised operating systems, its committed artifacts and the
        // CI that produces them stay in agreement.
        const nativePkgs = await collectNativePackages();
        const ciPlatforms = await parseCiPlatforms(nativePkgs);
        const { failures: platformFailures, rows: platformRows } = auditPlatforms(nativePkgs, ciPlatforms);
        // Prebuild-artifact audit — the body behind the promise. `auditPlatforms`
        // above compares declarations to each other and stays green on a declared
        // target with nothing behind it; this one opens every committed artifact,
        // and loads the ones this host can load.
        const prebuilds = auditPrebuildArtifacts(nativePkgs);
        // Both remaining audits read the same per-package `gjsify` metadata, and
        // collecting it runs `scanSourceTree` over every package — the bulk of what
        // `--check` costs. Collect ONCE and hand it to both, the way #821's
        // `auditCuratedAliasRouting(meta)` already does inside the reachability
        // audit.
        const reachMeta = await collectReachMeta();
        // Cross-runtime reachability audit (ADR 0014) — always part of `--check`,
        // for the same reason as the tier + platform audits: declaration-driven,
        // cheap (static import scan, no build), and a guard that only runs behind
        // `--strict` is a guard CI never executes.
        const reach = await auditReachability(reachMeta);
        // Headless-contract audit (ADR 0015) — always part of `--check`, same
        // reasoning again: declaration-driven, a static import scan, and the ONLY
        // guard on intra-GJS layering (headless vs toolkit-bound), which every
        // check above is structurally blind to.
        const headless = await auditHeadless(reachMeta);
        const ok =
            drifted.length === 0 &&
            missing.length === 0 &&
            probeFailures.length === 0 &&
            tierFailures.length === 0 &&
            platformFailures.length === 0 &&
            prebuilds.failures.length === 0 &&
            reach.failures.length === 0 &&
            reach.aliasFailures.length === 0 &&
            headless.failures.length === 0;
        if (ok) {
            const suffix = STRICT ? ` (functional probes passed on every declared slot)` : '';
            console.log(
                `audit-runtimes --check${STRICT ? ' --strict' : ''}: OK. ${declarable} declarable package(s) match the signal-based suggestion (${rows.length - declarable} infra/unknown skipped).${suffix}`,
            );
            console.log(
                `tier audit: OK. ${published.size} published package(s) declare a tier; dependency-direction + ADR-0005 node-gi isolation hold on every deps/optionalDeps edge.`,
            );
            const unverified = platformRows.filter((r) => !r.ci).length;
            console.log(
                `platform audit: OK. ${platformRows.length} native package(s) declare \`gjsify.platforms\`; committed prebuilds and CI-produced targets agree with every declaration${unverified > 0 ? ` (${unverified} package(s) had no CI job the parser recognised — reported, not enforced)` : ''}.`,
            );
            console.log(renderPrebuildSummary(prebuilds));
            console.log(
                `reachability audit (ADR 0014): OK. ${reach.checked} polyfill/partial slot(s) checked; no "polyfill" slot resolves to GLib/Gio-reaching code, and no curated browser alias resolves to the root of a package that ships a "./browser" entry.`,
            );
            console.log(
                `headless audit (ADR 0015): OK. ${headless.checked} package(s) declare \`gjsify.headless\`; no root entry graph reaches a typelib it promised not to.`,
            );
            renderReachabilityNotes(reach);
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
            console.error(`FUNCTIONAL PROBE FAILURES on ${probeFailures.length} package(s):`);
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
        if (tierFailures.length > 0) {
            console.error(`TIER-CONTRACT FAILURES (ADR 0003 / ADR 0005) on ${tierFailures.length} edge(s)/package(s):`);
            for (const line of tierFailures) {
                console.error(`  - ${line}`);
            }
            console.error('');
        }
        if (platformFailures.length > 0) {
            console.error(`PLATFORM-CONTRACT FAILURES (OS axis) on ${platformFailures.length} package(s)/target(s):`);
            for (const line of platformFailures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error('Current OS × native-package matrix (`node scripts/audit-runtimes.mjs --platforms`):');
            console.error(renderPlatformMatrix(platformRows));
            console.error('');
        }
        if (prebuilds.failures.length > 0) {
            console.error(
                `PREBUILD-ARTIFACT FAILURES (does the declared platform have a loadable body?) on ${prebuilds.failures.length} target(s):`,
            );
            for (const line of prebuilds.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'Every declared target of a package that names a `gjsify.prebuilds` directory must have that directory, ' +
                    "holding a shared library in the target OS's format plus the GI typelib that names it — and the " +
                    "artifacts must be structurally loadable: the image's own machine matching the directory, every " +
                    '`libgjsify*` sibling staged beside it and reachable via `$ORIGIN`/`@loader_path`, and every library ' +
                    'leaf the typelib records present. If a platform is genuinely built by CI but deliberately not ' +
                    'committed here, say so in `gjsify.platformsUncommitted: {"<target>": "<why>"}` — an honest ' +
                    '"not shipped yet" is available; a silent gap is not.',
            );
            console.error('');
            console.error(renderPrebuildSummary(prebuilds));
            console.error('');
        }
        if (reach.failures.length > 0) {
            console.error(`CROSS-RUNTIME REACHABILITY FAILURES (ADR 0014) on ${reach.failures.length} slot(s):`);
            for (const line of reach.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'Fix by one of: (a) import the cross-runtime slice instead (e.g. `@gjsify/utils/core` rather than `@gjsify/utils`); ' +
                    '(b) ship a `src/<target>.ts` platform entry + a `"./<target>"` export subpath so the slot routes there (ADR 0014); ' +
                    '(c) downgrade the slot to `partial`/`none` if the package genuinely cannot keep the `polyfill` promise on that runtime.',
            );
            console.error('');
        }
        if (reach.aliasFailures.length > 0) {
            console.error(`CURATED-ALIAS ROUTING FAILURES on ${reach.aliasFailures.length} alias entr(y|ies):`);
            for (const line of reach.aliasFailures) {
                console.error(`  - ${line}`);
            }
            console.error('');
        }
        if (headless.failures.length > 0) {
            console.error(`HEADLESS-CONTRACT FAILURES (ADR 0015) on ${headless.failures.length} package(s):`);
            for (const line of headless.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'A `gjsify.headless` declaration is a promise about the ROOT entry only. Fix by one of: ' +
                    '(a) move the toolkit-bound code behind a side-effect SUBPATH the root never imports and have its ' +
                    'consumers import that subpath explicitly (the `@gjsify/canvas2d-core/gdk` pattern); ' +
                    '(b) inject the capability through a seam the root defines but does not implement ' +
                    '(`CanvasPixelBridge`); (c) narrow or drop the declaration if the package genuinely cannot keep it — ' +
                    'a headless claim that is not true belongs in neither the docs nor package.json.',
            );
            console.error('');
        }
        renderReachabilityNotes(reach);
        console.error(
            "Either update the package's source-code signals (the GJS-binding shape changed) or update its package.json#gjsify.runtimes to match the new reality. See AGENTS.md `## Strategic direction — cross-runtime portability` for the slot model. For tier-contract failures see docs/adr/0003-package-tiering.md + docs/adr/0005-node-gi-scope.md. For reachability failures see docs/adr/0014-utils-core-subpath-and-platform-entry-routing.md. For headless-contract failures see docs/adr/0015-headless-package-contract.md.",
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
        console.log(
            `Declared: ${declaredCount} / ${declarableCount} declarable (${rows.length - declarableCount} infra/unknown).`,
        );
    }
}
