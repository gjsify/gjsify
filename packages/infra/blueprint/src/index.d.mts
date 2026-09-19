/**
 * Hand-written declarations for the surface `index.mjs` exports.
 *
 * The implementation is plain ESM with NO build step — `ast.d.mts` § WHY A DECLARATION FILE
 * AND NOT A `.ts` says why, and `@gjsify/manifest-conformance` ships the same arrangement for
 * the same reason. The cost is this file, kept in sync by hand; what keeps the cost honest is
 * that the VALUES are proven elsewhere: `scripts/check-blueprint-corpus.mjs` imports this
 * package by specifier and names any of the nine that stops being a function, on every run.
 *
 * `ast.d.mts` carries the AST and nothing about what it MEANS. The seams below are the other
 * half: what a bare identifier means, which element an ARIA entry becomes, what GType name a
 * type spells. That split is deliberate and stated there — do not move the seams into it.
 *
 * EVERY type the AST can hold is re-exported, and that is not tidiness. A consumer narrowing a
 * `Value` or an `Expression` has to be able to NAME the arm it handles; one missing re-export
 * and it writes the arm as a structural literal that stops matching the day the node grows a
 * field.
 *
 * WHY A WILDCARD AND NOT THE LIST OF 34
 *
 * The list was here, complete, and complete is not the property that matters — STAYING complete
 * is, and nothing could hold it. TypeScript has no `keyof` over a module's TYPE exports, so
 * `surface.conformance.mts` cannot assert it and only a script diffing two files could; a
 * comment saying "add it here too" is discipline, and discipline is not a check. `export type *`
 * removes the question instead of answering it: a type added to `ast.d.mts` is reachable here
 * the moment it exists, and there is no second list to fall behind.
 *
 * The cost is that `ast.d.mts` becomes public in full, and it is the right file for that — its
 * own header is explicit that it holds the syntax and NOTHING about what any of it means. A
 * helper type added there would ship; a helper type does not belong there. What the wildcard
 * does NOT cover is an arm written INLINE into a union rather than as a named interface: it has
 * nothing to re-export and a consumer cannot name it. That is what the union assertions in
 * `surface.conformance.mts` hold, which is why both exist.
 */

import type { BlueprintFile, SourceLocation, TypeRef } from './ast.mjs';

export type * from './ast.mjs';

export { BlueprintEmitError, BlueprintSyntaxError } from './ast.mjs';

/**
 * How the emitter is told what a bare identifier means — the five seams through which
 * introspection reaches it, every one optional and every one narrowing the output when it is
 * given. `emit-xml.mjs` § `EmitOptions` documents what each answers and what an absent one
 * costs; `resolve-ident.mjs` implements all five against the `@girs` vocabulary.
 */
export interface EmitOptions {
    resolveIdent?: (typeName: string, propertyName: string, member: string, where: SourceLocation) => string | null;
    accessibilityElement?: (name: string, where: SourceLocation) => 'property' | 'relation' | 'state';
    accessibilityValue?: (name: string, member: string, where: SourceLocation) => string | null;
    /**
     * `position` is which question is being asked: `'object'` is a type being INSTANTIATED,
     * anything else a type merely NAMED. The two have different answers and only the first
     * can be refused for being abstract — `resolve-ident.mjs` § `gtypeName` has the table.
     */
    gtypeName?: (type: TypeRef, where: SourceLocation, position?: 'object' | 'reference') => string;
    enumOrFlagsTypeOf?: (typeName: string | null, propertyName: string) => string | null;
}

/** `.blp` text into the AST, or a `BlueprintSyntaxError` naming the line. */
export declare function parseBlueprint(source: string, file: string): BlueprintFile;

/** The AST into GtkBuilder XML, including the trailing newline. */
export declare function emitGtkBuilderXml(file: BlueprintFile, options?: EmitOptions): string;

/** The enum member's number or the flag set's nicks, or `null` where the name is an object id. */
export declare function resolveIdent(
    typeName: string,
    propertyName: string,
    member: string,
    where: SourceLocation,
): string | null;

/** The enum or flags type one property holds, or `null` where the vocabulary has no join. */
export declare function enumOrFlagsTypeOf(typeName: string | null, propertyName: string): string | null;

/**
 * The GType name a type reference spells, or a thrown error naming what it cannot answer.
 *
 * The input is looser than a `TypeRef` on purpose: this reads three fields and never a line,
 * so a caller holding only a spelling can ask.
 */
export declare function gtypeName(
    type: Pick<TypeRef, 'namespace' | 'name' | 'extern'>,
    where: SourceLocation,
    position?: 'object' | 'reference',
): string;

/** Which element one `accessibility { }` entry becomes. */
export declare function accessibilityElement(name: string, where: SourceLocation): 'property' | 'relation' | 'state';

/** What one `accessibility { }` entry's VALUE emits, or `null` where the source spelling stands. */
export declare function accessibilityValue(name: string, member: string, where: SourceLocation): string | null;
