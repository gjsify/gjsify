// The selector grammar: text in, AST out.
//
// Everything this engine will not evaluate THROWS a `SyntaxError` NAMING the
// construct (ADR 0026 § 6). That is the whole point of the file: an engine that
// returns nothing for a selector it could not read is indistinguishable from one
// that read it and found nothing, which is the exact failure `querySelectorAll`
// had here — `.aditem`, `[data-adid]` and every combinator answered `[]`.
//
// Implements CSS Selectors Level 4 (https://drafts.csswg.org/selectors-4/) for
// the subset ADR 0026 § 6 scopes in.

import { type NthFormula, parseNth } from './nth.js';

export type Combinator = 'descendant' | 'child' | 'adjacent' | 'sibling';

/** The eight forms an attribute selector takes, `[a]` and `[a!=b]` included. */
export type AttributeAction = 'exists' | 'equals' | 'element' | 'start' | 'end' | 'any' | 'hyphen' | 'not';

export type NthAxis = 'child' | 'last-child' | 'of-type' | 'last-of-type';

export type SimpleSelector =
    | { kind: 'universal' }
    | { kind: 'type'; name: string }
    | { kind: 'attribute'; name: string; action: AttributeAction; value: string; ignoreCase: boolean | null }
    | { kind: 'nth'; axis: NthAxis; formula: NthFormula; of: ComplexSelector[] | null }
    | { kind: 'empty' }
    | { kind: 'root' }
    | { kind: 'scope' }
    | { kind: 'is'; selectors: ComplexSelector[] }
    | { kind: 'not'; selectors: ComplexSelector[] }
    | { kind: 'has'; selectors: ComplexSelector[] };

export interface ComplexSelector {
    /** `compounds[i]` is joined to `compounds[i + 1]` by `combinators[i]`. */
    compounds: SimpleSelector[][];
    combinators: Combinator[];
    /** Set only for a RELATIVE selector — `:has(> .price)` — where it names the
     *  combinator between the `:has()` anchor and `compounds[0]`. */
    leading: Combinator | null;
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

const ATTRIBUTE_OPERATORS: Record<string, AttributeAction> = {
    '~': 'element',
    '|': 'hyphen',
    '^': 'start',
    $: 'end',
    '*': 'any',
    '!': 'not',
};

const NTH_AXES: Record<string, NthAxis> = {
    'nth-child': 'child',
    'nth-last-child': 'last-child',
    'nth-of-type': 'of-type',
    'nth-last-of-type': 'last-of-type',
};

/**
 * Pseudo-classes that are ENTIRELY derived from attributes, expressed as the
 * selectors they stand for and expanded by the parser. Written out from the HTML
 * spec's own definitions rather than special-cased in the matcher, so the matcher
 * has no knowledge of HTML at all.
 *
 * https://html.spec.whatwg.org/multipage/scripting.html#disabled-elements
 * https://html.spec.whatwg.org/multipage/form-elements.html#concept-option-selectedness
 */
const ALIASES: Record<string, string> = {
    'any-link': ':is(a, area, link)[href]',
    disabled:
        ':is(:is(button, input, select, textarea, optgroup, option, fieldset)[disabled],' +
        ' optgroup[disabled] > option,' +
        ' fieldset[disabled]:not(fieldset[disabled] legend:first-of-type *))',
    enabled: ':is(button, input, select, textarea, optgroup, option, fieldset):not(:disabled)',
    checked: ':is(:is(input[type=radio], input[type=checkbox])[checked], option:selected)',
    required: ':is(input, select, textarea)[required]',
    optional: ':is(input, select, textarea):not([required])',
    selected: 'option:is([selected], select:not([multiple]):not(:has(> option[selected])) > :first-of-type)',
};

/** Answered by a rendering engine, which this is not. */
const PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter', 'selection', 'placeholder']);

/** Answered by a live document with a pointer and a history, which this is not. */
const USER_STATE = new Set([
    'hover',
    'active',
    'focus',
    'focus-visible',
    'focus-within',
    'visited',
    'link',
    'target',
    'target-within',
    'playing',
    'paused',
    'current',
    'past',
    'future',
]);

function isNameChar(ch: string): boolean {
    if (ch === '') return false;
    const code = ch.codePointAt(0) as number;
    return (
        ch === '-' ||
        ch === '_' ||
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code > 0x7f
    );
}

function isNameStart(ch: string): boolean {
    return ch === '\\' || (ch !== '-' && isNameChar(ch) && !(ch >= '0' && ch <= '9'));
}

function isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isNthChar(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || ch === 'n' || ch === 'N' || ch === '+' || ch === '-' || WHITESPACE.has(ch);
}

class SelectorParser {
    private pos = 0;

