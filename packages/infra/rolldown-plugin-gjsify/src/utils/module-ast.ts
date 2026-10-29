// One acorn walk over a built module, for every reader in the tree that has to
// summarise a file it did not write.
//
// WHY HERE AND NOT IN THE CLI, where these four functions were born: the readers
// are no longer all in the CLI. `gjsify build --app nativescript` asks which GI
// namespaces its bundle loads, and so does the Vite path (`defineNativescriptConfig`,
// ADR 0117 § stage 1b), which never boots the CLI at all. The bundler-plugin package
// is what both of those depend on, so it is where the walk can be ONE walk — and a
// second parse in the Vite path is exactly how the two answers would drift.
//
// A parse failure yields NO nodes rather than throwing: every caller is summarising
// somebody else's artifact, and under-selecting keeps a correct project buildable
// where mis-selecting breaks one.

import * as acorn from 'acorn';

/**
 * Literal module specifiers of `code`: static `import`/`export … from`, plus
 * `import('<literal>')`.
 *
 * acorn rather than a regex — see the header. `allowHashBang` because a CLI's
 * own entry is a bin (`#!/usr/bin/env node`), and a parse failure yields NO
 * specifiers, which under-selects rather than mis-selects.
 */
export interface SpecifierNode {
    type?: string;
    value?: unknown;
    expressions?: unknown[];
    quasis?: Array<{ value?: { cooked?: unknown } }>;
}

/**
 * The string a node names statically, or `null` when it is computed.
 *
 * A substitution-free TEMPLATE LITERAL is as static as a quoted string, and
 * skipping it is not hypothetical: the minifier rewrites `await
 * import('gi://GLib?version=2.0')` to a backtick form, so a Literal-only reader
 * silently loses every dynamic import in a built bundle.
 *
 * Not named for specifiers, because it does not only read them: the same
 * question is asked of a CALL ARGUMENT by `gi-namespaces.ts`, whose
 * `requireGi("Gtk", "4.0")` carries a namespace and a version in exactly the two
 * spellings above.
 */
export function staticStringValue(node: SpecifierNode | undefined): string | null {
    if (node?.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
    if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0) {
        const cooked = node.quasis?.[0]?.value?.cooked;
        return typeof cooked === 'string' ? cooked : null;
    }
    return null;
}

/** One node of the walk: whatever acorn produced, seen as a bag of properties. */
export type AstNode = { type?: string } & Record<string, unknown>;

/**
 * Parse `code` as a module and call `visit` for every node in it.
 *
 * Exported because a SECOND parse is how the readers of a built bundle would drift
 * apart: {@link moduleSpecifiers} answers "what does this file import" and
 * `gi-namespaces.ts` answers "which GI namespaces does it load", and the second
 * question has an answer the first cannot see — a `--app node` bundle carries no
 * `gi://` specifier at all, only the `requireGi()` calls the bundler rewrote them
 * into. One walker, many readers.
 *
 * A parse failure yields NO nodes rather than throwing: every caller is
 * summarising a file it did not write, and under-selecting is the failure mode
 * that keeps a correct project buildable.
 */
export function walkModuleAst(code: string, visit: (node: AstNode) => void): void {
    let ast: acorn.Program;
    try {
        ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    } catch {
        return;
    }
    const descend = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) descend(child);
            return;
        }
        const n = node as AstNode;
        visit(n);
        for (const [key, value] of Object.entries(n)) {
            if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
            descend(value);
        }
    };
    descend(ast);
}

/**
 * The module `node` imports from, or `null` when `node` is not an import at all.
 *
 * FOUR node types, in one place. Every reader of a built bundle in this tree asks
 * the same question of the same four — a static `import`, both `export … from`
 * forms and `import()` — and each copy of that list is a chance for one reader to
 * miss a form the others catch. The bare side-effect `import "gi://Soup"` is what
 * that costs when it happens (`gi-namespaces.ts`).
 */
export function importedSpecifier(node: AstNode): string | null {
    if (
        node.type !== 'ImportDeclaration' &&
        node.type !== 'ExportNamedDeclaration' &&
        node.type !== 'ExportAllDeclaration' &&
        node.type !== 'ImportExpression'
    ) {
        return null;
    }
    return staticStringValue(node.source as SpecifierNode | undefined);
}

export function moduleSpecifiers(code: string): string[] {
    const out: string[] = [];
    walkModuleAst(code, (node) => {
        const specifier = importedSpecifier(node);
        if (specifier !== null) out.push(specifier);
    });
    return out;
}
