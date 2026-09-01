/**
 * Rule `os-axis` — a package that makes an OS decision declares what it claims
 * per operating system, and every claim below `supported` states why.
 *
 * WHY THIS EXISTS (ADR 0018)
 *
 * Linux, macOS and Windows are a project goal, and the model insists that no
 * declaration exists without a machine check. The OS axis was the one that did
 * not hold up. Measured on `main` at 2026-08-05 over 190 manifests: 106 declared
 * `gjsify.runtimes`, 74 declared `gjsify.platforms`, 16 branched on the OS in
 * their own source — and TEN of those sixteen declared no OS axis at all,
 * including `@gjsify/cli`, the one package that writes `PATH` /
 * `DYLD_LIBRARY_PATH` / `LD_LIBRARY_PATH` per host and generates the launcher
 * every other package is started through.
 *
 * Neither existing axis can close that. `gjsify.platforms` answers a different
 * question by design ("I promise a prebuilt ARTIFACT for these `<os>-<arch>`
 * targets", checked by opening the binary), so a package with no native build
 * has nothing to declare in it — which is why the axis is declared almost
 * exclusively by packages that ship a binary and absent from nearly every
 * package that makes a DECISION. And the runtime axis is blind to operating
 * systems ON PURPOSE; that blindness is already documented as measured — the
 * whole native-bridge set stayed Linux-only while the project described itself
 * as platform-independent.
 *
 * The cost was four defects found in a single day of running the published
 * 0.28.0 on the Windows and macOS test VMs, none of which any existing check
 * could have surfaced, because every one lives in code that branches on the OS
 * while declaring nothing about it. The sharpest: the release gate that was
 * supposed to cover the darwin one counted `iconFiles: 860` and `verified
 * icons: 863` — FILE COUNTS, which a bundle of unloadable binaries passes.
 *
 * THE CANDIDATE SET IS DERIVED, NOT AUTHORED
 *
 * For a package with no OS-conditional code, OS support derives to all three
 * and authoring it would restate a derivable fact — which the status and
 * conformance rules already forbid. For a package that BRANCHES, the claim
 * carries information no derivation can produce: nothing in
 * `if (process.platform === 'win32') …` says whether that branch is correct or a
 * stub. So the rule computes who owes a declaration and demands it only there.
 * A new package pays nothing unless it makes an OS decision.
 *
 * WHY SHIPPING SOURCE ONLY — a narrowing of the ADR's own measurement
 *
 * The ADR's sixteen were counted over `src/**`, which includes `*.spec.ts`. That
 * over-counts: a spec that branches on the OS is making a claim about the TEST,
 * not about what the package supports, and the sanctioned instrument there is
 * already `it.failing(name, fn, reason, { when })` — which RUNS the assertion,
 * tolerates the failure on one OS only, and fails the day it starts passing.
 * Demanding a package-level support claim because a test file knows what OS it
 * is on would put the declaration in the wrong place and make it drift from the
 * `when` predicate that actually holds. Measured on this branch: excluding test
 * sources moves `@gjsify/fs`, `@gjsify/node-globals` and `@gjsify/web-globals`
 * out of the candidate set, and each is a package whose OS knowledge lives
 * entirely in its specs.
 *
 * Private packages are skipped for the same reason in the other direction: a
 * declaration is a promise to a CONSUMER, and examples and templates have none.
 *
 * WHAT COUNTS AS AN OS DECISION
 *
 * Reading the host's operating system at all. Since the `host-os` refactor the
 * canonical spelling is `@gjsify/utils/core`'s `isWin32()` / `isDarwin()` /
 * `isLinux()` / `hostOs()` / `hostPlatform()`, but the raw reads stay in the
 * list because infra deliberately keeps its own: `packages/infra/cli`'s
 * `platform-check.ts` documents a PURITY philosophy where every decision
 * function takes the host triple as a PARAMETER, so routing it through an
 * ambient helper would work against the design rather than with it. Both routes
 * are an OS decision and both owe a declaration; only the spelling differs.
 */

import { defineRule } from '../registry.mjs';
import { isNonShippingSource, listSourceFiles } from '../source-graph.mjs';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * The three operating systems ADR 0018 declares as the target set.
 *
 * Deliberately NARROWER than `process.platform`'s vocabulary: the emulated
 * `linux-{ppc64,s390x,riscv64}` legs are build-verified only and are an ARCH
 * question, which lives on `gjsify.platforms`. Keeping the two axes from
 * answering each other's question is the point of having both.
 */
export const TARGET_OSES = ['linux', 'darwin', 'win32'];

/** The claim vocabulary, weakest last. */
export const OS_CLAIMS = ['supported', 'partial', 'none'];