    constructor(private readonly input: string) {}

    parseSelectorList(relative: boolean): ComplexSelector[] {
        const list: ComplexSelector[] = [this.parseComplex(relative)];
        while (this.peek() === ',') {
            this.pos++;
            list.push(this.parseComplex(relative));
        }
        return list;
    }

    atEnd(): boolean {
        return this.pos >= this.input.length;
    }

    fail(message: string): never {
        throw new SyntaxError("Failed to parse selector '" + this.input + "': " + message);
    }

    private peek(offset = 0): string {
        return this.input[this.pos + offset] ?? '';
    }

    private skipWhitespace(): boolean {
        const start = this.pos;
        while (WHITESPACE.has(this.peek())) this.pos++;
        return this.pos > start;
    }

    private expect(ch: string): void {
        if (this.peek() !== ch) this.fail("expected '" + ch + "' at offset " + this.pos);
        this.pos++;
    }

    private parseComplex(relative: boolean): ComplexSelector {
        this.skipWhitespace();
        const leading = relative ? this.readLeadingCombinator() : null;
        const compounds: SimpleSelector[][] = [this.parseCompound()];
        const combinators: Combinator[] = [];
        for (;;) {
            const combinator = this.readCombinator();
            if (combinator === null) break;
            combinators.push(combinator);
            compounds.push(this.parseCompound());
        }
        return { compounds, combinators, leading };
    }

    /**
     * A relative selector may OPEN with a combinator — `:has(> .price)`. An
     * absent one is the descendant combinator, which is why this never fails
     * where `readCombinator` does: `.price` is a legal start, not a stray token.
     */
    private readLeadingCombinator(): Combinator {
        const ch = this.peek();
        if (ch !== '>' && ch !== '+' && ch !== '~') return 'descendant';
        this.pos++;
        this.skipWhitespace();
        return ch === '>' ? 'child' : ch === '+' ? 'adjacent' : 'sibling';
    }

    /** `null` ends the current complex selector — at `,`, at `)` or at the end. */
    private readCombinator(): Combinator | null {
        const spaced = this.skipWhitespace();
        const ch = this.peek();
        if (ch === '>' || ch === '+' || ch === '~') {
            this.pos++;
            this.skipWhitespace();
            return ch === '>' ? 'child' : ch === '+' ? 'adjacent' : 'sibling';
        }
        if (ch === '|' && this.peek(1) === '|') this.fail("the column combinator '||' needs a table layout");
        if (ch === '' || ch === ',' || ch === ')') return null;
        if (spaced) return 'descendant';
        this.fail("unexpected '" + ch + "' at offset " + this.pos);
    }

