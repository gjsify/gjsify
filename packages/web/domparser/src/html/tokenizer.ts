// HTML5 tokenizer — the string half of the parser: no tree, no node classes, no
// selectors. The states follow
// https://html.spec.whatwg.org/multipage/parsing.html#tokenization
//
// Three rules here read like bugs until you check them against a browser, and all
// three are what a regex-based tokenizer gets silently wrong:
//   - an unquoted attribute value does NOT end at `/`, so `<a href=x/>` carries
//     href="x/" and is not self-closing;
//   - of two identically named attributes the FIRST wins, so `<a HREF="x" href="y">`
//     is href="x";
//   - raw text ends only at an APPROPRIATE end tag — `</scriptx>` inside a script
//     is text, `</SCRIPT >` closes it.

import { decodeAttributeValue, decodeText } from '../entities/decode.js';
import { RAWTEXT_ELEMENTS, RCDATA_ELEMENTS } from './text-elements.js';
import type { TokenAttribute, TreeSink } from './tree-sink.js';

export { RAWTEXT_ELEMENTS, RCDATA_ELEMENTS } from './text-elements.js';

const REPLACEMENT = '\uFFFD';

// Computed, never written as a literal: a U+0000 escape in a source file is
// emitted as a RAW NUL byte by the gjs-target minifier, and GJS's module loader
// reads a raw NUL as end-of-script (it reports a misleading unterminated-template
// SyntaxError). Keeping the byte out of the bundle keeps that failure out.
const NUL = String.fromCharCode(0);

const COMMENT_START = 0;
const COMMENT_START_DASH = 1;
const COMMENT_TEXT = 2;
const COMMENT_LT = 3;
const COMMENT_LT_BANG = 4;
const COMMENT_LT_BANG_DASH = 5;
const COMMENT_LT_BANG_DASH_DASH = 6;
const COMMENT_END_DASH = 7;
const COMMENT_END = 8;
const COMMENT_END_BANG = 9;

const DOCTYPE_BEFORE_NAME = 0;
const DOCTYPE_NAME = 1;
const DOCTYPE_AFTER_NAME = 2;
const DOCTYPE_PUBLIC_ID_START = 3;
const DOCTYPE_PUBLIC_ID = 4;
const DOCTYPE_AFTER_PUBLIC_ID = 5;
const DOCTYPE_SYSTEM_ID_START = 6;
const DOCTYPE_SYSTEM_ID = 7;
const DOCTYPE_AFTER_SYSTEM_ID = 8;
const DOCTYPE_BOGUS = 9;

function isWhitespace(c: string | undefined): boolean {
    // Carriage return is absent on purpose: the input preprocessor has already
    // turned every CR into LF.
    return c === ' ' || c === '\n' || c === '\t' || c === '\f';
}

