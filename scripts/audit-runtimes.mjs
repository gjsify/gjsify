#!/usr/bin/env node
// The workspace manifest-conformance gate: the ENTRY POINT for the rule registry in
// `@gjsify/manifest-conformance` (`packages/infra/manifest-conformance/`). Rules
// register themselves, declare which manifest FIELDS they govern, and `field-coverage`
// fails the run on any `gjsify.*` declaration kind no rule claims — so a new
// declaration cannot be added without a check.
//
// WHAT LIVES WHERE. PORTABLE rules (`packages/infra/manifest-conformance/lib/rules/`)
// read only the manifest, files on disk and binaries, so they are correct in any npm
// package — hence a package rather than `scripts/`. REPO-SCOPED rules
// (`scripts/manifest-conformance/rules/` plus the three at the bottom of this file) know
// about THIS repository: its directory layout as an axis taxonomy, curated `@gjsify/*`
// package-name allowlists, `prebuilds.yml`'s matrix, `@gjsify/resolve-npm`'s alias
// table, `refs/` submodules. Correct here, actively misleading anywhere else.
//
// THE GATE STAYS A SCRIPT, NOT A CLI COMMAND. `.github/workflows/audit-runtimes.yml`
// runs on a bare ubuntu runner with `setup-node`, NO install and NO build, and this
// file is pure Node plus relative imports of unbuilt `lib/*.mjs`. A CLI route would
// need either a full `gjsify install` or a BUILT `dist/cli.gjs.mjs`, and the second
// reintroduces the staleness circularity `scripts/verify-committed-bundles.mjs` exists
// to break: a rule added in source but not rebuilt into the bundle silently does not
// run. #821 proved bundles do merge stale.
//
// The three checks still implemented here are the ones inseparable from the
// source-signal model: runtime-slot DRIFT, ADR-0014 cross-runtime REACHABILITY, and
// curated-alias routing.
//
// Usage — `node scripts/audit-runtimes.mjs` with:
//   (none)      human-readable table; `--json` / `--markdown` reformat it
//   --apply     write the SUGGESTED triplet into each package.json, ONLY where absent;
//               an existing `gjsify.runtimes` is never overwritten
//   --check     exit 1 on any drift from the signal-based suggestion, plus every other
//               selected rule (CI guard). Read-only.
//   --strict    with `--check`: also run the functional probes — `globals.mjs` parses
//               and each re-export is plausibly resolvable on-target, and a
//               `browser:"polyfill"` slot ships `src/test.browser.{mts,ts}`
//   --quick     suppress the probes even when `--strict` is passed (forward-compatible
//               opt-out for the eventual strict-by-default flip)
//   --platforms the OS × native-package matrix: which `<os>-<arch>` prebuild each
//               native package declares, ships and is built for in CI
//   --rules     list every registered rule, its scope and the fields it governs

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Local name for the ONE repo-relative path normalisation; the definition and the
// incidents behind it live in `toPosixPath`, never in a second copy here.
const toPosixRel = toPosixPath;
import { fileURLToPath } from 'node:url';

// Importing the barrel registers the portable rules; importing the repo-rule modules
// below registers theirs. Registration IS the wiring — there is no second list to keep
// in sync, which is the whole point.
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
    toPosixPath,
    selectRules,
    walkEntryGraph,
} from '../packages/infra/manifest-conformance/lib/index.mjs';
import { UNCHECKED_FIELDS } from './manifest-conformance/unchecked-fields.mjs';
import { platformRows, renderPlatformMatrix } from './manifest-conformance/rules/platforms-ci.mjs';
import './manifest-conformance/rules/tier.mjs';
import './manifest-conformance/rules/refs-pin.mjs';
import './manifest-conformance/rules/status-data.mjs';
import './manifest-conformance/rules/platform-packages.mjs';
import './manifest-conformance/rules/release-train.mjs';
import './manifest-conformance/rules/node-script-globals.mjs';
import './manifest-conformance/rules/pr-trigger-parity.mjs';
import './manifest-conformance/rules/workflow-rev-pin.mjs';
import './manifest-conformance/rules/stylesheet-font-families.mjs';
import './manifest-conformance/rules/bundler-plugins.mjs';

// Re-exported for `tests/e2e/prebuild-declaration-invariant`, which drives the prebuild
// invariant against SYNTHETIC packages: proving that a MISSING prebuild directory fails
// means removing one, and the e2e suites share a checkout.
export { auditPrebuildArtifacts, collectNativePackages, renderPrebuildSummary };

// `repoContext` is exported for `website/scripts/generate-platform-matrix.mjs`, which
// renders the platform matrix onto the Platform Support page. It needs THIS context —
// the `discoveryRoots` below are what keep `packages/{node-gi,napi}/*` in scope despite
// not being workspace members — and a second construction of it beside this one is how
// the website would come to tabulate a different population than the audit does.
export { repoContext };

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PACKAGES_DIR = resolve(ROOT, 'packages');

/** Recursively find every package.json under a root, returning [absDir]. */
const findPackages = (dir) => packagesUnder(dir);

