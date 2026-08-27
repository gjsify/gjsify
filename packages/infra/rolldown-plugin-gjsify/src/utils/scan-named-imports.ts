// Which NAMES a module imports from one package — the input the ADR 0032 § 8
// build-time gate needs and no bundler hook hands over.
//
// WHY A PARSE HERE RATHER THAN A HOOK. The gate has to name the IDENTIFIER, not
// the module: § 8's whole advantage over the runtime backstop is failing on
// `import { FlatList } from 'react-native'` with the importing file and position.
// Of the hooks BOTH engines honour — `@gjsify/rolldown-native`'s `NativePlugin`
// lists load, transform, resolveId, renderChunk, the four addons and the
// lifecycle pair, and that list is the ceiling — `resolveId` sees the specifier
// and never the bindings, and there is no `moduleParsed`, no `ModuleInfo.ast` and
// no `this.parse`. `transform` hands over the source and nothing else does, so
// the import list is ours to read.
//
// WHY NOT A TEXT SCAN. A regex over `import {…} from '<pkg>'` cannot tell a live
// import from one inside a block comment or a template literal, and it cannot
// see `importKind` — which is the difference between a build error and five
// type-only imports that ADR 0032 measured as costing nothing. Both of those are
// false POSITIVES, the failure mode that teaches people to switch a gate off.
//
// WHY ACORN AND NOT THE BUNDLER'S PARSER. Same measured reason as
// `inline-static-reads.ts`: under GJS the engine is `@gjsify/rolldown-native`,
// npm `rolldown` is a Node-only N-API crate, and a top-level
// `import { parseAst } from 'rolldown/parseAst'` puts it in a module that has to
// load under GJS — the CLI's own bundle died at startup with `createRequire:
// Cannot require builtin module "fs" synchronously in GJS`. `acorn-typescript`
// is pure JS and reports `importKind` on both the declaration and each specifier
// (verified against `.tsx` with JSX, a namespace import and inline `type`
// specifiers), which is exactly the discrimination the gate turns on.
//
// TWO BLIND SPOTS, BOTH MEASURED, AND NEITHER IS SILENT.
//
// 1. FORMS THAT CARRY NO NAME — the point of `opaque`. A named import is the
//    only form that carries a name at build time. `import * as RN`, a default
//    import, `export * from`, `await import('…')` and `require('…')` all reach
//    the surface through a value whose members are resolved at RUNTIME, and no
//    parser recovers them without type information this layer does not have.
//    They come back as {@link OpaqueReference}s so the caller can say out loud
//    that the gate cannot answer for this module and that the runtime refusal is
//    what covers it.
//
// 2. SYNTAX acorn-typescript 1.4.13 DOES NOT HAVE. Measured against the pinned
//    version (acorn 8.17.0): `const x = 1 satisfies number` fails with
//    `Unexpected token (1:12)`, and a `const` type parameter
//    (`<const T,>(x: T) => x`) fails with `Unexpected token (1:18)`. Both are
//    ordinary TypeScript, and this repository pins `typescript: "^6.0.3"`, so
//    both WILL appear in consumer source. This function throws
//    {@link ImportScanParseError} for them, and the plugin turns that into a
//    warning rather than a build failure — see `react-native-gate.ts` for why a
//    false violation is the worse outcome. `react-native-gate.spec.ts` pins the
//    gap as a fixture that must NOT parse, beside the modern syntax that must, so
//    the day acorn-typescript gains it that vector goes red and someone moves it.
//
// A gate whose limits are undocumented is worse than no gate; a gate that fails
// a valid program is how a gate gets switched off.

import * as acorn from 'acorn';
import { tsPlugin } from 'acorn-typescript';

/** One named import (or re-export) of `name` from a watched package. */
export interface NamedImport {
    /** The name as the SOURCE module exports it, not the local alias. */
    readonly name: string;
    /** The verbatim specifier it came from. */
    readonly specifier: string;
    /** 1-based line, as acorn reports it. */
    readonly line: number;
    /** 0-based column, as acorn reports it. */
    readonly column: number;
}

