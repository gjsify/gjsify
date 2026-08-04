#!/usr/bin/env node
// The workspace manifest-conformance gate.
//
// This file used to BE the audit — eight independent checks in one 2 800-line
// script, next to four other standalone scripts that each answered the same
// shape of question ("does this declaration match reality") for a different
// declaration. That collection grew one incident at a time and was never
// designed; nothing connected "we added a field to the manifest contract" to
// "therefore something must verify it".
//
// It is now the ENTRY POINT for the registry in
// `@gjsify/manifest-conformance` (`packages/infra/manifest-conformance/`).
// Rules register themselves, declare which manifest FIELDS they govern, and the
// `field-coverage` rule fails the run on any `gjsify.*` declaration kind no rule
// claims — so a new declaration is no longer addable without a check.
//
// WHAT LIVES WHERE, and the axis that decides it:
//
//   PORTABLE rules (`packages/infra/manifest-conformance/lib/rules/`) read only
//   the manifest, files on disk and binaries: `package-outputs`,
//   `prebuild-artifacts`, `headless`, `field-coverage`. They are correct in any
//   npm package, which is why they live in a package rather than in `scripts/`.
//
//   REPO-SCOPED rules (`scripts/manifest-conformance/rules/` and the three
//   defined at the bottom of this file) know about THIS repository: its
//   directory layout as an axis taxonomy, curated `@gjsify/*` package-name
//   allowlists, `prebuilds.yml`'s matrix, `@gjsify/resolve-npm`'s alias table,
//   `refs/` submodules. Correct here, actively misleading anywhere else.
//
// WHY THE GATE IS A SCRIPT AND NOT A CLI COMMAND: `.github/workflows/
// audit-runtimes.yml` runs on a bare ubuntu runner with `setup-node` and NO
// install and NO build — this file is pure Node plus relative imports of
// committed, unbuilt `lib/*.mjs`. Routing the gate through the CLI would need
// either a full `gjsify install` or the COMMITTED `dist/cli.gjs.mjs`, and the
// second reintroduces exactly the staleness circularity `verify-committed-
// bundles.mjs` exists to break: a rule added in source but not rebuilt into the
// bundle would silently not run. #821 proved bundles do merge stale.
//
// The checks this file still implements are the three that are inseparable from
// the source-signal model: the runtime-slot DRIFT check, the ADR-0014
// cross-runtime REACHABILITY check, and the curated-alias routing check.
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
//                                                 # would suggest (CI guard),
//                                                 # plus every other
//                                                 # registered rule
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
//   node scripts/audit-runtimes.mjs --rules       # list every registered rule,
//                                                 # its scope and the manifest
//                                                 # fields it governs
//   node scripts/audit-runtimes.mjs --check --quick
//                                                 # explicit forward-
//                                                 # compatible opt-out for
//                                                 # the functional probes.
//
// Pure read-only by default. `--apply` only fills in missing declarations;
// existing `gjsify.runtimes` values are NEVER overwritten — the human stays
// in charge of every non-default decision. `--check` is read-only; it never
// edits package.json — it only reports drift.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * A repo-relative path in the ONE spelling everything downstream assumes.
 *
 * `path.relative()` answers in the host's separator, and every consumer here
 * splits on `/` — `classifyAxis` reads the first segment to decide the axis, and
 * an axis of `infra` is what exempts a package from needing a
 * `gjsify.runtimes` declaration at all. On Windows `relative()` returned
 * `gjs\unit`, the split produced one segment, the pillar matched nothing, and
 * five infra packages were reported as MISSING a declaration they are not
 * supposed to carry. The audit was therefore red on win32 and green on Linux
 * for the same tree — the exact shape this repo's Windows work keeps finding.
 *
 * `split(sep).join('/')` rather than `replaceAll('\\', '/')`: a backslash is a
 * legal character in a POSIX filename, and rewriting it there would corrupt a
 * path instead of normalising it.
 */
function toPosixRel(path) {
    return path.split(sep).join('/');
}
import { fileURLToPath } from 'node:url';

