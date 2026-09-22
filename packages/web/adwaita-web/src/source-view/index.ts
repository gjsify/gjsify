// @gjsify/adwaita-web/source-view — opt-in entry for the CodeMirror-backed
// <adw-source-view> editor. Importing this module registers the custom element
// and self-injects its stylesheet. It is intentionally NOT re-exported from the
// package's main entry so CodeMirror stays out of the core adwaita-web bundle
// for consumers who do not need an editor.

export { AdwSourceView } from './adw-source-view.js';

// Building blocks, exported so apps/tests can reuse them (e.g. embed the 6502
// mode or the Adwaita theme in a bespoke EditorView).
export { asm6502, asm6502Parser, asm6502TokenTable } from './asm6502.js';
export {
    adwaitaEditorTheme,
    adwaitaHighlightStyle,
    ensureSourceViewStyleInjected,
    SOURCE_VIEW_CSS,
    SOURCE_VIEW_STYLE_ID,
} from './theme.js';

// The renderer-free half — language tables, tokenizer, gutter formatters — is
// owned by `@gjsify/adwaita-core`. Re-exported here under the spellings this
// subpath has always published, so nothing that imports them has to move.
export {
    ADW_SOURCE_6502_DIRECTIVES as DIRECTIVE_WORDS,
    ADW_SOURCE_6502_OPCODES as OPCODES,
    ADW_SOURCE_6502_REGISTERS as REGISTERS,
    ADW_SOURCE_HEX_STRIDE as HEX_ADDRESS_STRIDE,
    classifyAsm6502Word as classifyWord,
    formatHexAddress,
    formatLineNumber,
    stripSourceWhitespace as stripWhitespace,
    tokenizeAsm6502 as token6502,
} from '@gjsify/adwaita-core';
export type { AdwSourceTokenClass, AdwSourceTokenStream } from '@gjsify/adwaita-core';
