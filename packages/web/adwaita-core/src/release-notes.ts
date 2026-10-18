// Adwaita release notes — the What's New buffer `Adw.AboutDialog` builds (ADR 0004).
//
// `update_release_notes` feeds the AppStream `release-notes` string to a GMarkupParser
// whose handlers write a GtkTextBuffer: `<p>` paragraphs, `<ul>`/`<ol>` lists of `<li>`,
// `<em>` and `<code>` inside them, nothing else and no attributes at all. The result is a
// list of tagged text runs, which is what a renderer draws, so that is what this returns.
//
// The scanner is GMarkup itself, lifted, because what the user sees on malformed notes IS
// GMarkup: the page shows its error message and its line/char position verbatim. So the
// position counts UTF-8 BYTES and treats a `\n` at offset 0 as not a line break (both
// `advance_char`), entity errors report the line of the text AFTER the `&` while sitting at
// the `<` that ends the run (`set_unescape_error`), and an element name is validated only
// when its tag closes. Every one of those was probed against real GLib; the vectors are in
// `conformance/about-dialog-doors.ts`. The pango-markup scanner is a different parser with
// different answers (it ends `<?` at the first `?>` and resolves entities silently), so it
// is not reused.
//
// NOT modelled:
// - the `section` tag. It only sets `pixels-above-lines`, a spacing the buffer renderer
// draws from its own paragraph spacing;
// - GLib's UTF-8 validation of names and text: a JS string cannot hold invalid UTF-8,
// except a lone surrogate, which is undefined here;
// - `“%s” is not a valid name: “%c”` for a NON-ASCII invalid character: GLib prints the
// character's first byte, an invalid UTF-8 string; this prints the whole character.
//
// PLATFORM-NEUTRAL: renders nothing, imports nothing platform-bound, touches no global.
//
// Reference: refs/libadwaita/src/adw-about-dialog.c (start_element_handler,
// end_element_handler, text_handler, update_release_notes)
// Reference: GLib glib/gmarkup.c (g_markup_parse_context_parse, unescape_gstring_inplace)
// Copyright (c) GNOME contributors (libadwaita, GLib). LGPLv2.1+.

import { gStrStrip } from './glib.js';

/** The buffer tag a run carries; `null` is untagged text. `section` is not modelled. */
export type ReleaseNotesTag = 'heading' | 'bullet' | 'em' | 'code' | null;

/** One run of the What's New buffer. Adjacent runs never share a tag. */
export interface ReleaseNotesSegment {
    text: string;
    tag: ReleaseNotesTag;
}

/** Why the notes did not parse, and where — the three values the error page shows. */
export interface ReleaseNotesError {
    message: string;
    line: number;
    character: number;
}

export interface ReleaseNotesBuffer {
    segments: ReleaseNotesSegment[];
    error: ReleaseNotesError | null;
}

/** The properties `update_release_notes` reads. */
export interface ReleaseNotesInput {
    releaseNotes: string;
    releaseNotesVersion?: string;
    version?: string;
}

/** The three translatable strings the buffer is built from. */
export interface ReleaseNotesLabels {
    /** `Version %s`, the heading. */
    releaseNotesHeading: string;
    /** `Unable to parse release notes:`, the first line of the error page. */
    releaseNotesError: string;
    /** `Line: %d, character: %d`, its last line. */
    releaseNotesErrorPosition: string;
}

export const RELEASE_NOTES_LABELS: ReleaseNotesLabels = {
    releaseNotesHeading: 'Version %s',
    releaseNotesError: 'Unable to parse release notes:',
    releaseNotesErrorPosition: 'Line: %d, character: %d',
};

/**
 * `update_release_notes`: the What's New buffer for these properties.
 *
 * Empty notes give an empty buffer, and the What's New row is hidden. The heading reads
 * `release-notes-version`, falling back to `version`, at the moment the NOTES are set:
 * `set_version` does not rebuild the buffer, so a renderer calls this from the two
 * release-notes setters only.
 */
