#!/usr/bin/env node
// Root `build:infra` must be BUNDLER-FREE up to the clause that builds the bundler.
//
// THE INVARIANT
//
// `scripts/bootstrap-native-facades.mjs` produces the JS facade of the GI-bridge
// bundler engine. Under GJS, `gjsify build` cannot run before it exists — the
// engine is the thing being built, and the npm `rolldown` fallback is a Rust napi
// crate GJS cannot load. So every clause BEFORE that script must get by on `tsc`
// alone; everything after it may use the bundler freely.
//
// THE INCIDENT
//
// #1031 promoted the CLI's four link-time runtime deps (`semver`, `npm-registry`,
// `tar`, `workspace`) from `build:types` to `build` to stop a parallel sweep from
// creating `lib/esm` while another package's build imported it. But each of those
// four builds via `gjsify build --library`, which made them the first bundler
// consumers in the chain, five clauses ahead of the facade they need. Under Node
// it is invisible (the npm `rolldown` engine loads), and the GJS path only runs on
// a COLD tree — `main.yml` skips `build:infra` entirely on a warm cache — so CI
// stayed green for a day. It surfaced on the v0.31.0 publish, where `publish-napi`
// runs cold by design: `@gjsify/napi` and its two platform packages did not
// publish. The fix keeps BOTH properties — `build:types` before the CLI (whose
// `tsc` needs their declarations), full build right after the facade.
//
// WHAT IT CHECKS
//
// For every `gjsify workspace <pkg> <script>` clause before the facade clause,
// resolve that package's script — following `gjsify run <other>` one package deep
// — and fail if any resolved command invokes `gjsify build`. Derived from the
// manifests, so a package that grows a bundler step is caught by the change
// itself rather than by someone remembering this rule.
//
// Usage: node scripts/check-build-infra-order.mjs [--root <dir>]

import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const rootIndex = process.argv.indexOf('--root');
const ROOT = rootIndex === -1 ? '.' : process.argv[rootIndex + 1];
const FACADE_SCRIPT = 'bootstrap-native-facades.mjs';

/** name -> { json, dir }, for every manifest under `packages/<group>/<pkg>/`. */
function packageIndex() {
    const byName = new Map();
    const packagesDir = join(ROOT, 'packages');
    if (!existsSync(packagesDir)) return byName;
    for (const group of readdirSync(packagesDir)) {
        const groupDir = join(packagesDir, group);
        let entries;
        try {
            entries = readdirSync(groupDir);
        } catch {
            continue; // a file, not a group directory
        }
        for (const pkg of entries) {
            const manifest = join(groupDir, pkg, 'package.json');
            if (!existsSync(manifest)) continue;
            try {
                const json = JSON.parse(readFileSync(manifest, 'utf8'));
                if (json.name) byName.set(json.name, { json, dir: join(groupDir, pkg) });
            } catch {
                // A manifest that does not parse is `check-manifests`' problem, not this one.
            }
        }
    }
    return byName;
}

/** `gjsify build` as a COMMAND — not `gjsify build:gjsify`, not `--app build`. */
const BUNDLER_CALL = /(?:^|&&|\|\||;)\s*gjsify\s+build(?=\s|$)/;

/**
 * A `node <file>.mjs` call — which on a NODE-LESS GJS host also reaches the
 * bundler, and is nonetheless allowed in the pre-facade prefix.
 *
 * There is no `node` to spawn there, so `ensureGjsifyShimOnPath()` puts one on
 * PATH that re-enters the CLI as `gjsify run --node-script <file>`, bundling the
 * script first. What separates it from the shape that broke is WHICH ENGINE
 * serves the bundle: `gjsify build --library` for a WORKSPACE package needs
 * `@gjsify/rolldown-native`'s facade, the artifact the chain has not built yet,
 * whereas the shim is served by the engine the CLI itself carries
 * (`installGjsEnginePackages()` put it in the global prefix), reachable with
 * nothing built in the workspace at all.
 *
 * Reported separately rather than folded into `cleared`: a summary calling these
 * clauses "tsc-only" is FALSE on the one host the guard is about.
 */
