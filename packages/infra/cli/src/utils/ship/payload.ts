// The payload the packers see.
//
// One shape, read back off the staged tree rather than carried in memory from
// the planner. That is deliberate: it makes `gjsify ship --stage` and
// `gjsify ship --target deb` provably the same payload, because the second
// reads what the first wrote. A packer fed straight from the planner could
// drift from the staged tree and nothing would notice.

import { statSync } from 'node:fs';

import { launcherPath, type Layout, type LayoutIdentity } from './layout.js';
import { SCHEMA_CACHE } from './schemas.js';
import { isUnder, SHARE } from './share-dirs.js';

/** One file in the payload, with its bytes. */
export interface PayloadEntry {
    /** Prefix-relative path, POSIX-separated, e.g. `bin/learn6502`. */
    path: string;
    /** POSIX mode bits. */
    mode: number;
    data: Uint8Array;
}

/**
 * The build stamp every header gets.
 *
 * `SOURCE_DATE_EPOCH` is the cross-ecosystem convention and wins when it is
 * set. Without it the stamp is the BUNDLE's mtime — never `Date.now()`, which
 * is the one input guaranteeing that packing the same tree twice produces
 * different bytes, and never a fixed 0 either: `Build Date: 1 Jan 1970` is
 * what `rpm -qi` then shows a user, and an artifact that looks broken is a
 * support question. The mtime keeps the property that matters (pack the same
 * build twice, get the same bytes) while saying something true.
 *
 * Only the ASSEMBLING host runs this. A stage records the answer it got
 * (`.gjsify-ship-stage.json` → `mtime`) and the packing host reuses it: an
 * artifact upload does not carry mtimes, so re-stat'ing the stage there would
 * stamp every header with "whenever the download finished" and quietly destroy
 * the reproducibility this function exists to protect.
 */
export function buildTimestamp(bundlePath: string, env: Record<string, string | undefined> = process.env): number {
    const raw = env.SOURCE_DATE_EPOCH;
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new Error(`gjsify ship: SOURCE_DATE_EPOCH must be a non-negative integer, got "${raw}".`);
        }
        return parsed;
    }
    return Math.floor(statSync(bundlePath).mtimeMs / 1000);
}

/**
 * What the payload itself says about what it installs.
 *
 * Every field here used to be answered from the SETTINGS — `settings.iconFiles.length > 0`,
 * `settings.schemaFiles.length > 0`, `settings.typelibFiles` — i.e. from lists of absolute paths
 * on the BUILD host. Two things were wrong with that, and the second is why this function exists
 * at all:
 *
 *  1. It answered a different question than the one being asked. `cacheRefreshCommands` emits
 *     `gtk-update-icon-cache <prefix>/share/icons/hicolor` — the honest precondition is "did this
 *     package install anything into that directory", not "did the project have icon files lying
 *     around". They come apart for a `kind: 'cli'` project with a `data/icons/` folder: the
 *     planner stages no icon (icons are an `'app'` thing), the settings still listed them, and the
 *     postinst refreshed a cache for files that were never installed.
 *  2. An absolute build-host path cannot cross to the host that packs the artifact
 *     (ADR 0024 § A2). Carrying `iconFiles: ["/home/…/icon.svg"]` in a stage manifest so that
 *     `.length > 0` can be read on another machine is authoring a value that is measurable right
 *     there in the tree.
 *
 * Path-only, on purpose — `isArchIndependent` is the sibling that reads BYTES, and the two answer
 * different questions from the same payload. The same split as `plan.ts`'s `isExecutableAsset`
 * (by name) versus this module's magic sniffing (by content).
 *
 * NOT EVERY QUESTION BELONGS HERE, and one that does not was briefly added: "does this package need
 * a Node interpreter", derived from a `*.node.mjs` filename anywhere in the tree. Every fact above
 * is about something the package INSTALLS at a well-known path, which is why a path answers it.
 * That one was about what the launcher EXECS — and `discoverPayload` stages the whole directory
 * beside the bundle, so a `--app gjs` project that also builds a Node bundle carried the file and
 * ran neither. It lives on `settings.app` now, with `assertLauncherMatchesInterpreter` below as the
 * check. Before adding a field here, ask whether a path can answer it or only correlate with it.
 */
export interface PayloadFacts {
    /** The payload installs a `share/applications/*.desktop`. */
    hasDesktopEntry: boolean;
    /** The payload installs into `share/icons/hicolor/`. */
    hasIcons: boolean;
    /** The payload installs a compiled-on-install `share/glib-2.0/schemas/*.gschema.xml`. */
    hasSchemas: boolean;
    /** The payload installs a `share/mime/packages/*.xml`, so the mime cache needs rebuilding. */
    hasMimeTypes: boolean;
    /** Prefix-relative paths of the typelibs the payload carries itself. */
    bundledTypelibs: string[];
}

/**
 * Read {@link PayloadFacts} off a payload or off a plan.
 *
 * Takes anything with a `path`, so the assembling phase can ask the same
 * question of the PLAN (before the tree is read back) that the packing phase
 * asks of the payload. One function, so the two phases cannot disagree about
 * whether a package installs a schema.
 */