    private parseCompound(): SimpleSelector[] {
        const simples: SimpleSelector[] = [];
        for (;;) {
            const ch = this.peek();
            if (ch === '*') {
                this.pos++;
                this.rejectNamespace();
                simples.push({ kind: 'universal' });
            } else if (ch === '#') {
                this.pos++;
                simples.push({
                    kind: 'attribute',
                    name: 'id',
                    action: 'equals',
                    value: this.readName(),
                    ignoreCase: false,
                });
            } else if (ch === '.') {
                this.pos++;
                simples.push({
                    kind: 'attribute',
                    name: 'class',
                    action: 'element',
                    value: this.readName(),
                    ignoreCase: false,
                });
            } else if (ch === '[') {
                simples.push(this.parseAttribute());
            } else if (ch === ':') {
                for (const simple of this.parsePseudo()) simples.push(simple);
            } else if (ch === '|') {
                this.fail('namespace selectors need a namespace map this parser is not given');
            } else if (isNameStart(ch)) {
                const name = this.readName();
                this.rejectNamespace();
                simples.push({ kind: 'type', name });
            } else break;
        }
        if (simples.length === 0) this.fail('expected a selector at offset ' + this.pos);
        return simples;
    }

    /** `a|b` is a namespace selector; `[a|=b]` is the hyphen operator. */
    private rejectNamespace(): void {
        if (this.peek() === '|' && this.peek(1) !== '=') {
            this.fail('namespace selectors need a namespace map this parser is not given');
        }
    }

    private readName(): string {
        let out = '';
        for (;;) {
            const ch = this.peek();
            if (ch === '\\') {
                out += this.readEscape();
                continue;
            }
            if (!isNameChar(ch)) break;
            out += ch;
            this.pos++;
        }
        if (out === '') this.fail('expected an identifier at offset ' + this.pos);
        return out;
    }

    private readEscape(): string {
        this.pos++;
        let hex = '';
        while (hex.length < 6 && isHexDigit(this.peek())) {
            hex += this.peek();
            this.pos++;
        }
        if (hex === '') {
            const ch = this.peek();
            if (ch === '') this.fail('a trailing backslash escapes nothing');
            this.pos++;
            return ch;
        }
        // One whitespace character TERMINATES a hex escape rather than following
        // it, which is why `\3A x` is `:x` and not `: x`.
        if (WHITESPACE.has(this.peek())) this.pos++;
        const code = Number.parseInt(hex, 16);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
        return String.fromCodePoint(code);
    }

    private readString(quote: string): string {
        this.pos++;
        let out = '';
        for (;;) {
            const ch = this.peek();
            if (ch === '') this.fail('unterminated string');
            if (ch === quote) {
                this.pos++;
                return out;
            }
            if (ch === '\\') {
                out += this.readEscape();
                continue;
            }
            out += ch;
            this.pos++;
        }
    }

    private parseAttribute(): SimpleSelector {
        this.expect('[');
        this.skipWhitespace();
        if (this.peek() === '|' || this.peek() === '*') {
            this.fail('namespace selectors need a namespace map this parser is not given');
        }
        const name = this.readName();
        this.rejectNamespace();
        this.skipWhitespace();
        if (this.peek() === ']') {
            this.pos++;
            return { kind: 'attribute', name, action: 'exists', value: '', ignoreCase: null };
        }

        let action: AttributeAction;
        if (this.peek() === '=') {
            action = 'equals';
            this.pos++;
        } else if (this.peek(1) === '=' && Object.hasOwn(ATTRIBUTE_OPERATORS, this.peek())) {
            action = ATTRIBUTE_OPERATORS[this.peek()];
            this.pos += 2;
        } else {
            this.fail("'" + this.peek() + "' is not an attribute operator");
        }

        this.skipWhitespace();
        const quote = this.peek();
        const value = quote === '"' || quote === "'" ? this.readString(quote) : this.readName();
        this.skipWhitespace();

        let ignoreCase: boolean | null = null;
        const flag = this.peek().toLowerCase();
        if (flag === 'i' || flag === 's') {
            ignoreCase = flag === 'i';
            this.pos++;
            this.skipWhitespace();
        }
        this.expect(']');
        return { kind: 'attribute', name, action, value, ignoreCase };
    }