function isAsciiAlpha(c: string | undefined): boolean {
    if (c === undefined) return false;
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function asciiLower(value: string): string {
    // Not `toLowerCase()`: that applies the full Unicode mapping, where `İ` becomes
    // two code points and a tag name changes length. HTML lowercases ASCII only.
    return value.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

function replaceNul(value: string): string {
    return value.indexOf(NUL) === -1 ? value : value.split(NUL).join(REPLACEMENT);
}

class Tokenizer {
    private readonly source: string;
    private readonly sink: TreeSink;
    private pos = 0;
    private text = '';

    constructor(source: string, sink: TreeSink) {
        // Input preprocessing: CRLF and lone CR both become LF, so a text node never
        // carries the line ending the transport happened to use.
        this.source = source.indexOf('\r') === -1 ? source : source.replace(/\r\n?/g, '\n');
        this.sink = sink;
    }

    run(): void {
        const src = this.source;
        const len = src.length;
        while (this.pos < len) {
            const lt = src.indexOf('<', this.pos);
            if (lt === -1) {
                this.appendText(src.slice(this.pos));
                this.pos = len;
                break;
            }
            if (lt > this.pos) this.appendText(src.slice(this.pos, lt));
            this.pos = lt;
            this.readMarkup();
        }
        this.flushText();
    }

    /** Data-state text. NUL is passed through here — only the raw-text and markup
     *  states replace it — and character references are decoded. */
    private appendText(chunk: string): void {
        this.text += decodeText(chunk);
    }

    /** A `<` that started nothing: emitted as text, and merged into the surrounding
     *  run so `a < b` stays ONE text token rather than three. */
    private appendLiteral(chunk: string): void {
        this.text += chunk;
    }

    private flushText(): void {
        if (this.text === '') return;
        const pending = this.text;
        this.text = '';
        this.sink.onText(pending);
    }

    private emitComment(data: string): void {
        this.flushText();
        this.sink.onComment(data);
    }

    private readMarkup(): void {
        const src = this.source;
        const p = this.pos;
        const next = src[p + 1];

        if (next === '!') {
            if (src.startsWith('--', p + 2)) {
                this.readComment(p + 4);
                return;
            }
            if (asciiLower(src.slice(p + 2, p + 9)) === 'doctype') {
                this.readDoctype(p + 9);
                return;
            }
            // `<![CDATA[` outside foreign content is a bogus comment like any other
            // `<!…`, and the spec keeps the `[CDATA[` text as the comment's data.
            this.readBogusComment(p + 2);
            return;
        }

        if (next === '/') {
            const after = src[p + 2];
            if (after === undefined) {
                this.appendLiteral('</');
                this.pos = src.length;
                return;
            }
            if (after === '>') {
                // `</>` has no name: nothing is emitted at all.
                this.pos = p + 3;
                return;
            }
            if (isAsciiAlpha(after)) {
                this.readTag();
                return;
            }
            this.readBogusComment(p + 2);
            return;
        }

        if (isAsciiAlpha(next)) {
            this.readTag();
            return;
        }

        if (next === '?') {
            // The `?` belongs to the comment data, so `<?php ?>` is a comment
            // reading `?php ?`.
            this.readBogusComment(p + 1);
            return;
        }

        this.appendLiteral('<');
        this.pos = p + 1;
    }

    private readTag(): void {
        const src = this.source;
        const len = src.length;
        let p = this.pos + 1;
        const isEndTag = src[p] === '/';
        if (isEndTag) p++;

        const nameStart = p;
        while (p < len) {
            const c = src[p];
            if (isWhitespace(c) || c === '/' || c === '>') break;
            p++;
        }
        const name = replaceNul(asciiLower(src.slice(nameStart, p)));

        const attrs: TokenAttribute[] = [];
        const seen = new Set<string>();
        let selfClosing = false;

        for (;;) {
            while (p < len && isWhitespace(src[p])) p++;
            if (p >= len) {
                // eof-in-tag: the tag token is dropped whole. Text read before the
                // `<` stays pending and is flushed by `run()`.
                this.pos = len;
                return;
            }
            const c = src[p];
            if (c === '>') {
                p++;
                break;
            }
            if (c === '/') {
                p++;
                if (src[p] === '>') {
                    selfClosing = true;
                    p++;
                    break;
                }
                continue;
            }

            const attrNameStart = p;
            // A LEADING `=` is part of the attribute name (`<div =a>` names `=a`);
            // everywhere else it separates the name from the value.
            if (c === '=') p++;
            while (p < len) {
                const ch = src[p];
                if (isWhitespace(ch) || ch === '/' || ch === '>' || ch === '=') break;
                p++;
            }
            const attrName = replaceNul(asciiLower(src.slice(attrNameStart, p)));

            while (p < len && isWhitespace(src[p])) p++;
            let value = '';
            if (src[p] === '=') {
                p++;
                while (p < len && isWhitespace(src[p])) p++;
                const quote = src[p];
                if (quote === '"' || quote === "'") {
                    p++;
                    const valueStart = p;
                    while (p < len && src[p] !== quote) p++;
                    value = decodeAttributeValue(replaceNul(src.slice(valueStart, p)));
                    if (p < len) p++;
                } else {
                    const valueStart = p;
                    while (p < len) {
                        const ch = src[p];
                        if (isWhitespace(ch) || ch === '>') break;
                        p++;
                    }
                    value = decodeAttributeValue(replaceNul(src.slice(valueStart, p)));
                }
            }

            if (!seen.has(attrName)) {
                seen.add(attrName);
                attrs.push({ name: attrName, value });
            }
        }

        this.pos = p;
        this.flushText();
        if (isEndTag) {
            // Attributes and a self-closing solidus on an end tag are parse errors
            // and are dropped; the sink never sees them.
            this.sink.onCloseTag(name);
            return;
        }
        this.sink.onOpenTag(name, attrs, selfClosing);
        // The self-closing flag does not exempt a raw-text element: `<title/>x` puts
        // `x` inside the title, which is what browsers do.
        if (RAWTEXT_ELEMENTS.has(name)) this.readRawText(name, false);
        else if (RCDATA_ELEMENTS.has(name)) this.readRawText(name, true);
    }

    private readRawText(tagName: string, decodeReferences: boolean): void {
        // `script` is the only element with escape levels; every other raw-text
        // element ends at its first appropriate end tag.
        const end = tagName === 'script' ? this.findScriptDataEnd() : this.findRawTextEnd(tagName);
        this.appendRawText(this.source.slice(this.pos, end), decodeReferences);
        // Hand the end tag back to the main loop: it may carry attributes, which
        // `readTag` already knows to drop.
        this.pos = end;
    }

    /** Index of the `<` that ends the element's content, or the input length. */
    private findRawTextEnd(tagName: string): number {
        const src = this.source;
        let search = this.pos;
        for (;;) {
            const lt = src.indexOf('</', search);
            if (lt === -1) return src.length;
            if (this.isEndTagAt(lt, tagName)) return lt;
            search = lt + 2;
        }
    }

    /**
     * Script data has two escape levels the other raw-text elements do not. Inside
     * `<!-- … -->` an end tag still closes the script; inside a `<script` opened
     * within that comment it does NOT. Measured against parse5: without this,
     * `document.write("<!--<script></script>-->")` ends the script at the inner tag
     * and spills the rest of the JavaScript into the document as text.
     */
    private findScriptDataEnd(): number {
        const src = this.source;
        const len = src.length;
        let escapeLevel = 0;
        let i = this.pos;

        while (i < len) {
            if (escapeLevel === 0) {
                if (src.startsWith('<!--', i)) {
                    // Advance by two, not four: `<!-->` closes on the dashes it
                    // opened with.
                    escapeLevel = 1;
                    i += 2;
                    continue;
                }
                if (this.isEndTagAt(i, 'script')) return i;
                i++;
                continue;
            }
            if (src.startsWith('-->', i)) {
                escapeLevel = 0;
                i += 3;
                continue;
            }
            if (escapeLevel === 1) {
                if (this.isEndTagAt(i, 'script')) return i;
                if (this.isStartTagAt(i, 'script')) {
                    escapeLevel = 2;
                    i += '<script'.length;
                    continue;
                }
            } else if (this.isEndTagAt(i, 'script')) {
                // Leaves the inner script, does not end the outer one.
                escapeLevel = 1;
                i += '</script'.length;
                continue;
            }
            i++;
        }
        return len;
    }

    private isEndTagAt(index: number, tagName: string): boolean {
        const src = this.source;
        if (src[index] !== '<' || src[index + 1] !== '/') return false;
        return this.matchesTagName(index + 2, tagName);
    }

    private isStartTagAt(index: number, tagName: string): boolean {
        if (this.source[index] !== '<') return false;
        return this.matchesTagName(index + 1, tagName);
    }

    /** The name matches case-insensitively AND is followed by a tag terminator, so
     *  `</scriptx>` inside a script stays text and `</SCRIPT >` closes it. */
    private matchesTagName(nameStart: number, tagName: string): boolean {
        const src = this.source;
        const nameEnd = nameStart + tagName.length;
        const after = src[nameEnd];
        if (after === undefined) return false;
        if (!isWhitespace(after) && after !== '/' && after !== '>') return false;
        return asciiLower(src.slice(nameStart, nameEnd)) === tagName;
    }

    private appendRawText(raw: string, decodeReferences: boolean): void {
        if (raw === '') return;
        const chunk = replaceNul(raw);
        this.text += decodeReferences ? decodeText(chunk) : chunk;
    }

    /** `<!…`, `<?…` and `</` + non-letter: everything up to the next `>` is comment
     *  data. `start` is the first index that belongs to that data. */
    private readBogusComment(start: number): void {
        const src = this.source;
        const gt = src.indexOf('>', start);
        const end = gt === -1 ? src.length : gt;
        this.emitComment(replaceNul(src.slice(start, end)));
        this.pos = gt === -1 ? src.length : gt + 1;
    }

    /** `start` is the index just past the opening `<!--`. */
    private readComment(start: number): void {
        const src = this.source;
        const len = src.length;
        let data = '';
        let p = start;
        let state = COMMENT_START;

        for (;;) {
            if (p >= len) {
                // eof-in-comment: the comment is emitted with what was read.
                this.emitComment(data);
                this.pos = len;
                return;
            }
            const c = src[p];
            switch (state) {
                case COMMENT_START:
                    if (c === '-') {
                        state = COMMENT_START_DASH;
                        p++;
                    } else if (c === '>') {
                        // `<!-->` — an abruptly closed empty comment, not text.
                        this.emitComment('');
                        this.pos = p + 1;
                        return;
                    } else {
                        state = COMMENT_TEXT;
                    }
                    break;
                case COMMENT_START_DASH:
                    if (c === '-') {
                        state = COMMENT_END;
                        p++;
                    } else if (c === '>') {
                        this.emitComment('');
                        this.pos = p + 1;
                        return;
                    } else {
                        data += '-';
                        state = COMMENT_TEXT;
                    }
                    break;
                case COMMENT_TEXT:
                    if (c === '<') {
                        data += '<';
                        state = COMMENT_LT;
                        p++;
                    } else if (c === '-') {
                        state = COMMENT_END_DASH;
                        p++;
                    } else {
                        data += c === NUL ? REPLACEMENT : c;
                        p++;
                    }
                    break;
                case COMMENT_LT:
                    if (c === '!') {
                        data += '!';
                        state = COMMENT_LT_BANG;
                        p++;
                    } else if (c === '<') {
                        data += '<';
                        p++;
                    } else {
                        state = COMMENT_TEXT;
                    }
                    break;
                case COMMENT_LT_BANG:
                    if (c === '-') {
                        state = COMMENT_LT_BANG_DASH;
                        p++;
                    } else {
                        state = COMMENT_TEXT;
                    }
                    break;
                case COMMENT_LT_BANG_DASH:
                    if (c === '-') {
                        state = COMMENT_LT_BANG_DASH_DASH;
                        p++;
                    } else {
                        state = COMMENT_END_DASH;
                    }
                    break;
                case COMMENT_LT_BANG_DASH_DASH:
                    // A nested `<!--` inside a comment does not open a second one:
                    // whatever follows, the comment ends at the next `-->`.
                    state = COMMENT_END;
                    break;
                case COMMENT_END_DASH:
                    if (c === '-') {
                        state = COMMENT_END;
                        p++;
                    } else {
                        data += '-';
                        state = COMMENT_TEXT;
                    }
                    break;
                case COMMENT_END:
                    if (c === '>') {
                        this.emitComment(data);
                        this.pos = p + 1;
                        return;
                    } else if (c === '!') {
                        state = COMMENT_END_BANG;
                        p++;
                    } else if (c === '-') {
                        data += '-';
                        p++;
                    } else {
                        data += '--';
                        state = COMMENT_TEXT;
                    }
                    break;
                default:
                    // COMMENT_END_BANG — `--!>` closes a comment too.
                    if (c === '-') {
                        data += '--!';
                        state = COMMENT_END_DASH;
                        p++;
                    } else if (c === '>') {
                        this.emitComment(data);
                        this.pos = p + 1;
                        return;
                    } else {
                        data += '--!';
                        state = COMMENT_TEXT;
                    }
                    break;
            }
        }
    }

    /** `start` is the index just past `<!DOCTYPE`. */
    private readDoctype(start: number): void {
        const src = this.source;
        const len = src.length;
        let p = start;
        let state = DOCTYPE_BEFORE_NAME;
        let name: string | null = null;
        let publicId: string | null = null;
        let systemId: string | null = null;
        let forceQuirks = false;
        let quote = '"';

        const emit = (): void => {
            this.flushText();
            this.sink.onDoctype({ name, publicId, systemId, forceQuirks });
        };

        for (;;) {
            if (p >= len) {
                // Every EOF inside a DOCTYPE forces quirks except in the bogus state,
                // which has already recorded its verdict.
                if (state !== DOCTYPE_BOGUS) forceQuirks = true;
                emit();
                this.pos = len;
                return;
            }
            const c = src[p];
            switch (state) {
                case DOCTYPE_BEFORE_NAME:
                    if (isWhitespace(c)) {
                        p++;
                    } else if (c === '>') {
                        forceQuirks = true;
                        emit();
                        this.pos = p + 1;
                        return;
                    } else {
                        name = '';
                        state = DOCTYPE_NAME;
                    }
                    break;
                case DOCTYPE_NAME:
                    if (isWhitespace(c)) {
                        state = DOCTYPE_AFTER_NAME;
                        p++;
                    } else if (c === '>') {
                        emit();
                        this.pos = p + 1;
                        return;
                    } else {
                        name += c === NUL ? REPLACEMENT : asciiLower(c);
                        p++;
                    }
                    break;
                case DOCTYPE_AFTER_NAME:
                    if (isWhitespace(c)) {
                        p++;
                    } else if (c === '>') {
                        emit();
                        this.pos = p + 1;
                        return;
                    } else if (asciiLower(src.slice(p, p + 6)) === 'public') {
                        p += 6;
                        state = DOCTYPE_PUBLIC_ID_START;
                    } else if (asciiLower(src.slice(p, p + 6)) === 'system') {
                        p += 6;
                        state = DOCTYPE_SYSTEM_ID_START;
                    } else {
                        forceQuirks = true;
                        state = DOCTYPE_BOGUS;
                    }
                    break;
                case DOCTYPE_PUBLIC_ID_START:
                    if (isWhitespace(c)) {
                        p++;
                    } else if (c === '"' || c === "'") {
                        publicId = '';
                        quote = c;
                        state = DOCTYPE_PUBLIC_ID;
                        p++;
                    } else if (c === '>') {
                        forceQuirks = true;
                        emit();
                        this.pos = p + 1;
                        return;
                    } else {
                        forceQuirks = true;
                        state = DOCTYPE_BOGUS;
                    }
                    break;
                case DOCTYPE_PUBLIC_ID:
                    if (c === quote) {
                        state = DOCTYPE_AFTER_PUBLIC_ID;
                        p++;
                    } else if (c === '>') {
                        forceQuirks = true;
                        emit();
                        this.pos = p + 1;
                        return;
                    } else {
                        publicId += c === NUL ? REPLACEMENT : c;
                        p++;
                    }
                    break;
                case DOCTYPE_AFTER_PUBLIC_ID:
                    if (isWhitespace(c)) {
                        p++;
                    } else if (c === '>') {
                        emit();
                        this.pos = p + 1;
                        return;
                    } else if (c === '"' || c === "'") {
                        systemId = '';
                        quote = c;
                        state = DOCTYPE_SYSTEM_ID;
                        p++;
                    } else {
                        forceQuirks = true;
                        state = DOCTYPE_BOGUS;
                    }
                    break;
                case DOCTYPE_SYSTEM_ID_START:
                    if (isWhitespace(c)) {
                        p++;
                    } else if (c === '"' || c === "'") {
                        systemId = '';
                        quote = c;
                        state = DOCTYPE_SYSTEM_ID;
                        p++;
                    } else if (c === '>') {
                        forceQuirks = true;
                        emit();
                        this.pos = p + 1;
                        return;
                    } else {
                        forceQuirks = true;
                        state = DOCTYPE_BOGUS;
                    }
                    break;
                case DOCTYPE_SYSTEM_ID:
                    if (c === quote) {
                        state = DOCTYPE_AFTER_SYSTEM_ID;
                        p++;
                    } else if (c === '>') {
                        forceQuirks = true;
                        emit();
                        this.pos = p + 1;
                        return;
                    } else {
                        systemId += c === NUL ? REPLACEMENT : c;
                        p++;
                    }
                    break;
                case DOCTYPE_AFTER_SYSTEM_ID:
                    if (isWhitespace(c)) {
                        p++;
                    } else if (c === '>') {
                        emit();
                        this.pos = p + 1;
                        return;
                    } else {
                        // Junk after a complete system identifier is a parse error but
                        // does NOT force quirks — the declaration was well formed.
                        state = DOCTYPE_BOGUS;
                    }
                    break;
                default:
                    // DOCTYPE_BOGUS — everything up to `>` is discarded.
                    if (c === '>') {
                        emit();
                        this.pos = p + 1;
                        return;
                    }
                    p++;
                    break;
            }
        }
    }
}

/**
 * Tokenize `source` as HTML, reporting every token to `sink` in document order.
 * Pure string processing: no globals, no platform imports, no tree.
 */
export function tokenize(source: string, sink: TreeSink): void {
    new Tokenizer(source, sink).run();
}
