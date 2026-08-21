// The Adwaita CodeMirror theme + syntax-highlight style for <adw-source-view>,
// plus the self-injected "chrome" stylesheet (container + copy button + the
// light/dark syntax palette variables).
//
// Editor colours are expressed as adwaita-web CSS custom properties
// (`--view-bg-color`, `--view-fg-color`, `--accent-color`, `--separator-color`)
// and a small `--adw-src-*` syntax palette defined below. Because those
// variables flip with the page theme (`.theme-dark` / `prefers-color-scheme`),
// a SINGLE theme + highlight style covers light and dark automatically — no
// per-scheme rebuild, mirroring the native widget's two GtkSourceView schemes.
// Reference: packages/app-gnome/src/widgets/source-view.ts updateStyle()
// Reference: refs/libadwaita/src/stylesheet (colour tokens)

import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Monospace stack — the `--monospace-font-family` token, with its own value
 * repeated as the `var()` fallback for a page that loads `@gjsify/adwaita-web`'s
 * stylesheet without the theme tokens.
 *
 * It USED to be a second stack, written out here and longer (Cascadia Code,
 * JetBrains Mono, Source Code Pro, Consolas). Two consequences, both real: the
 * `stylesheet-font-families` conformance rule reads `.css`/`.scss` only, so a
 * stack living in a TS string literal was outside every check the repo has; and
 * on a host with, say, JetBrains Mono but no Adwaita Mono, an `<adw-source-view>`
 * and a `.monospace` label on the SAME page rendered in DIFFERENT typefaces.
 * `_variables.scss` is where that stack is argued about (it explains why
 * 'Cantarell' is dropped from it), so it is where it lives.
 */
const MONO_FONT =
    "var(--monospace-font-family, 'Adwaita Mono', ui-monospace, 'SF Mono', 'Menlo', monospace)";

/** The CodeMirror EditorView theme mapping `.cm-*` chrome to Adwaita tokens. */
export const adwaitaEditorTheme = EditorView.theme({
    '&': {
        color: 'var(--view-fg-color, rgba(0,0,6,0.8))',
        backgroundColor: 'var(--view-bg-color, #ffffff)',
        fontSize: 'var(--adw-src-font-size, 10.5pt)',
    },
    '.cm-scroller': {
        fontFamily: MONO_FONT,
        lineHeight: '1.5',
    },
    '.cm-content': {
        caretColor: 'var(--accent-color, #1c71d8)',
        padding: '8px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--accent-color, #1c71d8)',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--adw-src-selection)',
    },
    '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--adw-src-selection)',
    },
    '.cm-gutters': {
        backgroundColor: 'var(--adw-src-gutter-bg, var(--view-bg-color, #ffffff))',
        color: 'var(--adw-src-gutter-fg)',
        border: 'none',
        borderRight: '1px solid var(--separator-color, rgba(0,0,6,0.1))',
    },
    '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 8px',
        // Hex addresses are inherently LTR; keep the gutter text left-anchored
        // so it never mirrors under an RTL page.
        textAlign: 'right',
    },
    '.cm-activeLine': {
        backgroundColor: 'var(--adw-src-active-line)',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'var(--adw-src-active-line)',
        color: 'var(--view-fg-color, rgba(0,0,6,0.8))',
    },
    '.cm-foldPlaceholder': {
        backgroundColor: 'var(--button-bg-color, rgba(0,0,6,0.08))',
        border: 'none',
        color: 'var(--view-fg-color, rgba(0,0,6,0.8))',
    },
});

/** Syntax highlighting mapping tags → the `--adw-src-*` palette variables. */
export const adwaitaHighlightStyle = HighlightStyle.define([
    { tag: tags.lineComment, color: 'var(--adw-src-comment)', fontStyle: 'italic' },
    { tag: tags.comment, color: 'var(--adw-src-comment)', fontStyle: 'italic' },
    { tag: tags.keyword, color: 'var(--adw-src-keyword)', fontWeight: '600' },
    { tag: tags.number, color: 'var(--adw-src-number)' },
    { tag: tags.string, color: 'var(--adw-src-string)' },
    { tag: tags.labelName, color: 'var(--adw-src-label)', fontWeight: '600' },
    { tag: tags.atom, color: 'var(--adw-src-register)' },
    { tag: tags.meta, color: 'var(--adw-src-directive)' },
    { tag: tags.operator, color: 'var(--adw-src-operator)' },
    { tag: tags.variableName, color: 'var(--view-fg-color, rgba(0,0,6,0.8))' },
]);