/** A reference to a watched package whose imported NAMES are not statically knowable. */
export interface OpaqueReference {
    /** Which form hid the names. */
    readonly form: 'namespace' | 'default' | 'export-all' | 'dynamic-import' | 'require';
    readonly specifier: string;
    readonly line: number;
    readonly column: number;
}

export interface ScanResult {
    readonly named: readonly NamedImport[];
    readonly opaque: readonly OpaqueReference[];
}

/**
 * The TypeScript/TSX-capable parser, built once.
 *
 * `acorn-typescript` refuses to parse without `locations: true` (measured in
 * `inline-static-reads.ts`), and the gate needs the positions anyway.
 */
const TS_PARSER = acorn.Parser.extend(tsPlugin() as never);

const PARSE_OPTIONS = {
    ecmaVersion: 'latest' as const,
    sourceType: 'module' as const,
    locations: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowImportExportEverywhere: true,
};

/** Raised when a module that mentions a watched package cannot be parsed. */
export class ImportScanParseError extends Error {
    override readonly name = 'ImportScanParseError';
    constructor(
        readonly id: string,
        cause: unknown,
    ) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(
            `gjsify import scan: cannot read the import list of ${id} — ${detail}. This module mentions a ` +
                `package the build-time support gate watches, so for THIS file the gate is downgraded to ` +
                `the runtime backstop. Known causes, both measured on acorn-typescript 1.4.13: a ` +
                `\`satisfies\` expression, or a \`const\` type parameter. Otherwise the syntax is newer ` +
                `than the bundled parser, or the file is not the module type its extension claims.`,
            { cause },
        );
    }
}

interface WithLoc {
    loc?: { start?: { line?: number; column?: number } } | null;
}

function positionOf(node: WithLoc): { line: number; column: number } {
    return { line: node.loc?.start?.line ?? 0, column: node.loc?.start?.column ?? 0 };
}

/** The string value of a node when it is a plain string literal, else `undefined`. */
function literalString(node: unknown): string | undefined {
    const value = (node as { type?: string; value?: unknown } | null)?.value;
    return (node as { type?: string } | null)?.type === 'Literal' && typeof value === 'string' ? value : undefined;
}

/**
 * Visit every node in the tree, generically.
 *
 * A bare descent rather than `acorn-walk`, and not as a preference: `walk.simple`
 * looks its visitor up in a table keyed by node type and throws `No walker
 * function defined for node type TSInterfaceDeclaration` on the first interface
 * in a first-party source. A walker with no node table cannot fall behind the
 * parser — which matters precisely because the parser emits TS node types this
 * file has never heard of.
 */
function forEachNode(root: unknown, visit: (node: { type: string }) => void): void {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node === null || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
            for (const child of node) stack.push(child);
            continue;
        }
        if (typeof (node as { type?: unknown }).type === 'string') visit(node as { type: string });
        for (const value of Object.values(node)) {
            if (value !== null && typeof value === 'object') stack.push(value);
        }
    }
}

/**
 * Every named import and every opaque reference to one of `specifiers`.
 *
 * `specifiers` is matched EXACTLY. `react-native-web` and
 * `react-native/Libraries/…` are different modules with different contracts, and
 * a prefix match would fail a build over a package this layer never claimed —
 * the deep-subpath case has its own named error in the alias plugin, where the
 * importer is known and the message can say what to do.
 *
 * Type-only imports are absent from the result by construction. ADR 0032 counted
 * five of them (`ViewProps`, `TextProps`, `PressableProps`, `LayoutChangeEvent`,
 * `ColorValue`) in the measured application and recorded that they cost nothing:
 * a type erases at build time and reaches no runtime, so a gate that failed on
 * `import type { ViewProps }` would refuse a program that cannot fail.
 *
 * @throws {ImportScanParseError} when the source cannot be parsed.
 */
