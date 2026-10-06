export interface TranslateRegexOptions {
    /** The `extended="true"` attribute of the pattern element (PCRE `x`): whitespace and `#` comments are not part of the pattern. */
    readonly extended: boolean;
    /** Flags to add to the always-set `m` (GtkSourceView matches `^`/`$` per line), e.g. `y` for the engine. */
    readonly flags?: string;
}

/** A construct GRegex (PCRE) has and a JavaScript `RegExp` cannot express; refused, never approximated. */
export class UnsupportedRegexError extends Error {
    constructor(
        readonly construct: string,
        readonly offset: number,
    ) {
        super(`${construct} is not supported (at offset ${offset})`);
        this.name = 'UnsupportedRegexError';
    }
}

/** Escapes that PCRE reads and JS silently turns into a plain letter. */
const REFUSED_ESCAPES: Readonly<Record<string, string>> = {
    A: '\\A (start of subject)',
    Z: '\\Z (end of subject)',
    z: '\\z (end of subject)',
    G: '\\G (match start anchor)',
    K: '\\K (reset match start)',
    Q: '\\Q…\\E quoting',
    h: '\\h (horizontal space)',
    H: '\\H (not horizontal space)',
    R: '\\R (newline sequence)',
};

const BRACED_QUANTIFIER = /^\{\d+(?:,\d*)?\}/;

/** The delimiter PCRE accepts after `\g` for a group reference (`\g<1>`, `\g{name}`, `\g'1'`). */
const isGroupRefDelimiter = (c: string): boolean => c === '<' || c === '{' || c === "'";

/**
 * Translates one GtkSourceView pattern (GRegex/PCRE dialect) into a JS `RegExp`.
 *
 * One scanner owns the escape and character-class state, so a lookalike inside a class or
 * behind a backslash (`[\+\-\*]`, `a\+\+`, `\\A`) is never mistaken for the construct. It handles:
 * extended mode, `\%[`/`\%]` (GtkSourceView's word boundaries), a leading `(?i)`/`(?s)`/`(?x)`,
 * `(?P<n>…)`/`(?P=n)`, `(?#…)` comments, and the POSIX-less `[]…]` literal bracket.
 * It refuses, by name: possessive quantifiers, atomic groups, conditionals `(?(…)`, branch
 * reset `(?|…)`, recursion and subroutine calls, `\A \Z \z \G \K \Q \h \H \R`,
 * `\p{…}`/`\P{…}`, `\e`, `\g<…>`/`\g{…}` group references, `\N{U+…}`, `\%{id}` regex
 * references, braced `\x{…}`, POSIX classes and inline flags anywhere but the very start.
 */