/**
 * How a package can read the host OS. Each entry has a package behind it —
 * add on sight, never speculatively, the way `portable-scripts` does.
 */
const OS_DECISION_PATTERNS = [
    // The canonical route: `@gjsify/utils/core`'s host-os helpers.
    /\b(?:isWin32|isDarwin|isLinux|hostOs|hostPlatform)\s*\(/,
    // The raw ambient read, in every spelling that reaches `process.platform`.
    /\bprocess\s*\.\s*platform\b/,
    // A destructured `platform` binding off `node:process` / `node:os`. The
    // bare `from 'node:process'` is NOT enough — it also exports argv and env.
    /import\s*\{[^}]*\bplatform\b[^}]*\}\s*from\s*['"]node:(?:process|os)['"]/,
    // `os.platform()` through a namespace import.
    /\bos\s*\.\s*platform\s*\(/,
    // A `uname` shell-out — `@gjsify/os`, which has no `process` to ask and reads
    // the kernel's own answer (`mapSysname(cli('uname -s'))`).
    //
    // Anchored on the QUOTE, and that is not tidiness: a bare `\buname\b` also
    // matches `@gjsify/tar`, where `uname` is the POSIX tar header's USER-NAME
    // field (`uname: string`, `readString(header, 265, 32)`) and has nothing to do
    // with the utility. Matching the command string keeps the two apart.
    /['"`]uname(?:\s|['"`])/,
    // Probing the FILESYSTEM for the OS — `@gjsify/child_process`, which decides
    // between win32 / linux / android / darwin from `/proc/self/status` and the
    // macOS system-version plist, and never asks `process` either.
    /\bdetectPlatform\s*\(/,
];

/**
 * Source with its COMMENTS blanked, so prose ABOUT an OS read is not read as one.
 *
 * The patterns above are deliberately textual, and text does not know a comment
 * from a statement. The case that forced this: a module documenting that it takes
 * the platform as a PARAMETER — "this module never reads `process.platform`" —
 * was reported as reading `process.platform`, on the strength of the sentence
 * saying it does not. A rule whose failure message is false about the file it
 * names sends a reader to add a declaration the package cannot honestly make.
 *
 * DELIBERATELY CONSERVATIVE, and the constraint is one-directional: this may
 * never blank a line that carries CODE, because a hidden decision is a wrong
 * `supported` claim, while a surviving comment is only a false report someone
 * argues with. So it blanks exactly two shapes — a line whose content STARTS with
 * `//`, and the interior of a block whose line STARTS with `/*` and does not close
 * it — and leaves every line with code on it alone, an inline `/* … *\/`, a
 * trailing `// …` and a mid-line block opener included.
 *
 * BOTH shapes are anchored on the START of the trimmed line, and that anchor is
 * the whole safety argument. For `//` it is obvious: `import Gtk from
 * 'gi://Gtk?version=4.0'` contains `//` and does not start with it, so a naive
 * "cut at the first //" would have deleted the import — and with it any decision
 * further along the line. For `/*` the same hazard is less obvious and was
 * MEASURED: a `/*` inside a STRING opens a phantom block that runs until some
 * later line happens to contain `*\/`, blanking every line between. 144 tracked
 * files carry such a line, and they are ordinary — a glob (`['src/**', …]`, whose
 * `/*` never closes) or prose about a package (`'@gjsify/* end-to-end'`). One of
 * them swallowed 30 following lines including a `process.cwd()` read. No verdict
 * changes today (differenced over the whole shipping corpus: 0), which is exactly
 * when to close it: the failure it would eventually produce is a package that
 * reads the OS being reported as clean, and that direction is the one this
 * function's contract says must never happen.
 *
 * The cost is the other direction, and it is the cheap one: a block comment that
 * OPENS mid-line keeps its prose visible, so a false report stays possible where a
 * hidden decision no longer is.
 *
 * @param {string} text
 * @returns {string}
 */
function withoutComments(text) {
    const out = [];
    let inBlock = false;
    for (const line of text.split('\n')) {
        if (inBlock) {
            const end = line.indexOf('*/');
            if (end === -1) {
                out.push('');
                continue;
            }
            inBlock = false;
            out.push(line.slice(end + 2));
            continue;
        }
        const trimmed = line.trim();
        if (trimmed.startsWith('//')) {
            out.push('');
            continue;
        }
        // Only an UNTERMINATED opener at the start of the line starts a block. A
        // `/* … */` closed on the same line leaves the line intact, and an opener
        // with code (or a string) before it is left alone entirely — see above.
        if (trimmed.startsWith('/*') && line.indexOf('*/', line.indexOf('/*') + 2) === -1) {
            inBlock = true;
            out.push('');
            continue;
        }
        out.push(line);
    }
    return out.join('\n');
}

/**
 * The comment-stripper's own vectors, run on every audit rather than in a suite.
 *
 * `decidesOnOs` decides who owes an OS declaration, and `withoutComments` is the
 * half of it that can be wrong in the expensive direction — silently, because a
 * hidden decision presents as a package that simply owes nothing. This package has
 * no test runner of its own; the rule is reached by `audit-runtimes --check`, a
 * required job, so the vectors run there and their failures are the rule's.
 *
 * @returns {string[]} one message per vector that did not answer as stated
 */
export function commentStrippingSelfTest() {
    /** @type {Array<{ name: string, source: string, decides: boolean }>} */
    const vectors = [
        {
            name: 'a line comment stating the module does NOT read the platform',
            source: '// The platform is a PARAMETER: this module never reads `process.platform`.\nexport const x = 1;\n',
            decides: false,
        },
        {
            name: 'the same sentence inside a JSDoc block',
            source: '/**\n * The `process.platform` values this theme is the default for.\n */\nexport const y = 2;\n',
            decides: false,
        },
        {
            name: 'a real read is still a decision',
            source: 'export const os = process.platform;\n',
            decides: true,
        },
        {
            name: 'a decision on a line that also carries `//` inside a string',
            source: "import Gtk from 'gi://Gtk?version=4.0';\nexport const os = process.platform;\n",
            decides: true,
        },
        {
            name: 'a decision after a glob whose `/*` never closes',
            source: "const globs = ['src/**', 'tests/**'];\nexport const os = process.platform;\n",
            decides: true,
        },
    ];
    const failures = [];
    for (const vector of vectors) {
        const answer = decidesOnOs(vector.source);
        if (answer !== vector.decides) {
            failures.push(
                `os-axis comment stripping: "${vector.name}" answered ${answer}, expected ${vector.decides}. ` +
                    `\`withoutComments\` is ${vector.decides ? 'hiding a real OS decision' : 'reading prose as code'}.`,
            );
        }
    }
    return failures;
}

/**
 * Does this source text make an OS decision?
 *
 * @param {string} text
 * @returns {boolean}
 */
export function decidesOnOs(text) {
    const code = withoutComments(text);
    return OS_DECISION_PATTERNS.some((re) => re.test(code));
}

/**
 * Directory names holding code a package SHIPS but did not AUTHOR — build
 * output, and payload copied in to be handed to someone else.
 *
 * `@gjsify/create-gjsify` is why this exists: it ships `dist-templates/cli` and
 * `dist-templates/gtk-minimal`, both of which read `process.platform`. That is
 * the GENERATED APP's OS decision, not the generator's, and demanding a
 * `gjsify.os` claim from the scaffolding tool because its templates branch
 * would put the declaration on the package that cannot answer for it. The
 * generated project owes that claim, once it exists.
 */
const NOT_AUTHORED_HERE = new Set(['dist', 'dist-templates', 'lib', 'build', 'out', 'vendor', 'fixtures']);

/**
 * The shipping source files of a package that read the host OS, relative to the
 * package directory — named in the failure so the fix does not start with a grep.
 *
 * @param {import('../context.mjs').PackageRecord} pkg
 * @returns {string[]}
 */
export function osDecisionSites(pkg) {
    const sites = [];
    for (const file of listSourceFiles(pkg.dir)) {
        if (isNonShippingSource(basename(file))) continue;
        const rel = file.slice(pkg.dir.length + 1).split(/[\\/]/);
        if (rel.some((segment) => NOT_AUTHORED_HERE.has(segment))) continue;
        let text;
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            // A source file that cannot be read is `package-outputs`' failure,
            // not this rule's — staying silent here keeps one defect to one
            // rule instead of reporting it twice in different words.
            continue;
        }
        if (decidesOnOs(text))
            sites.push(
                file
                    .slice(pkg.dir.length + 1)
                    .split(/[\\/]/)
                    .join('/'),
            );
    }
    return sites;
}

/**
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
function auditOsAxis(ctx) {
    // The instrument before the measurement: a broken comment-stripper makes every
    // verdict below unattributable, so it answers for itself first.
    const failures = commentStrippingSelfTest();
    const notes = [];
    let candidates = 0;
    let declared = 0;
    const belowSupported = [];

    for (const pkg of ctx.packages) {
        const os = pkg.gjsify?.os;
        const osNotes = pkg.gjsify?.osNotes ?? {};
        const hasDeclaration = os !== undefined && os !== null;

        // A declaration on a private package is not wrong, just unread — it is
        // reported rather than failed, because deleting it would be the only
        // way to satisfy a failure and that is worse than an unused promise.
        const sites = pkg.private ? [] : osDecisionSites(pkg);
        const owes = sites.length > 0;
        if (owes) candidates++;

        if (owes && !hasDeclaration) {
            failures.push(
                `${pkg.rel}/package.json: reads the host operating system in ${sites.length} shipping source file(s) ` +
                    `but declares no \`gjsify.os\` — nothing in that branch says whether it is correct or a stub ` +
                    `(ADR 0018).\n` +
                    `      sites: ${sites.slice(0, 6).join(', ')}${sites.length > 6 ? `, … (+${sites.length - 6})` : ''}\n` +
                    `      add:   "gjsify": { "os": { "linux": "supported", "darwin": "…", "win32": "…" } }\n` +
                    `             values are ${OS_CLAIMS.join(' | ')}; anything below \`supported\` needs a reason in ` +
                    `\`gjsify.osNotes.<os>\`.`,
            );
            continue;
        }
        if (!hasDeclaration) continue;
        declared++;

        if (typeof os !== 'object' || Array.isArray(os)) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.os\` must be an object keyed by operating system, got ${JSON.stringify(os)}.`,
            );
            continue;
        }

        // A key outside the target set. The set is closed on purpose: a package
        // may not quietly claim an OS the project does not.
        for (const key of Object.keys(os)) {
            if (!TARGET_OSES.includes(key)) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.os.${key}\` names an operating system outside the declared ` +
                        `target set (${TARGET_OSES.join(', ')}). Anything else is build-verified only and belongs to ` +
                        `\`gjsify.platforms\`, not here.`,
                );
            }
        }

        // Silence is the gap this rule exists to close, so a declaration answers
        // for ALL THREE. A package that names only the OS it was thinking about
        // leaves the other two exactly as unstated as before.
        const missing = TARGET_OSES.filter((t) => os[t] === undefined);
        if (missing.length > 0) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.os\` does not answer for ${missing.join(', ')}. A partial ` +
                    `declaration leaves the unnamed operating systems exactly as unstated as no declaration at all — ` +
                    `name all of ${TARGET_OSES.join(', ')}.`,
            );
        }

        for (const target of TARGET_OSES) {
            const claim = os[target];
            if (claim === undefined) continue;
            if (!OS_CLAIMS.includes(claim)) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.os.${target}\` is ${JSON.stringify(claim)}; expected one of ` +
                        `${OS_CLAIMS.join(', ')}.`,
                );
                continue;
            }
            const reason = osNotes[target];
            if (claim !== 'supported') {
                belowSupported.push(`${pkg.name} ${target}=${claim}: ${reason ?? '(no reason)'}`);
                if (typeof reason !== 'string' || reason.trim().length === 0) {
                    failures.push(
                        `${pkg.rel}/package.json: \`gjsify.os.${target}\` is "${claim}" with no reason in ` +
                            `\`gjsify.osNotes.${target}\`. An honest "not supported here" is available; a silent gap ` +
                            `is not — the reason is mandatory and printed on every run.`,
                    );
                }
            } else if (typeof reason === 'string') {
                // The direction that keeps the ledger honest: a leftover note on
                // an OS that has since been fixed reads as a live limitation.
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.os.${target}\` is "supported" but \`gjsify.osNotes.${target}\` ` +
                        `still carries a reason — delete the note, or lower the claim to match it.\n` +
                        `      note: ${reason}`,
                );
            }
        }

        for (const key of Object.keys(osNotes)) {
            if (os[key] === undefined) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.osNotes.${key}\` explains a claim that is not made — ` +
                        `\`gjsify.os.${key}\` is absent.`,
                );
            }
        }
    }

    // Printed every run, pass or fail: the whole point of a mandatory reason is
    // that somebody sees it. The same shape as `gjsify.platformsUncommitted`.
    for (const entry of belowSupported.sort()) notes.push(`below \`supported\`: ${entry}`);

    return { failures, notes, stats: { candidates, declared, belowSupported: belowSupported.length } };
}

export const osAxisRule = defineRule({
    id: 'os-axis',
    scope: 'portable',
    fields: ['gjsify.os', 'gjsify.osNotes'],
    description:
        'a package that branches on the operating system declares `gjsify.os`, and every claim below `supported` states why',
    run(ctx) {
        const { failures, notes, stats } = auditOsAxis(ctx);
        return {
            failures,
            notes,
            stats,
            summary:
                `OS axis (ADR 0018): ${stats.declared} package(s) declare \`gjsify.os\`; ` +
                `${stats.candidates} make an OS decision in shipping source and owe one; ` +
                `${stats.belowSupported} claim(s) below \`supported\`, each with a printed reason`,
        };
    },
});