export function readPayloadFacts(entries: readonly { path: string }[]): PayloadFacts {
    const paths = entries.map((entry) => entry.path);
    return {
        hasDesktopEntry: paths.some((path) => isUnder(path, SHARE.applications) && path.endsWith('.desktop')),
        hasIcons: paths.some((path) => isUnder(path, SHARE.icons)),
        hasSchemas: paths.some((path) => isUnder(path, SHARE.schemas) && path.endsWith('.gschema.xml')),
        hasMimeTypes: paths.some((path) => isUnder(path, SHARE.mime) && path.endsWith('.xml')),
        // Anywhere in the payload, not only `lib/<name>/gi/`: `gjsify.ship.extraFiles` can place
        // one elsewhere, and a typelib the package carries is a typelib the package must not also
        // declare a distro dependency for, wherever it sits.
        bundledTypelibs: paths.filter((path) => path.endsWith('.typelib')),
    };
}

/**
 * Every interpreter the STAGED launcher could exec, resolved to a bare name.
 *
 * WHY THIS IS READ BACK AT ALL, when `settings.app` already says so. Because
 * `settings.app` says what the launcher was RENDERED from, and the dependency is
 * a claim about what the installed package will RUN. Those were once two
 * different things: the Node dependency was derived from a filename glob over
 * the staged tree while `renderLauncher` execed `gjs` unconditionally, and the
 * packer emitted `Depends: gjs (>= 1.86), nodejs (>= 24)` for a package that
 * runs neither combination. Nothing in the pipeline compared them, and no
 * structural check could: both artifacts were individually well-formed.
 *
 * A LIST, and every `exec` rather than one of them. The first cut took the first
 * match while its own comment claimed the last — `/\nexec\s+/` is not global, so
 * the two disagreed and the comment was the wrong one. Neither is right for a
 * script this tree did not write: a launcher may exec different interpreters on
 * different branches, and picking one branch's answer is a guess. Collecting
 * them lets {@link assertLauncherMatchesInterpreter} ask the only question that
 * is safe on a foreign script — see there.
 *
 * NAMES, not the tokens as written. `exec /usr/bin/gjs -m …` execs gjs, and an
 * `env` prefix (`exec env NODE_OPTIONS=… node …`) execs whatever follows its
 * assignments. Both are things `gjsify.ship.extraFiles` legitimately writes, and
 * the raw-token version REFUSED them: measured, an untouched `--app gjs` project
 * whose `extraFiles` replaced the launcher with `exec /usr/bin/gjs -m …` failed
 * the pack at exit 1 with "execs `/usr/bin/gjs`, but this package would declare
 * a dependency on `gjs`" — a working artifact rejected over a parser, which is
 * exactly what the `null` branch was written to prevent and did not.
 */
export function readLauncherInterpreters(
    payload: readonly PayloadEntry[],
    layout: Layout,
    identity: LayoutIdentity,
): string[] {
    // THE LAYOUT'S launcher, which is what this function's doc has always claimed
    // and what it did not do. It looked up `bin/<binaryName>` — the PREFIX-RELATIVE
    // path — so off Linux it matched nothing and returned `[]`, i.e. it was vacuous
    // for the darwin tree (`<App>.app/Contents/MacOS/<name>`) and the windows one
    // (`<name>.cmd`). Harmless while every format that called it wrapped the Linux
    // layout; a real hole the moment a darwin format exists, because `[]` is the
    // value `assertLauncherMatchesInterpreter` treats as "nothing to check".
    const launcher = payload.find((entry) => entry.path === launcherPath(layout, identity));
    if (launcher === undefined) return [];
    const text = new TextDecoder().decode(launcher.data);
    const dialect = layout.name === 'windows' ? 'cmd' : 'sh';
    const found: string[] = [];
    for (const command of dialect === 'cmd' ? batchCommands(text) : shellExecLines(text)) {
        const name = interpreterOf(command, dialect);
        if (name !== null) found.push(name);
    }
    return [...new Set(found)];
}

/**
 * The argument of every `exec` in a POSIX-shell launcher.
 *
 * `[ \t]*` because a branching launcher indents the `exec` inside its `if`, and a
 * pattern anchored hard to the newline silently sees only the last, unindented one
 * — measured: a two-branch script reported `gjs` alone. A comment (`# exec gjs …`)
 * still cannot match, since `#` is not whitespace.
 */
function shellExecLines(text: string): string[] {
    return [...`\n${text}`.matchAll(/\n[ \t]*exec\s+([^\n]*)/g)].map((match) => (match[1] as string).trim());
}

/**
 * Batch keywords that can never be the program a `.cmd` line runs.
 *
 * The list is what makes {@link batchCommands} a filter rather than a parser, and
 * it is deliberately only the keywords that CARRY NOTHING: `rem`, `echo`, `title`
 * and `pause` take no command at all, `goto` takes a label, `exit` takes a code,
 * `set`/`setlocal`/`endlocal` take a variable. A keyword missing from it costs a
 * SILENT non-answer, never a wrong one — an unrecognised first word is handed to
 * `interpreterOf`, which resolves it to `gjs`, to `node`, or to something
 * `assertLauncherMatchesInterpreter` ignores.
 *
 * `if`, `else` and `for` are NOT here, and an earlier draft put them here with a
 * doc claiming every entry "takes no program". That was false in the way batch
 * actually gets written, and measured through the built reader:
 *
 *     IF defined X (node x)          → []      ← the whole reader, on one line
 *     for %f in (*) do node %f       → []
 *
 * `[]` is the value `assertLauncherMatchesInterpreter` treats as "nothing to
 * check", so a `gjsify.ship.extraFiles` launcher written as
 * `if exist "%HERE%gjs.exe" ("%HERE%gjs.exe" -m …)` under `gjsify.app: "node"`
 * passed. That is the same class as the POSIX form's un-indented-`exec` incident,
 * one dialect over, so it gets the same treatment: {@link batchPrefix} REDUCES
 * those three to the command they carry rather than dropping the line.
 *
 * `call` and `start` stay unhandled and stay silent: both DO invoke a program and
 * both also take non-program arguments (`call :label`, `start "title"`), and
 * guessing at that would be the parser answering confidently wrong.
 */
