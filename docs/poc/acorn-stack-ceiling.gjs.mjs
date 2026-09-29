// Measure the stack budget acorn has when it parses a generated bundle in-process under
// GJS — the ceiling behind `Not enough stack space to parse input` in a GJS build.
// Companion to docs/poc/acorn-stack-ceiling.md — read that first.
//
//   gjs -m docs/poc/acorn-stack-ceiling.gjs.mjs            # full sweep
//   gjs -m docs/poc/acorn-stack-ceiling.gjs.mjs --quick    # short sweep
//   gjs -m docs/poc/acorn-stack-ceiling.gjs.mjs --one <nested|flat> <n> <stackFrames>
//
// WHY THIS EXISTS. A GJS build can die with
//
//     Not enough stack space to parse input (line:col)
//
// while BUILDING a package's test bundle — no test runs. Two facts about that message drive
// everything here, and neither is guessable from the text:
//
// 1. IT IS ACORN'S, NOT SPIDERMONKEY'S. acorn guards its own recursion and re-raises:
//      catchStackOverflow(f) { try { return f() } catch (e) {
//        if (stack-overflow-ish) this.raise(this.start, "Not enough stack space to parse input")
//        else throw e } }
//    (`node_modules/acorn/dist/acorn.mjs`, 8.17.0). The underlying error is SpiderMonkey's
//    "too much recursion", hit by acorn's recursive descent running as ordinary JS. Neither
//    `libmozjs-140` nor `libgjs` contains this string; acorn does.
// 2. `line:col` IS A POSITION IN THE INPUT. That is why the position a build reported
//    (1154:55) is in a GENERATED bundle — no source file in the failing package was that
//    long — and it is the cheapest way to tell this failure apart from a source-syntax one.
//
// gjsify runs this parser in-process over its own output: `packages/infra/rolldown-plugin-gjsify`
// imports acorn in `console-assign.ts`, `jsx-survival.ts`, `react-native-gate.ts` and the
// `--globals auto` detector, all against bundled code.
//
// EVERY MEASUREMENT RUNS IN A FRESH CHILD, and that is not tidiness. An in-process sweep
// gives different answers for the same input depending on what the process did first: a
// 600-level nest measured standalone fails, and measured after eight earlier parses it
// parses. A single number from a warm process is not a number, so the sweep shells out and
// the child does the measuring.

import GLib from 'gi://GLib?version=2.0';

const SELF = import.meta.url.replace('file://', '').replace(/[^/]*$/, '');
// GJS's native ESM loader does not follow a bare specifier into node_modules, and a POC
// should not carry a resolver. There is no `URL` global under GJS, so paths come from
// rewriting this module's own `import.meta.url`, which needs no URL parsing to do.
const ACORN_PATH = `${SELF}../../node_modules/acorn/dist/acorn.mjs`;

/** `n` levels of array nesting — one acorn recursion level each. */
function nested(n) {
    let e = '0';
    for (let i = 0; i < n; i++) e = `[${e}]`;
    return `export default ${e};\n`;
}

/** `n` top-level statements: no nesting, so acorn's recursion never deepens. */
function flat(n) {
    return `${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`;
}

function classify(err) {
    const m = String(err?.message ?? err);
    if (m.includes('Not enough stack space')) return 'acorn-stack';
    if (m.includes('too much recursion')) return 'raw-recursion';
    return m;
}

/**
 * Occupy `frames` stack frames, THEN parse — so the parse meets a partly-spent stack. acorn
 * runs on SpiderMonkey's JS stack, so the caller's depth is part of its budget. The parse has
 * to happen INSIDE the recursion: run it after the recursion unwinds and the effect is
 * invisible, which is how an earlier version of this probe wrongly reported "no headroom".
 */
function parseAtDepth(acorn, src, frames) {
    function at(n) {
        if (n > 0) return at(n - 1);
        try {
            acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
            return 'parses';
        } catch (err) {
            return `FAILS ${classify(err)}`;
        }
    }
    return at(frames);
}

/** One measurement in this process. */
async function measure(kind, n, frames) {
    const acorn = await import(`file://${ACORN_PATH}`);
    return parseAtDepth(acorn, kind === 'flat' ? flat(n) : nested(n), frames);
}

function runChild(kind, n, frames) {
    const [, stdout] = GLib.spawn_sync(
        null,
        ['gjs', '-m', `${SELF}acorn-stack-ceiling.gjs.mjs`, '--one', kind, String(n), String(frames)],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null,
    );
    // `spawn_sync` hands back raw bytes, not a string.
    const text = new TextDecoder().decode(stdout);
    return text.trim().split('\n').pop() ?? '(no output)';
}

function table(title, rows) {
    print(`\n${title}`);
    for (const [key, verdict] of rows) print(`  ${key.padEnd(14)} ${verdict}`);
}

async function main() {
    const args = ARGV.filter((a) => a !== '--quick');
    if (args[0] === '--one') {
        print(await measure(args[1], Number(args[2]), Number(args[3])));
        return;
    }

    const quick = ARGV.includes('--quick');
    print('each row is a fresh gjs process; see the header for why that is required');

    table(
        'A. expression NESTING, caller depth 0',
        (quick ? [200, 600, 1200] : [200, 400, 500, 600, 800, 1200, 2000]).map((n) => [
            `nest=${n}`,
            runChild('nested', n, 0),
        ]),
    );

    table(
        'B. top-level STATEMENTS, zero nesting — the control for A',
        (quick ? [20_000] : [3_000, 20_000, 100_000]).map((n) => [`stmts=${n}`, runChild('flat', n, 0)]),
    );

    table(
        'C. ONE input that A shows parsing, failing only on CALLER depth',
        (quick ? [0, 6000] : [0, 2000, 4000, 5000, 6000, 8000]).map((f) => [`stack=${f}`, runChild('nested', 200, f)]),
    );

    print("\nA puts acorn's ceiling somewhere in the low hundreds of nesting levels. B says");
    print('SIZE is not the factor — a flat megabyte parses where a few hundred levels do not.');
    print("C is the intermittency: one input, two verdicts, decided by the caller's stack.");
    print('So the number to take to a real build is the nesting depth of the generated');
    print('bundle, and the fix belongs where that nesting is produced. See the .md.');
}

await main();
