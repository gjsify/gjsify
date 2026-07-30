// `gjsify/deferred-process-exit` — a bare `process.exit()` does not halt under
// GJS, so code after it still runs.
//
// GJS has no atexit hook and the GLib main loop may still be armed, so
// `process.exit()` is DEFERRED: the call returns, the surrounding function
// keeps executing, and the exit code the caller asked for can be lost entirely.
// On Node/bun/deno the same call halts immediately, which is what makes this so
// easy to ship — the bug is invisible on the runtime most people test on.
//
// Measured on `gjsify storybook` in a directory with no stories:
//
//     if (initialCount === 0) {
//         console.error('No *.story.ts files found under src');
//         process.exit(1);                 // ← last statement of ITS block …
//     }
//     console.log(`Found ${initialCount} story file(s) …`);   // … but this ran
//
//     $ bunx @gjsify/cli storybook   → one message, exit 1
//     $ gjsify storybook             → BOTH messages, exit 0
//
// A command that reports a failure and exits 0 is worse than a crash: a script
// or CI step wrapping it reads success.
//
// The fix is `return process.exit(…)` — the `return` is what actually halts the
// handler; the deferred exit then carries its code on the way out.
//
// SCOPE — this rule flags the DANGEROUS shape, not every bare call. An exit in
// tail position (nothing follows it, anywhere up the statement list) is fine,
// and demanding `return` there would be style, not correctness. What it looks
// for is: a statement that CONTAINS a bare `process.exit()` while another
// statement follows it in the same block. That is precisely the case where the
// deferral changes behaviour.
//
// Deliberately NOT autofixable: the correct repair depends on context (`return
// process.exit()` inside a function, restructuring at module top level where
// `return` is a syntax error), and a wrong autofix here produces unparseable
// source. Reference: AGENTS.md § Lint & format, and `showcase.ts`, which
// carries the same reasoning inline at each of its call sites.

import type { Context, Node, Rule } from './types.ts';

/** Node types that open a new function scope — an exit inside one is not ours. */
const FUNCTION_TYPES = new Set<string>([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'TSDeclareFunction',
    'TSEmptyBodyFunctionExpression',
]);

/** Statement-list containers whose `body` is an ordered list of statements. */
const STATEMENT_LIST_KEYS: Record<string, string> = {
    BlockStatement: 'body',
    StaticBlock: 'body',
    SwitchCase: 'consequent',
    Program: 'body',
};

/** Is this node the expression statement `process.exit(...)`? */
function isBareProcessExitStatement(node: Node): boolean {
    if (node.type !== 'ExpressionStatement') return false;
    const expr = node.expression as Node | undefined;
    if (!expr || expr.type !== 'CallExpression') return false;
    const callee = expr.callee as Node | undefined;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed === true) return false;
    const object = callee.object as Node | undefined;
    const property = callee.property as Node | undefined;
    return (
        object?.type === 'Identifier' &&
        object.name === 'process' &&
        property?.type === 'Identifier' &&
        property.name === 'exit'
    );
}

/**
 * Find a bare `process.exit()` statement inside `node`'s subtree, without
 * descending into nested functions (a callback's exit belongs to the callback,
 * not to the statement list being examined).
 *
 * Returns the offending node, or `null`.
 */
function findBareExitInSubtree(node: Node): Node | null {
    // A function body runs later (or never) — its exits are evaluated against
    // ITS own statement lists, when the visitor reaches them. Guarded at ENTRY
    // (not only when descending into children) because the statement handed in
    // by `checkStatementList` can itself be a hoisted FunctionDeclaration: a
    // tail-position `process.exit()` inside `function forceExit() { … }` must
    // not be flagged just because another top-level declaration follows the
    // function in the module body.
    if (FUNCTION_TYPES.has(node.type)) return null;
    if (isBareProcessExitStatement(node)) return node;

    for (const key of Object.keys(node)) {
        // `parent` would walk back up and recurse forever; `range` is data.
        if (key === 'parent' || key === 'range') continue;
        const value = (node as Record<string, unknown>)[key];
        const children = Array.isArray(value) ? value : [value];
        for (const child of children) {
            if (!child || typeof child !== 'object') continue;
            const childNode = child as Node;
            if (typeof childNode.type !== 'string') continue;
            const found = findBareExitInSubtree(childNode);
            if (found) return found;
        }
    }
    return null;
}

export const deferredProcessExitRule: Rule = {
    meta: {
        // No autofix — see the SCOPE note in the file header.
        fixable: false,
    },
    create(context: Context) {
        const reported = new Set<number>();

        const checkStatementList = (node: Node) => {
            const key = STATEMENT_LIST_KEYS[node.type];
            if (!key) return;
            const body = (node as Record<string, unknown>)[key];
            if (!Array.isArray(body)) return;

            // Only statements with something AFTER them can fall through.
            for (let i = 0; i < body.length - 1; i++) {
                const stmt = body[i] as Node | undefined;
                if (!stmt || typeof stmt.type !== 'string') continue;
                const offender = findBareExitInSubtree(stmt);
                if (!offender || reported.has(offender.start)) continue;
                reported.add(offender.start);
                context.report({
                    message:
                        'Bare `process.exit()` does not halt under GJS (no atexit, the GLib loop may still ' +
                        'be armed) — the statements after this one still run, and the exit code can be lost. ' +
                        'Write `return process.exit(...)` so the handler actually stops here.',
                    node: offender,
                });
            }
        };

        const visitor: Record<string, (node: Node) => void> = {};
        for (const type of Object.keys(STATEMENT_LIST_KEYS)) {
            visitor[type] = checkStatementList;
        }
        return visitor;
    },
};