const args = new Set(process.argv.slice(2));
const FORMAT = args.has('--json') ? 'json' : args.has('--markdown') ? 'markdown' : 'table';
const APPLY = args.has('--apply');
const CHECK = args.has('--check');
// `--quick` opts OUT of the functional probes: today by suppressing `--strict`, and
// after the eventual strict-by-default flip by pinning the current behaviour. Wiring the
// spelling now lets a caller stay green across that flip.
const QUICK = args.has('--quick');
/** Print only the OS × native-package matrix (the platform-support report). */
const PLATFORMS = args.has('--platforms');
// `--quick` wins on conflict, so the caller's opt-out intent is unambiguous. The flip to
// strict-by-default is gated on closing the remaining `src/test.browser.{mts,ts}` gaps.
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
        // The standard cross-runtime `@gjsify/unit` harness. On the design-identity
        // axis it is what distinguishes a headless behaviour CONTRACT from a design
        // ASSET package (see `suggestRuntimes`).
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
            // `partial` when the file declares that slot in a comment, or when its impl
            // throws ENOTSUP from MULTIPLE entry points (the dns/module/ws shape). ONE
            // throw does not downgrade an otherwise functional polyfill — that is the
            // process-browserify shape (`process.chdir`).
            const slotDeclaredPartial = /Slot[^.\n]*partial/i.test(txt);
            const enotsupHits = (txt.match(/code\s*[:=]\s*['"]ENOTSUP['"]/g) ?? []).length;
            signals.browser_src_is_partial = slotDeclaredPartial || enotsupHits >= 2;
            // A third shape neither state can express: a NAMED UNSUPPORTED STUB. The
            // module has no browser pendant at all (`child_process`, `net`, `tls`), so
            // `none` is its honest slot, and `src/browser.ts` exists only so the curated
            // alias can point at a named module that throws with a message instead of at
            // the anonymous `@gjsify/empty`. Without this the file's mere EXISTENCE reads
            // as a promotion to `polyfill` and the drift check fails a correct
            // declaration. Same `Slot: browser:"<slot>"` marker, so a file states its own
            // slot in ONE place.
            signals.browser_src_is_unsupported = /Slot[^.\n]*none/i.test(txt);
        } catch {
            // unreadable — treat as full polyfill (conservative for upgrade path)
        }
    }
    if (signals.has_globals_mjs) {
        try {
            const txt = await readFile(join(pkgDir, 'globals.mjs'), 'utf8');
            // Browser-safe iff the file ships actual exports AND none re-export from a
            // `node:` specifier — i.e. it routes through `globalThis.*` or otherwise
            // stays runtime-agnostic. An empty `export {};` file (the
            // `@gjsify/node-polyfills` meta-package shape) is NOT a delegation path.
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
        // TS/MTS only, and skip `*.gjs.spec.ts` — specs are allowed to exercise
        // GJS-only paths.
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
    // Path-based axis taxonomy (slot model: AGENTS.md § Runtime & platform model).
    // `packages/infra/*` and `packages/gjs/*` ship build tooling and GJS runtime
    // helpers, not user-facing polyfills, so they classify as 'infra'.
    const [pillar, subpath] = relativeDir.split('/');
    if (pillar === 'infra') return 'infra';
    if (pillar === 'gjs') return 'infra';
    if (pillar === 'node') return 'node-api';
    if (pillar === 'dom') return 'dom';
    if (pillar === 'framework') {
        // Only iframe is a platform bridge (WebKit.WebView); the rest is GJS-only
        // framework composition glue.
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
 * Node-API packages with NO meaningful browser pendant (POSIX fork, the V8 debugger
 * protocol, TTY readline, …), recognised by name. They get `browser: "none"` rather
 * than the empty-stub polyfill the heuristic would otherwise default to: shipping an
 * empty stub AS a polyfill is a false claim, and the honest slot says "no sensible
 * browser surface exists".
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
 * Node-API packages GJS-only by design — native Vala+C bridges behind a
 * `gi://Gjsify*` typelib. They keep `node:"none"` + `browser:"none"` even where the
 * scanner picks up a `.imports?.gi` guard: the prebuild IS the implementation, not a
 * polyfill, and there is no surface anywhere except GJS.
 */
const NODE_API_GJS_ONLY = new Set(['tls-native', 'sab-native', 'terminal-native', 'http2-native', 'http-soup-bridge']);

/**
 * EMPTY. The seam for a declared `node:"none"` package the heuristic would suggest
 * `polyfill` for and that only a dedicated change can lift; its last member,
 * `@gjsify/process`, now ships `src/browser.ts`, which the heuristic honours through
 * `has_browser_polyfill` instead.
 */
const NODE_API_LEGACY_NONE = new Set([]);

/**
 * Node-API packages whose Node-native value IS also a browser-native value (different
 * identity, same shape), so they get `browser: "native"`:
 *   - `url`        → `URL` / `URLSearchParams` global
 *   - `perf_hooks` → `performance` / `PerformanceObserver` global
 * Every other node-api package with a `globals.mjs` keeps `browser: "polyfill"`, because
 * there that file is a `node:<pkg>` re-export with no browser equivalent.
 */
const NODE_API_BROWSER_NATIVE = new Set(['url', 'perf_hooks']);

/**
 * Web-API packages that are GJS-bound AND have NO Node-native pendant — browser-only
 * Web APIs (AudioContext, RTCPeerConnection, XMLHttpRequest, Gamepad). A `globals.mjs`
 * here signals browser delegation only; the node slot stays `none` because there is no
 * `node:` equivalent to re-export.
 */
const WEB_API_NODE_NONE = new Set(['webaudio', 'webrtc', 'xmlhttprequest', 'gamepad']);

/**
 * Pure-TS Web-API packages with a `globals.mjs` AND a Node-native pendant stable enough
 * for `native` from Node 22 LTS on. The rest keep `polyfill` on Node, each for its own
 * reason: `CustomEvent` before Node 23 in dom-events, EventSource still experimental,
 * DOMParser absent on Node, navigator/Storage experimental.
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
    // Dynamic-only GJS binding: portable package, real impl on the GJS path, degraded
    // no-op fallback elsewhere — slot `partial`.
    const gjsDynamicOnly = !gjsBound && signals.dynamic_gi;

    // Infra ships the toolchain itself, so it is outside the triplet model entirely.
    if (axis === 'infra') return null;

    // GJS-only by construction. (A PURE-TS framework contract — no GJS-binding
    // signal at all, e.g. `@gjsify/stories` / `@gjsify/storybook-core` — may
    // legitimately opt the node/browser/nativescript slots INTO `polyfill` since
    // it runs unmodified on those runtimes; `diffDeclared` tolerates both the
    // conservative `none` suggested here and the opt-in `polyfill`.)
    if (axis === 'framework-gjs') return { gjs: 'polyfill', node: 'none', browser: 'none' };

    // Design-identity (adwaita-*) carries two shapes:
    //   - ASSET / component packages (`adwaita-{web,fonts,icons,storybook}`): GJS has
    //     Libadwaita natively, the browser gets our polyfill, Node has no UI. No
    //     cross-runtime test harness.
    //   - Headless behaviour CONTRACT (`adwaita-core`, ADR 0004): pure TS with the
    //     standard `src/test.mts` harness, the design-axis twin of the pure-TS framework
    //     contracts. It runs unmodified everywhere and the renderers depend on it at
    //     RUNTIME, so `none` slots would be false — and actively harmful on NS, where
    //     `none` aliases the package to `@gjsify/empty` inside consumer bundles. Suggest
    //     the conservative GJS-first triplet; `diffDeclared`'s pure-TS-contract tolerance
    //     accepts the all-`polyfill` opt-in.
    if (axis === 'design-identity') {
        if (!gjsBound && !signals.dynamic_gi && signals.has_test_entry) {
            return { gjs: 'polyfill', node: 'none', browser: 'none' };
        }
        return { gjs: 'none', node: 'none', browser: 'polyfill' };
    }

    // Platform-bridge: iframe wraps WebKit.WebView, so it is GJS-only — browser and Node
    // would each need a different bridge entirely.
    if (axis === 'platform-bridge') {
        return { gjs: 'polyfill', node: 'none', browser: 'none' };
    }

    // (A) GJS-bound — `polyfill` on GJS; the other slots turn on whether the package
    // ships a `globals.mjs` re-export pointing at the runtime's native equivalent, which
    // is the signal that a workable delegation path exists. Present → `native`, absent →
    // `none`. `@gjsify/websocket` is gjs-bound (Soup) and re-exports
    // `globalThis.WebSocket`, which Node 22+ and every modern browser have;
    // `@gjsify/webrtc-native` is gjs-bound with no `globals.mjs` and nothing to delegate
    // to.
    if (gjsBound) {
        // The browser does not need our impl, so DOM is `native` there even when the
        // implementation is GJS-bound.
        if (axis === 'dom') {
            return { gjs: 'polyfill', node: 'none', browser: 'native' };
        }
        // Web-API: a `globals.mjs` signals delegation on Node AND browser when the
        // runtime-native value exists on both (fetch, WebSocket). Where the value is
        // browser-only, the curated WEB_API_NODE_NONE set keeps node=`none`.
        if (axis === 'web-api' && signals.has_globals_mjs) {
            const nodeSlot = WEB_API_NODE_NONE.has(pkgSubpath) ? 'none' : 'native';
            return { gjs: 'polyfill', node: nodeSlot, browser: 'native' };
        }
        // Node-API gjs-bound, split by reason: a GJS-only native bridge is `none`/`none`;
        // a NODE_API_LEGACY_NONE package keeps its declaration; anything else (e.g.
        // `path` — guarded `imports?.gi` fallback, fine in a browser bundler) takes the
        // per-package WEB-style mapping.
        if (axis === 'node-api') {
            if (NODE_API_GJS_ONLY.has(pkgSubpath)) {
                return { gjs: 'polyfill', node: 'none', browser: 'none' };
            }
            if (NODE_API_LEGACY_NONE.has(pkgSubpath)) {
                return { gjs: 'polyfill', node: 'none', browser: 'none' };
            }
            // `gjs_imports_guard` only, with no static `gi://` / `@girs/*` value import /
            // legacy `imports.X`: pure-TS portable (path, perf_hooks, …).
            if (signals.gjs_imports_guard && !signals.girs_value && !signals.gi_url && !signals.imports_legacy) {
                const nativeMember = NODE_API_BROWSER_NATIVE.has(pkgSubpath);
                // A `globals.mjs` re-exporting the runtime-native value upgrades the node
                // slot to `native`, as for the gjs-bound default below. Without it,
                // `@gjsify/process` (guard + a `globalThis.process` globals.mjs) gets a
                // spurious `polyfill` suggestion that drifts from its honest `native`.
                const nodeSlot = nativeMember || signals.has_globals_mjs ? 'native' : 'polyfill';
                const browserSlot = nativeMember ? 'native' : 'polyfill';
                return { gjs: 'polyfill', node: nodeSlot, browser: browserSlot };
            }
        }
        const nativeSlot = signals.has_globals_mjs ? 'native' : 'none';
        // A dedicated `src/browser.ts` means a browser-specific impl exists alongside the
        // GJS-bound default; `browser_src_is_partial` separates a stub-shaped entry from a
        // full polyfill. A NAMED UNSUPPORTED STUB is NOT an upgrade — that entry exists
        // only so the curated alias can name a module instead of the anonymous
        // `@gjsify/empty`, and the module still has no browser pendant.
        let browserSlot = nativeSlot;
        if (signals.has_browser_polyfill && !signals.has_globals_mjs && !signals.browser_src_is_unsupported) {
            browserSlot = signals.browser_src_is_partial ? 'partial' : 'polyfill';
        }
        return { gjs: 'polyfill', node: nativeSlot, browser: browserSlot };
    }

    // (B) Pure-TS — portable on all three. `native` means "delegate via re-export", so a
    // Web-API surface with a same-named browser global gets it; where that is not certain,
    // `polyfill` leaves our impl as the fallback. A package using dynamic
    // `import('gi://X')` for graceful degradation drops its non-GJS slots to `partial`: it
    // loads everywhere but loses functionality off GJS.
    //
    // A node-api package whose `globals.mjs` is browser-safe (routes through
    // `globalThis.*`, no `node:*` specifiers) has a working `native` slot on Node AND
    // browser from that one file — the `console` / `timers` shape.
    const nonGjsSlot = gjsDynamicOnly ? 'partial' : 'polyfill';
    if (axis === 'web-api') {
        // Native on browser by definition. On Node, `native` needs BOTH a `globals.mjs`
        // re-export and membership of WEB_API_NODE_NATIVE — see that set for which
        // globals are not stable enough and why they keep `polyfill`.
        const nodeNativeEligible = WEB_API_NODE_NATIVE.has(pkgSubpath);
        const nodeSlot = gjsDynamicOnly
            ? 'partial'
            : signals.has_globals_mjs && nodeNativeEligible
              ? 'native'
              : 'polyfill';
        // Under `gjsDynamicOnly` the package degrades to a no-op without its GJS backend.
        // A `globals.mjs` naming a native browser value (gamepad → Gamepad/GamepadEvent)
        // upgrades the browser slot to `native`: the dynamic backend never loads in a
        // browser bundle anyway.
        const browserSlot = gjsDynamicOnly ? (signals.has_globals_mjs ? 'native' : 'partial') : 'native';
        return { gjs: 'polyfill', node: nodeSlot, browser: browserSlot };
    }
    if (axis === 'node-api') {
        // Native on Node by definition; the browser gets our polyfill unless `globals.mjs`
        // is browser-safe, in which case `native` there too. A `src/browser.ts` throwing
        // ENOTSUP from multiple entries (or self-declared partial) downgrades `polyfill` to
        // `partial` — the `@gjsify/https` shape: server throws, client goes via fetch.
        let browserSlot;
        if (NODE_API_NO_BROWSER_SENSE.has(pkgSubpath)) {
            // The `globals.mjs` these ship is Node-only (`export * from 'node:cluster'`),
            // so without the carve-out the per-axis heuristic suggests `polyfill` and
            // produces false-positive drift on every CI run against the honest
            // `browser:"none"` in package.json.
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
 * Derive a default `nativescript` slot from an already-suggested {gjs,node,browser}
 * triplet plus the source signals. A package may always override with an explicit
 * declaration; `'none'` is the conservative fallback, so NS reach is opted INTO.
 *
 * GJS-bound → `none`: GObject Introspection has no NS' V8 equivalent. DOM and
 * framework-gjs → `none`: NS has its own UI system and no DOM. A browser-native Web API
 * → `native`, since NS V8 ships fetch/URL/WebSocket/crypto and `--app nativescript`
 * routes through the `/globals` re-export. A portable pure-TS Node-API shape →
 * `polyfill`, except the server-only modules.
 */
function deriveNativescriptSlot(axis, suggested, signals, pkgSubpath) {
    if (!suggested) return null;
    if (signals.girs_value || signals.gi_url || signals.imports_legacy) return 'none';
    if (axis === 'dom' || axis === 'framework-gjs') return 'none';
    if (axis === 'web-api' && suggested.browser === 'native') return 'native';
    if (axis === 'node-api') {
        if (NODE_API_NO_BROWSER_SENSE.has(pkgSubpath)) return 'none';
        // Any browser slot at all implies a portable shape.
        if (suggested.browser === 'polyfill' || suggested.browser === 'partial' || suggested.browser === 'native')
            return 'polyfill';
    }
    return 'none';
}

// ─── Functional probes (opt-in via `--check --strict`) ─────────────────────
//
// Do the DECLARED slots have the mechanics they claim, on disk? Independent of the drift
// check, which only compares the declaration against the signal-based suggestion. Two
// probes:
//   - `globals-broken` (`native` on node/browser): `globals.mjs` exists, parses, and every
//     `export {…} from '<spec>'` source is a specifier the target resolves — Node
//     built-ins for `node`, the curated browser-native set for `browser`, plus
//     `@gjsify/<X>/globals` self-delegation either way. NO runtime evaluation: we run
//     inside Node and must not crash on a browser-only re-export.
//   - `no-browser-test` (`browser:"polyfill"`): a `src/test.browser.{mts,ts}` entry exists
//     so `tests/browser/`'s Playwright suite can validate the package against
//     Firefox/SpiderMonkey. NO build — too expensive for `--check`; the entry's existence
//     IS the contract.

import { BROWSER_NATIVE_IDENTS } from '../packages/infra/resolve-npm/lib/globals-map.mjs';
import { EXTERNALS_NODE } from '../packages/infra/resolve-npm/lib/index.mjs';

/**
 * Bare specifiers safe to re-export from a `globals.mjs` aimed at the browser. Every
 * identifier `BROWSER_NATIVE_IDENTS` declares browser-native is by definition one the
 * browser resolves when a `globals.mjs` writes `export { Foo } from 'Foo'` — the browser
 * mirror of Node's `export { default as X } from 'node:X'`. `@gjsify/<X>/globals`
 * self-delegation is recognised separately in `probeGlobalsExports`.
 */
const BROWSER_NATIVE_RE_EXPORTS = new Set(BROWSER_NATIVE_IDENTS);

/**
 * Statically extract every `export {…} from '<src>'` / `export * from '<src>'` specifier
 * from a `globals.mjs`. Regex, not a full ESM parser: the pattern either matches the
 * canonical re-export form or it does not, and `existsSync` + `readFile` already gate a
 * malformed file, so nothing passes silently.
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
        // `@gjsify/<X>/globals` self-delegation is fine on either target: the chain
        // terminates at a package that gets its own probe.
        if (spec.startsWith('@gjsify/') && spec.endsWith('/globals')) continue;
        if (target === 'node') {
            // Node built-ins: a `node:*` prefix, or a bare specifier in EXTERNALS_NODE,
            // which mirrors the `module.builtinModules` surface resolve-npm treats as
            // native on Node.
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
 * Existence only: the presence of `src/test.browser.{mts,ts}` is the contract between the
 * package and `tests/browser/`'s Playwright discovery. No build — `--app browser` is
 * prohibitively expensive for an audit script.
 */
async function probeBrowserBuildable(pkgDir) {
    // A browser test mirrors the package's standard `src/test.{mts,ts}` suite, so a package
    // shipping no standard test has nothing to derive one from and the probe does not
    // apply: dependency-only meta packages (no `src/` at all) and design-asset packages
    // (CSS / fonts / icons / Web Components, no `@gjsify/unit` harness). Without this,
    // strict-by-default would gate every CI run on test entries that cannot exist.
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
 * Probe one row. Only the DECLARED triplet selects probes — drift is `diffDeclared`'s
 * job — and a row with no declaration skips them, since the missing-declaration path
 * already surfaces that.
 *
 * @returns `{ slot, kind, detail }` failures (empty = ok).
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
// The probes above validate a slot's MECHANICS; they say nothing about what its code
// REACHES. `@gjsify/os` declared `browser: "polyfill"` while `src/index.ts` statically
// imported `@gjsify/utils`, whose `cli` / `getPathSeparator` helpers call
// `GLib.spawn_command_line_sync` / `GLib.get_current_dir`. Nothing failed at build time —
// the browser target's `gjsImportsEmptyPlugin` substitutes `{}` for `@girs/*` — so the
// leak surfaced as a `TypeError` the first time a consumer CALLED `os.cpus()`.
//
// The invariant: a package declaring `polyfill` for a target must not, on that target,
// resolve to code that reaches GLib/Gio — neither directly (`@girs/*` value import,
// `gi://`, bare `imports.*`) nor transitively through a `@gjsify/*` package declared
// `none` there. Part of EVERY `--check` rather than `--strict`, because it is
// declaration-driven and cheap (a static import scan), it passes on the current tree, and
// a guard that only runs in a mode CI does not use is not a guard.
//
//   1. `gjs-only-reach` — the target-resolved source of a `polyfill` slot binds GJS
//      directly, or imports a `@gjsify/*` package that is BOTH declared `none` for the
//      target AND itself hard-bound. On a `partial` slot the same finding is REPORTED:
//      `partial` promises only graceful degradation, and a structured failure inside a
//      GJS-only path IS that contract (`resolve-npm/lib/runtime-aliases.mjs`).
//
//      "Hard-bound" excludes the sanctioned degradation shape: `@gjsify/terminal-native`
//      reaches GJS only through a guarded `globalThis.imports?.gi` probe and exports
//      `null` elsewhere, so importing it from a `polyfill` slot is correct — the
//      distinction `GJS_IMPORTS_GUARD_RE` / `DYNAMIC_GI_RE` already encode.
//
//      FATAL ON `browser` + `nativescript` ONLY, because that is where the failure mode
//      is: there `gjsImportsEmptyPlugin` substitutes `{}` for `@girs/*` AND `gi://*`, so
//      a leak stays SILENT until a consumer calls the helper. On `--app node`,
//      `gjsGiNodePlugin` claims a `gi://` specifier first and rewrites it to `requireGi(…)`
//      against the EXTERNAL `@gjsify/node-gi`, so the same leak either resolves through
//      the supported axis-5 reverse bridge or fails LOUDLY at module load. A loud
//      load-time failure needs no static guard; `node` findings are printed, not enforced.
//   2. `platform-entry-unreachable` — `src/<target>.ts` exists but `exports` declares no
//      `./<target>` subpath, so nothing can route to it and a dead variant reads as
//      coverage that does not exist. FATAL.
//   3. `platform-entry-parity` — where a slot ROUTES to `src/<target>.ts` (`polyfill` +
//      declared subpath, ADR 0014), that entry must re-export every VALUE export of the
//      root or the routed bundle dies with MISSING_EXPORT. FATAL. Type-only exports are
//      unaffected: the `types` condition still points at the root `.d.ts`.
//   4. `curated-alias-routing` — a curated alias in `ALIASES_NODE_FOR_BROWSER` may not
//      resolve to the ROOT of a package shipping a `./browser` entry. FATAL; rationale at
//      `auditCuratedAliasRouting`.
//   5. `globals-entry-parity` — the `native` mirror of check 3: a `native` slot routes the
//      package ROOT to `@gjsify/<X>/globals`, so `globals.mjs` must carry every VALUE
//      export of the root. REPORTED, not fatal — see `nativeGlobalsGap` for why, and for
//      which part of the gap a `globals.mjs` cannot close at all.
//
// Exported-but-unrouted platform entries are printed on every run. Check 3 gates the
// `partial` → `polyfill` promotion but is NECESSARY, NOT SUFFICIENT: several entries pass
// parity and stay un-promotable because a named export is unavailable on the browser
// platform itself. A green parity check is permission to look, not a mandate to promote —
// a routed entry must also have no unconditionally throwing value export.

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
 * The `gjsify` metadata this audit needs, keyed by package name. Separate from
 * `buildReport`'s rows because the reachability audit must look up the slot of an
 * IMPORTED package, and of an imported SUBPATH — not only of the one being scanned.
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
        // `hardGjs` reuses the drift check's signal vocabulary: hard-bound iff a `@girs/*`
        // VALUE import, a `gi://` import, or an UNGUARDED `imports.*` read. A package
        // whose only GJS contact is the guarded `globalThis.imports?.gi` probe or a
        // dynamic `await import('gi://…')` is a degradation bridge — it exports
        // null/false off GJS and is safe to import from any slot.
        const sig = await scanSourceTree(pkgDir);
        const hardGjs =
            sig.girs_value || sig.gi_url || (sig.imports_legacy && !sig.gjs_imports_guard && !sig.dynamic_gi);
        byName.set(pkgJson.name, {
            name: pkgJson.name,
            pkgDir,
            rel: toPosixRel(relative(PACKAGES_DIR, pkgDir)),
            runtimes: pkgJson.gjsify?.runtimes ?? null,
            subpaths: pkgJson.gjsify?.runtimeSubpaths ?? {},
            // The headless audit needs the export TARGETS, not just the keys: it has to
            // find the source behind `exports["."]` and follow a workspace import into
            // the subpath it actually resolves to.
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
 * A subpath import resolves against the imported package's `gjsify.runtimeSubpaths` map
 * first — that is how a GJS-runtime package exposes a genuinely cross-runtime slice
 * (`@gjsify/utils/core`) without the whole package claiming a slot it cannot keep. An
 * undeclared subpath falls back to the package-level slot, the conservative reading.
 *
 * @returns {{slot:string|undefined, via:string}|null} `null` when the specifier is not a
 *          workspace `@gjsify/*` package (nothing to say).
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
 * @param {Awaited<ReturnType<typeof collectReachMeta>>} meta — collected ONCE by the
 *        caller and shared with the headless audit: `collectReachMeta` runs
 *        `scanSourceTree` over every package, the bulk of what `--check` costs, and both
 *        want the same answer.
 * @returns {Promise<{failures:string[], warnings:string[], unrouted:string[],
 *                    aliasFailures:string[], checked:number}>}
 */
async function auditReachability(meta) {
    const aliasFailures = await auditCuratedAliasRouting(meta);
    const failures = [];
    const warnings = [];
    const unrouted = [];
    /** @type {Map<string, {name:string, targets:string[], missing:string[]}>} */
    const globalsGaps = new Map();
    /** `native` slots whose globals.mjs star-re-exports a runtime module (not enumerable). */
    const globalsStarExports = new Set();
    let checked = 0;

    for (const rec of [...meta.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
        const srcDir = join(rec.pkgDir, 'src');
        if (!rec.runtimes || !existsSync(srcDir)) continue;

        for (const target of REACH_TARGETS) {
            const slot = rec.runtimes[target];
            // Check 5 — the `native` mirror of `platform-entry-parity`.
            if (slot === 'native') {
                const missing = await nativeGlobalsGap(rec, srcDir);
                if (missing === 'star') globalsStarExports.add(rec.name);
                else if (missing !== null) {
                    const seen = globalsGaps.get(rec.name);
                    if (seen) seen.targets.push(target);
                    else globalsGaps.set(rec.name, { name: rec.name, targets: [target], missing });
                }
                continue;
            }
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
                // A `none` slot alone is not a leak — it also covers the degradation
                // bridges that export null off GJS. Only a HARD binding reaches GLib/Gio.
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
    return {
        failures,
        warnings,
        unrouted,
        aliasFailures,
        checked,
        globalsGaps: [...globalsGaps.values()],
        globalsStarExports: [...globalsStarExports].sort(),
    };
}

/**
 * Check 5 — `globals-entry-parity`, the `native` mirror of `platform-entry-parity`.
 *
 * A `native` slot routes the package ROOT to `@gjsify/<X>/globals` (§ Slot routing) just
 * as `polyfill` + a declared subpath routes it to `src/<target>.ts`, so the same
 * invariant holds: a name the root entry exports and `globals.mjs` does not is a
 * `MISSING_EXPORT` the moment a consumer imports it on that target. It went unnoticed
 * until a build of `@gjsify/gamepad`'s OWN README example died with `"hasGamepadBackend"
 * is not exported by "packages/web/gamepad/globals.mjs"` — because the `globals-broken`
 * probe validates only the `export … from '<spec>'` SOURCES a file names, and a
 * hand-written `export const X = globalThis.X` file names none and passes vacuously.
 *
 * REPORTED, not fatal: over half the comparable `native`-slot packages are narrower
 * today, so making it fatal is a cross-cutting rewrite (AGENTS.md exception (c): Plan +
 * user confirm + split PRs). Part of the gap is not closable in a `globals.mjs` at ALL —
 * no `globals.mjs` in the tree imports its own package body, so a name with no
 * runtime-native source needs a platform entry rather than a re-export. Tracked in
 * `status/open-todos.md`.
 *
 * @returns {Promise<string[]|null>} the missing value exports, or `null` when the slot
 *          does not route here / there is nothing to compare.
 */
async function nativeGlobalsGap(rec, srcDir) {
    if (!rec.exportKeys.has('./globals')) return null;
    const globalsFile = join(rec.pkgDir, 'globals.mjs');
    const rootEntry = join(srcDir, 'index.ts');
    if (!existsSync(globalsFile) || !existsSync(rootEntry)) return null;
    const globalsSrc = await readFile(globalsFile, 'utf8');
    // A star re-export from a NON-relative specifier is not statically enumerable and must
    // not be read as a gap. `@gjsify/util`'s `export * from 'node:util'` surfaces the
    // runtime's ENTIRE surface, so every root name it "does not name" is in fact present —
    // `tests/e2e/runtimes-routing` proves it by importing `format`/`inspect` through that
    // very file. Counting those packages as findings was the first version of this check
    // crying wolf. The skip is COUNTED and printed rather than silent.
    //
    // Residual blind spot, stated rather than hidden: a `globals.mjs` that stars a runtime
    // module AND has a root export that module does not carry is skipped too, so its real
    // gap is invisible here. Closing it means asking the runtime for the star target's
    // export set — runtime EVALUATION, which this audit must not do (it would crash on a
    // browser-only re-export). Recorded in `status/open-todos.md`.
    if (/^export\s*\*\s*from\s*['"](?!\.)/m.test(globalsSrc)) return 'star';
    const rootExports = await collectValueExports(rootEntry);
    const globalsExports = await collectValueExports(globalsFile);
    const missing = [...rootExports].filter((e) => !globalsExports.has(e)).sort();
    return missing.length > 0 ? missing : null;
}

// ─── Curated-alias routing (the `partial`-slot crash gap) ───────────────────
//
// `withDerivedSlotRouting` rewrites a curated alias VALUE only when the target package's
// slot is `polyfill` (ADR 0014), so a `partial` package keeps whatever the curated table
// names. If that is the package ROOT, the bundler gets the GJS body with `@girs/*`
// replaced by `{}` — the silent `GLib.Checksum is not a constructor` failure, i.e.
// `partial` means "crashes at first use" rather than "degrades at call time". Not a
// weaker promise: a false one.
//
// Invariant: no curated bare-specifier alias may resolve to the ROOT of a package that
// ships a `./<target>` platform entry. Either the slot is `polyfill` and the derived
// layer rewrites it, or the curated value names the subpath explicitly. FATAL.
//
// `browser` only, because it is the one target whose curated table is composed through
// `withDerivedSlotRouting` — composing the NS table is blocked on the `native`-slot
// vocabulary decision, so auditing it here would report a gap with no fix available.

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
 * The reachability audit's informational sections: `partial` slots that reach GJS-only
 * code, and platform entries that exist and are exported but that no slot routes to. Both
 * are non-fatal and both must stay VISIBLE on every run — a dead platform variant nobody
 * prints is how `src/browser.ts` sat unrouted for a whole release cycle while reading as
 * browser coverage.
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
    if ((reach.globalsGaps ?? []).length > 0) {
        const names = reach.globalsGaps.reduce((n, g) => n + g.missing.length, 0);
        console.error(
            `\nreachability notes — ${reach.globalsGaps.length} \`native\` slot package(s) whose globals.mjs is NARROWER than the root entry (${names} export(s); globals-entry-parity, reported not enforced):`,
        );
        console.error(
            '  A `native` slot routes the package ROOT to `@gjsify/<X>/globals`, so each name below is a MISSING_EXPORT the moment a consumer imports it on that target — the invariant `platform-entry-parity` already enforces for `polyfill`. See `nativeGlobalsGap` for why this is reported rather than fatal, and which part of the gap a `globals.mjs` cannot close at all.',
        );
        for (const g of reach.globalsGaps) {
            const shown = g.missing.slice(0, 12).join(', ');
            const rest = g.missing.length > 12 ? ` … (+${g.missing.length - 12})` : '';
            console.error(`  · ${g.name} (${g.targets.join(', ')}) — ${g.missing.length}: ${shown}${rest}`);
        }
        if ((reach.globalsStarExports ?? []).length > 0) {
            console.error(
                `  (${reach.globalsStarExports.length} further package(s) NOT compared: their globals.mjs star-re-exports a runtime module — ` +
                    `${reach.globalsStarExports.slice(0, 6).join(', ')}${reach.globalsStarExports.length > 6 ? ', …' : ''} — which surfaces the whole runtime surface and is not statically enumerable.)`,
            );
        }
    }
}

async function buildReport() {
    const pkgDirs = await findPackages(PACKAGES_DIR);
    const rows = [];
    for (const pkgDir of pkgDirs) {
        const pkgJsonPath = join(pkgDir, 'package.json');
        const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
        // Per-target platform packages (ADR 0017) carry a binary and no JavaScript. The
        // quadruplet describes an API surface's cross-runtime reach, and a package with no
        // source has none — yet the path-based classifier would happily suggest one from
        // the pillar directory alone, a suggestion nothing can satisfy and a declaration
        // that would be false whichever way it was written. Skipped on the manifest's own
        // signature, the same predicate `status-data` and `platforms-ci` use, so the three
        // cannot disagree about what a data package is.
        if (isPlatformPackageManifest(pkgJson)) continue;
        const rel = toPosixRel(relative(PACKAGES_DIR, pkgDir));
        const signals = await scanSourceTree(pkgDir);
        const axis = classifyAxis(rel, pkgJson.name ?? '');
        const subpath = rel.split('/')[1] ?? '';
        const suggested = suggestRuntimes(axis, signals, subpath);
        if (suggested) {
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
 * Compare declared vs suggested triplets. Infra / unknown axes (`suggested === null`) are
 * skipped — the script has nothing to say about them. A row with a suggestion and no
 * declaration is flagged too: a new package landed without declaring its triplet.
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
        // A pure-TS contract (no `.imports?.gi` guard, none of the hard GJS-binding
        // signals) is platform-agnostic: it runs unmodified on Node, the browser and NS'
        // V8, resolving to its real `lib/esm/index.js`. So it may opt the node / browser /
        // nativescript slots INTO `"polyfill"` even though the conservative heuristic
        // suggests `none` — both readings are honest and neither is drift. The GJS slot
        // stays enforced, and GJS-bound packages get no tolerance at all. Two axes carry
        // the shape: framework-gjs (the all-polyfill contracts the GTK/browser/NS
        // renderers share) and design-identity (ADR 0004's headless widget behaviour),
        // the latter recognised by the `src/test.mts` harness the design-ASSET packages
        // never ship.
        const isPureTsContract =
            (r.axis === 'framework-gjs' || (r.axis === 'design-identity' && r.signals.has_test_entry)) &&
            !r.signals.gjs_imports_guard &&
            !r.signals.girs_value &&
            !r.signals.gi_url &&
            !r.signals.imports_legacy &&
            !r.signals.dynamic_gi;
        const portableContractSlot = (s) => s === 'node' || s === 'browser' || s === 'nativescript';
        const mismatches = slots.filter((s) => {
            // The 4th slot is OPTIONAL: packages that declared their triplet before NS was
            // an axis are backfilled opportunistically, so an undeclared `nativescript`
            // makes the suggestion a hint rather than a target.
            if (s === 'nativescript' && r.declared[s] === undefined) return false;
            // Pure-TS contract: `none` and `polyfill` are both valid on the portable slots
            // (see above), so neither drifts.
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
// These three stay in this file because they are inseparable from the source-signal model
// above, and all three are REPO-SCOPED for one reason: they compare a declaration not to a
// fact but to a re-derivation built out of THIS repository — path-based axis
// classification, the curated `@gjsify/*` package-name allowlists, and
// `@gjsify/resolve-npm`'s own alias tables. Against somebody else's package that
// derivation does not degrade, it lies.
//
// Registering them lets `field-coverage` see that `gjsify.runtimes` and
// `gjsify.runtimeSubpaths` have owners, and that a future declaration kind cannot be added
// without one.

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
 * `package-outputs` and `refs-pin` are REGISTERED so `field-coverage` sees the fields
 * they govern, but deliberately NOT selected: `package-outputs` is a POST-condition on a
 * built tree and this job does no install and no build, and `refs-pin` needs initialised
 * `refs/` submodules and runs per-package inside `build:meson`. Selecting a rule that
 * cannot pass here would make the gate noise; leaving it unregistered would hide its
 * fields from coverage. Registration and selection are separate on purpose.
 */
const CHECK_RULES = [
    'runtimes-drift',
    'tier',
    'platforms-ci',
    'prebuild-artifacts',
    // Reads COMMITTED binaries out of the tree, so no install and no build — and the libc
    // flavour and glibc floor come out of the ELF headers, which is why one x86-64 runner
    // can answer for every architecture.
    'prebuild-libc',
    'platform-packages',
    'runtimes-reachability',
    'curated-alias-routing',
    'headless',
    // Reads only `scripts` out of each manifest. It belongs in THIS job rather than a
    // Windows leg precisely because the defect it guards is invisible on Linux: a script
    // shelling out to `rm`/`cp` runs fine here and cannot run at all under cmd.exe.
    'portable-scripts',
    // ADR 0018. It does not TEST any operating system — it holds the DECLARATION about all
    // three, which is exactly the half a single-OS runner can be trusted with.
    'os-axis',
    'storybook',
    // There is no iOS CI anywhere in this repo, so "does the declared platform have an
    // implementation at all" is the only half of that promise any machine here can hold.
    'nativescript-platforms',
    // Reads only `license` + `files` out of each manifest, so it needs no build and no
    // payload on disk: the payload it asks about is gitignored and produced on a runner,
    // and `files` is what says the tarball will carry it. Added the day three published
    // packages were found declaring `"license": "MIT"` over 37-45 relocated LGPL/MPL/GPL
    // libraries — the notice files were already correct, and the one machine-readable
    // field was not.
    'bundled-license',
    // Guards the apps EXCLUDED from `workspaces` — the set no other check can see.
    'release-train',
    // Reads `.github/workflows/*.yml` and nothing else, so it needs no install and no
    // build. It belongs in the job that runs on EVERY PR, because the thing it guards is
    // a workflow that does not run on a PR: put it anywhere path-filtered and the check
    // for post-merge-only coverage would itself be post-merge-only.
    'pr-trigger-parity',
    // Reads one workflow `env:` and this checkout's `.git/index` — two FILES a bare
    // `actions/checkout` already leaves behind, with no `git` binary and no initialised
    // submodules involved. So unlike `refs-pin`, this half of the `refs/` contract can be
    // held on every PR, which is where it has to be: the drift it found arrived inside a
    // submodule SWEEP, touching no file this workflow builds. The binary-free reading is
    // load-bearing, not tidiness — `windows-suites.yml` runs this same `--check` with
    // `\Git\` stripped from PATH, and the first draft's `git ls-files` died there.
    'workflow-rev-pin',
    // Reads `files` and the `.css`/`.scss` a published package ships — committed sources,
    // no install and no build (a generated stylesheet is inspected too when a build left
    // one behind, and its SCSS carries the same declarations either way). It belongs on
    // every PR because the claim it holds is invisible in a rendering: a GNOME runner
    // resolves 'Adwaita Sans'/'Adwaita Mono' from fontconfig, so a screenshot looks right
    // over a tree that ships neither.
    'stylesheet-font-families',
    // Reads only `gjsify.bundler.plugins` + the three dependency maps out of each
    // manifest, then resolves each name from the DECLARING package. No build, no install
    // beyond the one this job already has.
    'bundler-plugins',
    // Reads only `repository` out of each manifest, so no install and no build. It
    // belongs on every PR: npm renders the "Repository" link (and `npm repo <pkg>`) from
    // `repository.url` + `repository.directory`, every package here shares one `url`, and
    // a missing or wrong `directory` still resolves — to the tree root or to a sibling
    // package — which is a defect nobody reports because the link looks fine.
    'repository-directory',
    'field-coverage',
    'status-data',
];

/** Build the context every rule reads. */
function repoContext() {
    return createContext({
        root: ROOT,
        // `packages/node-gi/*` and `packages/napi/*` are deliberately NOT workspace
        // members, yet `@gjsify/napi` declares `gjsify.platforms` +
        // `gjsify.platformsUncommitted` and is audited. Scanning the subtree keeps them in
        // scope; narrowing to the `workspaces` globs would drop that coverage silently.
        discoveryRoots: ['packages'],
        extra: {
            fieldCoverage: 'enforce',
            uncheckedFields: UNCHECKED_FIELDS,
            // No `prebuildGirGaps` here, and that is a state rather than an omission: the
            // ledger module this injected drained to zero once every `.gir` arrived through
            // `commit-prebuilds`, and an empty ledger is a corpse by this repo's own rule,
            // so it was deleted. `prebuild-artifacts` still ACCEPTS the option — recreating
            // a ledger module and importing it here is the whole of the work if a directory
            // ever again ships without its `.gir` and cannot be restaged.
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
        // `matrixRows`, not `rows`: the per-target platform packages (ADR 0017) are
        // audited but not TABULATED (see `creditPlatformPackages`). `--json` takes the
        // same set, so the machine-readable form and the table cannot describe different
        // populations.
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
        // The headless walk needs the metadata the reachability walk builds, and building
        // it runs `scanSourceTree` over every package — the bulk of what `--check` costs.
        // Collect ONCE, hand it to both.
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
        const osAxis = byId.get('os-axis');
        const storybook = byId.get('storybook');
        const nativescriptPlatforms = byId.get('nativescript-platforms');
        const releaseTrain = byId.get('release-train');
        const coverage = byId.get('field-coverage');
        const statusData = byId.get('status-data');
        // Selected by CHECK_RULES, so its failures set the exit code — and once it was
        // never fetched here in EITHER branch, making its findings structurally
        // unprintable. That is what made the 2026-08-01 `commit-prebuilds` outage cost six
        // main runs and ~41 hours: the gate said `DRIFT DETECTED.` and named nothing. See
        // the accountant at the end of this branch.
        const platformPackages = byId.get('platform-packages');
        const prTriggerParity = byId.get('pr-trigger-parity');
        // Fetched in the same breath as the rule was added, because the two omissions
        // recorded on either side of this line are what a selected-but-unfetched rule costs:
        // it passes silently and reports only through the accountant, which mislabels it.
        // Only HALF that lesson took the first time: the summary below was wired up and the
        // FAILURE block was not, so the accountant caught the rule's very first finding and
        // announced it as a REPORTER bug. Fetching a rule here is not the contract — having
        // a print block in BOTH branches is.
        const workflowRevPin = byId.get('workflow-rev-pin');
        // Same omission as `platform-packages` above, found while adding the rule beside
        // it: selected by CHECK_RULES since #1208 and fetched in NEITHER branch, so it
        // printed no summary when it passed and reached a reader only through the
        // accountant — which labels its findings a REPORTER bug rather than a licence
        // drift. Being caught by the safety net is not the same as being reported.
        const bundledLicense = byId.get('bundled-license');
        const stylesheetFontFamilies = byId.get('stylesheet-font-families');
        // Fetched AND printed in both branches in the same edit — the two comments above
        // are what the other order cost twice.
        const bundlerPlugins = byId.get('bundler-plugins');
        const repositoryDirectory = byId.get('repository-directory');
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
            console.log(osAxis.summary);
            console.log(storybook.summary);
            console.log(nativescriptPlatforms.summary);
            console.log(releaseTrain.summary);
            console.log(bundledLicense.summary);
            console.log(stylesheetFontFamilies.summary);
            console.log(bundlerPlugins.summary);
            console.log(repositoryDirectory.summary);
            console.log(prTriggerParity.summary);
            console.log(workflowRevPin.summary);
            console.log(coverage.summary);
            console.log(statusData.summary);
            console.log(platformPackages.summary);
            // EVERY rule's notes, derived from the run rather than listed here.
            //
            // Printed on a PASSING run and not only a failing one: a note is what a
            // rule says when it could not answer, and that has to reach a reader or
            // the green line above overstates the coverage. Two rules paid for this
            // already. `os-axis` records a claim below `supported`, whose mandatory
            // reason only does its job if somebody reads it. `bundler-plugins` needs
            // the plugin built and this job builds nothing, so in CI every plugin
            // produces a "not checked" note, and dropping it turned "declared, export
            // unverified" into a clean green line, a missing signal reading as a pass
            // inside the guard written to remove that class.
            //
            // Both were fixed by adding a hand-written loop per rule, which is why
            // the third rule to grow notes (`stylesheet-font-families`, whose subject
            // only exists on a machine that has built) would have been silent again.
            // Derived beats curated here: a rule that starts emitting notes cannot be
            // forgotten.
            //
            // `prebuild-artifacts` and `prebuild-libc` are excluded because their own
            // renderers already lay their notes out above.
            const NOTES_RENDERED_ELSEWHERE = new Set(['prebuild-artifacts', 'prebuild-libc']);
            for (const { rule, result } of run.results) {
                if (NOTES_RENDERED_ELSEWHERE.has(rule.id)) continue;
                for (const note of result.notes ?? []) console.log(`  · [${rule.id}] ${note}`);
            }
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
        if ((osAxis.failures ?? []).length > 0) {
            console.error(`OS-AXIS FAILURES (ADR 0018) on ${osAxis.failures.length} package(s):`);
            for (const line of osAxis.failures) {
                console.error(`  - ${line.split('\n').join('\n    ')}`);
            }
            console.error('');
            console.error(
                'Linux, macOS and Windows are a project goal, so a package that BRANCHES on the operating system owes a ' +
                    'declared claim about all three. `gjsify.platforms` cannot answer this — it promises a prebuilt ' +
                    'ARTIFACT per `<os>-<arch>` target, so a package with no native build has nothing to declare in it — ' +
                    'and the runtime axis is blind to operating systems ON PURPOSE. That blindness is measured, not ' +
                    'theoretical: the whole native-bridge set stayed Linux-only while the project described itself as ' +
                    'platform-independent. Declare `gjsify.os` with all three keys; anything below `supported` states its ' +
                    'reason in `gjsify.osNotes.<os>`, and that reason is printed on every run.',
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
        if ((storybook.failures ?? []).length > 0) {
            console.error(`STORYBOOK-DECLARATION FAILURES on ${storybook.failures.length} package(s):`);
            for (const line of storybook.failures) {
                console.error(`  - ${line.split('\n').join('\n    ')}`);
            }
            console.error('');
            console.error(
                '`gjsify.storybook.stories` is the directory `gjsify storybook` globs for `*.story.{ts,js,mts,mjs}` ' +
                    '(default `src`). A path that does not exist, or holds no story, produces an empty storybook at ' +
                    'RUN time — and nothing in CI runs the command reliably (the only job that does is path-filtered, ' +
                    'so it is advisory). Fix by pointing `stories` at the directory that actually holds them, or by ' +
                    'dropping the declaration if the package no longer ships stories.',
            );
            console.error('');
        }
        if ((nativescriptPlatforms.failures ?? []).length > 0) {
            console.error(
                `NATIVESCRIPT-PLATFORM FAILURES on ${nativescriptPlatforms.failures.length} declaration(s)/module(s):`,
            );
            for (const line of nativescriptPlatforms.failures) {
                console.error(`  - ${line.split('\n').join('\n    ')}`);
            }
            console.error('');
            console.error(
                'A `gjsify.nativescriptPlatforms` entry promises that every platform-resolved module has a variant for ' +
                    'that platform. There is no iOS CI anywhere in this repo, so "does the declared platform have an ' +
                    'implementation at all" is the only half any machine here can hold — and it is the half that fails ' +
                    'SILENTLY: the NS build resolves `foo.<platform>.ts` before `foo.ts`, so a missing variant falls ' +
                    'back to the base module and renders nothing, with no crash and no warning (icons.ios.ts, for the ' +
                    'whole life of the declaration). Fix by adding the variant, or by narrowing the declared list.',
            );
            console.error('');
        }
        if ((releaseTrain.failures ?? []).length > 0) {
            console.error(`RELEASE-TRAIN FAILURES (ADR 0008) on ${releaseTrain.failures.length} dependency range(s):`);
            for (const line of releaseTrain.failures) {
                console.error(`  - ${line.split('\n').join('\n    ')}`);
            }
            console.error('');
            console.error(
                'The apps EXCLUDED from `workspaces` (the NativeScript ones, under `showcases/` and ' +
                    '`tests/integration/`) resolve their ' +
                    '`@gjsify/*` deps through npm, not through the workspace, so their ranges are the one place a ' +
                    'stale version survives unnoticed — nothing installs them in CI and `gjsify upgrade --check` ' +
                    'never sees them. Fix by naming the current workspace version in every range; during a RELEASE ' +
                    'that is done for you by `scripts/bump-release-train-ranges.mjs` in the `after:bump` hook, so a ' +
                    'finding here on a bumped tree means that hook did not run or did not reach these files.',
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
        if ((bundledLicense.failures ?? []).length > 0) {
            console.error(`BUNDLED-LICENCE FAILURES on ${bundledLicense.failures.length} finding(s):`);
            for (const line of bundledLicense.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'A `@gjsify/gtk-runtime-*` tarball carries relocated third-party libraries, so its manifest may not ' +
                    'declare a bare SPDX id: `license` must point at the notice file the builder emitted ' +
                    '(`SEE LICENSE IN gtk/THIRD-PARTY-NOTICES.md`), and `files` must carry it. Both are produced by ' +
                    'the bundle build — re-run it rather than hand-editing the field a scanner reads.',
            );
            console.error('');
        }
        if ((stylesheetFontFamilies.failures ?? []).length > 0) {
            console.error(`STYLESHEET-FONT-FAMILY FAILURES on ${stylesheetFontFamilies.failures.length} finding(s):`);
            for (const line of stylesheetFontFamilies.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'A shipped stylesheet heads a font stack with a family the package itself does not carry. Ship the face ' +
                    '(a `@font-face` whose `src:` targets are in `files`, or a `data:` URI) or record the reason in ' +
                    'status/stylesheet-font-families.json. Naming a system-installed family is often the RIGHT call — ' +
                    'what is never right is nobody knowing which of the two it is.',
            );
            console.error('');
        }
        if ((bundlerPlugins.failures ?? []).length > 0) {
            console.error(`BUNDLER-PLUGIN FAILURES on ${bundlerPlugins.failures.length} finding(s):`);
            for (const line of bundlerPlugins.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'A package names a build plugin it does not depend on, or names an export the plugin does not have. ' +
                    'The first resolves here only because the workspace hoists it and fails for every consumer that ' +
                    'installs from npm; the second fails on the first build. Declare the plugin in the package that ' +
                    'configures it.',
            );
            console.error('');
        }
        if ((prTriggerParity.failures ?? []).length > 0) {
            console.error(`PR-TRIGGER-PARITY FAILURES on ${prTriggerParity.failures.length} finding(s):`);
            for (const line of prTriggerParity.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'A workflow that runs after the merge but not before it makes "all checks passed" exclude something ' +
                    'without saying so. The principle and the three workflows already split PR-side for it are in ' +
                    'docs/ci-selective.md § PR coverage parity; ADR 0018 records why the OS legs were the last holdouts ' +
                    'and what re-measuring their cost found.',
            );
            console.error('');
        }
        if ((workflowRevPin.failures ?? []).length > 0) {
            console.error(`WORKFLOW-REV-PIN FAILURES on ${workflowRevPin.failures.length} finding(s):`);
            for (const line of workflowRevPin.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                'A workflow `env:` that hard-codes an upstream revision and the matching `refs/` gitlink are two ' +
                    'names for ONE commit, and each environment reads only one of them: CI reads the env, a ' +
                    'maintainer regenerating goldens reads the gitlink. Point both at the same sha in the SAME ' +
                    'change, and regenerate whatever the old revision produced. The pairings are declared in ' +
                    '`WORKFLOW_REV_PINS` (scripts/manifest-conformance/rules/workflow-rev-pin.mjs) — dropping one is ' +
                    'a legitimate answer, but it has to be an edit to that table that says what reads the revision ' +
                    'instead, never a rename that lets the check pass by finding nothing.',
            );
            console.error('');
        }
        if ((repositoryDirectory.failures ?? []).length > 0) {
            console.error(`REPOSITORY-DIRECTORY FAILURES on ${repositoryDirectory.failures.length} finding(s):`);
            for (const line of repositoryDirectory.failures) {
                console.error(`  - ${line}`);
            }
            console.error('');
            console.error(
                "Every non-private package shares this monorepo's `repository.url`, so `directory` is the only " +
                    'part of the field that says WHICH package a reader ends up on. Absent, npm\'s "Repository" link ' +
                    'and `npm repo <pkg>` land on the tree root; present but wrong, they land on a different ' +
                    "package — both look like working links. Set `repository.directory` to the package's own " +
                    'repo-relative path.',
            );
            console.error('');
        }
        for (const note of bundlerPlugins.notes ?? []) console.error(`  · ${note}`);
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
            'os-axis',
            // All three were selected by CHECK_RULES with no print block, so all
            // three could set the exit code while naming nothing — the same
            // defect as `platform-packages` above, times three. `release-train`
            // is the one that was actually hit: it fired inside the v0.32.0
            // `after:bump` hook and the accountant below is the only reason its
            // 11 findings were visible at all.
            'storybook',
            'nativescript-platforms',
            'release-train',
            'field-coverage',
            'status-data',
            'platform-packages',
            'bundled-license',
            'pr-trigger-parity',
            'workflow-rev-pin',
            'stylesheet-font-families',
            'bundler-plugins',
            'repository-directory',
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
            "Either update the package's source-code signals (the GJS-binding shape changed) or update its package.json#gjsify.runtimes to match the new reality. See AGENTS.md `### The axes` for the slot model and docs/runtime-platform-axes.md for its enforcement. For tier-contract failures see docs/adr/0003-package-tiering.md + docs/adr/0005-node-gi-scope.md. For reachability failures see docs/adr/0014-utils-core-subpath-and-platform-entry-routing.md. For headless-contract failures see docs/adr/0015-headless-package-contract.md.",
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