// The shared registry + the PORTABLE rule set. Importing the barrel registers
// `package-outputs`, `prebuild-artifacts`, `headless` and `field-coverage`;
// importing the repo-rule modules below registers `tier`, `platforms-ci` and
// `refs-pin`. Registration IS the wiring — there is no second list to keep in
// sync, which is the whole point.
import {
    auditPrebuildArtifacts,
    collectNativePackages,
    collectValueExports,
    createContext,
    defineRule,
    DYNAMIC_GI_RE,
    GI_URL_RE,
    GIRS_VALUE_RE,
    GJS_IMPORTS_GUARD_RE,
    IMPORTS_LEGACY_RE,
    isPlatformPackageManifest,
    listSourceFiles,
    packagesUnder,
    renderPrebuildLibcSummary,
    renderPrebuildSummary,
    runRules,
    selectRules,
    walkEntryGraph,
} from '../packages/infra/manifest-conformance/lib/index.mjs';
import { UNCHECKED_FIELDS } from './manifest-conformance/unchecked-fields.mjs';
import { PREBUILD_GIR_GAPS } from './manifest-conformance/prebuild-gir-gaps.mjs';
import { platformRows, renderPlatformMatrix } from './manifest-conformance/rules/platforms-ci.mjs';
import './manifest-conformance/rules/tier.mjs';
import './manifest-conformance/rules/refs-pin.mjs';
import './manifest-conformance/rules/status-data.mjs';
import './manifest-conformance/rules/platform-packages.mjs';

// `tests/e2e/prebuild-declaration-invariant` drives the prebuild invariant
// against SYNTHETIC packages, because proving that a MISSING prebuild directory
// fails means removing one and the e2e suites share a checkout. Re-exported
// here so that suite keeps importing the same path it always has.
export { auditPrebuildArtifacts, collectNativePackages, renderPrebuildSummary };

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PACKAGES_DIR = resolve(ROOT, 'packages');

/** Recursively find every package.json under a root, returning [absDir]. */
const findPackages = (dir) => packagesUnder(dir);

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
/** `--rules` lists the registry instead of running anything. */
const RULES_LIST = args.has('--rules');

