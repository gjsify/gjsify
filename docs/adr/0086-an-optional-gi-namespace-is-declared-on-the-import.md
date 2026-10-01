# 86. An optional GI namespace is declared on the import: `gi://Ns?version=X&optional`

- Status: **Accepted**
- Date: 2026-10-01
- Deciders: Pascal Garber
- Related: [ADR 0085](0085-gi-namespaces-are-acquired-after-the-prologue.md) (where `gi://`
  namespaces are acquired), [ADR 0021](0021-launcher-free-prebuild-resolution.md),
  [ADR 0024 § 6](0024-ship-installable-artifacts.md) (`gi://` specifiers → typelib packages),
  `packages/infra/rolldown-plugin-gjsify/src/plugins/gi-optional.ts`,
  `packages/gjs/utils/src/native-library.ts` (`loadOptionalNativeModule`), #1931, #1892

## Context

A `--app gjs` bundle that imports `gi://Goa?version=1.0` cannot start on a host without that
typelib: GJS loads the typelib when the specifier is evaluated, the import rejects, and the
module graph dies before the app decides anything. ADR 0085 fixes the *installed but
unloadable* class (ordering). It leaves the *absent* class untouched, and that is what a
consumer with a legitimate "run without it" path (a mail client with no Evolution, a headless
CI leg, macOS without `libgoa`) cannot express.

gjsify already has the shape for its own prebuilds — `loadOptionalNativeModule` returns a module
or `null` plus an error — but a system namespace has no equivalent, and `gi://` is a hard,
static edge.

Measured (gjs 1.88, linux): `await import('gi://Goa?version=9.9')` rejects with
`Requiring Goa, version 9.9: Typelib file for namespace 'Goa', version '9.9' not found`, and the
rejection is catchable. The bundler keeps a `gi://` external's `import()` as a real dynamic
import, so a guarded import needs no new loader mechanism.

## Decision

**A `gi://` import is declared optional by the `optional` query flag on its specifier.**

```ts
import Goa from 'gi://Goa?version=1.0&optional';
if (Goa === undefined) { /* degrade */ }
```

1. **The declaration lives on the import**, next to the version pin that already lives there.
   It is typed-portable (`@girs/*` and editors see an ordinary `gi://` specifier with a query),
   needs no side config that can drift from the code, and is greppable.
2. **The bundler claims the flagged specifier** (`gjsify-gi-optional`, `resolveId` `pre`, `--app
   gjs` only) and resolves it to a virtual module that runs `await import(<same specifier
   without the flag>)` in a `try`/`catch`. Its default export is the namespace, or `undefined`.
3. **The clean specifier survives verbatim in the emitted bundle**, so
   `ship/gi-namespaces.ts` and `depends.ts` keep reading the artifact they read today
   (ADR 0085 § 3).
4. **The failure is diagnosed, not swallowed**: one `console.warn` naming the namespace, the
   version, girepository's typelib search path and the underlying GI message — enough to tell
   "not installed" from "installed but unloadable" without a debugger.
5. **An unflagged `gi://` import keeps today's behaviour.** Optional is opt-in per import; a
   hard dependency stays hard and fails at load, as before.
6. **`--app node` and the other targets are not touched.** On node, `gjsGiNodePlugin` already
   makes the namespace lazy (resolved on first access); the flag is rejected nowhere but also
   not given meaning there yet.
7. **The cost is a top-level await in the importing module**, the same cost ADR 0085 clause 5
   names, and the same answer: GTK apps run via `runAsync`.

## Consequences

- An app can write `import Goa from 'gi://Goa?version=1.0&optional'`, get `undefined` on a host
  without it, and let its own `check()` say so.
- Reporting is split honestly: the scanner still lists an optional namespace as a dependency
  (it is imported). Distinguishing hard from optional typelibs in the derived package
  `depends` (Recommends vs Depends) is follow-up work, not done here.
- A namespace can still be present with a library that fails to open at first member access;
  that class stays with `loadOptionalNativeModule` / `probeNativeLibrary`.

## Alternatives considered

- **A `gjsify.optionalGi` list in `package.json`.** Rejected: a second place that must agree
  with the import, invisible at the use site.
- **`await optionalGi('Goa', '1.0')` runtime helper (the issue's spelling).** Rejected as the
  primary form: a computed specifier hides the namespace from `scanGiNamespaces()`, the exact
  defect ADR 0024 § 6 records. The query flag keeps a literal specifier.
- **Wait for #1892 (dynamic-import laziness).** The laziness here comes from the emitted
  binding, not from the bundler leaving the import alone; the two are not competing fixes.

## Implementation

`gi-optional.ts` plugin (+ unit `gi-optional.spec.ts`), composed in `app/gjs.ts`, e2e
`tests/e2e/gi-optional`. Left open: hard-vs-optional split in `depends.ts`, and #1898.
