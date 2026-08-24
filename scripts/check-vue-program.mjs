#!/usr/bin/env node
// `vue-tsc --noEmit` on a package, plus the assertions that keep it non-vacuous.
//
// A bare `vue-tsc --noEmit` in a package script is an exit code and nothing else, and two
// configuration changes turn it green while it verifies nothing. Both are measured, and
// which one bites depends on the package — so this script makes all three claims:
//
//  1. THE PROGRAM CONTAINS THE SFCs. A tsconfig whose `include` lists only `.ts` globs
//     makes `vue-tsc` check ZERO standalone SFCs at exit 0 (measured; kept executable as
//     a probe by `scripts/check-type-surfaces.mjs` for `@gjsify/gtk-host`'s fixtures).
//     NOTE what it does NOT catch, also measured: an SFC a root `.ts` IMPORTS is pulled
//     into the program and fully type-checked with or without the glob, so in a showcase
//     whose `app.ts` imports its `App.vue` this assertion is only load-bearing for an SFC
//     nothing imports yet. It is still the cheapest statement of the claim.
//  2. `vueCompilerOptions.strictTemplates` IS SET. Without it — measured on vue-tsc 3.3.11
//     against `showcases/gtk/vue-host-counter` — an unknown prop, an unknown event and an
//     entirely UNRESOLVED tag are all silently accepted while wrong value types still
//     error, so the check looks alive and has stopped verifying the half that matters.
//     That `strictTemplates` changes outcomes at all is proven behaviourally, once, by
//     `check-type-surfaces.mjs`'s `lax-templates` probe; what no gate held until now is
//     that a CONSUMER's config carries it.
//  3. THE CONFIG DOES NOT `extends`. Measured, four cells, all four: the BASE of an
//     extends chain wins `strictTemplates` in both directions — a child setting it `true`
//     over a `false` base stays LAX. So a config that extends cannot be read here, and
//     `vue-tsc --showConfig` is no help either: measured, it prints `compilerOptions`,
//     `files`, `include` and `exclude`, and NOT `vueCompilerOptions`.
//
// Usage: node scripts/check-vue-program.mjs [<package-dir>] [--project <tsconfig>] [--help]

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const HELP = `check-vue-program — run a package's vue-tsc and hold it to checking the SFCs.

  node scripts/check-vue-program.mjs [<package-dir>] [options]

  <package-dir>       package to check (default: the working directory)
  --project <file>    tsconfig to use (default: <package-dir>/tsconfig.json)
  --help              this text

Exits 0 when vue-tsc exits 0, every .vue file in the package is in its program, and the
config carries vueCompilerOptions.strictTemplates without an \`extends\` above it.`;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    process.exit(0);
}

const projectFlag = argv.indexOf('--project');
const positional = argv.filter((arg, index) => !arg.startsWith('--') && index !== projectFlag + 1);
const PKG = resolve(positional[0] ?? '.');
const PROJECT = projectFlag === -1 ? join(PKG, 'tsconfig.json') : resolve(PKG, argv[projectFlag + 1]);
const WHERE = relative(process.cwd(), PKG) || '.';

/** Build outputs and dependency trees hold `.vue` files that are not this package's. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'lib', 'build', '.git', 'tmp']);

const problems = [];
/** A gate that could not RUN is not a gate that found nothing — reported apart. */
const harness = [];

function sfcsIn(dir) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) found.push(...sfcsIn(path));
        else if (entry.endsWith('.vue')) found.push(path);
    }
    return found;
}

const require = createRequire(import.meta.url);

function resolveOrFail(specifier, label) {
    try {
        return require.resolve(specifier);
    } catch (error) {
        harness.push(`cannot resolve ${label} (${specifier}): ${error.message}. Run the workspace install first.`);
        return null;
    }
}