// ─── Source-tree probes ─────────────────────────────────────────────────────

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
        browser_src_is_unsupported: false,
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
            // A THIRD shape the two states above cannot express: a NAMED
            // UNSUPPORTED STUB. The module has no browser pendant at all
            // (`child_process`, `net`, `tls` — the `NODE_API_NO_BROWSER_SENSE`
            // judgement), so its honest slot is `none`; the `src/browser.ts`
            // exists only so the curated alias can redirect to a NAMED module
            // that exports the real shape and throws with a message instead of
            // to the shared anonymous `@gjsify/empty`. Without this the mere
            // EXISTENCE of the file reads as a promotion to `polyfill` and the
            // drift check fails on a declaration that is correct. Declared by
            // the same `Slot: browser:"<slot>"` marker the `partial` entries
            // already use, so a file states its own slot in ONE place.
            signals.browser_src_is_unsupported = /Slot[^.\n]*none/i.test(txt);
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
        // A NAMED UNSUPPORTED STUB is not an upgrade: the entry exists so the
        // curated browser alias can name a module instead of the anonymous
        // `@gjsify/empty`, and the module still has no browser pendant. Keep
        // the conservative slot the package already declares.
        let browserSlot = nativeSlot;
        if (signals.has_browser_polyfill && !signals.has_globals_mjs && !signals.browser_src_is_unsupported) {
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
            rel: toPosixRel(relative(PACKAGES_DIR, pkgDir)),
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

async function buildReport() {
    const pkgDirs = await findPackages(PACKAGES_DIR);
    const rows = [];
    for (const pkgDir of pkgDirs) {
        const pkgJsonPath = join(pkgDir, 'package.json');
        const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
        // Per-target platform packages (ADR 0017) carry a binary and no
        // JavaScript. The runtime quadruplet describes the cross-runtime reach of
        // an API surface; a package with no source has none, and the path-based
        // axis classifier would happily suggest one from the pillar directory
        // alone — a suggestion nothing could satisfy and a declaration that would
        // be a lie in whichever direction it was written. They are skipped on the
        // manifest's own signature, the same predicate `status-data` and
        // `platforms-ci` use, so all three cannot disagree about what a data
        // package is.
        if (isPlatformPackageManifest(pkgJson)) continue;
        const rel = toPosixRel(relative(PACKAGES_DIR, pkgDir));
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

// ─── Rule registrations ─────────────────────────────────────────────────────
//
// The three checks below stay implemented in this file because they are
// inseparable from the source-signal model above, and all three are REPO-SCOPED
// for the same reason: they compare a declaration not to a fact but to a
// re-derivation built out of THIS repository — path-based axis classification
// (`packages/node/*`, `packages/web/adwaita*`), five curated `@gjsify/*`
// package-name allowlists, and `@gjsify/resolve-npm`'s own alias tables. Run
// against somebody else's package that derivation does not degrade, it lies.
//
// Registering them means `field-coverage` can see that `gjsify.runtimes` and
// `gjsify.runtimeSubpaths` have owners, and that a future declaration kind
// cannot be added without one.

/** Cached across rules in a single run — `buildReport` is the expensive part. */
let reportRows = null;
async function rowsFor() {
    reportRows ??= await buildReport();
    return reportRows;
}

/** Cached likewise: `collectReachMeta` scans every package's source tree. */
let reachMetaCache = null;
async function reachMetaFor() {
    reachMetaCache ??= await collectReachMeta();
    return reachMetaCache;
}

defineRule({
    id: 'runtimes-drift',
    scope: 'repo',
    fields: ['gjsify.runtimes'],
    description: 'the declared cross-runtime slot quadruplet matches what the source signals suggest',
    async run() {
        const rows = await rowsFor();
        const { drifted, missing } = diffDeclared(rows);
        const probeFailures = STRICT ? await runProbes(rows) : [];
        const declarable = rows.filter((r) => r.suggested).length;
        const failures = [
            ...missing.map(
                (r) =>
                    `${r.name ?? r.path} (packages/${r.path}): no \`gjsify.runtimes\` declaration; signals suggest ${fmtTriplet(r.suggested)} (${summarizeSignals(r)}).`,
            ),
            ...drifted.map(
                ({ row: r, mismatches }) =>
                    `${r.name ?? r.path} (packages/${r.path}): declared ${fmtTriplet(r.declared)} drifts from suggested ${fmtTriplet(r.suggested)} on ${mismatches.join(', ')} (${summarizeSignals(r)}).`,
            ),
            ...probeFailures.flatMap(({ row: r, failures: fs }) =>
                fs.map(
                    (f) =>
                        `${r.name ?? r.path} (packages/${r.path}): ${f.slot}-${declaredSlot(r, f.slot)}: ${f.kind} — ${f.detail}`,
                ),
            ),
        ];
        return {
            failures,
            stats: { declarable, drifted: drifted.length, missing: missing.length, probes: probeFailures.length },
            summary:
                `audit-runtimes --check${STRICT ? ' --strict' : ''}: OK. ${declarable} declarable package(s) match the signal-based suggestion ` +
                `(${rows.length - declarable} infra/unknown skipped).${STRICT ? ` (functional probes passed on every declared slot)` : ''}`,
            rows,
            drifted,
            missing,
            probeFailures,
            declarable,
        };
    },
});

defineRule({
    id: 'runtimes-reachability',
    scope: 'repo',
    fields: ['gjsify.runtimes', 'gjsify.runtimeSubpaths'],
    description: 'a slot declared `polyfill` must not resolve to code that reaches GLib/Gio (ADR 0014)',
    async run() {
        const meta = await reachMetaFor();
        const reach = await auditReachability(meta);
        return {
            failures: reach.failures,
            stats: { checked: reach.checked },
            summary:
                `reachability audit (ADR 0014): OK. ${reach.checked} polyfill/partial slot(s) checked; no "polyfill" slot resolves ` +
                'to GLib/Gio-reaching code, and no curated browser alias resolves to the root of a package that ships a "./browser" entry.',
            reach,
        };
    },
});

defineRule({
    id: 'curated-alias-routing',
    scope: 'repo',
    // Governs no manifest field: it audits `@gjsify/resolve-npm`'s own curated
    // alias TABLE against the packages it points at. Declared explicitly as an
    // empty list so the registry's contract ("say what you govern") is met
    // rather than silently skipped.
    fields: [],
    description: 'no curated browser alias resolves to the ROOT of a package that ships a `./browser` entry',
    async run() {
        const meta = await reachMetaFor();
        const failures = await auditCuratedAliasRouting(meta);
        return { failures, summary: undefined };
    },
});

/**
 * The rules `--check` selects.
 *
 * `package-outputs` and `refs-pin` are REGISTERED (so `field-coverage` sees the
 * fields they govern) but deliberately NOT selected here, because neither can
 * run in this job: `package-outputs` is a POST-condition on a built tree and
 * this workflow does no install and no build, and `refs-pin` needs initialised
 * `refs/` submodules and runs per-package inside `build:meson`. Selecting a
 * rule that cannot pass here would turn the gate into noise; leaving it
 * unregistered would hide its fields from coverage. Registration and selection
 * are separate on purpose.
 */
const CHECK_RULES = [
    'runtimes-drift',
    'tier',
    'platforms-ci',
    'prebuild-artifacts',
    // Runs in this job for the same reason `prebuild-artifacts` does: it reads
    // COMMITTED binaries out of the tree, so it needs no install and no build.
    // The libc flavour and the glibc floor come out of the ELF headers, which is
    // also why it works for every architecture from a single x86-64 runner.
    'prebuild-libc',
    'platform-packages',
    'runtimes-reachability',
    'curated-alias-routing',
    'headless',
    // Reads only `scripts` out of each manifest — no install, no build, no
    // filesystem beyond the package.json this job already parses. It belongs in
    // THIS job rather than a Windows leg precisely because the defect it guards
    // is invisible on Linux: a script that shells out to `rm`/`cp` runs fine
    // here and cannot run at all under cmd.exe.
    'portable-scripts',
    'field-coverage',
    'status-data',
];

/** Build the context every rule reads. */
function repoContext() {
    return createContext({
        root: ROOT,
        // `packages/node-gi/*` and `packages/napi/*` are deliberately NOT
        // workspace members, yet `@gjsify/napi` declares `gjsify.platforms` +
        // `gjsify.platformsUncommitted` and is audited. Scanning the subtree is
        // what keeps them in scope; narrowing to the `workspaces` globs would
        // drop that coverage with nothing to notice it.
        discoveryRoots: ['packages'],
        extra: {
            fieldCoverage: 'enforce',
            uncheckedFields: UNCHECKED_FIELDS,
            // The missing-`.gir` ledger. Injected here rather than declared in a
            // manifest because the manifests it would live in are GENERATED from
            // derived fields only — see the rule's header.
            prebuildGirGaps: PREBUILD_GIR_GAPS,
        },
    });
}

// ─── Main ───────────────────────────────────────────────────────────────────

const IS_ENTRY = Boolean(process.argv[1]) && resolve(process.argv[1]).endsWith('audit-runtimes.mjs');

if (IS_ENTRY) {
    await main();
}

async function main() {
    if (RULES_LIST) {
        for (const rule of selectRules()) {
            console.log(
                `${rule.id.padEnd(24)} ${rule.scope.padEnd(9)} ${rule.fields.join(', ') || '(no manifest field)'}`,
            );
            console.log(`${' '.repeat(34)}${rule.description}`);
        }
        process.exit(0);
    }

    if (PLATFORMS) {
        // `matrixRows`, not `rows`: the per-target platform packages (ADR 0017)
        // are audited but not TABULATED — see `creditPlatformPackages`. `--json`
        // takes the same set so the machine-readable form and the table cannot
        // describe different populations.
        const { matrixRows } = await platformRows(repoContext());
        if (FORMAT === 'json') {
            console.log(JSON.stringify(matrixRows, null, 2));
        } else {
            console.log(renderPlatformMatrix(matrixRows, { markdown: FORMAT === 'markdown' }));
        }
        process.exit(0);
    }

    if (APPLY) {
        const { updated, skipped } = await apply(await rowsFor());
        console.log(
            `audit-runtimes: applied ${updated} package(s), skipped ${skipped} (already-declared / infra / unknown).`,
        );
        process.exit(0);
    }

    if (CHECK) {
        const ctx = repoContext();
        // The headless walk needs the same per-package metadata the
        // reachability walk builds, and building it runs `scanSourceTree` over
        // every package — the bulk of what `--check` costs. Collect ONCE and
        // hand it to both.
        ctx.options.headlessMeta = await reachMetaFor();
        const run = await runRules(selectRules({ only: CHECK_RULES }), ctx);
        const byId = new Map(run.results.map((r) => [r.rule.id, r.result]));

        const drift = byId.get('runtimes-drift');
        const tier = byId.get('tier');
        const platform = byId.get('platforms-ci');
        const prebuilds = byId.get('prebuild-artifacts');
        const prebuildLibc = byId.get('prebuild-libc');
        const reachability = byId.get('runtimes-reachability');
        const alias = byId.get('curated-alias-routing');
        const headless = byId.get('headless');
        const portableScripts = byId.get('portable-scripts');
        const coverage = byId.get('field-coverage');
        const statusData = byId.get('status-data');
        // `platform-packages` is selected by CHECK_RULES, so its failures set the
        // exit code — but it was never fetched here, in EITHER branch, so its
        // findings were structurally unprintable and its summary printed on no
        // run. That is what made the 2026-08-01 `commit-prebuilds` outage cost six
        // main runs and ~41 hours: the gate said `DRIFT DETECTED.` and named
        // nothing, because the only rule that could fail was the one rule with no
        // print block. See the accountant at the end of this branch.
        const platformPackages = byId.get('platform-packages');
        const reach = reachability.reach;

        if (run.ok) {
            console.log(drift.summary);
            console.log(tier.summary);
            console.log(platform.summary);
            console.log(renderPrebuildSummary({ notes: prebuilds.notes ?? [], stats: prebuilds.stats }));
            console.log(renderPrebuildLibcSummary({ notes: prebuildLibc.notes ?? [], stats: prebuildLibc.stats }));
            console.log(reachability.summary);
            console.log(headless.summary);
            console.log(portableScripts.summary);
            console.log(coverage.summary);
            console.log(statusData.summary);
            console.log(platformPackages.summary);
            for (const note of coverage.notes ?? []) console.log(`  · ${note}`);
            renderReachabilityNotes(reach);
            process.exit(0);
        }

        console.error(`audit-runtimes --check${STRICT ? ' --strict' : ''}: DRIFT DETECTED.\n`);
        if (drift.missing.length > 0) {
            console.error(`Missing gjsify.runtimes declaration on ${drift.missing.length} package(s):`);
            for (const r of drift.missing) {
                console.error(`  - ${r.name ?? r.path}  (path: packages/${r.path})`);
                console.error(`      suggested: ${fmtTriplet(r.suggested)}`);
                console.error(`      reason:    ${summarizeSignals(r)}`);
            }
            console.error('');
        }
        if (drift.drifted.length > 0) {
            console.error(`Declared triplet drifts from source-code signals on ${drift.drifted.length} package(s):`);
            for (const { row: r, mismatches } of drift.drifted) {
                console.error(`  - ${r.name ?? r.path}  (path: packages/${r.path})`);
                console.error(`      declared:  ${fmtTriplet(r.declared)}`);
                console.error(`      suggested: ${fmtTriplet(r.suggested)}`);
                console.error(`      slots:     ${mismatches.join(', ')}`);
                console.error(`      reason:    ${summarizeSignals(r)}`);
            }
            console.error('');
        }
        if (drift.probeFailures.length > 0) {
            console.error(`FUNCTIONAL PROBE FAILURES on ${drift.probeFailures.length} package(s):`);
            for (const { row: r, failures } of drift.probeFailures) {
                console.error(`  - ${r.name ?? r.path}  (path: packages/${r.path})`);
                console.error(`      declared:  ${fmtTriplet(r.declared)}`);
                const lines = failures.map((f) => `${f.slot}-${declaredSlot(r, f.slot)}: ${f.kind} — ${f.detail}`);
                for (const line of lines) {
                    console.error(`      problem:   ${line}`);
                }
            }
            console.error('');
        }
        if ((tier.failures ?? []).length > 0) {
            console.error(
                `TIER-CONTRACT FAILURES (ADR 0003 / ADR 0005) on ${tier.failures.length} edge(s)/package(s):`,
            );
            for (const line of tier.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
        }
        if ((platform.failures ?? []).length > 0) {
            console.error(`PLATFORM-CONTRACT FAILURES (OS axis) on ${platform.failures.length} package(s)/target(s):`);
            for (const line of platform.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error('Current OS × native-package matrix (`node scripts/audit-runtimes.mjs --platforms`):');
            console.error(renderPlatformMatrix(platform.rows));
            console.error('');
        }
        if ((prebuilds.failures ?? []).length > 0) {
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
            console.error(renderPrebuildSummary({ notes: prebuilds.notes ?? [], stats: prebuilds.stats }));
            console.error('');
        }
        if ((prebuildLibc.failures ?? []).length > 0) {
            console.error(
                `PREBUILD-LIBC FAILURES (is the libc claim measured, or just written down?) on ${prebuildLibc.failures.length} finding(s):`,
            );
            for (const line of prebuildLibc.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                "Every committed Linux prebuild's libc flavour is read out of its DT_NEEDED list and its glibc floor out " +
                    'of SHT_GNU_verneed — `libc.so.6` IS the glibc marker (musl records `libc.musl-<arch>.so.1`), and an ' +
                    'artifact recording neither is libc-agnostic and must NOT declare `libc` at all. Fix by one of: ' +
                    '(a) set `libc` to what the binaries measure (`["glibc"]` when every committed Linux target needs it); ' +
                    '(b) raise the outgrown `gjsify.glibcRequires["<target>"]` entry — the dynamic linker enforces the ' +
                    "measured number, so a lower promise is one a host actually hits as `version 'GLIBC_x.y' not found`; " +
                    '(c) rename a directory that holds a musl build to `<os>-<arch>-musl` and declare that token. ' +
                    'A `.so` whose ELF could not be read is a FAILURE and never a pass: "records no libc.so.6" derived ' +
                    'from a file nobody parsed is the check claiming more than it did.',
            );
            console.error('');
            console.error(renderPrebuildLibcSummary({ notes: prebuildLibc.notes ?? [], stats: prebuildLibc.stats }));
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
        if ((alias.failures ?? []).length > 0) {
            console.error(`CURATED-ALIAS ROUTING FAILURES on ${alias.failures.length} alias entr(y|ies):`);
            for (const line of alias.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
        }
        if ((headless.failures ?? []).length > 0) {
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
        if ((portableScripts.failures ?? []).length > 0) {
            console.error(`UNPORTABLE PACKAGE SCRIPT(S) on ${portableScripts.failures.length} package(s):`);
            for (const line of portableScripts.failures) {
                console.error(`  - ${line.split('\n').join('\n    ')}`);
            }
            console.error('');
            console.error(
                'npm runs package scripts through cmd.exe on Windows, which has no `rm`/`cp`/`mkdir -p` and expands no ' +
                    'glob — so such a script cannot run there at all, while looking perfectly healthy on Linux and macOS. ' +
                    'Two portable replacements cover almost every case: `gjsify clear <paths…>` (recursive, and it ignores ' +
                    'a missing path, so the `|| exit 0` tail goes too — that tail also swallowed real permission errors) ' +
                    'and `gjsify copy <sources…> <dest>` (recursive, creates the destination, overwrites).',
            );
            console.error('');
        }
        if ((coverage.failures ?? []).length > 0) {
            console.error(`MANIFEST FIELD-COVERAGE FAILURES on ${coverage.failures.length} declaration kind(s):`);
            for (const line of coverage.failures) {
                console.error(`  - ${line.split('\n').join('\n    ')}`);
            }
            console.error('');
            console.error(
                'Every `gjsify.*` declaration kind must be governed by a registered rule, or explicitly deferred with a ' +
                    'reason in `scripts/manifest-conformance/unchecked-fields.mjs`. This is the guard that stops the next ' +
                    'declaration from shipping with nothing verifying it — the failure mode every other rule here was ' +
                    'written in reaction to.',
            );
            console.error('');
        }
        if ((statusData.failures ?? []).length > 0) {
            console.error(`STATUS-DATA FAILURES on ${statusData.failures.length} finding(s):`);
            for (const line of statusData.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'STATUS.md is GENERATED from the authored data under status/ plus the package manifests. Fix the ' +
                    'authored data (status/status.json, status/*.md, status/sections/*.md), then regenerate with ' +
                    '`node scripts/generate-status.mjs` and commit both. Never edit STATUS.md directly.',
            );
            console.error('');
        }
        if ((platformPackages.failures ?? []).length > 0) {
            console.error(`PLATFORM-PACKAGE FAILURES on ${platformPackages.failures.length} finding(s):`);
            for (const line of platformPackages.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'The per-target packages (ADR 0017) are GENERATED — both their `package.json` AND their ' +
                    '`README.md`. Re-emit with `node scripts/generate-platform-packages.mjs --write` and commit ' +
                    'the result; never hand-edit one. If the difference is a `libc` / `gjsify.glibcRequires` ' +
                    'field, a rebuild MEASURED a different floor: that is a declaration change and belongs in a ' +
                    'reviewed commit, not in a job that pushes under `[skip ci]`.',
            );
            console.error('');
        }
        for (const note of coverage.notes ?? []) console.error(`  · ${note}`);
        renderReachabilityNotes(reach);

        // THE ACCOUNTANT — a verdict may not be emitted without the findings that
        // caused it.
        //
        // Everything above is a HAND-WRITTEN list of rule ids while the verdict
        // comes from the AGGREGATE (`run.failures`, over every selected rule). A
        // rule missing from the list therefore fails in total silence, and one
        // was: `platform-packages`. Six main runs were spent on `DRIFT DETECTED.`
        // followed by nothing but informational notes.
        //
        // This closes the class rather than the instance: the set below is what
        // has a print block, and anything selected but absent from it gets dumped
        // verbatim. It can only ADD output to a run that is already failing, so it
        // can never turn a green run red. (Deriving the whole report from
        // `run.results` — which removes this list entirely — is the follow-up;
        // until then, adding an id here without a print block is a deliberate lie.)
        const REPORTED_RULE_IDS = new Set([
            'runtimes-drift',
            'tier',
            'platforms-ci',
            'prebuild-artifacts',
            'prebuild-libc',
            'runtimes-reachability',
            'curated-alias-routing',
            'headless',
            'portable-scripts',
            'field-coverage',
            'status-data',
            'platform-packages',
        ]);
        const unreported = run.results.filter(
            ({ rule, result }) => (result.failures ?? []).length > 0 && !REPORTED_RULE_IDS.has(rule.id),
        );
        if (unreported.length > 0) {
            console.error('');
            console.error('UNREPORTED FINDING(S) — this is a REPORTER bug, not a new drift:');
            for (const { rule, result } of unreported) {
                for (const line of result.failures) console.error(`  - [${rule.id}] ${line}`);
            }
            console.error('');
            console.error(
                'A rule was selected by CHECK_RULES but has no print block in scripts/audit-runtimes.mjs, so ' +
                    'it set the exit code without naming anything. Add its block next to the others — and add ' +
                    'its id to REPORTED_RULE_IDS only together with that block.',
            );
            console.error('');
        }

        console.error(
            "Either update the package's source-code signals (the GJS-binding shape changed) or update its package.json#gjsify.runtimes to match the new reality. See AGENTS.md `## Strategic direction — cross-runtime portability` for the slot model. For tier-contract failures see docs/adr/0003-package-tiering.md + docs/adr/0005-node-gi-scope.md. For reachability failures see docs/adr/0014-utils-core-subpath-and-platform-entry-routing.md. For headless-contract failures see docs/adr/0015-headless-package-contract.md.",
        );
        process.exit(1);
    }

    const rows = await rowsFor();
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