const BATCH_NON_PROGRAMS = new Set([
    'rem',
    'set',
    'setlocal',
    'endlocal',
    'echo',
    'goto',
    'exit',
    'title',
    'pause',
    'shift',
    'cd',
    'chdir',
    'pushd',
    'popd',
    'color',
    'cls',
    'verify',
    'prompt',
]);

/**
 * One `cmd.exe` command line, split the way `cmd.exe` splits it.
 *
 * QUOTE-AWARE, and that is the whole reason it is not `line.split(/\s+/)`: a
 * condition operand is routinely a path, and a program directory lives under
 * `C:\Program Files\…`. Splitting `if exist "%HERE%My App\x" node y` on
 * whitespace and then dropping "two tokens" would drop half the path and leave
 * the rest as the program.
 */
function cmdTokens(line: string): { text: string; end: number }[] {
    const tokens: { text: string; end: number }[] = [];
    let at = 0;
    while (at < line.length) {
        if (/\s/.test(line[at] as string)) {
            at += 1;
            continue;
        }
        const start = at;
        let quoted = false;
        while (at < line.length && (quoted || !/\s/.test(line[at] as string))) {
            if (line[at] === '"') quoted = !quoted;
            at += 1;
        }
        tokens.push({ text: line.slice(start, at), end: at });
    }
    return tokens;
}

/**
 * Split `( … ) rest` into the block's body and whatever follows it.
 *
 * Depth-counting and quote-aware, because `(A) else (B)` is how a batch launcher
 * writes two branches and BOTH have to be read — the POSIX form collects every
 * `exec`, and a reader that saw one arm of an `if`/`else` would answer for a
 * branch the user may never take. `null` when the parenthesis is unbalanced,
 * which is a line this reader cannot honestly split.
 */
function splitBatchBlock(line: string): [string, string] | null {
    let depth = 0;
    let quoted = false;
    for (let at = 0; at < line.length; at++) {
        const ch = line[at];
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch === '(') depth += 1;
        else if (!quoted && ch === ')') {
            depth -= 1;
            if (depth === 0) return [line.slice(1, at).trim(), line.slice(at + 1).trim()];
        }
    }
    return null;
}

/** Conditions whose operand is one token: `if exist FILE …`, `if defined VAR …`. */
const BATCH_UNARY_CONDITIONS = new Set(['exist', 'defined', 'errorlevel']);

/** `if a EQU b …` — three tokens where `a==b` is one. */
const BATCH_COMPARISONS = new Set(['equ', 'neq', 'lss', 'leq', 'gtr', 'geq']);

/**
 * Strip one batch construct that WRAPS a command, or `null` when the line carries
 * none this reader can reach.
 *
 * Returns the pieces for another round — `if defined X (node a) else (gjs -m b)`
 * reduces to `["node a", "else (gjs -m b)"]` — which is what makes a compound line
 * answerable at all, and what keeps BOTH arms of a branch in the answer.
 * `undefined` means "nothing to strip", i.e. the line already IS the command.
 *
 * The `if` conditions are enumerated rather than guessed: three unary forms, the
 * `a==b` form (one token, because `==` needs no spaces), and the six comparison
 * operators. A shape not in that list returns `null` rather than a best guess,
 * because the failure mode of guessing here is not silence — it is naming
 * whichever token happened to land in the program position.
 */
function batchPrefix(line: string): string[] | null | undefined {
    if (line.startsWith('(')) {
        const split = splitBatchBlock(line);
        return split === null ? null : [split[0], split[1]];
    }
    const tokens = cmdTokens(line);
    const word = (index: number): string => (tokens[index]?.text ?? '').toLowerCase();
    const after = (index: number): string[] => [line.slice(tokens[index]?.end ?? line.length).trim()];

    if (word(0) === 'else') return after(0);
    if (word(0) === 'for') {
        const doAt = tokens.findIndex((token) => token.text.toLowerCase() === 'do');
        return doAt === -1 ? null : after(doAt);
    }
    if (word(0) !== 'if') return undefined;

    // `not` and `/i` are modifiers, in either order and both optional.
    let at = 1;
    while (word(at) === 'not' || word(at) === '/i') at += 1;
    if (BATCH_UNARY_CONDITIONS.has(word(at))) return after(at + 1);
    if (word(at).includes('==')) return after(at);
    if (BATCH_COMPARISONS.has(word(at + 1))) return after(at + 2);
    return null;
}

/**
 * Every command in a `.cmd` that could run a program.
 *
 * NOT an `exec` scan, because `cmd.exe` has no `exec`: the last command a batch
 * file runs IS what the launcher runs, and its exit status is the script's. So
 * where the POSIX form has a keyword to anchor on, this one has to rule lines OUT
 * — see {@link BATCH_NON_PROGRAMS} for why ruling one out too few is the safe
 * direction and ruling one out too many is not.
 *
 * `@` comes off first (`@echo off` is `echo` with output suppressed), and `::` is
 * the label-abuse comment form, which no first-word test would otherwise catch.
 * Lines are split on CR LF *or* LF: the form this tree writes is CRLF, and a
 * launcher that arrived from `gjsify.ship.extraFiles` may be neither.
 *
 * The work list is BOUNDED. `if defined X (if defined Y (node a))` is legal batch
 * and each round strips one construct; a cap turns a pathological line into a
 * silent non-answer instead of a hang, which is the same trade `interpreterOf`
 * makes for `env`.
 */
