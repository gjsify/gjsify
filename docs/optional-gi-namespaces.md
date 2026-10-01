# Optional GI namespaces: how the artifact records them

Detail moved out of `packages/infra/rolldown-plugin-gjsify/AGENTS.md` and `packages/infra/cli/AGENTS.md`
(agent context budget, see [governance.md](governance.md) § Agent context budget). ADR 0087.

## Bundler side (`rolldown-plugin-gjsify`)

**Optional GI namespace — `gi://Ns?version=X&optional`** (ADR 0087, `plugins/gi-optional.ts`, gjs + node, composed `pre` ahead of the externals policy / ahead of `gjsGiNodePlugin`). The flag on the specifier declares the app can run without the typelib: the import resolves to a virtual module that loads the SAME namespace inside a try/catch and default-exports it or `undefined`, with one `console.warn` naming namespace, version, typelib search path and the GI message. The clean specifier stays literal in the bundle, so `ship/gi-namespaces.ts` reads it — a computed `optionalGi(...)` call would hide it (ADR 0024 § 6). An unflagged import keeps failing at load.
|`--app gjs` awaits `await import(<flag-free specifier>)` — a top-level await in the importing module (ADR 0085 clause 5's cost, same answer). `--app node` CANNOT use that arm and is not a documentation-only gap: `gjsGiNodePlugin`'s hard shim is a lazy `Proxy`, so `Ns === undefined` is never true there and the identical source degraded on gjs and threw at first member access on node. Its arm is therefore EAGER and SYNCHRONOUS (`require('@gjsify/node-gi/gi').requireGi(Ns, X)` in a `try`), which is the point — a flag whose promise is that the app can branch on the result must not make every importer async — and a missing node-gi itself lands in that catch and yields `undefined`. `browser`/`nativescript` are untouched: their `gi://` arm is the build-time `gi-renderer` table, where no typelib is absent at runtime.
|**The artifact records which namespaces are optional**: `globalThis[Symbol.for("gjsify.optionalGi")]?.("Ns", "X")` (`GI_OPTIONAL_MARKER`), emitted by BOTH shims and read by `@gjsify/cli`'s `scanGiRequirements` → `deriveDepends` → `Recommends:`/`RECOMMEND*`. A global CALL rather than a bare constant because it survives rolldown's minifier where a standalone string is dropped (measured); in the artifact rather than in a sidecar because `ship` reads the emitted file. The split is by MARKER, never by import SHAPE — an app's own unflagged `await import("gi://X")` stays a hard dependency, because moving it out of `Depends:` is the failure the whole chain exists to prevent. Unit `gi-optional.spec.ts`; e2e `tests/e2e/gi-optional`.

## Reader side (`@gjsify/cli`)

**The same reader answers HARD vs OPTIONAL, and it keys on a MARKER the bundler emits, never on the
import shape** (ADR 0087): `globalThis[Symbol.for("gjsify.optionalGi")]?.("Ns", "X")`, written by
both the gjs and the node optional shim, read by `scanGiRequirements` and carried into
`deriveDepends` → `Recommends:`/`RECOMMEND*`. Reading the shape instead would classify an
application's OWN unflagged `await import("gi://X")` as optional and move a package the host must
provide out of `Depends:` — this chain's whole purpose, failed from the other direction. Two
consequences for the packaging layer, both deliberate: an AppImage has no `Depends:` field, so the
split becomes WORDING ("the Notify-0.7 typelib (optional)"); and an unmapped OPTIONAL namespace does
not fail the build (it cannot — the app runs without it by declaration) but is reported, while the
HARD case stays fatal so the optional list is never a hatch that turns ADR 0024 § 6 off.