// The light-theme syntax palette + shared chrome. Dark values are supplied by
// the overrides block (same mechanism as adwaita-web's _theme.scss: auto via
// prefers-color-scheme, manual via .theme-dark / opt-out via .theme-light).
const DARK_TOKENS = `
    --adw-src-comment: #9a9996;
    --adw-src-keyword: #78aeed;
    --adw-src-number: #ffa348;
    --adw-src-string: #8ff0a4;
    --adw-src-label: #dc8add;
    --adw-src-register: #33d1c9;
    --adw-src-directive: #f66151;
    --adw-src-operator: rgba(255, 255, 255, 0.55);
    --adw-src-gutter-fg: rgba(255, 255, 255, 0.35);
    --adw-src-active-line: color-mix(in srgb, #ffffff 6%, transparent);`;

/** Element id of the injected stylesheet (idempotency guard). */
export const SOURCE_VIEW_STYLE_ID = 'adw-source-view-style';

/** The chrome stylesheet: container, copy button, LTR pin, syntax palette. */
export const SOURCE_VIEW_CSS = `
.adw-source-view {
    --adw-src-comment: #5e5c64;
    --adw-src-keyword: #1c71d8;
    --adw-src-number: #c64600;
    --adw-src-string: #26a269;
    --adw-src-label: #813d9c;
    --adw-src-register: #007e8a;
    --adw-src-directive: #a51d2d;
    --adw-src-operator: rgba(0, 0, 6, 0.55);
    --adw-src-selection: color-mix(in srgb, var(--accent-bg-color, #3584e4) 26%, transparent);
    --adw-src-gutter-bg: var(--view-bg-color, #ffffff);
    --adw-src-gutter-fg: rgba(0, 0, 6, 0.35);
    --adw-src-active-line: color-mix(in srgb, var(--view-fg-color, #00000a) 4%, transparent);

    /* Source code is inherently LTR — pin the whole widget so the gutter,
       scrollbar and copy button never mirror under an RTL page. */
    direction: ltr;
    position: relative;
    display: block;
    box-sizing: border-box;
    overflow: hidden;
    border-radius: var(--card-radius, 12px);
    background-color: var(--view-bg-color, #ffffff);
    color: var(--view-fg-color, rgba(0, 0, 6, 0.8));
}

.adw-source-view .cm-editor {
    border-radius: inherit;
    max-height: 100%;
}

.adw-source-view.adw-source-view--fill,
.adw-source-view.adw-source-view--fill .cm-editor {
    height: 100%;
}

.adw-source-view .cm-editor.cm-focused {
    outline: none;
}

.adw-source-view__copy {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: var(--button-radius, 9px);
    background-color: color-mix(in srgb, var(--view-bg-color, #ffffff) 82%, transparent);
    color: var(--view-fg-color, rgba(0, 0, 6, 0.75));
    opacity: 0.72;
    cursor: pointer;
    transition: opacity 0.15s ease, background-color 0.15s ease;
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
}

.adw-source-view__copy:hover {
    opacity: 1;
    background-color: var(--button-hover-color, rgba(0, 0, 6, 0.13));
}

.adw-source-view__copy:active {
    background-color: var(--button-active-color, rgba(0, 0, 6, 0.19));
}

.adw-source-view__copy:focus-visible {
    opacity: 1;
    outline: 2px solid var(--accent-color, #1c71d8);
    outline-offset: 1px;
}

.adw-source-view__copy[hidden] {
    display: none;
}

.adw-source-view__copy svg {
    width: 16px;
    height: 16px;
    display: block;
}

.adw-source-view__copy .adw-icon {
    width: 16px;
    height: 16px;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
}

@media (prefers-color-scheme: dark) {
    :root:not(.theme-light) .adw-source-view {${DARK_TOKENS}
    }
}

:root.theme-dark .adw-source-view {${DARK_TOKENS}
}
`;

/**
 * Inject the chrome stylesheet once (browser-only, idempotent). Matches the
 * self-injection pattern of `@gjsify/adwaita-web`'s main entry, so importing
 * the source-view subpath is enough to style it under any bundler.
 */
export function ensureSourceViewStyleInjected(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(SOURCE_VIEW_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SOURCE_VIEW_STYLE_ID;
    style.textContent = SOURCE_VIEW_CSS;
    document.head.appendChild(style);
}
