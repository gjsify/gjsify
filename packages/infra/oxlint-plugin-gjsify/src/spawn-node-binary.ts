// `gjsify/spawn-node-binary` — spawning `process.execPath` assumes the CLI runs
// under Node. Under the GJS bundle it does not, and the spawn starts the WRONG
// interpreter.
//
// `spawn(process.execPath, […])` is the documented portable way to start a
// second copy of the current runtime, and that is exactly what makes it wrong
// here: this CLI is a DUAL-HOST program. Run from `lib/index.js` the current
// runtime is Node; run from `dist/cli.gjs.mjs` it is GJS, where
// `@gjsify/process` resolves `execPath` honestly from `/proc/self/exe` →
// `/usr/bin/gjs-console`. Handing a Node script to that binary does not fail
// with a missing-interpreter error — it RUNS, under the wrong engine, and dies
// somewhere inside the payload.
//
// Measured on `gjsify workspace @gjsify/create-app build` with a GJS-hosted CLI
// and `@gjsify/tsc`'s bundle not yet built (the normal state of a cold tree —
// `build:infra` builds `@gjsify/create-app` fifth and `@gjsify/tsc` far later):
//
//     JS ERROR: ReferenceError: module is not defined
//     @/…/node_modules/typescript/lib/tsc.js:8:1
//     script "build" exited with code 1
//
// …because `commands/tsc.ts` spawned `process.execPath` for its upstream-`tsc`
// fallback. On a host where `execPath` resolves to a gjsify launcher instead of
// the raw interpreter, the same line re-executes the CLI and yargs reports the
// tsc entry as `Unknown argument: …/typescript/lib/tsc.js`. One defect, two
// faces, both invisible on Node.
//
// The fix is `nodeBinary()` from `utils/run-node.ts`: `process.execPath` when
// `isNode()`, PATH `node` otherwise.
//
// WHY A RULE AND NOT A COMMENT. This was already the documented convention —
// `oxc-resolve.ts`, `run-node.ts`, `test.ts`, `storybook.ts`, `showcase.ts` and
// `install.ts` each carry a prose warning naming `nodeBinary()`, two of them in
// capitals. Six copies of a rule and one file that never got it is the measured
// outcome of enforcing an invariant with comments; `commands/tsc.ts` was that
// file, for as long as the fallback existed.
//
// SCOPE — configured in `.oxlintrc.json` for `packages/infra/cli/src/**` only.
// Everywhere else `process.execPath` is correct: Node-only build scripts
// (`packages/infra/tsc/scripts/build-bundle.mjs`), Node-only test harnesses
// (`packages/node-gi/**/test/*`) and `run-node.ts` itself, which is where the
// one legitimate read lives. A repo-wide ban would flag all of those and would
// be a rule about the wrong thing: the hazard is not the property, it is
// spawning it from code that also runs under GJS.
//
// Flags only the COMMAND position (first argument). Passing the path as data —
// `spawn(cmd, [process.execPath])`, `{ execPath: process.execPath }` — is fine
// and stays silent. Not autofixable: `nodeBinary()` needs an import the rule
// cannot place, and it is the wrong repair where the intent really was "this
// interpreter" (`storybook.ts` re-dispatches in-process instead).

import type { Context, Node, Rule } from './types.ts';

/** `child_process` entry points whose first argument is the command to run. */
const SPAWN_CALLEES = new Set<string>(['spawn', 'spawnSync', 'execFile', 'execFileSync']);

/** Is this node the member expression `process.execPath`? */
function isProcessExecPath(node: Node | undefined): boolean {
    if (!node || node.type !== 'MemberExpression' || node.computed === true) return false;
    const object = node.object as Node | undefined;
    const property = node.property as Node | undefined;
    return (
        object?.type === 'Identifier' &&
        object.name === 'process' &&
        property?.type === 'Identifier' &&
        property.name === 'execPath'
    );
}

/**
 * The called name for `spawn(…)` and for `cp.spawn(…)` / `childProcess.spawn(…)`
 * alike — the member form is how several call sites in this CLI spell it, and a
 * rule that only understood the bare identifier would miss them.
 */
function calleeName(callee: Node | undefined): string | undefined {
    if (!callee) return undefined;
    if (callee.type === 'Identifier') return callee.name as string;
    if (callee.type === 'MemberExpression' && callee.computed !== true) {
        const property = callee.property as Node | undefined;
        if (property?.type === 'Identifier') return property.name as string;
    }
    return undefined;
}

export const spawnNodeBinaryRule: Rule = {
    meta: {
        // No autofix — see the note in the file header.
        fixable: false,
    },
    create(context: Context) {
        return {
            CallExpression(node: Node) {
                const name = calleeName(node.callee as Node | undefined);
                if (!name || !SPAWN_CALLEES.has(name)) return;

                const args = node.arguments;
                if (!Array.isArray(args) || args.length === 0) return;
                const command = args[0] as Node | undefined;
                if (!isProcessExecPath(command)) return;

                context.report({
                    message:
                        `\`${name}(process.execPath, …)\` assumes this CLI runs under Node. Under the GJS ` +
                        'bundle `process.execPath` is the GJS interpreter (`/proc/self/exe` → `gjs-console`), ' +
                        'so this starts the wrong runtime — a Node script handed to GJS runs and then dies ' +
                        'inside the payload (`ReferenceError: module is not defined`), which reads as a bug ' +
                        'in the payload rather than in the spawn. Use `nodeBinary()` from ' +
                        '`utils/run-node.ts` (`process.execPath` on Node, PATH `node` otherwise). If you ' +
                        'genuinely mean "re-enter the CURRENT interpreter", say so in a reasoned ' +
                        'oxlint-disable comment.',
                    node: command as Node,
                });
            },
        };
    },
};
