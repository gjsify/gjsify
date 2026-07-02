// A CodeMirror 6 StreamLanguage mode for 6502 assembly — the web twin of the
// GtkSourceView `6502-assembler` language definition. A stream tokenizer is
// enough here: 6502 asm is line-oriented and needs no nested grammar, so we
// avoid a full Lezer grammar (per the task brief).
//
// Token classes (mapped to @lezer/highlight tags via `asm6502TokenTable`):
//   opcode     — the 56 official mnemonics (LDA, STA, JMP, …)      → keyword
//   register   — the accumulator/index registers A, X, Y           → atom
//   directive  — assembler pseudo-ops (define, dcb, .org, .byte …) → meta
//   number     — hex `$1a`, binary `%1010`, decimal `42`           → number
//   string     — quoted literals used by `.ascii` / `.byte "…"`    → string
//   comment    — `; …` to end of line                              → lineComment
//   label      — a definition (`loop:` or a bare name at column 0) → labelName
//   operator   — the immediate `#`, arithmetic + addressing punct  → operator
//   identifier — any other symbol reference (a named operand)      → variableName
//
// Reference: refs/gjs-guide + the GtkSourceView `.lang` grammar shape.

import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { tags, type Tag } from '@lezer/highlight';

/** The 56 official NMOS 6502 mnemonics (uppercased for case-insensitive match). */
export const OPCODES: ReadonlySet<string> = new Set([
    'ADC',
    'AND',
    'ASL',
    'BCC',
    'BCS',
    'BEQ',
    'BIT',
    'BMI',
    'BNE',
    'BPL',
    'BRK',
    'BVC',
    'BVS',
    'CLC',
    'CLD',
    'CLI',
    'CLV',
    'CMP',
    'CPX',
    'CPY',
    'DEC',
    'DEX',
    'DEY',
    'EOR',
    'INC',
    'INX',
    'INY',
    'JMP',
    'JSR',
    'LDA',
    'LDX',
    'LDY',
    'LSR',
    'NOP',
    'ORA',
    'PHA',
    'PHP',
    'PLA',
    'PLP',
    'ROL',
    'ROR',
    'RTI',
    'RTS',
    'SBC',
    'SEC',
    'SED',
    'SEI',
    'STA',
    'STX',
    'STY',
    'TAX',
    'TAY',
    'TSX',
    'TXA',
    'TXS',
    'TYA',
]);

/** The registers that appear as bare operands (`ASL A`, `LDA $00,X`). */
export const REGISTERS: ReadonlySet<string> = new Set(['A', 'X', 'Y']);

/** Assembler pseudo-ops. `define`/`dcb` are the easy6502 dialect; the rest are
 *  common cross-assembler directives (with the leading dot handled separately). */
export const DIRECTIVE_WORDS: ReadonlySet<string> = new Set([
    'DEFINE',
    'DCB',
    'ORG',
    'BYTE',
    'WORD',
    'DB',
    'DW',
    'DS',
    'ASCII',
    'ASCIIZ',
    'TEXT',
    'INCLUDE',
    'INCBIN',
    'EQU',
    'END',
    'PROC',
    'ENDPROC',
    'MACRO',
    'ENDMACRO',
]);

/**
 * Classify an identifier-shaped token. Pure + side-effect-free so it is unit
 * testable without a CodeMirror stream. `atLineStart` decides whether an
 * unknown word is a label DEFINITION (column 0) or a symbol REFERENCE.
 */
export function classifyWord(word: string, atLineStart: boolean): string {
    const upper = word.toUpperCase();
    if (OPCODES.has(upper)) return 'opcode';
    if (DIRECTIVE_WORDS.has(upper)) return 'directive';
    if (REGISTERS.has(upper)) return 'register';
    if (atLineStart) return 'label';
    return 'identifier';
}

/**
 * Tokenize one token from the stream. Exported for unit tests (feed it a
 * `StringStream`). Returns a token-class name (see file header) or `null` for
 * whitespace/unclassified punctuation.
 */
export function token6502(stream: StringStream): string | null {
    const atLineStart = stream.sol();
    if (stream.eatSpace()) return null;

    const ch = stream.peek();
    if (ch === null || ch === undefined) return null;

    // `; …` line comment.
    if (ch === ';') {
        stream.skipToEnd();
        return 'comment';
    }

    // Quoted string (used by `.ascii "…"` / `.byte "…"`).
    if (ch === '"' || ch === "'") {
        const quote = ch;
        stream.next();
        let escaped = false;
        while (!stream.eol()) {
            const c = stream.next();
            if (c === undefined) break;
            if (c === quote && !escaped) break;
            escaped = c === '\\' && !escaped;
        }
        return 'string';
    }

    // Immediate-addressing prefix.
    if (ch === '#') {
        stream.next();
        return 'operator';
    }

    // Hex literal `$1a2b`.
    if (ch === '$') {
        stream.next();
        stream.eatWhile(/[0-9a-fA-F]/);
        return 'number';
    }

    // Binary literal `%1010`.
    if (ch === '%') {
        stream.next();
        stream.eatWhile(/[01]/);
        return 'number';
    }

    // Decimal literal.
    if (/[0-9]/.test(ch)) {
        stream.eatWhile(/[0-9]/);
        return 'number';
    }

    // Dot-directive `.org` / `.byte`.
    if (ch === '.') {
        stream.next();
        if (stream.eatWhile(/[A-Za-z0-9_]/)) return 'directive';
        return null;
    }

    // Identifier → opcode / register / directive / label / reference.
    if (/[A-Za-z_]/.test(ch)) {
        stream.eatWhile(/[A-Za-z0-9_]/);
        const word = stream.current();
        // An explicit `name:` is always a label definition.
        if (stream.peek() === ':') return 'label';
        return classifyWord(word, atLineStart);
    }

    // Arithmetic / addressing punctuation.
    if ('+-*/=<>,()[]&|^~'.includes(ch)) {
        stream.next();
        return 'operator';
    }

    stream.next();
    return null;
}

/** Maps this mode's token-class names to @lezer/highlight tags. */
export const asm6502TokenTable: Record<string, Tag> = {
    opcode: tags.keyword,
    register: tags.atom,
    directive: tags.meta,
    number: tags.number,
    string: tags.string,
    comment: tags.lineComment,
    label: tags.labelName,
    operator: tags.operator,
    identifier: tags.variableName,
};

/** The StreamParser powering the 6502 mode. */
export const asm6502Parser: StreamParser<unknown> = {
    name: '6502',
    token: (stream) => token6502(stream),
    tokenTable: asm6502TokenTable,
    languageData: { commentTokens: { line: ';' } },
};

/** The 6502 assembly language extension for a CodeMirror EditorState. */
export function asm6502(): Extension {
    return StreamLanguage.define(asm6502Parser);
}
