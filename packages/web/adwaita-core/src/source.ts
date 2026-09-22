// Renderer-free source-code presentation: the 6502 assembly language definition
// (token tables + tokenizer), the syntax palette its token classes are coloured
// from, and the gutter formatters a hex/line-number gutter needs.
//
// It lived in `@gjsify/adwaita-web/source-view`, where 281 of its 953 lines
// carried no DOM and no CodeMirror and still could not be reached by any other
// renderer, because the module they sat in imported `@codemirror/language` at
// the top. The one thing that tied the tokenizer to CodeMirror was the TYPE of
// its argument, so {@link AdwSourceTokenStream} declares the eight members it
// actually touches and CodeMirror's `StringStream` satisfies that structurally —
// no adapter object, no wrapper allocation, and no dependency in this direction.
//
// What deliberately did NOT come along: the widget, any buffer state, and any
// generator from these tables to a GtkSourceView `.lang` file or `<style-scheme>`
// XML. The GNOME arm inherits the SYSTEM Adwaita scheme (its own scheme file is
// ten lines with `parent-scheme="Adwaita-dark"`); generating a scheme from the
// table below would silently take that inheritance away, so the palette here is
// the WEB twin of a scheme GNOME gets for free, not its source.
//
// Reference: refs/gjs-guide + the GtkSourceView `.lang` grammar shape
// Reference: packages/app-gnome/src/gutter-renderer-line-numbers.ts (native parity)
// Reference: packages/app-gnome/src/widgets/source-view.ts updateStyle(), onCopyHexClipboard()

// --- The stream seam -------------------------------------------------------

/**
 * The read/advance surface a stream tokenizer needs from its host editor — the
 * exact eight members {@link tokenizeAsm6502} touches, with CodeMirror's
 * `StringStream` signatures, so passing one satisfies this structurally.
 *
 * `next()` returns `string | void` rather than `string | undefined` because
 * that is what `StringStream` declares, and `void` is not assignable to
 * `undefined`: narrowing here would reject the very class this exists to accept.
 */
export interface AdwSourceTokenStream {
    /** The text consumed since the current token started. */
    current(): string;
    /** Consume the whitespace run ahead of the cursor; true if any was there. */
    eatSpace(): boolean;
    /** Consume while characters match; true if any were consumed. */
    eatWhile(match: string | RegExp | ((ch: string) => boolean)): boolean;
    /** True at the end of the line. */
    eol(): boolean;
    /** Read one character and advance. */
    next(): string | void;
    /** The character at the cursor, without advancing. */
    peek(): string | undefined;
    /** Jump to the end of the line. */
    skipToEnd(): void;
    /** True at the start of the line — what makes a bare word a label. */
    sol(): boolean;
}

// --- 6502 assembly ---------------------------------------------------------

/** The token classes {@link tokenizeAsm6502} can emit. */
export type AdwSourceTokenClass =
    | 'comment'
    | 'directive'
    | 'identifier'
    | 'label'
    | 'number'
    | 'opcode'
    | 'operator'
    | 'register'
    | 'string';

