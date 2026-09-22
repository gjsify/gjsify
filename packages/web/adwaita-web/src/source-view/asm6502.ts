// The CodeMirror 6 binding for the 6502 assembly mode — the web twin of the
// GtkSourceView `6502-assembler` language definition. A stream tokenizer is
// enough here: 6502 asm is line-oriented and needs no nested grammar, so we
// avoid a full Lezer grammar (per the task brief).
//
// The LANGUAGE itself — the opcode/register/directive tables and the tokenizer —
// is not here. It lives in `@gjsify/adwaita-core` (`source.ts`), typed on an
// eight-member stream interface that CodeMirror's `StringStream` satisfies
// structurally, so a second renderer can highlight 6502 without CodeMirror and
// this file stays what it claims to be: a binding.
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

import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { tags, type Tag } from '@lezer/highlight';
import { ADW_SOURCE_6502_LINE_COMMENT, tokenizeAsm6502 } from '@gjsify/adwaita-core';

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
    token: (stream) => tokenizeAsm6502(stream),
    tokenTable: asm6502TokenTable,
    languageData: { commentTokens: { line: ADW_SOURCE_6502_LINE_COMMENT } },
};

/** The 6502 assembly language extension for a CodeMirror EditorState. */
export function asm6502(): Extension {
    return StreamLanguage.define(asm6502Parser);
}
