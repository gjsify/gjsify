# 87. An optional GI namespace is declared on the import: `gi://Ns?version=X&optional`

- Status: **Accepted** (amended 2026-10-01 — hard/optional split in packaging, and the
  `--app node` arm; both clauses below carry what changed)
- Date: 2026-10-01
- Deciders: Pascal Garber
- Related: [ADR 0085](0085-gi-namespaces-are-acquired-after-the-prologue.md) (where `gi://`
  namespaces are acquired), [ADR 0021](0021-launcher-free-prebuild-resolution.md),
  [ADR 0024 § 6](0024-ship-installable-artifacts.md) (`gi://` specifiers → typelib packages),
  `packages/infra/rolldown-plugin-gjsify/src/plugins/gi-optional.ts`,
  `packages/infra/cli/src/utils/ship/gi-namespaces.ts` (which namespaces are optional),
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
6. **Both GJS-shaped targets carry the flag; the other two do not.**
   - **`--app gjs`**: `await import(<same specifier>)` inside a `try`, as above.
   - **`--app node`**: `require('@gjsify/node-gi/gi').requireGi(<Ns>, <X>)` inside a `try`,
     SYNCHRONOUSLY, default-exporting the namespace or `undefined` with the same one warn.
     The original draft excluded node on the grounds that `gjsGiNodePlugin` "already makes
     the namespace lazy". That reason was correct about the mechanism and wrong about the
     consequence: the hard node shim default-exports a `Proxy` that resolves on first member
     access, so `Ns === undefined` is never true there and the app's degrade branch could not
     run — the identical source degraded on gjs and threw at the first real access on node.
     A flag whose promise is "the app decides" cannot hold on one target only. Lazy loading is
     therefore NOT the answer on node, and eager-in-a-`try` is: the load is synchronous
     (`require`, not `import()`) precisely so the flag does not force every importer to be
     async. A missing `@gjsify/node-gi` itself lands in the same catch and yields `undefined`,
     which is honest — without node-gi no GI namespace loads, optional or not.
     The `&optional` arm is composed AHEAD of `gjsGiNodePlugin` on `resolveId` order; both
     match a flagged specifier and the optional one has to win.
   - **`--app browser` / `--app nativescript`**: untouched. Their `gi://` arm is
     `gi-renderer.ts` (ADR 0034 stage 9), a build-time namespace-to-renderer table that
     refuses an unanswered namespace by name; there is no typelib to be absent at runtime, so
     there is nothing for the flag to mean.
7. **The artifact records which namespaces are optional, in a statement the bundler emits.**
   `globalThis[Symbol.for("gjsify.optionalGi")]?.("<Ns>", "<X>")`, one per flagged import, in
   BOTH shims.
   - **In the artifact, not beside it.** `ship` reads the emitted file, and the stage manifest
     when it packs on another host — so a sidecar is a second source that can be stale, absent,
     or a different file. The marker is part of the module body the plugin already emits, on
     the same principle as clause 3.
   - **A global call, not a bare constant.** Measured on rolldown's own minifier: an unknown
     global call is not statically pure and survives minification and tree-shaking, where a
     standalone string constant is dropped. `?.()` means a host that registers nothing under the
     key pays nothing, which is every host today.
   - **The key is `Symbol.for`-scoped and matched by the reader**, so an application's own
     `globalThis[Symbol.for("…")]?.(…)` cannot be mistaken for one — the same asymmetry
     `gi-namespaces.ts` already applies to a foreign `requireGi`, where over-approximating
     fails the build.
8. **The split is by MARKER, not by import SHAPE.** An app may write
   `await import("gi://Soup?version=3.0")` itself with no flag, and that must stay a HARD
   dependency: classifying a dynamic import as optional would move a package the host must
   provide out of `Depends:`, which is the exact failure this chain exists to prevent, reached
   from the other direction.
9. **The cost is a top-level await in the importing module on `--app gjs`**, the same cost ADR
   0085 clause 5 names, and the same answer: GTK apps run via `runAsync`. `--app node` pays
   nothing here (clause 6's arm is synchronous).

## Consequences

- An app can write `import Goa from 'gi://Goa?version=1.0&optional'`, get `undefined` on a host
  without it, and let its own `check()` say so — on gjs AND on node, from the same source.
- **The namespace is still reported as a dependency; the package field is what changes.**
  `deriveDepends` returns `{ requires, recommends, unmappedOptional }`: an optional namespace
  lands in `Recommends:` (deb) / `RECOMMENDNAME` (rpm), never `Depends:` / `Requires:`. In
  `Depends:` it would mean apt REFUSES to install the package on a host without the typelib, so
  the integration the author declared optional would decide whether the app exists on the
  machine. The rpm tag numbers are 5046/5047/5048 — measured against a package `rpmbuild`
  produced and read back with rpm 6.0.2, in their OWN index space, NOT the 1099/1046/1047 of
  the pre-4.19 layout.
- **An AppImage has no `Depends:` field, so the split becomes WORDING**: "the Notify-0.7
  typelib (optional)" against "the Gtk-4.0 typelib". Load-bearing rather than cosmetic — a user
  told a typelib is required and lacking it concludes the image is broken; told it is optional,
  they skip it and the app degrades as written.
- **An unmapped optional namespace does NOT fail the build.** An unmapped HARD one still does
  (ADR 0024 § 6), because a package with a silent dependency dies on the user's machine after
  the download. An unmapped OPTIONAL one cannot: the app runs without the typelib by
  declaration, so there is nothing to be wrong about — it is reported as a warning naming the
  namespace and the `gjsify.ship.typelibPackages` row to add. The asymmetry is the decision,
  and the hard case stays fatal so the optional list can never become a hatch that turns the
  check off.
- `gjsify ship --verbose` prints the three lists separately (`gi namespaces`, `gi optional
  namespaces`, `gi required namespaces`), and the optional set travels in the stage manifest so
  a `--from-stage` pack on another host derives the same split. That field is OPTIONAL on read:
  a stage written before the split has none, and "everything is hard" is today's behaviour and
  the safe direction — over-declaring rather than dropping a requirement the artifact cannot
  run without. Hence no `STAGE_SCHEMA_VERSION` bump.
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

`gi-optional.ts` plugin (+ unit `gi-optional.spec.ts`), composed in `app/gjs.ts` AND
`app/node.ts` (clause 6), e2e `tests/e2e/gi-optional`.

Packaging side: `utils/ship/gi-namespaces.ts` gained `scanGiRequirements` (the union plus the
marked-optional subset; `scanGiNamespaces` is now the union half of it, so every existing caller
keeps its answer), `utils/ship/depends.ts` gained the `{ requires, recommends, unmappedOptional }`
return shape, `deb.ts` writes `Recommends:`, `rpm.ts` writes the `RECOMMEND*` trio,
`appimage.ts` words the optional half, `stage-manifest.ts` carries the subset, `commands/ship.ts`
reports the unmapped optionals and prints the split.

Left open: #1898 (dynamic-import laziness in the emitted artifacts — the audit-runtimes work,
tracked separately from this slice).
