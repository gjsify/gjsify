// Measure the max AST depth of a JavaScript file using acorn.
// Companion to docs/poc/acorn-stack-ceiling.md — the falsified candidates table.
//
//   gjs -m docs/poc/acorn-ast-depth.gjs.mjs <file>
//
// WHY THIS EXISTS. The acorn-stack-ceiling.md doc claims three candidate bundles
// have max AST depths of 67, 50, and 50. This probe measures those numbers
// directly from the bundled output using an ITERATIVE walk (explicit stack,
// no recursion) so the measurement doesn't consume the stack it's trying to
// measure.
//
// The walk uses acorn-walk's simple() but implemented iteratively to avoid
// the measuring script's own stack blowing up on deep trees.

import GLib from 'gi://GLib?version=2.0';

const SELF = import.meta.url.replace('file://', '').replace(/[^/]*$/, '');
const ACORN_PATH = `${SELF}../../node_modules/acorn/dist/acorn.mjs`;

async function main() {
    const args = ARGV.filter((a) => !a.startsWith('-'));
    if (args.length !== 1) {
        print('Usage: gjs -m docs/poc/acorn-ast-depth.gjs.mjs <file>');
        GLib.exit(1);
    }

    const filePath = args[0];
    const contents = GLib.file_get_contents(filePath)[1];
    const src = new TextDecoder().decode(contents);

    const acorn = await import(`file://${ACORN_PATH}`);

    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });

    // Iterative walk using explicit stack: [node, depth]
    let maxDepth = 0;
    const stack = [[ast, 0]];

    while (stack.length > 0) {
        const popped = stack.pop();
        if (!popped) continue;
        const [node, depth] = popped;
        if (depth > maxDepth) maxDepth = depth;

        // Push all child nodes onto stack with depth+1
        // acorn-walk's simple() visits all properties that are nodes or arrays of nodes
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
            const val = node[key];
            if (val && typeof val === 'object') {
                if (Array.isArray(val)) {
                    for (const item of val) {
                        if (item && typeof item === 'object' && item.type) {
                            stack.push([item, depth + 1]);
                        }
                    }
                } else if (val.type) {
                    stack.push([val, depth + 1]);
                }
            }
        }
    }

    const bytes = src.length;
    const lines = src.split('\n').length;

    print(`${bytes} ${lines} ${maxDepth}`);
}

await main();