const NODE_SCRIPT_CALL = /(?:^|&&|\|\||;)\s*node\s+\S+\.mjs(?=\s|$)/;

/**
 * Every command a package script runs, following `gjsify run <script>` within the
 * same package. The visited set is what makes a self-referencing script terminate.
 */
function commandsOf(pkg, scriptName, seen = new Set()) {
    if (seen.has(scriptName)) return [];
    seen.add(scriptName);
    const body = pkg.scripts?.[scriptName];
    if (!body) return [];
    const out = [body];
    for (const m of body.matchAll(/gjsify\s+run\s+([\w:.-]+)/g)) {
        out.push(...commandsOf(pkg, m[1], seen));
    }
    return out;
}

const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const chain = rootManifest.scripts?.['build:infra'];
if (!chain) {
    console.error('::error::root package.json has no `build:infra` script — this check is blind.');
    process.exit(1);
}

const clauses = chain.split(' && ').map((c) => c.trim());
const facadeAt = clauses.findIndex((c) => c.includes(FACADE_SCRIPT));
if (facadeAt === -1) {
    console.error(
        `::error::no \`build:infra\` clause runs ${FACADE_SCRIPT}. Either the bootstrap moved out of the ` +
            'chain (then this check needs to follow it) or the chain lost it (then every GJS cold-tree ' +
            'build is broken). Both are failures, neither is a silent pass.',
    );
    process.exit(1);
}

const byName = packageIndex();
const problems = [];
const cleared = [];
/** Pre-facade clauses that bundle through the CLI's OWN engine on a Node-less host. */
const cliEngine = [];

for (let i = 0; i < facadeAt; i++) {
    const m = /^gjsify workspace (\S+) ([\w:.-]+)/.exec(clauses[i]);
    if (!m) continue; // not a workspace build clause — nothing to resolve
    const [, name, script] = m;
    const pkg = byName.get(name)?.json;
    if (!pkg) {
        problems.push(
            `clause ${i + 1} builds ${name}, which no manifest under packages/ declares — ` +
                'the resolution is blind, so this cannot be cleared.',
        );
        continue;
    }
    const commands = commandsOf(pkg, script);
    if (!commands.length) {
        problems.push(`clause ${i + 1}: ${name} has no \`${script}\` script — the clause cannot succeed.`);
        continue;
    }
    const bundler = commands.find((c) => BUNDLER_CALL.test(c));
    if (bundler) {
        problems.push(
            `clause ${i + 1} runs \`${name} ${script}\`, which reaches \`${bundler.trim()}\` — a BUNDLER ` +
                `build, ${facadeAt - i} clause(s) before ${FACADE_SCRIPT} produces the bundler. Under GJS ` +
                'this cannot work on a cold tree (it is how v0.31.0 failed to publish @gjsify/napi). ' +
                `Use a tsc-only script here (\`build:types\`) and move the full build after clause ${facadeAt + 1}.`,
        );
    } else if (commands.some((c) => NODE_SCRIPT_CALL.test(c))) {
        cliEngine.push(`${name} ${script}`);
    } else {
        cleared.push(`${name} ${script}`);
    }
}

// The positive fact: a check that resolved nothing must not report success.
if (!cleared.length && !cliEngine.length && !problems.length) {
    console.error(
        '::error::no `build:infra` clause before the facade resolved to a package script. The clause ' +
            'spelling changed and this check silently stopped reading it.',
    );
    process.exit(1);
}

console.log(
    `build-infra-order: ${cleared.length} pre-facade clause(s) are tsc-only, ` +
        `${cliEngine.length} bundle through the CLI's own engine on a Node-less host, ` +
        `${clauses.length - facadeAt - 1} clause(s) run after ${FACADE_SCRIPT}.`,
);
for (const c of cleared) console.log(`  · ${c}`);
for (const c of cliEngine) console.log(`  · ${c} (cli engine)`);
for (const p of problems) console.error(`  ✗ ${p}`);

