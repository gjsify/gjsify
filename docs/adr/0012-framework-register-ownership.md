# ADR 0012 — Global registration ownership for GTK/WebKit-backed DOM classes

- **Status:** Accepted (2026-07-26)
- **Scope:** `packages/framework/*` (`@gjsify/canvas2d`, `@gjsify/iframe`, and the
  rule for future bridges), `packages/dom/*`, `packages/web/*`,
  `packages/infra/resolve-npm` (`GJS_GLOBALS_MAP` + the alias layer), AGENTS.md
  (framework-package rule + the tree-shakeable-globals convention)

## Context

Two AGENTS.md invariants collide on `@gjsify/canvas2d` and `@gjsify/iframe`
(finding **E1** of [the 2026-07-11 code-quality audit](../reports/2026-07-11-code-quality-audit.md)):

- **Barrel rule / tree-shakeable-globals rule 1:** "`src/index.ts` zero top-level
  side effects. Any `globalThis.X=…`/`defineProperty(globalThis,…)` there =
  regression → move to `register.ts`."
- **Framework-package rule:** framework packages have "**No `/register`, no
  `globalThis.*` writes, no top-level side effects.** […] never register browser
  globals (Web/DOM pillars' job). A framework pkg needing a global imports
  `@gjsify/<web-or-dom-pkg>/register` explicitly."

Both packages violated both rules: their `src/index.ts` wrote to `globalThis` and
registered element/context factories at module load. Neither shipped a
`register.ts`, neither declared `sideEffects`, and none of the identifiers they
wrote were in `GJS_GLOBALS_MAP`.

Reading the second rule literally ("move it to the pillar that owns the global")
is impossible for two of the four registrations, and the audit's proposed fix
("move it to `src/register.ts`") is a literal violation of it. So the rule needs
a precise boundary rather than a per-package exemption. The concrete situation:

| Registration | Class implemented in | Pillar register that already owns it |
|---|---|---|
| `'2d'` context factory | `@gjsify/canvas2d-core` (DOM) | ✅ `@gjsify/dom-elements/register/canvas` |
| `CanvasRenderingContext2D` | `@gjsify/canvas2d-core` (DOM) | ✅ `@gjsify/dom-elements/register/canvas` |
| `ImageData` | `@gjsify/canvas2d-core` (DOM) | ❌ none |
| `Path2D` | `@gjsify/canvas2d-core` (DOM) | ❌ none |
| `'iframe'` element factory | `@gjsify/iframe` (framework) | ❌ none |
| `HTMLIFrameElement` | `@gjsify/iframe` (framework) | ❌ none |

Three facts drove the decision:

1. **The first two rows were a live duplicate.** `@gjsify/dom-elements/register/canvas`
   already installs `CanvasRenderingContext2D` and calls
   `HTMLCanvasElement.registerContextFactory('2d', …)`; `@gjsify/canvas2d/src/index.ts`
   did the same again with a byte-equivalent factory. A baseline build of
   `showcases/dom/canvas2d-fireworks` contains **two** `registerContextFactory('2d')`
   calls — the second silently replaces the first. That is exactly the class of bug
   the framework rule exists to prevent.
2. **`HTMLIFrameElement` cannot move to a pillar.** Its only implementation is a
   `WebKit.WebView` (`gi://WebKit?version=6.0`). WebKitGTK is an *optional* gjsify
   system dependency — `gjsify check` lists it under "Optional:", required only by
   `@gjsify/iframe` (guarded by `tests/e2e/cli-only/check-deps.mjs`). Hosting the
   class, or merely its registration, in `@gjsify/dom-elements` would make WebKitGTK
   mandatory for every `document` / `Image` / canvas consumer.
3. **`ImageData` / `Path2D` should not move to `@gjsify/canvas2d-core` either.**
   canvas2d-core declares `runtimes.browser: "native"` and ships a `globals.mjs`
   that *reads from* `globalThis` and re-exports the native values. Giving it a
   `register.ts` that *writes to* `globalThis` would put both halves of the
   `register.ts`-vs-`globals.mjs` contract in one package and muddy its
   deliberately headless charter ("NO GTK dependency — usable in worker-like
   contexts"). `@gjsify/canvas2d` is the GJS-only distribution of those classes
   (`node`/`browser`/`nativescript`: `"none"`), i.e. the only place where a GJS
   `globalThis` write is unambiguously correct.

Independently, the identifiers were invisible to `--globals auto`: `ImageData`,
`Path2D` and `HTMLIFrameElement` had no `GJS_GLOBALS_MAP` entry, so the *only*
way they ever reached `globalThis` was the barrel's import side effect. Moving the
side effect without mapping the identifiers would have silently dropped them —
rule 4 ("Globals map authoritative") and the "Missing entry → `--globals auto`
silently fails to inject" invariant.

## Decision

**Ownership, not pillar membership, decides where a global is registered.** The
framework rule is refined from "framework packages never register globals" to
three narrower rules:

1. **A framework package MUST NOT register a global a Web/DOM pillar register
   already owns.** It imports the pillar's *granular* register subpath from the
   module that needs it (never from `index.ts`). `@gjsify/canvas2d`'s
   `canvas2d-bridge.ts` — which calls `canvas.getContext('2d')` — imports
   `@gjsify/dom-elements/register/canvas`; the duplicate factory registration is
   deleted. This is the framework rule's own prescription ("a framework pkg
   needing a global imports `@gjsify/<web-or-dom-pkg>/register` explicitly")
   applied at the module that needs it, so it tree-shakes with the bridge.
2. **A framework package MAY ship a `/register` for — and only for — globals whose
   implementation it owns, or which it is the only GJS-slot distribution of, and
   which no Web/DOM pillar package can host without taking a GTK/WebKit dependency
   the pillar must not have.** Today that is exactly `HTMLIFrameElement` + the
   `'iframe'` element factory (`@gjsify/iframe/register`) and `ImageData` + `Path2D`
   (`@gjsify/canvas2d/register`).
3. **Whatever a framework `/register` writes is subject to the full
   tree-shakeable-globals convention** — `exports["./register"]`, a `sideEffects`
   array pinned to register-only, an entry in `GJS_GLOBALS_MAP`, the alias-layer
   mirror, an entry in `GJS_GI_BACKED_REGISTERS` when the register pulls a
   typelib, and a dedicated `register.spec.ts`. A framework `/register` is never a
   private back door; if it cannot be expressed in the globals map, it does not
   belong there.
4. **Rule 1's dependency import must survive the `--app node` alias layer.** A
   framework package's import of a pillar register is a hard functional
   dependency, not an opt-in global — so it must NOT be routed to `@gjsify/empty`
   on a reverse-bridge build. `setupForNode` therefore lifts the register
   emptying for ANY genuine GJS source (see Consequences), not only for builds
   that named explicit `--globals`.
5. **A framework bridge's `installGlobals()` and its `/register` install the same
   set.** `installGlobals()` is the explicit, unconditional imperative path;
   `/register` is the tree-shakeable one `--globals auto` injects. Moving a side
   effect out of `index.ts` must not shrink what `installGlobals()` does — if the
   barrel used to install something for free, the bridge method has to keep
   offering it.

Two deliberate non-decisions:

- **The new identifiers are NOT added to `GJS_GLOBALS_GROUPS.dom`.** That group is
  the coarse `--globals auto,dom` safety net; adding them would make every
  `auto,dom` build hard-require `@gjsify/canvas2d` / `@gjsify/iframe` to be
  installed, and for the latter WebKitGTK to be present. `--globals auto` injects
  them only when the identifier survives tree-shaking in the consumer's bundle.
- **No bare-specifier alias is added** (`ALIASES_WEB_FOR_GJS`). There is no bare
  `canvas2d` / `iframe` npm alias today and inventing one would hijack real npm
  package names. Only the `@gjsify/*`-qualified `/register` forms are mirrored,
  into `ALIASES_WEB_FOR_NODE` → `@gjsify/empty`.

## Consequences

- **A published contract changes.** `import { Canvas2DBridge } from '@gjsify/canvas2d'`
  and `import { IFrameBridge } from '@gjsify/iframe'` no longer install
  `globalThis.{ImageData,Path2D,HTMLIFrameElement}` as a side effect. In-repo
  consumers are unaffected (see below); an external consumer that relied on the
  implicit write gets it back automatically under the default `--globals auto`
  (the identifiers are now mapped), or explicitly via `import '@gjsify/<pkg>/register'`.
  Called out in the package READMEs and the website bridge docs.
- **`Canvas2DBridge` keeps working with `--globals none` and with an explicit
  allowlist.** Its `'2d'` factory dependency is now a real module import instead of
  an accident of auto-detection — strictly more robust than before.
- **One `registerContextFactory('2d')` call per bundle instead of two.**
- **Framework bridges become genuinely tree-shakeable.** A consumer importing only
  `Path2D` from `@gjsify/canvas2d` no longer pays for the GTK register chain.
- **Cost:** two framework packages now have a `/register`, which reads as an
  exception to a previously absolute rule. Mitigated by making the rule
  ownership-based and testable — rule 3 above means any such register is visible in
  `GJS_GLOBALS_MAP` and covered by a spec, so a future "just add a register here"
  cannot pass review silently.
- **`@gjsify/webgl` had the same untreated violation** (`src/ts/index.ts` wrote
  `globalThis.WebGLRenderingContext` / `WebGL2RenderingContext` at barrel load, no
  `register.ts`, neither identifier mapped). It falls under rule 2 of this ADR; it
  was left out of this change to keep the diff reviewable and because the
  `'webgl'`/`'webgl2'` factories register via a subclass override rather than the
  context-factory registry. **Resolved in a follow-up** under this same ADR:
  `@gjsify/webgl/register` now installs both constructors (guarded),
  `WebGLBridge.installGlobals()` installs them unconditionally per rule 5, and both
  identifiers are mapped in `GJS_GLOBALS_MAP` with a `GJS_GI_BACKED_REGISTERS` entry
  of `['GdkPixbuf', 'Gwebgl']` — Gtk/Gdk are NOT in that set, because the register's
  import chain is the two context classes only, not the `Gtk.GLArea` bridge.

## Implementation

1. `@gjsify/canvas2d`: `src/index.ts` → pure barrel; new `src/register.ts` (imports
   `@gjsify/dom-elements/register/canvas`, then guards + installs `ImageData` /
   `Path2D`); `src/canvas2d-bridge.ts` imports the DOM-pillar register it needs;
   `exports["./register"]` + `sideEffects`; `src/register.spec.ts` wired into
   `src/test.mts`.
2. `@gjsify/iframe`: `src/index.ts` → pure barrel; new `src/register.ts`
   (`Document.registerElementFactory('iframe', …)` + guarded
   `globalThis.HTMLIFrameElement`); `exports["./register"]` + `sideEffects`;
   `src/register.spec.ts` wired into `src/test.mts` (the
   `document.createElement('iframe')` case moves out of `index.spec.ts` per
   testing rule 7).
3. `packages/infra/resolve-npm`: `ImageData` / `Path2D` → `@gjsify/canvas2d/register`
   and `HTMLIFrameElement` → `@gjsify/iframe/register` in `GJS_GLOBALS_MAP`; both
   register paths in `GJS_GI_BACKED_REGISTERS`; both mirrored into
   `ALIASES_WEB_FOR_NODE` → `@gjsify/empty`.
4. Regenerate the register-globals closure map
   (`node packages/infra/cli/scripts/generate-register-closure.mjs`) so
   `--globals auto` expands the two new register paths in one pass instead of
   iterating (stale is fail-soft, not a correctness bug).
5. AGENTS.md: replace the framework-package "No `/register`" sentence with the
   three rules above; note the two exceptions in the framework package table.
6. `status/open-todos.md`: `@gjsify/webgl` barrel-purity follow-up.