export function releaseNotesBuffer(
    input: ReleaseNotesInput,
    labels: ReleaseNotesLabels = RELEASE_NOTES_LABELS,
): ReleaseNotesBuffer {
    if (input.releaseNotes.length === 0) return { segments: [], error: null };

    const buffer = new TextBuffer();
    const version = input.releaseNotesVersion || input.version || '';
    if (version.length > 0) {
        buffer.insert(labels.releaseNotesHeading.replace('%s', version), 'heading');
        buffer.insert('\n', null);
    }

    const failure = parseMarkup(input.releaseNotes, new ReleaseNotesHandler(buffer));
    if (failure !== null) {
        const position = labels.releaseNotesErrorPosition
            .replace('%d', String(failure.line))
            .replace('%d', String(failure.character));
        return {
            segments: [{ text: `${labels.releaseNotesError}\n${failure.message}\n${position}`, tag: null }],
            error: failure,
        };
    }

    buffer.deleteLastChar();
    return { segments: buffer.segments, error: null };
}

/** A GtkTextBuffer reduced to what the handlers use: append at the end, offsets in characters. */
class TextBuffer {
    readonly segments: ReleaseNotesSegment[] = [];
    offset = 0;

    insert(text: string, tag: ReleaseNotesTag): void {
        this.offset += [...text].length;
        const last = this.segments[this.segments.length - 1];
        if (last !== undefined && last.tag === tag) last.text += text;
        else this.segments.push({ text, tag });
    }

    deleteLastChar(): void {
        const last = this.segments[this.segments.length - 1];
        if (last === undefined) return;
        last.text = [...last.text].slice(0, -1).join('');
        this.offset--;
        if (last.text.length === 0) this.segments.pop();
    }
}

const enum State {
    None,
    Paragraph,
    UnorderedList,
    UnorderedItem,
    OrderedList,
    OrderedItem,
}

/**
 * GRegex `\s` — GLib compiles with PCRE2_UCP, so it is Unicode white space plus PCRE's
 * horizontal/vertical space lists (U+0085 and U+180E included), not JavaScript's `\s`.
 */