const BATCH_REDUCTION_STEPS = 32;

function batchCommands(text: string): string[] {
    const commands: string[] = [];
    const pending = text.split(/\r?\n/).map((raw) => raw.trim().replace(/^@+/, '').trim());
    for (let step = 0; step < BATCH_REDUCTION_STEPS && pending.length > 0; step++) {
        const line = pending.shift() as string;
        if (line === '' || line === ')' || line.startsWith('::')) continue;
        const first = (cmdTokens(line)[0]?.text ?? '').toLowerCase();
        if (BATCH_NON_PROGRAMS.has(first)) continue;
        const reduced = batchPrefix(line);
        if (reduced === undefined) commands.push(line);
        else if (reduced !== null) pending.unshift(...reduced);
    }
    return commands;
}

/**
 * The program a command line runs, as a bare name, or `null` when the line is
 * not one this reader can honestly resolve.
 *
 * TWO DIALECTS, because the two launchers are two languages and the difference is
 * not cosmetic — it is what made the first Windows reading VACUOUS. See
 * {@link cmdProgramOf}.
 *
 * `env` is followed through because it is the documented way to pass variables
 * to an interpreter and says nothing about which one runs. Everything past the
 * first non-assignment word is arguments, so the walk stops there. There is no
 * `env` on Windows, so the hop is the POSIX branch's alone.
 */
function interpreterOf(line: string, dialect: 'sh' | 'cmd'): string | null {
    if (dialect === 'cmd') return cmdProgramOf(line);
    let words = line.split(/\s+/).filter((word) => word.length > 0);
    for (let hop = 0; hop < 2 && words.length > 0; hop++) {
        const program = basenameOf(words[0] as string);
        if (program !== 'env') return program === '' ? null : program;
        // Past `env`: skip its flags and `NAME=value` assignments to reach the
        // program. `-S` takes the rest of the line as one string, which the split
        // above has already flattened into words — the right answer either way.
        words = words.slice(1).filter((word) => !word.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    }
    return null;
}

/**
 * The program one `cmd.exe` command line runs, as a bare, extension-free name.
 *
 * THREE DIALECT RULES, and every one of them is the difference between a check
 * and a vacuous pass. Measured on the launcher `gjsify ship windows` writes
 * (`"%HERE%node.exe" "%HERE%app\app.node.mjs" %*`), reading it with the POSIX
 * path alone:
 *
 *   1. there is no `exec` keyword in batch, so the scan matched NOTHING and the
 *      whole reader returned `[]` — the value `assertLauncherMatchesInterpreter`
 *      treats as "nothing to check". {@link batchCommands} is that half.
 *   2. `%~dp0` ALREADY ENDS IN A SEPARATOR, so the renderer concatenates with
 *      none: the token is `%HERE%node.exe`, which splits on `[/\\]` to itself.
 *      Stripping one leading `%NAME%` is what makes the basename a basename —
 *      and a token that is nothing BUT an expansion (`%NODE%`) strips to empty
 *      and stays `null`, which is the honest answer.
 *   3. Windows executables carry `.exe` and this vocabulary does not
 *      (`'gjs' | 'node'`). PATHEXT makes `node` and `node.exe` the same program,
 *      so the suffix comes off. `.cmd` and `.bat` deliberately do NOT: those are
 *      batch files, not interpreters, and resolving one to a bare name would be
 *      this reader claiming to know what that script runs.
 *
 * The first token is taken the way `cmd.exe` takes it — a quoted run up to the
 * closing quote, otherwise up to the first whitespace — rather than by splitting
 * on spaces, because a program directory under `C:\Program Files\…` is exactly
 * the case a naive split gets wrong.
 */
function cmdProgramOf(line: string): string | null {
    const quoted = /^"([^"]*)"/.exec(line);
    const token = quoted !== null ? (quoted[1] as string) : (line.split(/\s+/)[0] ?? '');
    const expanded = token.replace(/^%[^%\s]*%/, '');
    const leaf = expanded.split(/[/\\]/).pop() ?? '';
    const bare = leaf.replace(/\.exe$/i, '');
    return bare === '' ? null : bare;
}

/**
 * Last path segment of a shell TOKEN, POSIX or Windows.
 *
 * The quotes come off first, and that is not cosmetic. #1354 M2b makes the macOS
 * launcher exec `"$here/node"` — the interpreter the bundle carries, named by a
 * layout-relative path because macOS has no system Node to find on `PATH`.
 * Without the strip this reader answered `node"`, which is neither `node` nor
 * `gjs`, so {@link assertLauncherMatchesInterpreter} took its "a program that is
 * neither" branch and passed. Not a wrong answer — a VACUOUS one, on exactly the
 * layout that made the check matter, and green.
 *
 * Both quote characters, and only as a surrounding pair: a shell token is
 * `"…"`, `'…'` or bare, and stripping a lone quote from the middle of a word
 * would be this function guessing at a syntax it does not parse. The `$here`
 * inside survives as a literal, which is fine — this reader wants the last
 * SEGMENT, and no expansion can change which segment that is.
 */
function basenameOf(token: string): string {
    const parts = unquote(token).split(/[/\\]/);
    return parts[parts.length - 1] ?? '';
}

/** `"x"` and `'x'` → `x`; everything else unchanged. */
function unquote(token: string): string {
    const first = token[0];
    if ((first === '"' || first === "'") && token.length > 1 && token[token.length - 1] === first) {
        return token.slice(1, -1);
    }
    return token;
}

