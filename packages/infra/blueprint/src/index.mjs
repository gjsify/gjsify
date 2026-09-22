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
// answers from `resolve-ident.mjs` are part of the same job and not a second one. Plus BOTH
// error classes, because clause 3 makes the refusal the contract: a consumer that cannot tell
// a Blueprint refusal from any other `Error` cannot report the file and line the two exits went
// to the trouble of carrying. Two classes and not one, because the parse half has a column and
// the emit half has no such thing to give.
//
// THE SECOND EXIT IS HERE NOW, AND THE REASON IT WAS NOT IS WHY IT IS
//
// `projectToSharedNode` was deliberately absent, and the argument was recorded here:
//
//   > The `SharedNode` projection is ADR 0053 clause 1's SECOND exit, and a declared lossy
//   > one. Nothing outside this repository asks for it — its only caller is stage D of
//   > `scripts/check-blueprint-corpus.mjs`, one directory over — and it is not what makes the
//   > parser a build dependency. Exporting it would promise a shape whose whole point is that
//   > it drops things, to consumers that have not asked.
//
// Both halves of that have since been paid off, and neither was refuted — a justification
// goes stale with its technique, and one left standing beside the thing it no longer
// describes is read as a decision nobody has revisited.
//
// A CONSUMER EXISTS. `@gjsify/vite-plugin-blueprint` serves `<file>.blp?shared-tree`, the
// exit the non-GTK app targets read; that import is how a `.blp` reaches `adwaita-web`'s
// `mountSharedTree` and the NativeScript port's `build`. The gate's dynamic import by path
// remains, and on purpose — stage D must still be able to say "the file is missing", which a
// specifier resolved through `exports` cannot report.
//
// AND THE DROPPING IS NO LONGER SILENT. The objection was never to the shape but to handing
// out a lossy one unannounced. `SharedNodeProjection` carries `lost` beside `node`, and the
// plugin refuses a `.blp` whose projection lost anything rather than emitting a tree that is
// whole on GTK and quietly partial everywhere else. A consumer that asks for this exit gets
// the tree or the list of what it would have cost — never half a template.
//
// WHY A BARREL AND NOT ONE SUBPATH PER MODULE
//
// Every export is a promise, and a subpath promises the FILE LAYOUT on top of the names:
// `./parser`, `./emit-xml` and `./resolve-ident` would make merging or splitting a module a
// breaking change for a consumer that only ever wanted the names. One door promises them —
// and the move of `BlueprintSyntaxError` out of `parser.mjs` and into `errors.mjs`,
// which this barrel absorbed without a consumer noticing, is the property being bought.
//
// There is no build step, and that is load-bearing: `tree-checks` installs the workspace and
// does NOT build it, so a surface behind a build is a surface the gate cannot run. The types
// travel beside the implementation in `index.d.mts`, the arrangement `ast.d.mts` § WHY A
// DECLARATION FILE AND NOT A `.ts` already argues for and `@gjsify/manifest-conformance`
// already ships.

export { BlueprintEmitError, BlueprintSyntaxError } from './errors.mjs';
export { parseBlueprint } from './parser.mjs';
export { emitGtkBuilderXml } from './emit-xml.mjs';
export { projectToSharedNode } from './project.mjs';
export {
    accessibilityElement,
    accessibilityValue,
    enumOrFlagsTypeOf,
    gtypeName,
    propertyGType,
    resolveIdent,
} from './resolve-ident.mjs';
