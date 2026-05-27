// Minimal local typings for the subset of the oxlint JS-plugin API this
// plugin uses. The published `oxlint` package (1.66/1.67) does not export the
// `Plugin` / `Rule` / `Context` / `Fixer` types yet, so we declare just what
// `register-class-order` needs. Shapes mirror
// `refs/oxc/apps/oxlint/src-js/plugins/{load,context,fix,report}.ts` and the
// ESTree nodes in `refs/oxc/apps/oxlint/src-js/generated/types.d.ts`.
//
// Reference: refs/oxc/apps/oxlint/src-js/plugins/*. Copyright (c) oxc
// contributors. MIT.

/** Half-open byte range `[start, end)` over the source text. */
export type Range = [number, number];

/** Anything the fixer can target — a node or token with a `range`. */
export interface Ranged {
    range: Range;
}

/** Generic AST node. Only the fields the rule touches are modelled. */
export interface Node extends Ranged {
    type: string;
    start: number;
    end: number;
    parent?: Node;
    [key: string]: unknown;
}

export interface ClassBody extends Node {
    type: 'ClassBody';
    body: ClassElement[];
}

export interface ClassElement extends Node {
    type: string;
    static?: boolean;
}

export interface PropertyDefinition extends Node {
    type: 'PropertyDefinition' | 'TSAbstractPropertyDefinition';
    static: boolean;
    computed: boolean;
    key: Node;
    value: Node | null;
}

export interface StaticBlock extends Node {
    type: 'StaticBlock';
    body: Node[];
}

/** A single fix produced by the {@link Fixer}. */
export interface Fix {
    range: Range;
    text: string;
}

/** Frozen fixer handed to a `fix` function. Subset of oxlint's full Fixer. */
export interface Fixer {
    insertTextBefore(nodeOrToken: Ranged, text: string): Fix;
    insertTextAfter(nodeOrToken: Ranged, text: string): Fix;
    replaceText(nodeOrToken: Ranged, text: string): Fix;
    remove(nodeOrToken: Ranged): Fix;
    insertTextBeforeRange(range: Range, text: string): Fix;
    removeRange(range: Range): Fix;
}

export type FixFn = (fixer: Fixer) => Fix | Fix[] | null;

export interface Diagnostic {
    message: string;
    node: Node;
    fix?: FixFn;
}

export interface SourceCode {
    text: string;
    getText(node?: Ranged | null, beforeCount?: number | null, afterCount?: number | null): string;
}

export interface Context {
    filename: string;
    sourceCode: SourceCode;
    report(diagnostic: Diagnostic): void;
}

/** Visitor object: maps AST node type → handler. */
export type Visitor = Record<string, (node: Node) => void>;

export interface RuleMeta {
    fixable?: 'code' | 'whitespace' | boolean;
    [key: string]: unknown;
}

export interface Rule {
    meta?: RuleMeta;
    create(context: Context): Visitor;
}

export interface Plugin {
    meta: { name: string };
    rules: Record<string, Rule>;
}