/**
 * Refuse a package whose launcher execs an interpreter the package does not
 * depend on.
 *
 * THE RULE, and it is deliberately asymmetric: fail ONLY when the launcher
 * positively names the OTHER known interpreter and never names the declared one.
 * Everything else passes — no launcher, no `exec` this reader resolves, a program
 * that is neither `gjs` nor `node`, or a script whose branches include the
 * declared one.
 *
 * That asymmetry is the correction. The first cut failed whenever the resolved
 * token was not equal to the declared interpreter, and its own doc comment
 * claimed the opposite ("`null` is SILENT ... refusing a package because this
 * function did not understand a launcher somebody else wrote would fail a
 * working artifact over a parser"). The parser's failure mode is not `null` — it
 * answers confidently wrong. Measured on an otherwise untouched `--app gjs`
 * project whose `gjsify.ship.extraFiles` replaced `bin/<name>`:
 *
 *     exec /usr/bin/gjs -m …        → exit 1, "execs `/usr/bin/gjs`"
 *     exec env NODE_OPTIONS=… node… → exit 1, "execs `env`"
 *
 * Both worked before the check existed. A guard that turns working packages into
 * failures buys nothing over the defect it prevents.
 *
 * The advice in the message is also fixed. It used to say "re-run the `--stage`
 * phase", which is FALSE for the case that actually reaches a user: re-staging
 * an `extraFiles` override reproduces it forever. The two real causes are named
 * instead.
 */
export function assertLauncherMatchesInterpreter(
    payload: readonly PayloadEntry[],
    layout: Layout,
    identity: LayoutIdentity,
    interpreter: 'gjs' | 'node',
): void {
    const found = readLauncherInterpreters(payload, layout, identity);
    if (found.length === 0 || found.includes(interpreter)) return;
    const other = interpreter === 'gjs' ? 'node' : 'gjs';
    if (!found.includes(other)) return;
    throw new Error(
        `gjsify ship: the launcher ${launcherPath(layout, identity)} execs \`${other}\`, but this package ` +
            `would declare a dependency on \`${interpreter}\`.\n` +
            '    An installed package that depends on one interpreter and runs another installs cleanly and ' +
            'fails\n' +
            "    at first launch, on the user's machine.\n" +
            `    Either set \`gjsify.app\` to "${other}", or fix the launcher — if it comes from ` +
            '`gjsify.ship.extraFiles`,\n' +
            '    that override is what decides which interpreter runs and it must match the declaration.',
    );
}

/**
 * How a `share/` entry behaves once it leaves the layout a Linux package installs.
 *
 * `aborts` and `inert` are not one severity, and printing them as one was a
 * measured presentation defect: every launcher exports `XDG_DATA_DIRS` at the
 * staged `share/`, so a `.app` built from a stage with an UNCOMPILED schema
 * directory points GSettings at an `.xml` with no `gschemas.compiled` beside it —
 * `g_settings_new()` ABORTS. The others merely do nothing. Ranking them
 * identically in a list of five buried the one that stops the app.
 *
 * #1354 M2a compiles that cache into every non-Linux stage, so `aborts` is empty
 * for a stage this gjsify wrote. The variant STAYS, and reachable — see
 * {@link SHARE_VERDICTS}'s schema row.
 */
export type ShareVerdict = 'aborts' | 'inert' | 'unknown';

/** One `share/` entry a non-Linux layout carries, and what happens to it there. */
export interface CarriedShareEntry {
    path: string;
    verdict: ShareVerdict;
    why: string;
}

/** What the classifier knows about the payload as a WHOLE, rather than per path. */
interface ShareContext {
    /** The tree carries `share/glib-2.0/schemas/gschemas.compiled`. */
    hasCompiledSchemas: boolean;
}

/**
 * What each known `share/` directory costs a layout with no install step.
 *
 * Keyed on {@link SHARE}, so the compiler — not a comment — is what keeps this in
 * step with where `plan.ts` stages the files and which directory
 * `cacheRefreshCommands` refreshes. The previous version claimed exactly that in
 * prose over five independent string literals, and pointing one rule at a
 * directory matching nothing silently dropped a file from the printed warning
 * with the whole suite green at exit 0.
 *
 * The verdict is a FUNCTION of the payload rather than a constant, and exactly
 * one row uses that: the schema directory's cost depends on whether the compiled
 * cache is in the tree with it. Making it a function keeps that in the table
 * instead of as a branch in the loop — one place still answers "what does this
 * directory cost", which is the property the five string literals cost us.
 */
const SHARE_VERDICTS: ReadonlyArray<readonly [string, (context: ShareContext) => readonly [ShareVerdict, string]]> = [
    [
        SHARE.schemas,
        // The `aborts` branch is what #1354 M2a removed the cause of, and it is
        // deliberately still REACHABLE: a stage assembled before the compile step
        // existed, or one whose cache was deleted, classifies as `aborts` again
        // with no rule to remember to re-add. A rule that can no longer fire is a
        // comment; this one is a mechanism.
        ({ hasCompiledSchemas }) =>
            hasCompiledSchemas
                ? [
                      'inert',
                      'the schema SOURCE; `gschemas.compiled` is staged beside it and that is what ' +
                          'GSettings reads, so this file is carried and never opened',
                  ]
                : [
                      'aborts',
                      'needs `glib-compile-schemas`, and the launcher points XDG_DATA_DIRS here — ' +
                          'GSettings ABORTS on a schema directory with no `gschemas.compiled`',
                  ],
    ],
    [SHARE.mime, () => ['inert', 'needs `update-mime-database`; detection runs off the compiled cache']],
    [SHARE.icons, () => ['inert', 'needs `gtk-update-icon-cache`; neither OS reads the hicolor theme']],
    [SHARE.applications, () => ['inert', 'a freedesktop desktop entry; neither OS reads one']],
    [SHARE.metainfo, () => ['inert', 'an AppStream component; neither OS reads one']],
];