export function scanNamedImports(code: string, id: string, specifiers: readonly string[]): ScanResult {
    const named: NamedImport[] = [];
    const opaque: OpaqueReference[] = [];
    const watched = new Set(specifiers);

    let ast: acorn.Program;
    try {
        ast = TS_PARSER.parse(code, PARSE_OPTIONS) as acorn.Program;
    } catch (cause) {
        throw new ImportScanParseError(id, cause);
    }

    // Import and re-export declarations are top level by grammar, so `body` is
    // the whole population — no descent needed and none wanted, because a
    // descent would also visit a `TSModuleDeclaration`'s ambient imports, which
    // declare types and import nothing.
    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration') {
            const specifier = literalString(node.source);
            if (specifier === undefined || !watched.has(specifier)) continue;
            // `import type { X } from …` — the whole declaration erases.
            if ((node as { importKind?: string }).importKind === 'type') continue;
            for (const spec of node.specifiers) {
                const at = positionOf(spec as WithLoc);
                if (spec.type === 'ImportSpecifier') {
                    // `import { type X }` — the one specifier erases while its
                    // value-importing siblings in the same declaration do not.
                    if ((spec as { importKind?: string }).importKind === 'type') continue;
                    const imported = spec.imported as { name?: string; value?: unknown };
                    const name = imported.name ?? (typeof imported.value === 'string' ? imported.value : undefined);
                    if (name !== undefined) named.push({ name, specifier, ...at });
                } else {
                    opaque.push({
                        form: spec.type === 'ImportNamespaceSpecifier' ? 'namespace' : 'default',
                        specifier,
                        ...at,
                    });
                }
            }
            continue;
        }
        if (node.type === 'ExportNamedDeclaration') {
            const specifier = literalString(node.source);
            if (specifier === undefined || !watched.has(specifier)) continue;
            if ((node as { exportKind?: string }).exportKind === 'type') continue;
            for (const spec of node.specifiers) {
                if ((spec as { exportKind?: string }).exportKind === 'type') continue;
                // On an `ExportSpecifier` it is `local` that names the binding in
                // the SOURCE module; `exported` is the name this module publishes.
                const local = spec.local as { name?: string; value?: unknown };
                const name = local.name ?? (typeof local.value === 'string' ? local.value : undefined);
                if (name !== undefined) named.push({ name, specifier, ...positionOf(spec as WithLoc) });
            }
            continue;
        }
        if (node.type === 'ExportAllDeclaration') {
            const specifier = literalString(node.source);
            if (specifier === undefined || !watched.has(specifier)) continue;
            if ((node as { exportKind?: string }).exportKind === 'type') continue;
            opaque.push({ form: 'export-all', specifier, ...positionOf(node as WithLoc) });
        }
    }

    // `import('…')` and `require('…')` can sit anywhere, so these need the
    // descent. Only the specifier is recoverable — which member of the namespace
    // the caller reaches for is a runtime question by construction.
    forEachNode(ast, (node) => {
        if (node.type === 'ImportExpression') {
            const specifier = literalString((node as { source?: unknown }).source);
            if (specifier !== undefined && watched.has(specifier)) {
                opaque.push({ form: 'dynamic-import', specifier, ...positionOf(node as WithLoc) });
            }
            return;
        }
        if (node.type !== 'CallExpression') return;
        const call = node as unknown as { callee?: { type?: string; name?: string }; arguments?: unknown[] };
        // `import(…)` also arrives as a CallExpression with an `Import` callee on
        // some acorn versions; both spellings are accepted so the form is not
        // silently missed by a parser upgrade.
        const isImport = call.callee?.type === 'Import';
        const isRequire = call.callee?.type === 'Identifier' && call.callee.name === 'require';
        if (!isImport && !isRequire) return;
        const specifier = literalString(call.arguments?.[0]);
        if (specifier === undefined || !watched.has(specifier)) return;
        opaque.push({ form: isImport ? 'dynamic-import' : 'require', specifier, ...positionOf(node as WithLoc) });
    });

    return { named, opaque };
}