export function translateRegex(source: string, options: TranslateRegexOptions): RegExp {
    let extended = options.extended;
    let flags = 'm';
    let out = '';
    let i = 0;
    let afterQuantifier = false;

    const lead = /^\(\?([isx]+)\)/.exec(source);
    if (lead) {
        for (const flag of lead[1]) {
            if (flag === 'x') extended = true;
            else if (!flags.includes(flag)) flags += flag;
        }
        i = lead[0].length;
    }

    const emit = (text: string): void => {
        out += text;
        afterQuantifier = false;
    };

    while (i < source.length) {
        const ch = source[i];

        if (ch === '\\') {
            const next = source[i + 1];
            if (next === undefined) throw new UnsupportedRegexError('a trailing backslash', i);
            if (next in REFUSED_ESCAPES) throw new UnsupportedRegexError(REFUSED_ESCAPES[next], i);
            if (next === '%') {
                const marker = source[i + 2];
                if (marker === '[' || marker === ']') {
                    emit('\\b');
                    i += 3;
                    continue;
                }
                throw new UnsupportedRegexError('\\%{id} regex reference', i);
            }
            if (next === 'x' && source[i + 2] === '{') throw new UnsupportedRegexError('braced \\x{…} escape', i);
            // \p/\P only mean a Unicode property with a brace; a bare `\g` is a PCRE error, but the
            // delimited forms are the reference/subroutine syntax JS reads as a plain letter.
            if ((next === 'p' || next === 'P') && source[i + 2] === '{')
                throw new UnsupportedRegexError('\\p{…}/\\P{…} (Unicode property)', i);
            if (next === 'e') throw new UnsupportedRegexError('\\e (ESC character)', i);
            if (next === 'g' && isGroupRefDelimiter(source[i + 2]))
                throw new UnsupportedRegexError('\\g<…>/\\g{…} (PCRE group reference)', i);
            if (next === 'N' && source.slice(i + 2, i + 5) === '{U+')
                throw new UnsupportedRegexError('\\N{U+…} (Unicode codepoint)', i);
            emit(ch + next);
            i += 2;
            continue;
        }

        if (ch === '[') {
            let j = i + 1;
            let cls = '[';
            if (source[j] === '^') {
                cls += '^';
                j++;
            }
            if (source[j] === ']') {
                cls += '\\]';
                j++;
            }
            for (;;) {
                const c = source[j];
                if (c === undefined) throw new UnsupportedRegexError('an unterminated character class', i);
                if (c === ']') break;
                if (c === '[' && source[j + 1] === ':') throw new UnsupportedRegexError('a POSIX character class', j);
                if (c === '\\') {
                    const n = source[j + 1];
                    if (n === undefined) throw new UnsupportedRegexError('an unterminated character class', i);
                    if (n in REFUSED_ESCAPES) throw new UnsupportedRegexError(REFUSED_ESCAPES[n], j);
                    if (n === 'x' && source[j + 2] === '{') throw new UnsupportedRegexError('braced \\x{…} escape', j);
                    if ((n === 'p' || n === 'P') && source[j + 2] === '{')
                        throw new UnsupportedRegexError('\\p{…}/\\P{…} (Unicode property)', j);
                    if (n === 'e') throw new UnsupportedRegexError('\\e (ESC character)', j);
                    if (n === 'g' && isGroupRefDelimiter(source[j + 2]))
                        throw new UnsupportedRegexError('\\g<…>/\\g{…} (PCRE group reference)', j);
                    if (n === 'N' && source.slice(j + 2, j + 5) === '{U+')
                        throw new UnsupportedRegexError('\\N{U+…} (Unicode codepoint)', j);
                    cls += c + n;
                    j += 2;
                    continue;
                }
                cls += c;
                j++;
            }
            emit(`${cls}]`);
            i = j + 1;
            continue;
        }

        if (ch === '(' && source[i + 1] === '?') {
            const rest = source.slice(i + 2);
            if (rest.startsWith('>')) throw new UnsupportedRegexError('an atomic group (?>…)', i);
            if (rest.startsWith('(')) throw new UnsupportedRegexError('a conditional group (?(…)', i);
            if (rest.startsWith('|')) throw new UnsupportedRegexError('a branch reset group (?|…)', i);
            if (rest.startsWith('#')) {
                const end = source.indexOf(')', i);
                if (end === -1) throw new UnsupportedRegexError('an unterminated (?#…) comment', i);
                i = end + 1;
                continue;
            }
            if (rest.startsWith('P<')) {
                emit('(?<');
                i += 4;
                continue;
            }
            const named = /^P=(\w+)\)/.exec(rest);
            if (named) {
                emit(`\\k<${named[1]}>`);
                i += 2 + named[0].length;
                continue;
            }
            if (/^(?:R|[0-9]|[+-][0-9]|&|P>)/.test(rest))
                throw new UnsupportedRegexError('recursion or a subroutine call', i);
            if (/^[imsxUJ-]+[:)]/.test(rest)) throw new UnsupportedRegexError('an inline flag group', i);
            emit('(?');
            i += 2;
            continue;
        }

        if (ch === '{') {
            const braced = BRACED_QUANTIFIER.exec(source.slice(i));
            if (braced) {
                emit(braced[0]);
                afterQuantifier = true;
                i += braced[0].length;
                continue;
            }
        }

        if (ch === '+' && afterQuantifier) throw new UnsupportedRegexError('a possessive quantifier', i);

        if (ch === '*' || ch === '+' || ch === '?') {
            const lazy: boolean = ch === '?' && afterQuantifier;
            emit(ch);
            afterQuantifier = !lazy;
            i++;
            continue;
        }

        if (extended) {
            if (/\s/.test(ch)) {
                i++;
                continue;
            }
            if (ch === '#') {
                while (i < source.length && source[i] !== '\n') i++;
                continue;
            }
        }

        emit(ch);
        i++;
    }

    return new RegExp(out, flags + (options.flags ?? ''));
}
