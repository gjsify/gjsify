#!/usr/bin/env node
// No workflow resolves a `@gjsify/*` closure from npm through a bare `npm install`.
//
// THE INCIDENT
//
// v0.46.0 (run 33735989472) went red in three jobs, all in the same step and none of
// them in a publish: `Prepare a Node-runnable @gjsify/cli` died with
//
//   npm error code ETARGET
//   npm error notarget No matching version found for @gjsify/child_process@^0.46.0.
//
// on a version the publish client had PUT 3m56s earlier (09:25:10 vs an ETARGET at
// 09:29:06), and which npm's own `time` field records at 09:29:21 — fifteen seconds
// AFTER the installer that could not find it gave up. The ordering was correct
// (`needs: publish`, dependency 3m21s before dependent); npm served a packument older
// than a PUT it had already acknowledged. Attempt 3 of the same run was green with no
// change to the tree.
//
// WHY A CHECK AND NOT JUST THE FIX. Four jobs carried that step, and the three that
// went red were simply the three that started earliest — `publish-napi` at 09:29:37
// and the gtk-runtime legs at 09:31:19 ran the identical command and passed. So the
// defect was never in those three jobs; it was in a SHAPE that four of them shared and
// that any new publish leg would copy. `release.yml` never runs on a pull request, so
// a fifth copy would be reviewed by nobody and would first execute during a release —
// the same argument that puts `check-workflow-inline-scripts.mjs` in this job.
//
// WHAT IT CHECKS
//
// Every line in `.github/workflows/*.y{a,}ml` and `.github/actions/*/action.yml` that
// hands an install verb (`npm|pnpm|yarn` × `install|i|ci|add|exec`, or `npx`) a
// `@gjsify/*` spec must route through `scripts/npm-install-published.mjs`.
// `scripts/bootstrap-published-cli.mjs` never trips it: it derives the spec itself, so
// no workflow line names one.
//
// WHY THE SPELLINGS ARE A CORPUS AND NOT A REGEX SOMEBODY EYEBALLED. The first draft
// recognised exactly the four shapes already in the tree, and an adversarial pass found
// eight it did not: `npm add`, `npm exec`, a `pnpm`/`yarn` front, a version interpolated
// into the NAME (`@gjsify/gtk-runtime-$TARGET@latest`), an unversioned name (npm
// resolves `latest`, which during a release sweep is this very closure), a spec split
// across a `\` continuation — the formatting the routed call sites in `macos-suites.yml`
// themselves use — and a bare install whose line merely MENTIONS
// `npm-install-published.mjs` in a trailing `#` comment, which the substring exemption
// then blessed. So the patterns are held by MUST_FLAG/MUST_PASS below, run on every
// invocation, in the construction `check-workflow-run-syntax.mjs` uses: a detector that
// has stopped detecting must fail rather than report "clean".
//
// KNOWN GAPS, stated rather than implied. This reads LINES, not YAML: a shell `#`
// inside a quoted string truncates the line early (a false negative, never a false
// positive), and an install performed by a script the workflow merely calls is outside
// this check by construction.
//
// `ALLOWED` is self-retiring — an entry that no CODE line matched during the scan
// FAILS, so an exemption cannot outlive its cause, and commenting the line out retires
// it exactly as deleting it does — and every entry is printed on every run.
//
// Usage: node scripts/check-workflow-registry-installs.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

/**
 * `relative()` answers in HOST separators, and every `ALLOWED.file` is written with
 * `/` because it is an identifier in this source, not a path on the runner. Comparing
 * them directly made `a.file === file` false for EVERY entry on Windows, so nothing
 * was ever recorded as hit and all four exemptions reported as stale — while the rows
 * above still printed as `allowed`, which is how the same log said both at once.
 * Measured on `Manifest checks (Windows)`: exit 1 on a tree whose Linux run exits 0.
 * The declared-exceptions ledger this repository keeps for `path.sep` is about exactly
 * this crossing: a portable identifier is `/`-separated, and the conversion belongs at
 * the boundary rather than at the comparison.
 *
 * Takes the separator so a Linux run can exercise the Windows crossing: with `sep`
 * alone the helper is a no-op here and the defect is unprovable off Windows. It is NOT
 * a both-separator helper on purpose — this repository's declared-exceptions ledger
 * argues that case repeatedly, since splitting on both would corrupt a legitimate
 * Linux filename containing a backslash.
 */