/**
 * Paths that survive the trip, so the rule below can be an INVERSE one.
 *
 * Two entries and they are different SHAPES, which is why the check below tests
 * both containment and equality:
 *
 *  - `share/locale` is a DIRECTORY. A `.mo` is read straight off disk by
 *    `bindtextdomain`, with no install step anywhere, and the launcher hands the
 *    directory over on all three layouts.
 *  - `gschemas.compiled` is one FILE, and it is here because it is not a cost —
 *    it is the thing that removes one. Reported under a warning headed "whose
 *    Linux correctness comes from a package install step" it would name the fix
 *    as if it were the problem, and it would be the sixth line of a five-line
 *    list nobody asked to grow.
 */
const SHARE_PORTABLE: readonly string[] = [SHARE.locale, SCHEMA_CACHE];

/**
 * Every `share/` entry a non-Linux layout carries, classified — including the
 * ones nothing here has a rule for.
 *
 * WHY THIS EXISTS, and it is the hole the layout axis opened. `planStage` emits
 * one prefix-relative plan and every layout carries it, so the darwin and windows
 * trees hold the same `share/…` files the `.deb` does — and on Linux most of those
 * are only correct because `cacheRefreshCommands` compiles or reindexes them at
 * install time (`scripts.ts`), which is a `.deb`/`.rpm` scriptlet and nothing else.
 *
 * The equality `tests/e2e/ship-layout` checks — same file set, same bytes, modulo
 * the map — is structurally blind to all of it, because SAMENESS IS THE DEFECT:
 * the Linux tree is right for a reason the other two do not have.
 *
 * EXHAUSTIVE, not an allow-list, and that direction is the point. A closed list of
 * five was measured to say "carries 5 file(s)" for a payload carrying six — a
 * `share/dbus-1/services/*.service` added through `gjsify.ship.extraFiles` is
 * meaningful on Linux only because the package installs it into a system prefix,
 * and it went unnamed. Anything under `share/` that is neither classified nor
 * known-portable comes back as `unknown` rather than silently passing.
 *
 * ONE ENTRY IS ANSWERED BY THE SET, not by its own path: the GSettings schema
 * directory aborts the app when it holds a source `.gschema.xml` and no compiled
 * cache, and is merely inert when the cache is beside it. #1354 M2a compiles that
 * cache into every non-Linux stage, so the `aborts` branch is empty for a stage
 * this gjsify wrote — and it is still REACHABLE, which is the point: a stage
 * assembled before the compile step existed, or one whose cache was removed,
 * classifies as `aborts` again with no rule to remember to re-add.
 *
 * What the rest BECOME — an `Info.plist` `CFBundleDocumentTypes`, a Windows
 * registry association, or nothing — is ADR 0024 stages 4 and 5. The `.app`
 * container exists as of M2a; the file-type and icon halves do not.
 */
export function linuxInstallDependent(entries: readonly { path: string }[]): CarriedShareEntry[] {
    const out: CarriedShareEntry[] = [];
    // Asked of the WHOLE payload once, not per entry: "does this tree carry a
    // compiled schema cache" is a fact about the set, and asking it inside the
    // loop would make the answer depend on iteration order.
    const context: ShareContext = { hasCompiledSchemas: entries.some((entry) => entry.path === SCHEMA_CACHE) };
    for (const entry of entries) {
        if (!isUnder(entry.path, 'share')) continue;
        if (SHARE_PORTABLE.some((portable) => entry.path === portable || isUnder(entry.path, portable))) continue;
        const rule = SHARE_VERDICTS.find(([dir]) => isUnder(entry.path, dir));
        if (rule === undefined) {
            out.push({
                path: entry.path,
                verdict: 'unknown',
                why:
                    'nothing here classifies this directory — it may need an install step no ' +
                    'non-Linux layout runs, or it may be inert; say which before shipping it',
            });
            continue;
        }
        const [verdict, why] = rule[1](context);
        out.push({ path: entry.path, verdict, why });
    }
    // `aborts` first: a list sorted by path buried the one entry that stops the
    // application behind four that merely do nothing.
    const rank: Record<ShareVerdict, number> = { aborts: 0, unknown: 1, inert: 2 };
    return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (a.path < b.path ? -1 : 1));
}

/**
 * The interpreters the payload's own executables need, read off their shebangs.
 *
 * An interpreter is a dependency like any other, and rpm expects it declared:
 * `rpmbuild`'s file-based generator emits one `Requires` per executable
 * shebang, with the `RPMSENSE_FIND_REQUIRES` sense that says "derived, not
 * declared". Measured on Fedora 44 against a package whose only file is a
 * `#!/bin/sh` script: `rpm -qp --requires` → `/usr/bin/sh 16384`.
 *
 * The LITERAL path, not a resolved one. `rpmbuild` prints `/usr/bin/sh` there
 * because it resolved `/bin` through the symlink of the usrmerged host it ran
 * on; this writer has no target host to resolve against (ADR 0024 § A1 — the
 * packers are pure JavaScript and run anywhere), and `/bin/sh` is satisfied on
 * both layouts: measured on Fedora 44, `rpm -q --whatprovides /bin/sh` and
 * `/usr/bin/sh` both answer `bash`. It is also the spelling the scriptlet
 * requirements already use.
 *
 * EXECUTABLE files only, which is the same rule `rpmbuild` applies. A GJS
 * bundle staged 0644 carries `#!/usr/bin/env -S gjs -m` for the days it is run
 * directly, but nothing in the installed package executes it as a program — the
 * launcher `exec`s `gjs` with it as an argument — so declaring `/usr/bin/env`
 * for it would be a dependency on a path this package never uses.
 */