// ── claims 2 and 3: the config ──────────────────────────────────────────
// TypeScript's own JSONC parser, not a regex: a comment stripper that mis-lexes a string
// literal reads a different config than the compiler does.
const tsPath = resolveOrFail('typescript', 'typescript');
if (tsPath !== null) {
    const ts = require(tsPath);
    const parsed = ts.parseConfigFileTextToJson(PROJECT, readFileSync(PROJECT, 'utf8'));
    if (parsed.error !== undefined) {
        harness.push(`cannot parse ${PROJECT}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`);
    } else {
        const config = parsed.config ?? {};
        if (config.extends !== undefined) {
            problems.push(
                `${relative(PKG, PROJECT)} uses \`extends\`. The BASE of an extends chain wins ` +
                    '`vueCompilerOptions.strictTemplates` in BOTH directions (measured, vue-tsc 3.3.11), so the ' +
                    'setting this check depends on would be decided in a file it does not read.',
            );
        }
        if ((config.vueCompilerOptions ?? {}).strictTemplates !== true) {
            problems.push(
                `${relative(PKG, PROJECT)} does not set \`vueCompilerOptions.strictTemplates: true\`. Without it ` +
                    'an unknown prop, an unknown event and an UNRESOLVED tag are all accepted while wrong value ' +
                    'types still error — the check stays green and stops holding the type surface.',
            );
        }
    }
}

// ── claim 1: the program ────────────────────────────────────────────────
const bin = resolveOrFail('vue-tsc/bin/vue-tsc.js', 'vue-tsc');
const expected = sfcsIn(PKG);
if (expected.length === 0) {
    problems.push(
        `${WHERE} holds no .vue file, so this check would report green having verified nothing. ` +
            'Point it at a package with SFCs, or drop the check.',
    );
}

if (bin !== null && expected.length > 0) {
    const run = spawnSync(process.execPath, [bin, '-p', PROJECT, '--noEmit', '--listFiles'], {
        cwd: PKG,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (run.error || run.signal !== null || typeof run.status !== 'number') {
        harness.push(
            `vue-tsc did not complete (${run.error?.message ?? `signal ${run.signal}`}) — ` +
                'this is not "no errors found".',
        );
    } else {
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
        // `--listFiles` prints one absolute path per line; a diagnostic line is never one.
        const program = new Set(
            output
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => /^([/\\]|[A-Za-z]:[/\\]).*\.(vue|tsx?|mts|cts)$/.test(line))
                .map((line) => resolve(line)),
        );
        const missing = expected.filter((file) => !program.has(file));
        if (run.status !== 0) {
            const diagnostics = output.split('\n').filter((line) => /error TS\d+/.test(line));
            problems.push(
                `vue-tsc exited ${run.status}:\n    ${(diagnostics.length > 0 ? diagnostics : [output]).join('\n    ')}`,
            );
        }
        if (missing.length > 0) {
            problems.push(
                `vue-tsc left ${missing.length} of ${expected.length} SFC(s) out of its program: ` +
                    `${missing.map((file) => relative(PKG, file)).join(', ')}. An \`include\` that lists only .ts ` +
                    'globs reaches an SFC only through an import — add `src/**/*.vue` to it.',
            );
        }
        if (problems.length === 0) {
            const inProgram = [...program].filter((file) => file.endsWith('.vue')).length;
            console.log(
                `check-vue-program: ${WHERE} — vue-tsc exit 0 with strictTemplates, no \`extends\`, and ` +
                    `${inProgram} SFC(s) in the program covering all ${expected.length} on disk`,
            );
        }
    }
}

if (harness.length > 0) {
    console.error(`check-vue-program: HARNESS FAILURE — the check could not run, which is not green.`);
    for (const line of harness) console.error(`  ${line}`);
}
if (problems.length > 0) {
    console.error(`check-vue-program: ${WHERE} — ${problems.length} problem(s):`);
    for (const line of problems) console.error(`  ${line}`);
}
process.exit(harness.length + problems.length > 0 ? 1 : 0);