const toPosix = (p, s = sep) => p.split(s).join('/');

const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];
const GITHUB_DIR = join(ROOT, '.github');

/** The one wrapper. A line naming it has already answered the question. */
const WRAPPER = 'npm-install-published.mjs';

/** The verbs that make a package manager resolve a tree. `add`/`exec` are npm aliases. */
const INSTALL_VERB = /\b(?:npm|pnpm|yarn)\s+(?:install|i|ci|add|exec)\b|\bnpx\b/;

/**
 * A `@gjsify/*` argument in any spelling a shell or YAML can produce: pinned
 * (`@gjsify/cli@0.46.0`), dist-tagged (`@latest`), interpolated (`@gjsify/$TARGET@…`,
 * `@gjsify/${{ matrix.pkg }}@…`) or bare (`@gjsify/cli`, which npm resolves as
 * `latest` — during a release sweep that is the closure this whole file is about).
 */
const GJSIFY_SPEC = /@gjsify\/[^\s"'`]/;

/**
 * `name:` and `description:` carry free prose, and this repo's step names quote the
 * command the step runs ("Scaffold a minimal gjsify project (npm install @gjsify/cli)").
 * Excluding those two keys is what lets the spec pattern accept an unversioned name
 * without the check reporting its own documentation as a finding.
 */
const YAML_PROSE = /^\s*-?\s*(?:name|description):/;

/**
 * Lines allowed to resolve a `@gjsify/*` spec directly, each with the reason the
 * wrapper does not belong there. `snippet` must still match a CODE line of `file`, or
 * this check fails on the stale entry. `file` is relative to `.github/`.
 *
 * @type {Array<{ file: string, snippet: string, why: string }>}
 */
const ALLOWED = [
    {
        file: 'workflows/cli-cross-platform.yml',
        snippet: 'npm install --no-audit --no-fund --no-save "@gjsify/node-gi@latest" > npm-nodegi.log',
        why: [
            'the FAILURE is an outcome this step MAPS, not a verdict it reports. node-gi declares',
            '`scripts.install: node-gyp rebuild`, so the step exists to find out whether a source build is',
            'forced on this OS; the surrounding shell keeps `install_ok` and then attributes a rollback',
            'against a version bound. Routing it would change nothing about the failure it measures — a',
            'node-gyp exit is `npm error code 1`, which the classifier already calls fatal — and would',
            'spend a 10-minute window before an `install_ok=0` this step may report at once.',
        ].join(' '),
    },
    {
        file: 'workflows/cli-cross-platform.yml',
        snippet: '"@gjsify/node-gi@latest" "@gjsify/gtk-runtime-$TARGET@latest" > npm-load.log',
        why: [
            'same step shape as the row above, one probe further: `|| true` under `continue-on-error`,',
            'because a failed install IS one of the outcomes this leg maps. Its subject is the bundled GTK',
            'runtime loading, not resolution. RESIDUAL, stated: a propagation lag on either `@latest`',
            'closure would be reported here as "the addon does not load" — an advisory false negative.',
        ].join(' '),
    },
    {
        file: 'workflows/cli-cross-platform.yml',
        snippet: 'npx --yes "@gjsify/cli@${CLI_VERSION}" install "@gjsify/cli@${CLI_VERSION}"',
        why: [
            'the resolver under test is GJSIFY’s install backend, not npm’s — the assertion is that',
            '`linkBins` writes a runnable shim (the win32 cmd-shim trio). This is a STATED GAP rather than',
            'a solved one: the wrapper speaks `npm install` and cannot wrap an `npx`, and `npx --yes',
            '@gjsify/cli@latest` DOES resolve the same transitive closure the v0.46.0 incident lagged on —',
            'a resolving dist-tag is not the whole question, as the sparse-checkout note in this same file',
            'says of the scaffold step. What bounds it is `continue-on-error: true`: a lag costs an advisory',
            'false negative on one leg, never a red release. Closing it means staging the CLI through the',
            'wrapper and invoking the installed entry instead of `npx`.',
        ].join(' '),
    },
    {
        file: 'workflows/cli-cross-platform.yml',
        snippet: 'npx gjsify install @gjsify/path',
        why: [
            '`npx` here runs the gjsify bin ALREADY present in this working directory — the scaffold step',
            'installed it — so no registry read stages it, and `@gjsify/path` is resolved by gjsify’s own',
            'install backend, which is the thing under test. Visible to this check only since it began',
            'accepting an unversioned name; kept as a row so the next reader sees that it was read.',
        ].join(' '),
    },
];

/**
 * The code half of one physical line: a comment cannot run npm, and these workflows
 * quote npm commands in prose constantly. STRIPPING rather than skipping the whole line
 * is what stops a trailing `# … npm-install-published.mjs` from exempting the bare
 * install in front of it.
 */
function codeOf(line) {
    return line.replace(/(?:^|\s)#.*$/, '');
}

/**
 * One file's logical lines: comments stripped FIRST, then `\` continuations joined —
 * that order, because a `\` inside a comment is not a continuation. Each entry carries
 * the number of the physical line the logical one STARTS on.
 *
 * @returns {Array<[number, string]>}
 */
export function logicalLines(text) {
    const out = [];
    let buffer = null;
    let start = 0;
    text.split('\n').forEach((raw, index) => {
        const code = codeOf(raw);
        const continued = /\\\s*$/.test(code);
        const body = code.replace(/\\\s*$/, '');
        if (buffer === null) {
            start = index + 1;
            buffer = body;
        } else {
            buffer += ` ${body.trim()}`;
        }
        if (!continued) {
            out.push([start, buffer]);
            buffer = null;
        }
    });
    if (buffer !== null) out.push([start, buffer]);
    return out;
}

/**
 * Every logical line of `text` that resolves a `@gjsify/*` spec through an install verb
 * without the wrapper. Exemptions are NOT applied here — the caller matches them, so an
 * entry that matched nothing can be reported as stale.
 *
 * @returns {Array<{ line: number, text: string }>}
 */
export function findRegistryInstalls(text) {
    const found = [];
    for (const [line, code] of logicalLines(text)) {
        if (!code.trim() || YAML_PROSE.test(code)) continue;
        if (!INSTALL_VERB.test(code) || !GJSIFY_SPEC.test(code)) continue;
        if (code.includes(WRAPPER)) continue;
        found.push({ line, text: code.trim() });
    }
    return found;
}

/**
 * The detector must DISCRIMINATE, or a green run means nothing — same construction as
 * `check-workflow-run-syntax.mjs`. MUST_FLAG holds the spellings an adversarial pass
 * produced against the first draft, every one of which it missed; MUST_PASS holds what
 * the widened patterns must NOT claim, the step-name prose included.
 */
const MUST_FLAG = [
    'npm add "@gjsify/cli@0.46.0"',
    'npm exec "@gjsify/cli@0.46.0" -- --version',
    'npm i -g "@gjsify/cli@0.46.0"',
    'pnpm add "@gjsify/cli@0.46.0"',
    'npm install "@gjsify/cli@$env:CLI_VERSION"',
    'npm install "@gjsify/gtk-runtime-$TARGET@latest"',
    'npm install @gjsify/cli --no-save',
    'npm install "@gjsify/cli@0.46.0"   # TODO route via npm-install-published.mjs',
    'npm install --no-audit \\\n  "@gjsify/cli@0.46.0"',
];
const MUST_PASS = [
    'node scripts/npm-install-published.mjs -- "@gjsify/cli@0.46.0" --no-audit',
    'node scripts/npm-install-published.mjs -- \\\n  --prefix "$RUNNER_TEMP/x" @gjsify/cli@latest',
    '- name: Scaffold a minimal gjsify project (npm install @gjsify/cli)',
    '# npm install "@gjsify/cli@0.46.0"',
    'npm install -g corepack',
    'npm run build --workspace @gjsify/cli',
];

function selfTest() {
    const broken = [];
    for (const shape of MUST_FLAG) {
        if (findRegistryInstalls(shape).length !== 1) broken.push(`MUST_FLAG missed: ${JSON.stringify(shape)}`);
    }
    for (const shape of MUST_PASS) {
        if (findRegistryInstalls(shape).length !== 0) broken.push(`MUST_PASS flagged: ${JSON.stringify(shape)}`);
    }
    // The exemption KEY, which the pattern corpus above does not reach. `relative()`
    // answers in host separators while every `ALLOWED.file` is a `/`-spelled identifier
    // in this source, so a direct comparison matched nothing on Windows: all four
    // exemptions reported stale there on a tree whose Linux run exited 0, and the same
    // log printed them as `allowed` one screen earlier.
    // LIMIT, stated rather than implied: this holds the HELPER and the ledger's
    // spelling, not the call site. Deleting `toPosix(...)` from the scan loop is a
    // no-op on a host whose `sep` is already `/`, so a Linux run still exits 0 —
    // measured. What holds the call site is the Windows leg, which is what caught
    // this in the first place. Simulating a foreign host across the whole scan would
    // be more machinery than the risk warrants while that leg runs on every PR.
    if (toPosix('workflows\\cli.yml', '\\') !== 'workflows/cli.yml') {
        broken.push('exemption key derivation is not separator-independent');
    }
    for (const a of ALLOWED) {
        if (a.file.includes('\\')) broken.push(`ALLOWED.file must be /-spelled: ${a.file}`);
    }
    return broken;
}

/** `.github/workflows/*.y{a,}ml` plus every composite action — same set as run-syntax. */
function workflowFiles() {
    const out = [];
    const wfDir = join(GITHUB_DIR, 'workflows');
    if (existsSync(wfDir)) {
        for (const name of readdirSync(wfDir)) {
            if (name.endsWith('.yml') || name.endsWith('.yaml')) out.push(join(wfDir, name));
        }
    }
    const actionsDir = join(GITHUB_DIR, 'actions');
    if (existsSync(actionsDir)) {
        for (const name of readdirSync(actionsDir)) {
            const f = join(actionsDir, name, 'action.yml');
            if (existsSync(f)) out.push(f);
        }
    }
    return out.sort();
}

const broken = selfTest();
if (broken.length > 0) {
    console.error('check-workflow-registry-installs: the DETECTOR is broken — it cannot report on the tree:');
    for (const b of broken) console.error(`  ${b}`);
    process.exit(1);
}

const findings = [];
const hits = new Set();
const files = workflowFiles();

for (const path of files) {
    const file = toPosix(relative(GITHUB_DIR, path));
    for (const found of findRegistryInstalls(readFileSync(path, 'utf8'))) {
        const exemption = ALLOWED.find((a) => a.file === file && found.text.includes(a.snippet));
        if (exemption) {
            hits.add(exemption);
            continue;
        }
        findings.push({ file, ...found });
    }
}

console.log(
    `check-workflow-registry-installs: read ${files.length} file(s) under ${relative(ROOT, GITHUB_DIR)}, ` +
        `${MUST_FLAG.length} must-flag + ${MUST_PASS.length} must-pass shapes green`,
);
for (const a of ALLOWED) {
    // `hits` is what decides staleness below, so print the same fact here. Printing
    // `allowed` unconditionally is what let one run claim `allowed` and `stale` for
    // all four of the same entries.
    console.log(`  ${hits.has(a) ? 'allowed' : 'UNMATCHED'}  ${a.file}: ${a.snippet}`);
    console.log(`           ${a.why}`);
}

const stale = ALLOWED.filter((a) => !hits.has(a));
if (stale.length > 0) {
    console.error('\ncheck-workflow-registry-installs: stale ALLOWED entr(y|ies) — no code line matches:');
    for (const a of stale) console.error(`  ${a.file}: ${a.snippet}`);
    console.error('An exemption must not outlive its cause. Delete the entry.');
    process.exit(1);
}

if (findings.length > 0) {
    console.error('\ncheck-workflow-registry-installs: a bare npm install of a @gjsify/* spec:');
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`);
    console.error(
        '\nRoute it through `node scripts/npm-install-published.mjs -- <npm args>` (or, for a release\n' +
            "leg's Node-runnable CLI, `node scripts/bootstrap-published-cli.mjs`). npm can serve a\n" +
            'packument older than a PUT it has acknowledged, and that ETARGET is not a verdict — the\n' +
            'measurement is in the wrapper’s header. If the failure genuinely IS the measurement, add an\n' +
            'ALLOWED entry here saying so.',
    );
    process.exit(1);
}

console.log(`clean — no workflow resolves a @gjsify/* spec without ${WRAPPER}`);