/** The 56 official NMOS 6502 mnemonics (uppercased for case-insensitive match). */
export const ADW_SOURCE_6502_OPCODES: ReadonlySet<string> = new Set([
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
export const ADW_SOURCE_6502_REGISTERS: ReadonlySet<string> = new Set(['A', 'X', 'Y']);

/** Assembler pseudo-ops. `define`/`dcb` are the easy6502 dialect; the rest are
 *  common cross-assembler directives (with the leading dot handled separately). */
export const ADW_SOURCE_6502_DIRECTIVES: ReadonlySet<string> = new Set([
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

/** The comment introducer 6502 assembly uses, for an editor's comment command. */
export const ADW_SOURCE_6502_LINE_COMMENT = ';';

/**
 * Classify an identifier-shaped token. Pure + side-effect-free so it is unit
 * testable without a stream at all. `atLineStart` decides whether an unknown
 * word is a label DEFINITION (column 0) or a symbol REFERENCE.
 */
export function classifyAsm6502Word(word: string, atLineStart: boolean): AdwSourceTokenClass {
    const upper = word.toUpperCase();
    if (ADW_SOURCE_6502_OPCODES.has(upper)) return 'opcode';
    if (ADW_SOURCE_6502_DIRECTIVES.has(upper)) return 'directive';
    if (ADW_SOURCE_6502_REGISTERS.has(upper)) return 'register';
    if (atLineStart) return 'label';
    return 'identifier';
}

/**
 * Tokenize one token from `stream`. Returns a token class or `null` for
 * whitespace and unclassified punctuation, which is the contract a CodeMirror
 * `StreamParser.token` wants — and, being typed on
 * {@link AdwSourceTokenStream}, the contract any other editor can meet too.
 */
export function tokenizeAsm6502(stream: AdwSourceTokenStream): AdwSourceTokenClass | null {
    const atLineStart = stream.sol();
    if (stream.eatSpace()) return null;

    const ch = stream.peek();
    if (ch === null || ch === undefined) return null;

    // `; …` line comment.
    if (ch === ADW_SOURCE_6502_LINE_COMMENT) {
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
        return classifyAsm6502Word(word, atLineStart);
    }

    // Arithmetic / addressing punctuation.
    if ('+-*/=<>,()[]&|^~'.includes(ch)) {
        stream.next();
        return 'operator';
    }

    stream.next();
    return null;
}

// --- Syntax palette --------------------------------------------------------

/**
 * The colourable roles a token class maps onto. Fewer than the token classes,
 * because a language names tokens after its own grammar (`opcode`) while a
 * colour scheme names them after what a reader sees (`keyword`) — and the
 * second set is what a scheme, a stylesheet or another language shares.
 */
export type AdwSourceSyntaxRole =
    | 'comment'
    | 'directive'
    | 'keyword'
    | 'label'
    | 'number'
    | 'operator'
    | 'register'
    | 'string';

/** The roles in the order a generated stylesheet emits them. */
export const ADW_SOURCE_SYNTAX_ROLES: readonly AdwSourceSyntaxRole[] = [
    'comment',
    'keyword',
    'number',
    'string',
    'label',
    'register',
    'directive',
    'operator',
];

/** One colour per {@link AdwSourceSyntaxRole}, as a CSS-parsable colour. */
export type AdwSourcePalette = Readonly<Record<AdwSourceSyntaxRole, string>>;

/**
 * Which role paints a token class. `identifier` maps to `null`: a plain symbol
 * reference is deliberately UNCOLOURED, taking the view's foreground, exactly
 * as the native GtkSourceView scheme leaves it.
 */
export const ADW_SOURCE_6502_TOKEN_ROLES: Readonly<Record<AdwSourceTokenClass, AdwSourceSyntaxRole | null>> = {
    comment: 'comment',
    directive: 'directive',
    identifier: null,
    label: 'label',
    number: 'number',
    opcode: 'keyword',
    operator: 'operator',
    register: 'register',
    string: 'string',
};

/** Light-scheme syntax colours (Adwaita named palette). */
export const ADW_SOURCE_PALETTE_LIGHT: AdwSourcePalette = {
    comment: '#5e5c64',
    keyword: '#1c71d8',
    number: '#c64600',
    string: '#26a269',
    label: '#813d9c',
    register: '#007e8a',
    directive: '#a51d2d',
    operator: 'rgba(0, 0, 6, 0.55)',
};

/** Dark-scheme syntax colours (Adwaita named palette). */
export const ADW_SOURCE_PALETTE_DARK: AdwSourcePalette = {
    comment: '#9a9996',
    keyword: '#78aeed',
    number: '#ffa348',
    string: '#8ff0a4',
    label: '#dc8add',
    register: '#33d1c9',
    directive: '#f66151',
    operator: 'rgba(255, 255, 255, 0.55)',
};

// --- Gutter formatting -----------------------------------------------------

/** Bytes represented per visual line in the hex monitor / hexdump gutter. */
export const ADW_SOURCE_HEX_STRIDE = 16;

/**
 * Format a 1-based line number as a 4-digit uppercase hex address, the way the
 * native GtkSourceView hex gutter renders monitor/hexdump rows: each row advances
 * the address by `stride` bytes from `start` (the base address of the first row,
 * e.g. 0x0600 for a 6502 program). `lineNo` is 1-based, per CodeMirror's
 * `formatNumber` contract.
 */
export function formatHexAddress(lineNo: number, start: number, stride: number = ADW_SOURCE_HEX_STRIDE): string {
    const address = start + (lineNo - 1) * stride;
    return address.toString(16).padStart(4, '0').toUpperCase();
}

/**
 * Format a 1-based line number for the normal (decimal) gutter, offset so
 * `start` is the value shown on the first line — the web twin of the native
 * renderer's `line + startValue`.
 */
export function formatLineNumber(lineNo: number, start: number = 1): string {
    return String(lineNo - 1 + start);
}

/**
 * Strip every whitespace character from `text` — the copy-without-spaces
 * transform the native hex monitor applies so a copied address/byte run pastes
 * as a compact hex string. Mirrors `text.replace(/\s/g, '')` in the GTK widget.
 */
export function stripSourceWhitespace(text: string): string {
    return text.replace(/\s/g, '');
}
