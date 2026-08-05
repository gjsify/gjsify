# Tree-shakeable globals — the `/register` subpath convention

> Detail for the root [AGENTS.md](../AGENTS.md) § Package convention.
> Applies to every package that installs a global.

## Tree-shakeable globals — `/register` subpath convention

Every pkg registering anything on `globalThis` MUST follow these rules.

1. **No side effects in `src/index.ts`.** Root = named exports only. Any top-level `globalThis.X=…`/`defineProperty(globalThis,…)` there = regression → move to `register.ts`.
2. **Side effects in `src/register.ts`**, importing from `./index.js`, idempotent (twice must not throw): function/class → `if (typeof globalThis.X === 'undefined') { (globalThis as any).X = X; }`; plain value (process, Buffer) → `if (!('X' in globalThis)) { Object.defineProperty(globalThis,'X',{value:X,writable:true,configurable:true}); }`; DOM constructors (GTK-only) → unconditional `defineGlobal`; streams → `isNativeStreamUsable(globalThis.X,'method')` before replacing.
3. **`package.json` subpaths + `sideEffects`:**
   ```jsonc
   "exports": {
     ".":                    { "default": "./lib/esm/index.js" },
     "./register":           { "types": "./lib/types/register.d.ts", "default": "./lib/esm/register.js" },
     "./register/<feature>": { "default": "./lib/esm/register/<feature>.js" }
     // "./globals": "./globals.mjs"  // optional native re-exports for Node
   },
   "sideEffects": ["./lib/esm/register.js","./lib/esm/register/*.js","./globals.mjs"]
   ```
   `sideEffects` pinned to register-only, and it MUST stay — never `false` on a register-providing package. `./register` catch-all keeps `types`; granular subpaths only need `default`.

   **`register.ts` vs `globals.mjs` — distinct patterns:** `register.ts` WRITES our GJS impl to globalThis (GJS; injected by `--globals auto`; aliased to `@gjsify/empty` on Node). `globals.mjs` READS globalThis and re-exports the native value (Node; the `ALIASES_WEB_FOR_NODE` alias target). Cross-platform `import { subtle } from 'webcrypto'` → GJS: our impl; Node: alias → `@gjsify/webcrypto/globals` re-exporting native `globalThis.crypto`.
4. **Globals map is authoritative.** Every identifier a register writes MUST map in `resolve-npm/lib/globals-map.mjs` → its bare `/register` subpath — a missing entry makes `--globals auto` silently fail to inject; pointing at the catch-all when a granular subpath exists pulls the whole register module into the bundle.
5. **Alias layer mirrors the map** in `resolve-npm/lib/index.mjs`: `ALIASES_WEB_FOR_GJS` (`<pkg>/register` → `@gjsify/<pkg>/register`), `ALIASES_WEB_FOR_NODE` (both forms → `@gjsify/empty`), `ALIASES_GENERAL_FOR_NODE` (non-web registers).
6. **Tests import `/register` explicitly** (`import 'fetch/register'`) — no implicit reliance on root imports. **Examples and application code must NOT import `/register` directly**: rely on `--globals auto` (the default). Explicit register imports pull the catch-all into the bundle instead of the granular subpaths actually used, AND paper over detection gaps — if auto misses a global, fix the detector or add `--globals auto,<extra>` to the build script; an explicit import hides the bug.
7. **Users rely on `--globals auto`** (§ Build); source-level `import '<pkg>/register'` remains supported + equivalent.
8. **Exception — intra-package class inheritance:** a root class extending a global constructor (`class TextLineStream extends TransformStream`) runs its class body at module load → `index.ts` may side-effect-import its OWN `/register`. Document in the file header. Current: `@gjsify/eventsource`.
9. **Granular subpaths.** Each register module in `src/register/<feature>.ts` (related identifiers share a file); catch-all `src/register.ts` re-exports via side-effect imports. When splitting: own file, `exports` entry, `sideEffects` glob coverage, catch-all import, globals-map → GRANULAR path, all three alias maps.
10. **Adding a new global — checklist:** implement → register file with rule-2 guard → catch-all → `exports`+`sideEffects` → granular globals-map entry → three alias maps → (new pkg) add to `@gjsify/{node,web}-polyfills` → `register.spec.ts` → website cli-reference Known identifiers → regenerate the register-globals closure map (`generate-register-closure.mjs`; stale = fail-soft, extra analysis passes).

**Invariant (permanent): `@gjsify/<pkg>/register[/<feature>]` MUST NEVER be externalized for `--app gjs`.** GJS's native ESM loader has no node_modules walker AND does not follow `package.json#exports` maps for bare specifiers — an externalized register subpath throws `Module not found` at runtime even with the file on disk. Enforced in `app/gjs.ts` via `createGjsExternalsPredicate`: `isRegisterSubpath(id)` short-circuits to force-inline BEFORE the user-external check, and register-subpath entries are filtered out of the exact-name `external` array. The predicate is applied through the shared `externalsPlugin` resolveId hook (`{ external: true }`) — NOT a function `external` option, because `@gjsify/rolldown-native` JSON-serializes options to the Rust core and silently DROPS function values; the resolveId form is honoured by both engines AND by the `--globals auto` analysis passes. Matching is by SHAPE (`*/register`, `*/register/<feature>`, resolved register disk path) so the carve-out scales with no allow-list. Verified by `auto-globals.spec.ts`. Until upstream GJS gains an exports-map-aware resolver, inlining is the only safe option.