export function readShebangInterpreters(payload: readonly PayloadEntry[]): string[] {
    const found = new Set<string>();
    for (const entry of payload) {
        if ((entry.mode & 0o111) === 0) continue;
        const interpreter = readShebang(entry.data);
        if (interpreter !== null) found.add(interpreter);
    }
    return [...found].sort();
}

/** The absolute interpreter path of a `#!` line, or `null` when there is none to read. */
function readShebang(data: Uint8Array): string | null {
    if (data[0] !== 0x23 || data[1] !== 0x21) return null; // `#!`
    // A shebang is one LINE; reading further would let a long file's contents
    // decide how much work this does. 256 bytes is above every real one and is
    // what Linux itself truncates at (BINPRM_BUF_SIZE).
    const line = new TextDecoder().decode(data.subarray(2, Math.min(data.byteLength, 256))).split('\n')[0] ?? '';
    const interpreter = line.trim().split(/\s+/)[0] ?? '';
    return interpreter.startsWith('/') ? interpreter : null;
}

/**
 * Does the payload contain anything architecture-specific?
 *
 * Decided from the file's MAGIC, not from its name. A bundled runtime is just
 * called `node`, a stripped helper may have no extension at all, and an
 * extension list that misses one of them produces `Architecture: all` on an
 * x86-64 payload — which apt and dnf will happily install on arm64, where it
 * does not run.
 */
export function isArchIndependent(payload: readonly PayloadEntry[]): boolean {
    return !payload.some((entry) => isNativeBinary(entry.data));
}

// `process.arch` tokens, keyed by what the image records about itself. Only the
// values this repository can actually produce are listed; an unknown one reads
// as "cannot tell" rather than as a mismatch, because refusing an artifact over
// a machine constant nobody here emits would be a guess wearing a gate's clothes.
// The machine values this project actually ships packages for — no more. A value
// missing here makes `readBinaryArch` return null, and null is SILENT, so an
// absent row costs nothing but a check that does not fire.
//
// `EM_MIPS` (0x08) is absent for that reason and no other. An earlier version of
// this comment claimed it was absent because one value covers `mips` and
// `mipsel` and the row would have to guess; that was wrong three times over, and
// is corrected here rather than deleted because it is the kind of reasoning that
// gets re-derived: (1) `mipsel` IS little-endian MIPS, so the discriminator is
// `EI_DATA`, which `readBinaryArch` reads four lines below; (2) it could not
// "refuse a correct pack" either way, because `formats.ts` has no `mips` row in
// `DEBIAN_ARCH`/`RPM_ARCH`, so `archName` throws before any label is written;
// and (3) the principle it invoked is already broken one row down — `0x16` maps
// to `s390x`, but `EM_S390` is emitted by 31-bit `s390` too, and its
// discriminator is `EI_CLASS` at offset 4, which this function does NOT read.
// That row is the ambiguous one. Unreachable today (nothing here builds s390),
// but it is the row to fix first if this table ever grows.
const ELF_MACHINE_TO_ARCH: Record<number, string> = {
    0x03: 'ia32',
    0x15: 'ppc64',
    0x16: 's390x',
    0x28: 'arm',
    0x3e: 'x64',
    0xb7: 'arm64',
    0xf3: 'riscv64',
};

const MACHO_CPUTYPE_TO_ARCH: Record<number, string> = {
    0x00000007: 'ia32',
    0x0000000c: 'arm',
    0x01000007: 'x64',
    0x0100000c: 'arm64',
};

/**
 * PE/COFF `IMAGE_FILE_HEADER.Machine` → `process.arch`.
 *
 * The same three rows `manifest-conformance/lib/binary.mjs` carries, restated
 * rather than imported because `@gjsify/manifest-conformance` is `"private": true`
 * and `@gjsify/cli` is published: a published package cannot depend on a workspace
 * package that is never on npm. (An earlier version of this note said the CLI must
 * not depend on it because the rules are `portable` — `portable` is a `RuleScope`
 * on individual conformance RULES, and the ban it states runs the other way: a
 * portable rule must not import the CLI.) The values themselves are Microsoft's
 * architecture constants, so agreeing with that file is not agreeing with
 * ourselves.
 */
const PE_MACHINE_TO_ARCH: Record<number, string> = {
    0x014c: 'ia32',
    0x8664: 'x64',
    0xaa64: 'arm64',
};

/**
 * The `process.arch` token an image says it is built for, or `null` when the
 * question cannot be answered from the bytes.
 *
 * `null` still covers three different things on purpose, and all three must stay
 * silent: a file that is not a native binary at all (most of a payload), an image
 * whose machine constant is not in the tables above, and a Mach-O fat archive,
 * which carries several architectures and therefore matches any label a caller
 * could pass.
 *
 * PE WAS A FOURTH, AND IT WAS THE WORST ONE. This comment used to say PE was
 * silent because "this tree has never parsed" the COFF machine field — true, and
 * it made `assertPayloadMatchesArch` VACUOUS on the one layout whose native format
 * IS PE. #1354 M2b made that check non-vacuous for darwin by staging Mach-O into a
 * `.app`; M3 stages `node.exe` and a win32 GTK closure into a Windows program
 * directory, so a windows stage built with the wrong `--arch` would have carried
 * x64 DLLs under an `arm64` label with nothing to notice. Two reads — `e_lfanew`
 * at 0x3c, then `Machine` four bytes past the `PE\0\0` signature — close it. A
 * truncated `MZ` with no reachable PE header stays `null`, which is what
 * `packers.spec.ts` has always asserted and still does.
 */