// ---------------------------------------------------------------------------
// RULE 2 — a clause may not type-check against declarations no earlier clause
// has emitted.
//
// THE INVARIANT
//
// Each clause compiles against whatever the clauses BEFORE it produced. A
// workspace package's types resolve through its `exports` map into `lib/`, which
// a cold checkout does not have — so importing `@gjsify/X` from a package built
// before X is a build that only succeeds on a tree someone already warmed.
//
// THE INCIDENT
//
// #1133 gave `@gjsify/unit` an import of `@gjsify/runtime`, which built later:
// `TS2307: Cannot find module '@gjsify/runtime'`. #1237 then added
// `holdMainLoop` to `@gjsify/utils` and imported it from the CLI — which builds
// TEN clauses before utils — and got `TS2305: … has no exported member`. The two
// error codes are the same defect seen from different cache states: cold gives
// TS2307 (no declaration file at all), warm-but-STALE gives TS2305 (last
// release's declaration file, missing the new export). The stale-warm shape is
// the nastier one, because it also fires on the incremental CI legs, not only on
// the cold ones nobody runs per-PR.
//
// WHY THIS RULE AND NOT AN ORDER DERIVED FROM THE DEPENDENCY GRAPH
//
// Deriving the order was measured and does not work: sorting the tail
// topologically over production deps puts `@gjsify/canvas2d-core` first and
// `@gjsify/unit` last, while canvas2d-core's `build:types` compiles spec files
// that import `@gjsify/unit` — the edge is a devDependency, which no production
// sort can see, and the dev graph is cyclic. Two cheaper rules were also tried
// and rejected for crying wolf: "every workspace dependency must be built
// earlier" (a dependency only has to EXIST if something COMPILED imports it) and
// the same rule scanning all of `src/**` (which counts spec files no build
// compiles). Both were missing the same fact — WHICH FILES the package's own
// `build:types` actually feeds to tsc. That is what this rule reads.
//
// WHAT MAKES A DEPENDENCY SATISFIED
//
//   · an earlier clause ran that package's `build` or `build:types`; or
//   · the clause passes `-d`/`--with-dependencies`, which builds the package's
//     production closure first (this is why `@gjsify/process` may import
//     `@gjsify/string_decoder`); or
//   · the declaration file is TRACKED IN GIT, so a cold checkout already has it
//     (`@gjsify/resolve-npm` commits its `lib/`, via a `!lib/` .gitignore rule).

/**
 * Strip comments STRING-AWARE. A regex cannot do this: the glob `src/**` + `/*.ts`
 * contains a syntactically complete empty block comment, so a naive stripper
 * rewrites that include pattern and the compiled file list silently collapses to
 * the `files` entries — a check that then reports a clean tree for the wrong
 * reason.
 */
function readJsonc(file) {
    const src = readFileSync(file, 'utf8');
    let out = '';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '"') {
            let j = i + 1;
            while (j < src.length && !(src[j] === '"' && src[j - 1] !== '\\')) j++;
            out += src.slice(i, j + 1);
            i = j;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? src.length : end + 1;
            continue;
        }
        out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** `files`/`include`/`exclude` of a tsconfig, one `extends` level deep. */
function tsconfigInputs(pkgDir, configName) {
    const path = join(pkgDir, configName);
    if (!existsSync(path)) return null;
    const cfg = readJsonc(path);
    const dir = dirname(path);
    let { files, include, exclude } = cfg;
    if (cfg.extends) {
        const guess = resolve(dir, cfg.extends);
        const parentPath = existsSync(guess) ? guess : `${guess}.json`;
        if (existsSync(parentPath)) {
            const parent = readJsonc(parentPath);
            files ??= parent.files;
            include ??= parent.include;
            exclude ??= parent.exclude;
        }
    }
    const rooted = new Set();
    const forced = new Set((files ?? []).map((f) => resolve(dir, f)));
    for (const f of forced) rooted.add(f);
    for (const pattern of include ?? (files ? [] : ['**/*'])) {
        for (const hit of globSync(pattern, { cwd: dir })) rooted.add(resolve(dir, hit));
    }
    const excluded = new Set();
    for (const pattern of exclude ?? ['node_modules']) {
        for (const hit of globSync(pattern, { cwd: dir })) excluded.add(resolve(dir, hit));
    }
    // tsconfig's `exclude` narrows `include`; it never drops an explicit `files` entry.
    return [...rooted].filter((f) => /\.(m|c)?tsx?$/.test(f) && (forced.has(f) || !excluded.has(f)));
}

