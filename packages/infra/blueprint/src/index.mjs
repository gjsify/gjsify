// The one door into this package, and the whole of what is behind it.
//
// WHY A SURFACE EXISTS BEFORE THE FLIP DOES
//
// ADR 0053 clause 5 makes the in-repo parser authoritative and `blueprint-compiler` the
// oracle. The consumer of that flip is `@gjsify/vite-plugin-blueprint`, and until this file
// there was nothing for it to import: `exports` named the corpus and nothing else, so the
// only way to the implementation was a raw filesystem path plus a dynamic import — which is
// exactly how `scripts/check-blueprint-corpus.mjs` reached it, around the package boundary
// rather than through it. A boundary nothing crosses is a boundary nothing holds: moving a
// file, renaming an export or splitting a module broke a consumer that the package could not
// see, and `package.json` recorded none of it.
//
// WHAT IS HERE, AND WHY IT IS EXACTLY THIS
//
// One compile is `parseBlueprint` then `emitGtkBuilderXml`, and the emitter reaches
// introspection through five seams it does not implement (`EmitOptions`) — so the five
// answers from `resolve-ident.mjs` are part of the same job and not a second one. Plus
// `BlueprintSyntaxError`, because clause 3 makes the refusal the contract: a consumer that
// cannot tell a Blueprint syntax error from any other `Error` cannot report the line the
// parser went to the trouble of carrying.
//
// WHAT IS DELIBERATELY NOT HERE: `src/project.mjs`
//
// The `SharedNode` projection is ADR 0053 clause 1's SECOND exit, and a declared lossy one.
// Nothing outside this repository asks for it — its only caller is stage D of
// `scripts/check-blueprint-corpus.mjs`, one directory over — and it is not what makes the
// parser a build dependency. Exporting it would promise a shape whose whole point is that it
// drops things, to consumers that have not asked. It stays internal, and the gate keeps
// reaching it by path, which is also what lets that stage still say "the file is missing".
//
// WHY A BARREL AND NOT ONE SUBPATH PER MODULE
//
// Every export is a promise, and a subpath promises the FILE LAYOUT on top of the names:
// `./parser`, `./emit-xml` and `./resolve-ident` would make merging or splitting a module a
// breaking change for a consumer that only ever wanted eight names. One door promises the
// eight.
//
// There is no build step, and that is load-bearing: `tree-checks` installs the workspace and
// does NOT build it, so a surface behind a build is a surface the gate cannot run. The types
// travel beside the implementation in `index.d.mts`, the arrangement `ast.d.mts` § WHY A
// DECLARATION FILE AND NOT A `.ts` already argues for and `@gjsify/manifest-conformance`
// already ships.

export { BlueprintSyntaxError, parseBlueprint } from './parser.mjs';
export { emitGtkBuilderXml } from './emit-xml.mjs';
export {
    accessibilityElement,
    accessibilityValue,
    enumOrFlagsTypeOf,
    gtypeName,
    resolveIdent,
} from './resolve-ident.mjs';
