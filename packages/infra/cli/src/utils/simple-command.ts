// Quote-aware tokenizer for a package.json script that is a SIMPLE command line.
//
// Lifted out of `commands/run.ts` when `gjsify dev` became the second caller:
// both need to know whether a declared script is a plain `gjsify <subcommand> …`
// they may take apart, or something only a shell can execute. The predicate is
// deliberately conservative in ONE direction — a `null` costs the caller its
// fast path, a wrong token list would run a different command than the script
// says.

/** Characters that make a string something only a shell may execute. */
const SHELL_SPECIAL = '|&;<>`$()\\\n\r*?{}[]~#!';

/** The same set minus `*` and `?` — see {@link TokenizeOptions.allowGlobs}. */
const SHELL_SPECIAL_ALLOWING_GLOBS = SHELL_SPECIAL.replace('*', '').replace('?', '');

export interface TokenizeOptions {
    /**
     * Accept an unquoted `*`/`?` as an ordinary token character.
     *
     * Off by default, and the default is about EXECUTION: a caller that RUNS
     * the tokens must not pass `*.tsbuildinfo` through unexpanded, because the
     * shell it replaces would have expanded it first. A caller that only READS
     * the targets — `utils/package-inputs.ts`, asking which paths a package
     * declares it produces — wants the pattern itself, and `gjsify clear`
     * expands the same two characters in its own last segment anyway
     * (`utils/clear-targets.ts`). Nothing else moves: every operator,
     * substitution, brace and tilde still returns `null`.
     */
    allowGlobs?: boolean;
}

/**
 * Tokenize `cmd`, or return `null` if the string contains anything the shell
 * would treat specially — operators (`&& | ; < > &`), substitutions (`$(...)` /
 * backticks / `$VAR`), unquoted globs/expansions (`* ? { } [ ] ~`), comments
 * (`#`), or an unterminated quote — in which case the caller MUST use the real
 * shell instead. Quotes are honoured so a quoted glob (`'src/**'`) survives as a
 * single literal token, exactly as the shell would hand it to `gjsify` (which
 * does its own glob expansion).
 */
export function tokenizeSimpleCommand(cmd: string, options: TokenizeOptions = {}): string[] | null {
    const special = options.allowGlobs === true ? SHELL_SPECIAL_ALLOWING_GLOBS : SHELL_SPECIAL;
    const tokens: string[] = [];
    let cur = '';
    let has = false;
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i]!;
        if (quote === "'") {
            if (c === "'") quote = null;
            else cur += c;
            continue;
        }
        if (quote === '"') {
            if (c === '"') quote = null;
            else if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) cur += cmd[++i];
            else if (c === '$' || c === '`')
                return null; // substitution inside "…"
            else cur += c;
            continue;
        }
        if (c === "'" || c === '"') {
            quote = c;
            has = true;
            continue;
        }
        if (c === ' ' || c === '\t') {
            if (has) {
                tokens.push(cur);
                cur = '';
                has = false;
            }
            continue;
        }
        if (special.includes(c)) return null;
        cur += c;
        has = true;
    }
    if (quote) return null; // unterminated quote
    if (has) tokens.push(cur);
    return tokens;
}

/**
 * The argv of a script that is a single `gjsify <subcommand> …` command — i.e.
 * the tokens after `gjsify` — or `null` when it is anything else. `null` is the
 * signal to hand the literal to a shell.
 */
export function gjsifyCommandArgv(literal: string, options: TokenizeOptions = {}): string[] | null {
    const tokens = tokenizeSimpleCommand(literal, options);
    if (!tokens || tokens.length < 2 || tokens[0] !== 'gjsify') return null;
    return tokens.slice(1);
}