export function readBinaryArch(data: Uint8Array): string | null {
    if (data.byteLength < 20) return null;
    const magic = ((data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!) >>> 0;
    if (magic === 0x7f454c46) {
        // ELF: EI_DATA at offset 5 says which end e_machine (offset 18) is written from.
        const littleEndian = data[5] === 1;
        const machine = littleEndian ? data[18]! | (data[19]! << 8) : (data[18]! << 8) | data[19]!;
        return ELF_MACHINE_TO_ARCH[machine] ?? null;
    }
    if (magic === 0xfeedface || magic === 0xfeedfacf) {
        return MACHO_CPUTYPE_TO_ARCH[((data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!) >>> 0] ?? null;
    }
    if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
        return MACHO_CPUTYPE_TO_ARCH[((data[7]! << 24) | (data[6]! << 16) | (data[5]! << 8) | data[4]!) >>> 0] ?? null;
    }
    // PE/COFF: `MZ`, then `IMAGE_DOS_HEADER.e_lfanew` at 0x3c points at `PE\0\0`,
    // and `IMAGE_FILE_HEADER.Machine` is the u16 right after it. Every field here
    // is little-endian regardless of the machine it names.
    if (data[0] === 0x4d && data[1] === 0x5a && data.byteLength >= 0x40) {
        const peOffset = (data[0x3c]! | (data[0x3d]! << 8) | (data[0x3e]! << 16) | (data[0x3f]! << 24)) >>> 0;
        if (peOffset + 6 > data.byteLength) return null;
        const signature = (data[peOffset]! | (data[peOffset + 1]! << 8) | (data[peOffset + 2]! << 16)) >>> 0;
        if (signature !== 0x004550 || data[peOffset + 3] !== 0x00) return null;
        return PE_MACHINE_TO_ARCH[data[peOffset + 4]! | (data[peOffset + 5]! << 8)] ?? null;
    }
    return null;
}

/**
 * Refuse a payload whose binaries disagree with the label the package will carry.
 *
 * THE INCIDENT, measured on 0.41.0 before this existed. A project whose payload
 * carries one x86-64 `.so`, packed on this x86-64 host:
 *
 *     gjsify ship --skip-build --arch arm64
 *     → xarch-demo_1.2.3-1_arm64.deb, xarch-demo-1.2.3-1.aarch64.rpm
 *     rpm -qp --qf '%{ARCH}'  → aarch64
 *     the .so inside it       → ELF e_machine 0x3e (x86-64)
 *
 * `--arch` LABELS the payload; it does not cross-compile it, and nothing
 * compared the two. The result installs on an arm64 machine — apt and dnf both
 * believe the header — and then fails to load, which is this tree's most
 * expensive failure class with an independent oracle actively confirming the
 * lie: `rpm` reads the header, and the header was written from the caller's
 * claim.
 *
 * Payload against LABEL, never payload against HOST. Assembling an arm64
 * artifact on an x64 machine is a supported path — the packers are pure
 * JavaScript and ADR 0024 § A1 turns it into a design commitment — so a host
 * comparison would refuse the very case the split exists to allow.
 */
export function assertPayloadMatchesArch(payload: readonly PayloadEntry[], arch: string): void {
    for (const entry of payload) {
        const found = readBinaryArch(entry.data);
        if (found === null || found === arch) continue;
        throw new Error(
            `gjsify ship: the payload is ${found}, but the package would be labelled ${arch} — ` +
                `${entry.path} is built for ${found}.\n` +
                '    `--arch` names the architecture the PAYLOAD was built for; it does not cross-compile ' +
                'anything.\n' +
                `    A package labelled ${arch} installs on ${arch} and then fails to load. Build the payload ` +
                `for ${arch}\n` +
                '    (its own prebuild), or assemble the stage without `--arch` and label the payload you ' +
                'actually have.',
        );
    }
}

/**
 * Which executable format these bytes are, or `null` for anything else.
 *
 * The FAMILY and not merely "is it native", because the signer needs the
 * distinction: `codesign` signs Mach-O and `signtool` signs PE, and an ELF in a
 * darwin payload is neither — it is a file that should not be there. A caller
 * asking only "is this native" would have handed one to `codesign`, whose
 * refusal names a file rather than the mistake.
 *
 * Magic numbers rather than suffixes, and that is load-bearing on darwin: a GTK
 * closure names its images `.dylib`, `.so`, `.node` and nothing at all (the
 * interpreter), so a suffix list signs three of those four.
 */
export function classifyBinary(data: Uint8Array): 'elf' | 'macho' | 'pe' | null {
    if (data.byteLength < 4) return null;
    const magic = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
    switch (magic >>> 0) {
        case 0x7f454c46: // \x7fELF
            return 'elf';
        case 0xfeedface: // Mach-O 32
        case 0xfeedfacf: // Mach-O 64
        case 0xcefaedfe: // Mach-O 32, byte-swapped
        case 0xcffaedfe: // Mach-O 64, byte-swapped
        case 0xcafebabe: // Mach-O universal binary
            return 'macho';
        default:
            return data[0] === 0x4d && data[1] === 0x5a ? 'pe' : null; // MZ — PE/COFF
    }
}

/** ELF, Mach-O (both endiannesses, both widths, and a fat archive) or PE. */
function isNativeBinary(data: Uint8Array): boolean {
    return classifyBinary(data) !== null;
}
