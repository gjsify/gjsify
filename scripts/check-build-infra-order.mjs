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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const rootIndex = process.argv.indexOf('--root');
const ROOT = rootIndex === -1 ? '.' : process.argv[rootIndex + 1];
const FACADE_SCRIPT = 'bootstrap-native-facades.mjs';

/** name -> package.json, for every manifest under `packages/<group>/<pkg>/`. */
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
                if (json.name) byName.set(json.name, json);
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
    const pkg = byName.get(name);
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

if (problems.length) {
    console.error(`build-infra-order: ${problems.length} problem(s).`);
    process.exit(1);
}