    private parsePseudo(): SimpleSelector[] {
        this.pos++;
        if (this.peek() === ':') {
            this.pos++;
            this.fail("pseudo-element '::" + this.readName() + "' has no meaning without rendering");
        }
        const name = this.readName().toLowerCase();

        if (name === 'not' || name === 'is' || name === 'where' || name === 'matches' || name === 'has') {
            this.expect('(');
            const selectors = this.parseSelectorList(name === 'has');
            this.expect(')');
            // `:where()` differs from `:is()` only in specificity, which nothing
            // here computes: there is no cascade, only a yes or a no.
            return [{ kind: name === 'not' ? 'not' : name === 'has' ? 'has' : 'is', selectors }];
        }

        if (Object.hasOwn(NTH_AXES, name)) return [this.parseNthPseudo(NTH_AXES[name])];

        if (name === 'first-child') return [positional('child', 1)];
        if (name === 'last-child') return [positional('last-child', 1)];
        if (name === 'only-child') return [positional('child', 1), positional('last-child', 1)];
        if (name === 'first-of-type') return [positional('of-type', 1)];
        if (name === 'last-of-type') return [positional('last-of-type', 1)];
        if (name === 'only-of-type') return [positional('of-type', 1), positional('last-of-type', 1)];

        if (name === 'empty') return [{ kind: 'empty' }];
        if (name === 'root') return [{ kind: 'root' }];
        if (name === 'scope') return [{ kind: 'scope' }];

        if (Object.hasOwn(ALIASES, name)) {
            return [{ kind: 'is', selectors: parseSelectorList(ALIASES[name]) }];
        }

        if (USER_STATE.has(name)) {
            this.fail("':" + name + "' is a user-state pseudo-class and needs a live document");
        }
        if (PSEUDO_ELEMENTS.has(name)) {
            this.fail("pseudo-element ':" + name + "' has no meaning without rendering");
        }
        this.fail("unknown pseudo-class ':" + name + "'");
    }

    private parseNthPseudo(axis: NthAxis): SimpleSelector {
        this.expect('(');
        const formula = parseNth(this.readNthArgument());
        let of: ComplexSelector[] | null = null;
        if (this.readKeyword('of')) of = this.parseSelectorList(false);
        this.expect(')');
        return { kind: 'nth', axis, formula, of };
    }

    /**
     * `odd` and `even` are read as whole words FIRST: `odd` starts with the same
     * letter as the `of` keyword, so scanning for `of` before them would cut the
     * argument in half and leave `parseNth` an empty string.
     */
    private readNthArgument(): string {
        this.skipWhitespace();
        if (this.readKeyword('odd')) return 'odd';
        if (this.readKeyword('even')) return 'even';
        const start = this.pos;
        while (isNthChar(this.peek())) this.pos++;
        return this.input.slice(start, this.pos);
    }

    private readKeyword(word: string): boolean {
        const candidate = this.input.slice(this.pos, this.pos + word.length).toLowerCase();
        if (candidate !== word || isNameChar(this.peek(word.length))) return false;
        this.pos += word.length;
        this.skipWhitespace();
        return true;
    }
}

function positional(axis: NthAxis, b: number): SimpleSelector {
    return { kind: 'nth', axis, formula: { a: 0, b }, of: null };
}

/**
 * Quote a raw identifier so it survives being spliced into selector text — the
 * inverse of `readString`. Without it a `class` or `id` holding `a.b` turns
 * `getElementsByClassName('a.b')` into "class a AND class b": a WRONG answer
 * rather than an empty one, which is the failure mode this package exists to end.
 */
export function quoteSelectorString(value: string): string {
    return '"' + value.split('\\').join('\\\\').split('"').join('\\"') + '"';
}

/** Parse a comma-separated selector list. Throws `SyntaxError` on anything it
 *  will not evaluate — never returns a selector that silently matches nothing. */
export function parseSelectorList(selector: string): ComplexSelector[] {
    const parser = new SelectorParser(selector);
    const list = parser.parseSelectorList(false);
    if (!parser.atEnd()) parser.fail('unexpected trailing input');
    return list;
}
