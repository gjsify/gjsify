/**
 * Hand-written declarations for the surface `index.mjs` exports.
 *
 * The implementation is plain ESM with NO build step — `ast.d.mts` § WHY A DECLARATION FILE
 * AND NOT A `.ts` says why, and `@gjsify/manifest-conformance` ships the same arrangement for
 * the same reason. The cost is this file, kept in sync by hand; what keeps the cost honest is
 * that the VALUES are proven elsewhere: `scripts/check-blueprint-corpus.mjs` imports this
 * package by specifier and names any of the eight that stops being a function, on every run.
 *
 * `ast.d.mts` carries the AST and nothing about what it MEANS. The seams below are the other
 * half: what a bare identifier means, which element an ARIA entry becomes, what GType name a
 * type spells. That split is deliberate and stated there — do not move the seams into it.
 */

import type { BlueprintFile, TypeRef } from './ast.mjs';

export type {
    BindingValue,
    BlueprintFile,
    BlueprintImport,
    BoolValue,
    Child,
    Extension,
    ExtensionEntry,
    IdentValue,
    ListValue,
    MenuItem,
    MenuNode,
    NumberValue,
    ObjectBody,
    ObjectNode,
    ObjectValue,
    Property,
    Signal,
    StringValue,
    TemplateNode,
    TopLevel,
    TypeRef,
    Value,
} from './ast.mjs';

export { BlueprintSyntaxError } from './ast.mjs';

/**
 * How the emitter is told what a bare identifier means — the five seams through which
 * introspection reaches it, every one optional and every one narrowing the output when it is
 * given. `emit-xml.mjs` § `EmitOptions` documents what each answers and what an absent one
 * costs; `resolve-ident.mjs` implements all five against the `@girs` vocabulary.
 */
export interface EmitOptions {
    resolveIdent?: (typeName: string, propertyName: string, member: string, where: string) => string | null;
    accessibilityElement?: (name: string, where: string) => 'property' | 'relation' | 'state';
    accessibilityValue?: (name: string, member: string, where: string) => string | null;
    /**
     * `position` is which question is being asked: `'object'` is a type being INSTANTIATED,
     * anything else a type merely NAMED. The two have different answers and only the first
     * can be refused for being abstract — `resolve-ident.mjs` § `gtypeName` has the table.
     */
    gtypeName?: (type: TypeRef, where: string, position?: 'object' | 'reference') => string;
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
    where: string,
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
    where: string,
    position?: 'object' | 'reference',
): string;

/** Which element one `accessibility { }` entry becomes. */
export declare function accessibilityElement(name: string, where: string): 'property' | 'relation' | 'state';

/** What one `accessibility { }` entry's VALUE emits, or `null` where the source spelling stands. */
export declare function accessibilityValue(name: string, member: string, where: string): string | null;