const GREGEX_SPACE_RUN = /[\t-\r \u0085\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

class ReleaseNotesHandler implements MarkupHandler {
    private _state = State.None;
    private _nItem = 0;
    private _paragraphStart = -1;
    private _sectionStart = -1;
    private _lastTrailingSpace = false;

    constructor(private readonly _buffer: TextBuffer) {}

    start(name: string, attributes: readonly string[]): string | null {
        const error = this._open(name);
        if (error !== null) return error;
        if (attributes.length > 0) return `attribute '${attributes[0]}' invalid for element '${name}'`;
        return null;
    }

    end(name: string): void {
        if (name === 'p' || name === 'ul' || name === 'ol') {
            if (this._sectionStart !== this._buffer.offset) this._buffer.insert('\n', null);
            this._state = State.None;
            this._sectionStart = -1;
            this._paragraphStart = -1;
            this._nItem = 0;
            return;
        }
        if (name === 'li') {
            this._state = this._state === State.UnorderedItem ? State.UnorderedList : State.OrderedList;
            this._nItem++;
            this._paragraphStart = -1;
        }
    }

    text(text: string, element: string): void {
        if (
            this._state !== State.Paragraph &&
            this._state !== State.UnorderedItem &&
            this._state !== State.OrderedItem
        ) {
            return;
        }
        const collapsed = text.replace(GREGEX_SPACE_RUN, ' ');
        const isLeadingSpace = collapsed.startsWith(' ');
        const isTrailingSpace = collapsed.endsWith(' ');
        const stripped = gStrStrip(collapsed);
        if (stripped.length === 0) {
            this._lastTrailingSpace = isTrailingSpace;
            return;
        }
        if ((isLeadingSpace || this._lastTrailingSpace) && this._paragraphStart !== this._buffer.offset) {
            this._buffer.insert(' ', null);
        }
        this._buffer.insert(stripped, element === 'em' || element === 'code' ? element : null);
        this._lastTrailingSpace = isTrailingSpace;
    }

    private _open(name: string): string | null {
        const unexpected = `Unexpected element '${name}'`;
        switch (this._state) {
            case State.None:
                if (name === 'p') {
                    this._state = State.Paragraph;
                    this._paragraphStart = this._buffer.offset;
                } else if (name === 'ul') this._state = State.UnorderedList;
                else if (name === 'ol') this._state = State.OrderedList;
                else return unexpected;
                this._sectionStart = this._buffer.offset;
                return null;
            case State.Paragraph:
            case State.UnorderedItem:
            case State.OrderedItem:
                return name === 'em' || name === 'code' ? null : unexpected;
            case State.UnorderedList:
            case State.OrderedList: {
                if (name !== 'li') return unexpected;
                if (this._nItem > 0) this._buffer.insert('\n', null);
                const isOrdered = this._state === State.OrderedList;
                this._state = isOrdered ? State.OrderedItem : State.UnorderedItem;
                this._buffer.insert(isOrdered ? `${this._nItem + 1}. ` : '• ', 'bullet');
                this._paragraphStart = this._buffer.offset;
                return null;
            }
        }
    }
}

// --- GMarkup ---------------------------------------------------------------------------------

interface MarkupHandler {
    /** An error message (reported without a position prefix), or `null`. */
    start(name: string, attributes: readonly string[]): string | null;
    end(name: string): void;
    /** Called with the unescaped run and the innermost open element. */
    text(text: string, element: string): void;
}

const enum Scan {
    Start,
    AfterOpenAngle,
    AfterCloseAngle,
    AfterElisionSlash,
    InsideOpenTagName,
    InsideAttributeName,
    AfterAttributeName,
    BetweenAttributes,
    AfterAttributeEqualsSign,
    InsideAttributeValue,
    InsideText,
    AfterCloseTagSlash,
    InsideCloseTagName,
    AfterCloseTagName,
    InsidePassthrough,
}

class MarkupFailure extends Error {
    constructor(
        message: string,
        readonly at: number,
    ) {
        super(message);
    }
}

const isXmlSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
/** `IS_COMMON_NAME_END_CHAR`. */
const isNameEnd = (c: string | undefined): boolean => c === '=' || c === '/' || c === '>' || c === ' ';
const isAsciiAlpha = (c: string): boolean => /^[A-Za-z]$/.test(c);
/** `g_unichar_isalpha` for a non-ASCII character. */
const isUnicodeAlpha = (c: string): boolean => c.codePointAt(0)! >= 0x80 && /^\p{L}$/u.test(c);

/** `name_validate`: `null`, or the message. An empty name is invalid too. */
function nameError(name: string): string | null {
    const chars = [...name];
    const first = chars[0] ?? '';
    if (!(isAsciiAlpha(first) || first === '_' || first === ':' || isUnicodeAlpha(first))) {
        return `“${name}” is not a valid name`;
    }
    for (const c of chars.slice(1)) {
        if (!(/^[A-Za-z0-9._:-]$/.test(c) || isUnicodeAlpha(c))) return `“${name}” is not a valid name: “${c}”`;
    }
    return null;
}

function utf8Length(text: string): number {
    let bytes = 0;
    for (const c of text) {
        const code = c.codePointAt(0)!;
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
}

/**
 * `g_markup_parse_context_get_position` with the iterator at `at`: `advance_char` counts a
 * line on stepping ONTO a `\n` and resets the column to 1 there, so the first character is
 * never a line break and columns count bytes from that `\n`.
 */
function markupPosition(text: string, at: number): { line: number; character: number } {
    let line = 1;
    let lineStart = 0;
    for (let k = 1; k <= Math.min(at, text.length - 1); k++) {
        if (text[k] === '\n') {
            line++;
            lineStart = k;
        }
    }
    return { line, character: utf8Length(text.slice(lineStart, at)) + 1 };
}

/** `strtoul`: C-locale space, a sign, and for base 16 an optional `0x`. */
function strtoul(text: string, from: number, base: 10 | 16): { value: bigint; end: number; isOverflow: boolean } {
    let p = from;
    while (p < text.length && ' \t\n\v\f\r'.includes(text[p]!)) p++;
    const isNegative = text[p] === '-';
    if (text[p] === '-' || text[p] === '+') p++;
    const digit = (c: string | undefined): number => (c === undefined ? -1 : parseInt(c, base));
    if (base === 16 && text[p] === '0' && (text[p + 1] === 'x' || text[p + 1] === 'X') && digit(text[p + 2]) >= 0) {
        p += 2;
    }
    const digitsStart = p;
    let value = 0n;
    while (p < text.length && /^[0-9A-Fa-f]$/.test(text[p]!) && digit(text[p]) >= 0) {
        value = value * BigInt(base) + BigInt(digit(text[p]));
        p++;
    }
    if (p === digitsStart) return { value: 0n, end: from, isOverflow: false };
    const max = (1n << 64n) - 1n;
    if (value > max) return { value: max, end: p, isOverflow: true };
    return { value: isNegative && value > 0n ? max + 1n - value : value, end: p, isOverflow: false };
}

const isPermittedCharacter = (l: bigint): boolean =>
    (0n < l && l <= 0xd7ffn) || (0xe000n <= l && l <= 0xfffdn) || (0x10000n <= l && l <= 0x10ffffn);

const SEMICOLON_HINT =
    'most likely you used an ampersand character without intending to start an entity — escape ampersand as &amp;';

const NAMED_ENTITIES: readonly (readonly [string, string])[] = [
    ['lt;', '<'],
    ['gt;', '>'],
    ['amp;', '&'],
    ['quot;', '"'],
    ['apos;', "'"],
];

/**
 * `unescape_gstring_inplace` over the run `raw`, which ends at `end` in `text`. The error is
 * reported at `end` but names the line of the text after the `&`: GLib takes the line at
 * the iterator and subtracts the line breaks still ahead of the failing entity.
 */
function unescape(text: string, raw: string, end: number, isAttribute: boolean): string {
    const fail = (from: number, message: string): never => {
        const line = markupPosition(text, end).line - (raw.slice(from).match(/\n/g)?.length ?? 0);
        throw new MarkupFailure(`Error on line ${line}: ${message}`, end);
    };
    let out = '';
    for (let from = 0; from < raw.length; from++) {
        let c = raw[from]!;
        if (isAttribute && (c === '\t' || c === '\n')) c = ' ';
        if (c === '\r') {
            c = isAttribute ? ' ' : '\n';
            if (raw[from + 1] === '\n') from++;
        }
        if (raw[from] !== '&') {
            out += c;
            continue;
        }
        from++;
        if (raw[from] === '#') {
            from++;
            let base: 10 | 16 = 10;
            if (raw[from] === 'x') {
                base = 16;
                from++;
            }
            const parsed = strtoul(raw, from, base);
            if (parsed.end === from || parsed.isOverflow) {
                fail(
                    from,
                    `Failed to parse “${raw.slice(from, parsed.end)}”, which should have been a digit inside a ` +
                        'character reference (&#234; for example) — perhaps the digit is too large',
                );
            } else if (raw[parsed.end] !== ';') {
                fail(from, `Character reference did not end with a semicolon; ${SEMICOLON_HINT}`);
            } else if (!isPermittedCharacter(parsed.value)) {
                fail(
                    from,
                    `Character reference “${raw.slice(from, parsed.end)}” does not encode a permitted character`,
                );
            }
            out += String.fromCodePoint(Number(parsed.value));
            from = parsed.end;
            continue;
        }
        const named = NAMED_ENTITIES.find(([entity]) => raw.startsWith(entity, from));
        if (named !== undefined) {
            out += named[1];
            from += named[0].length - 1;
            continue;
        }
        if (raw[from] === ';') fail(from, 'Empty entity “&;” seen; valid entities are: &amp; &quot; &lt; &gt; &apos;');
        const semicolon = raw.indexOf(';', from);
        if (semicolon >= 0) fail(from, `Entity name “${raw.slice(from, semicolon)}” is not known`);
        fail(from, `Entity did not end with a semicolon; ${SEMICOLON_HINT}`);
    }
    return out;
}

/** `g_markup_parse_context_parse` + `_end_parse` over one chunk: `null`, or the error. */
function parseMarkup(text: string, handler: MarkupHandler): ReleaseNotesError | null {
    try {
        scan(text, handler);
        return null;
    } catch (error) {
        if (!(error instanceof MarkupFailure)) throw error;
        return { message: error.message, ...markupPosition(text, error.at) };
    }
}

function scan(text: string, handler: MarkupHandler): void {
    const n = text.length;
    const stack: string[] = [];
    let state = Scan.Start;
    let i = 0;
    let start = 0;
    let isDocumentEmpty = true;
    let attributes: string[] = [];
    let attribute = '';
    let closeName = '';
    let delimiter = '"';
    let passthroughStart = 0;
    let balance = 0;

    const top = (): string => stack[stack.length - 1] ?? '';
    const at = (k: number): string => String.fromCodePoint(text.codePointAt(k)!);
    const fail = (message: string): never => {
        const position = markupPosition(text, i);
        throw new MarkupFailure(`Error on line ${position.line} char ${position.character}: ${message}`, i);
    };
    const skipSpaces = (): void => {
        while (i < n && isXmlSpace(text[i])) i++;
    };
    const nameEnd = (): void => {
        while (i < n && !isNameEnd(text[i]) && !isXmlSpace(text[i])) i++;
    };
    const emitStart = (): void => {
        const invalid = nameError(top());
        if (invalid !== null) fail(invalid);
        const error = handler.start(top(), attributes);
        if (error !== null) throw new MarkupFailure(error, i);
    };
    const emitEnd = (): void => {
        handler.end(stack.pop()!);
    };

    while (i < n) {
        switch (state) {
            case Scan.Start:
                skipSpaces();
                if (i === n) break;
                if (text[i] !== '<') fail('Document must begin with an element (e.g. <book>)');
                i++;
                state = Scan.AfterOpenAngle;
                isDocumentEmpty = false;
                break;
            case Scan.AfterOpenAngle:
                if (text[i] === '?' || text[i] === '!') {
                    passthroughStart = i - 1;
                    balance = 1;
                    state = Scan.InsidePassthrough;
                } else if (text[i] === '/') {
                    i++;
                    state = Scan.AfterCloseTagSlash;
                } else if (!isNameEnd(text[i])) {
                    start = i;
                    state = Scan.InsideOpenTagName;
                } else {
                    fail(
                        `“${at(i)}” is not a valid character following a “<” character; it may not begin an element name`,
                    );
                }
                break;
            case Scan.InsideOpenTagName:
                nameEnd();
                if (i === n) break;
                stack.push(text.slice(start, i));
                attributes = [];
                state = Scan.BetweenAttributes;
                break;
            case Scan.BetweenAttributes:
                skipSpaces();
                if (i === n) break;
                if (text[i] === '/') {
                    i++;
                    state = Scan.AfterElisionSlash;
                    emitStart();
                } else if (text[i] === '>') {
                    i++;
                    state = Scan.AfterCloseAngle;
                    emitStart();
                } else if (text[i] === '=') {
                    fail(
                        `Odd character “=”, expected a “>” or “/” character to end the start tag of element “${top()}”, ` +
                            'or optionally an attribute; perhaps you used an invalid character in an attribute name',
                    );
                } else {
                    start = i;
                    state = Scan.InsideAttributeName;
                }
                break;
            case Scan.InsideAttributeName:
                nameEnd();
                if (i === n) break;
                attribute = text.slice(start, i);
                state = Scan.AfterAttributeName;
                break;
            case Scan.AfterAttributeName: {
                skipSpaces();
                if (i === n) break;
                const invalid = nameError(attribute);
                if (invalid !== null) fail(invalid);
                attributes.push(attribute);
                if (text[i] !== '=') {
                    fail(
                        `Odd character “${at(i)}”, expected a “=” after attribute name “${attribute}” of element “${top()}”`,
                    );
                }
                i++;
                state = Scan.AfterAttributeEqualsSign;
                break;
            }
            case Scan.AfterAttributeEqualsSign:
                skipSpaces();
                if (i === n) break;
                if (text[i] !== '"' && text[i] !== "'") {
                    fail(
                        `Odd character “${at(i)}”, expected an open quote mark after the equals sign when giving ` +
                            `value for attribute “${attribute}” of element “${top()}”`,
                    );
                }
                delimiter = text[i]!;
                i++;
                start = i;
                state = Scan.InsideAttributeValue;
                break;
            case Scan.InsideAttributeValue: {
                const close = text.indexOf(delimiter, i);
                if (close < 0) {
                    i = n;
                    break;
                }
                i = close;
                unescape(text, text.slice(start, close), close, true);
                i++;
                state = Scan.BetweenAttributes;
                break;
            }
            case Scan.AfterElisionSlash:
                if (text[i] !== '>') {
                    fail(`Odd character “${at(i)}”, expected a “>” character to end the empty-element tag “${top()}”`);
                }
                i++;
                state = Scan.AfterCloseAngle;
                emitEnd();
                break;
            case Scan.AfterCloseAngle:
                if (stack.length === 0) {
                    state = Scan.Start;
                } else {
                    start = i;
                    state = Scan.InsideText;
                }
                break;
            case Scan.InsideText: {
                const open = text.indexOf('<', i);
                if (open < 0) {
                    i = n;
                    break;
                }
                i = open;
                const raw = text.slice(start, open);
                if (raw.length > 0) handler.text(unescape(text, raw, open, false), top());
                i++;
                state = Scan.AfterOpenAngle;
                break;
            }
            case Scan.AfterCloseTagSlash:
                if (isNameEnd(text[i])) {
                    fail(
                        `“${at(i)}” is not a valid character following the characters “</”; “${at(i)}” may not begin ` +
                            'an element name',
                    );
                }
                start = i;
                state = Scan.InsideCloseTagName;
                break;
            case Scan.InsideCloseTagName:
                nameEnd();
                if (i === n) break;
                closeName = text.slice(start, i);
                state = Scan.AfterCloseTagName;
                break;
            case Scan.AfterCloseTagName:
                skipSpaces();
                if (i === n) break;
                if (text[i] !== '>') {
                    fail(
                        `“${at(i)}” is not a valid character following the close element name “${closeName}”; the ` +
                            'allowed character is “>”',
                    );
                }
                if (stack.length === 0) fail(`Element “${closeName}” was closed, no element is currently open`);
                if (closeName !== top()) {
                    fail(`Element “${closeName}” was closed, but the currently open element is “${top()}”`);
                }
                i++;
                state = Scan.AfterCloseAngle;
                emitEnd();
                break;
            case Scan.InsidePassthrough:
                for (; i < n; i++) {
                    if (text[i] === '<') balance++;
                    if (text[i] !== '>') continue;
                    balance--;
                    const seen = text.slice(passthroughStart, i);
                    if (
                        (seen[1] === '?' && seen.endsWith('?')) ||
                        (seen.startsWith('<!--') && seen.endsWith('--')) ||
                        (seen.startsWith('<![CDATA[') && seen.endsWith(']]')) ||
                        (seen.startsWith('<!DOCTYPE') && balance === 0)
                    ) {
                        break;
                    }
                }
                if (i === n) break;
                i++;
                state = Scan.AfterCloseAngle;
                break;
        }
    }

    if (isDocumentEmpty) fail('Document was empty or contained only whitespace');
    const unopened = stack.length === 0;
    switch (state) {
        case Scan.AfterOpenAngle:
            fail('Document ended unexpectedly just after an open angle bracket “<”');
            break;
        case Scan.AfterCloseAngle:
        case Scan.InsideText:
            if (!unopened) {
                fail(`Document ended unexpectedly with elements still open — “${top()}” was the last element opened`);
            }
            break;
        case Scan.AfterElisionSlash:
            fail(`Document ended unexpectedly, expected to see a close angle bracket ending the tag <${top()}/>`);
            break;
        case Scan.InsideOpenTagName:
            fail('Document ended unexpectedly inside an element name');
            break;
        case Scan.InsideAttributeName:
        case Scan.AfterAttributeName:
            fail('Document ended unexpectedly inside an attribute name');
            break;
        case Scan.BetweenAttributes:
            fail('Document ended unexpectedly inside an element-opening tag.');
            break;
        case Scan.AfterAttributeEqualsSign:
            fail('Document ended unexpectedly after the equals sign following an attribute name; no attribute value');
            break;
        case Scan.InsideAttributeValue:
            fail('Document ended unexpectedly while inside an attribute value');
            break;
        case Scan.AfterCloseTagSlash:
        case Scan.InsideCloseTagName:
        case Scan.AfterCloseTagName:
            fail(
                unopened
                    ? 'Document ended unexpectedly inside the close tag for an unopened element'
                    : `Document ended unexpectedly inside the close tag for element “${top()}”`,
            );
            break;
        case Scan.InsidePassthrough:
            fail('Document ended unexpectedly inside a comment or processing instruction');
            break;
        case Scan.Start:
            break;
    }
}