/**
 * Blank comments and TEMPLATE literals, keep ordinary quoted strings.
 *
 * Both hide specifiers that are not imports of THIS package. The expensive one
 * is a CLI command that GENERATES a consumer entry file as a template literal
 * containing a real `import … from '@gjsify/devtools-mcp'` line: nothing
 * type-checks it here, it is text. Quoted strings must survive, because the
 * specifier of a real import is one.
 */
function blankNonCode(src) {
    let out = '';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') {
            // Length-PRESERVING: `isSuppressed` looks the `@ts-ignore` up by the
            // match index, so blanking may not move any character of the file.
            const start = i;
            while (i < src.length && src[i] !== '\n') i++;
            out += ' '.repeat(i - start);
            i--;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const chunk = src.slice(i, end === -1 ? src.length : end + 2);
            out += chunk.replace(/[^\n]/g, ' ');
            i = end === -1 ? src.length : end + 1;
            continue;
        }
        if (c === '`') {
            let j = i + 1;
            let depth = 0;
            while (j < src.length) {
                if (src[j] === '\\') {
                    j += 2;
                    continue;
                }
                if (src[j] === '`' && depth === 0) break;
                if (src[j] === '$' && src[j + 1] === '{') {
                    depth++;
                    j += 2;
                    continue;
                }
                if (src[j] === '}' && depth > 0) depth--;
                j++;
            }
            out += src.slice(i, j + 1).replace(/[^\n]/g, ' ');
            i = j;
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c) {
                if (src[j] === '\\') j++;
                j++;
            }
            out += src.slice(i, j + 1);
            i = j;
            continue;
        }
        out += c;
    }
    return out;
}

/**
 * Import statements only, anchored to the start of a line.
 *
 * Anchoring is what keeps an error message like
 * `"import '@gjsify/compression-streams/register' on GJS to register it"` — a
 * quoted string, deliberately preserved above — from reading as an import.
 */
const IMPORT_STATEMENT =
    /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]|^[ \t]*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** A `@ts-ignore`/`@ts-expect-error` on the line above is the author declaring tsc does not resolve it. */
function isSuppressed(src, index) {
    const before = src.slice(0, index);
    const prev = before.slice(before.lastIndexOf('\n', before.length - 2) + 1);
    return /@ts-(?:ignore|expect-error)/.test(prev);
}

/** Workspace specifiers a package's own type-check inputs import, spec -> "file: specifier". */
function typeCheckedImports(files) {
    const found = new Map();
    for (const file of files) {
        let raw;
        try {
            raw = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        const code = blankNonCode(raw);
        for (const m of code.matchAll(IMPORT_STATEMENT)) {
            const spec = m[1] ?? m[2] ?? m[3];
            if (!spec?.startsWith('@gjsify/')) continue;
            if (isSuppressed(raw, m.index)) continue;
            const name = spec.split('/').slice(0, 2).join('/');
            if (!found.has(name)) found.set(name, { file, spec });
        }
    }
    return found;
}

/** The declaration file a specifier resolves to, relative to the package dir. */
function typesTargetOf(manifest, specifier, name) {
    const sub = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
    const exports = manifest.exports ?? {};
    const pick = (value) => {
        if (typeof value === 'string') return value.endsWith('.d.ts') ? value : null;
        if (value && typeof value === 'object') return value.types ?? null;
        return null;
    };
    if (exports[sub] !== undefined) return pick(exports[sub]);
    for (const [key, value] of Object.entries(exports)) {
        if (!key.includes('*')) continue;
        const [head, tail] = key.split('*');
        if (!sub.startsWith(head) || !sub.endsWith(tail)) continue;
        const star = sub.slice(head.length, sub.length - tail.length);
        const target = pick(value);
        if (target) return target.replace('*', star);
    }
    return manifest.types ?? manifest.typings ?? null;
}

/** Production workspace closure of a package — what `-d` builds before the clause itself. */
function productionClosure(name, index, seen = new Set()) {
    if (seen.has(name)) return seen;
    seen.add(name);
    const manifest = index.get(name)?.json;
    for (const dep of Object.keys(manifest?.dependencies ?? {})) {
        if (index.has(dep)) productionClosure(dep, index, seen);
    }
    return seen;
}

const tracked = new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\0')
        .filter(Boolean),
);

