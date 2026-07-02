// @gjsify/adwaita-web/source-view — opt-in entry for the CodeMirror-backed
// <adw-source-view> editor. Importing this module registers the custom element
// and self-injects its stylesheet. It is intentionally NOT re-exported from the
// package's main entry so CodeMirror stays out of the core adwaita-web bundle
// for consumers who do not need an editor.

export { AdwSourceView } from './adw-source-view.js';

// Building blocks, exported so apps/tests can reuse them (e.g. embed the 6502
// mode or the Adwaita theme in a bespoke EditorView).
export {
    asm6502,
    asm6502Parser,
    asm6502TokenTable,
    classifyWord,
    token6502,
    OPCODES,
    REGISTERS,
    DIRECTIVE_WORDS,
} from './asm6502.js';
export {
    adwaitaEditorTheme,
    adwaitaHighlightStyle,
    ensureSourceViewStyleInjected,
    SOURCE_VIEW_CSS,
    SOURCE_VIEW_STYLE_ID,
} from './theme.js';
export { formatHexAddress, formatLineNumber, stripWhitespace, HEX_ADDRESS_STRIDE } from './hex.js';