/** Clause index at which each package's declarations first exist. */
const typedAt = new Map();
for (const [i, clause] of clauses.entries()) {
    const m = /^gjsify workspace (\S+) ([\w:.-]+)/.exec(clause);
    if (!m || !/^build(?::types)?$/.test(m[2])) continue;
    if (!typedAt.has(m[1])) typedAt.set(m[1], i);
    if (/\s(?:-d|--with-dependencies)(?:\s|$)/.test(clause)) {
        for (const dep of productionClosure(m[1], byName)) {
            if (!typedAt.has(dep)) typedAt.set(dep, i);
        }
    }
}

const orderProblems = [];
let scanned = 0;
let inputsSeen = 0;

for (const [i, clause] of clauses.entries()) {
    const m = /^gjsify workspace (\S+) ([\w:.-]+)/.exec(clause);
    if (!m) continue;
    const [, name, script] = m;
    const entry = byName.get(name);
    if (!entry) continue; // rule 1 already reported the unresolvable clause
    const tscCall = commandsOf(entry.json, script).find((c) => /gjsify\s+tsc\b/.test(c));
    if (!tscCall) continue; // no type-check in this clause, nothing to order
    const projectFlag = /gjsify\s+tsc\b[^&|;]*?\s-p\s+(\S+)/.exec(tscCall);
    const configName = projectFlag ? projectFlag[1] : 'tsconfig.json';
    const inputs = tsconfigInputs(entry.dir, configName);
    if (inputs === null) {
        orderProblems.push(
            `clause ${i + 1} runs \`${name} ${script}\`, whose tsc reads ${configName} — which does not ` +
                'exist. Either the clause cannot succeed or this check is reading the wrong config.',
        );
        continue;
    }
    scanned++;
    inputsSeen += inputs.length;
    const withDeps = /\s(?:-d|--with-dependencies)(?:\s|$)/.test(clause);
    const closure = withDeps ? productionClosure(name, byName) : new Set([name]);
    for (const [dep, { file, spec }] of typeCheckedImports(inputs)) {
        if (closure.has(dep)) continue;
        const depEntry = byName.get(dep);
        if (!depEntry) continue; // not a workspace package — npm resolves it
        const at = typedAt.get(dep);
        if (at !== undefined && at < i) continue;
        const target = typesTargetOf(depEntry.json, spec, dep);
        if (!target) continue; // no declaration entry to resolve — nothing this rule can assert
        const rel = relative(ROOT, resolve(depEntry.dir, target)).split(sep).join('/');
        if (tracked.has(rel)) continue; // committed declarations survive a cold checkout
        const builtLater = at === undefined ? 'is never built by `build:infra`' : `is built at clause ${at + 1}`;
        orderProblems.push(
            `clause ${i + 1} runs \`${name} ${script}\`, whose tsc compiles ` +
                `${relative(ROOT, file).split(sep).join('/')} — it imports '${spec}', but ${dep} ${builtLater}. ` +
                `Its declarations (${target}) are not committed, so a cold tree has none and a warm tree has ` +
                "the PREVIOUS build's. Emit them earlier — a `build:types` clause before this one is enough.",
        );
    }
}

// The positive fact again: a rule that scanned nothing must not report success.
if (!scanned || !inputsSeen) {
    console.error(
        '::error::the type-ordering rule resolved no tsconfig inputs at all. The clause spelling or the ' +
            'tsconfig layout changed and this rule silently stopped reading them.',
    );
    process.exit(1);
}

console.log(`build-infra-order: type-ordering rule read ${inputsSeen} compiled file(s) across ${scanned} clause(s).`);
for (const p of orderProblems) console.error(`  ✗ ${p}`);

const total = problems.length + orderProblems.length;
if (total) {
    console.error(`build-infra-order: ${total} problem(s).`);
    process.exit(1);
}
