// <adw-source-view> — an Adwaita-styled source-code editor Web Component backed
// by CodeMirror 6. It is the GtkSourceView twin the Learn6502 web rewrite needs:
// the Editor plus — in read-only, hex-address mode — the hex monitor, hexdump
// and disassembled panes. It maps 1:1 onto the `SourceViewWidget` interface from
// `@learn6502/common-ui` (code / lineNumbers / editable / readonly /
// lineNumberStart / selectable / copyable / copyButtonIcon / copyButtonTooltip).
//
// Opt-in subpath: this element lives at `@gjsify/adwaita-web/source-view`, NOT
// the main bundle, so consumers who do not need an editor never pay for
// CodeMirror. Importing the subpath registers <adw-source-view> and self-injects
// its stylesheet.
//
// Attributes are the kebab-case spelling of the properties. Events:
//   `code-changed` (CustomEvent, bubbles, detail `{ code }`) — USER edits only;
//     programmatic `.code =` is suppressed so an EditorView two-way bind does not loop.
//     The consuming SourceViewWidget maps it to `changed`.
//   `copy` (CustomEvent, bubbles, detail `{ code }`) — the clipboard receives the
//     whitespace-stripped text in hex mode.
// Reference: packages/app-gnome/src/widgets/source-view.ts (native parity target)
// Copyright (c) 2025 gjsify contributors. MIT License.

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
    drawSelection,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

import { asm6502 } from './asm6502.js';
import { adwaitaEditorTheme, adwaitaHighlightStyle, ensureSourceViewStyleInjected } from './theme.js';
import { formatHexAddress, formatLineNumber, stripWhitespace } from './hex.js';
import { createGtkImage } from '../elements/gtk-image.js';

/** A recognisable copy glyph rendered inline so the subpath needs no icon CSS. */
const COPY_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
    '<path d="M4 1a2 2 0 0 0-2 2v7h2V3h6V1H4z"/>' +
    '<path d="M7 4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H7zm0 2h5v7H7V6z"/>' +
    '</svg>';

/** Parse a boolean attribute: present (any value but "false") ⇒ true. */
function boolAttr(value: string | null): boolean {
    return value !== null && value !== 'false';
}

export class AdwSourceView extends HTMLElement {
    private _view?: EditorView;
    private _editorHost!: HTMLDivElement;
    private _copyButton!: HTMLButtonElement;
    private _initialized = false;
    private _suppressChangeEvent = false;

    private _code = '';
    private _editable = true;
    private _selectable = true;
    private _lineNumbers = false;
    private _lineNumberStart: number | undefined = undefined;
    private _hexAddresses = false;
    private _language = '6502';
    private _copyable = false;
    private _copyButtonIcon = 'edit-copy';
    private _copyButtonTooltip = 'Copy';

    // Reconfigurable pieces (CodeMirror compartments).
    private readonly _editableComp = new Compartment();
    private readonly _lineNumbersComp = new Compartment();
    private readonly _selectableComp = new Compartment();
    private readonly _languageComp = new Compartment();
    private readonly _copyComp = new Compartment();

    static get observedAttributes(): string[] {
        return [
            'code',
            'editable',
            'readonly',
            'selectable',
            'line-numbers',
            'line-number-start',
            'hex-addresses',
            'language',
            'copyable',
            'copy-button-icon',
            'copy-button-tooltip',
            'fill-height',
        ];
    }

    /** The document text. Programmatic assignment does NOT emit `code-changed`. */
    get code(): string {
        return this._view ? this._view.state.doc.toString() : this._code;
    }

    set code(value: string) {
        const next = value ?? '';
        if (next === this.code) return;
        this._code = next;
        if (this._view) {
            this._suppressChangeEvent = true;
            this._view.dispatch({
                changes: { from: 0, to: this._view.state.doc.length, insert: next },
            });
            this._suppressChangeEvent = false;
        }
    }

    /** Whether the user can edit the buffer (drives readOnly + active-line). */
    get editable(): boolean {
        return this._editable;
    }

    set editable(value: boolean) {
        this._editable = !!value;
        this._reconfigure(this._editableComp, this._editableExtension());
    }

    /** Inverse of `editable` — mirrors the native widget's readonly prop. */
    get readonly(): boolean {
        return !this._editable;
    }

    set readonly(value: boolean) {
        this.editable = !value;
    }

    /** Whether the content is selectable by the user. */
    get selectable(): boolean {
        return this._selectable;
    }

    set selectable(value: boolean) {
        this._selectable = !!value;
        this._reconfigure(this._selectableComp, this._selectableExtension());
    }

    /** Whether the gutter is shown. */
    get lineNumbers(): boolean {
        return this._lineNumbers;
    }

    set lineNumbers(value: boolean) {
        this._lineNumbers = !!value;
        this._reconfigure(this._lineNumbersComp, this._lineNumbersExtension());
    }

    /** First gutter value: decimal offset, or the base ADDRESS in hex mode. */
    get lineNumberStart(): number | undefined {
        return this._lineNumberStart;
    }

    set lineNumberStart(value: number | undefined) {
        this._lineNumberStart = value === undefined || Number.isNaN(value) ? undefined : Number(value);
        this._reconfigure(this._lineNumbersComp, this._lineNumbersExtension());
    }

    /** Render the gutter as 4-digit hex addresses (monitor / hexdump panes). */
    get hexAddresses(): boolean {
        return this._hexAddresses;
    }

    set hexAddresses(value: boolean) {
        this._hexAddresses = !!value;
        this._reconfigure(this._lineNumbersComp, this._lineNumbersExtension());
        this._reconfigure(this._copyComp, this._copyExtension());
    }

    /** `6502` / `6502-assembler` enables highlighting; anything else = plain. */
    get language(): string {
        return this._language;
    }

    set language(value: string) {
        this._language = value ?? '';
        this._reconfigure(this._languageComp, this._languageExtension());
    }

    /** Whether the floating copy button is shown. */
    get copyable(): boolean {
        return this._copyable;
    }

    set copyable(value: boolean) {
        this._copyable = !!value;
        if (this._copyButton) this._copyButton.hidden = !this._copyable;
    }

    /** Icon name for the copy button (`edit-copy`/`copy` render an inline SVG). */
    get copyButtonIcon(): string {
        return this._copyButtonIcon;
    }

    set copyButtonIcon(value: string) {
        this._copyButtonIcon = value || 'edit-copy';
        if (this._copyButton) this._renderCopyIcon();
    }

    /** Accessible label / tooltip for the copy button. */
    get copyButtonTooltip(): string {
        return this._copyButtonTooltip;
    }

    set copyButtonTooltip(value: string) {
        this._copyButtonTooltip = value ?? '';
        if (this._copyButton) {
            this._copyButton.title = this._copyButtonTooltip;
            this._copyButton.setAttribute('aria-label', this._copyButtonTooltip || 'Copy');
        }
    }

    /** Whether the editor fills its host's height (vs. auto-sizing to content). */
    get fillHeight(): boolean {
        return this.classList.contains('adw-source-view--fill');
    }

    set fillHeight(value: boolean) {
        this.classList.toggle('adw-source-view--fill', !!value);
    }

    /** The live CodeMirror EditorView (null until connected). Escape hatch. */
    get view(): EditorView | null {
        return this._view ?? null;
    }

    connectedCallback(): void {
        if (this._initialized) return;
        this._initialized = true;

        ensureSourceViewStyleInjected();
        this.classList.add('adw-source-view');
        this.setAttribute('dir', 'ltr');

        this._editorHost = document.createElement('div');
        this._editorHost.className = 'adw-source-view__editor';

        this._copyButton = document.createElement('button');
        this._copyButton.type = 'button';
        this._copyButton.className = 'adw-source-view__copy';
        this._copyButton.hidden = !this._copyable;
        this._copyButton.addEventListener('click', () => this._onCopyButtonClick());

        this.replaceChildren(this._editorHost, this._copyButton);

        // Fold any declarative attributes into fields (a property set earlier
        // already updated the field, so the attribute is a no-op then).
        this._readDeclarativeAttributes();
        this._renderCopyIcon();
        this.copyButtonTooltip = this._copyButtonTooltip;

        this._view = new EditorView({
            doc: this._code,
            parent: this._editorHost,
            extensions: this._baseExtensions(),
        });
    }

    disconnectedCallback(): void {
        // Preserve the last document so a re-attach restores it.
        this._code = this.code;
        this._view?.destroy();
        this._view = undefined;
        this._initialized = false;
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
        switch (name) {
            case 'code':
                this.code = value ?? '';
                break;
            case 'editable':
                this.editable = boolAttr(value);
                break;
            case 'readonly':
                this.readonly = boolAttr(value);
                break;
            case 'selectable':
                this.selectable = value === null ? true : boolAttr(value);
                break;
            case 'line-numbers':
                this.lineNumbers = boolAttr(value);
                break;
            case 'line-number-start':
                this.lineNumberStart = value === null ? undefined : Number(value);
                break;
            case 'hex-addresses':
                this.hexAddresses = boolAttr(value);
                break;
            case 'language':
                this.language = value ?? '';
                break;
            case 'copyable':
                this.copyable = boolAttr(value);
                break;
            case 'copy-button-icon':
                this.copyButtonIcon = value ?? '';
                break;
            case 'copy-button-tooltip':
                this.copyButtonTooltip = value ?? '';
                break;
            case 'fill-height':
                this.fillHeight = boolAttr(value);
                break;
        }
    }

    private _baseExtensions(): Extension {
        return [
            this._editableComp.of(this._editableExtension()),
            this._lineNumbersComp.of(this._lineNumbersExtension()),
            this._selectableComp.of(this._selectableExtension()),
            this._languageComp.of(this._languageExtension()),
            this._copyComp.of(this._copyExtension()),
            history(),
            drawSelection(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            adwaitaEditorTheme,
            syntaxHighlighting(adwaitaHighlightStyle),
            EditorView.contentAttributes.of({
                'aria-label': 'Source code',
                translate: 'no',
                autocorrect: 'off',
                autocapitalize: 'off',
                spellcheck: 'false',
            }),
            EditorView.updateListener.of((update) => {
                if (!update.docChanged) return;
                this._code = update.state.doc.toString();
                if (this._suppressChangeEvent) return;
                this.dispatchEvent(new CustomEvent('code-changed', { bubbles: true, detail: { code: this._code } }));
            }),
        ];
    }

    private _editableExtension(): Extension {
        const editable = this._editable;
        const extensions: Extension[] = [EditorView.editable.of(editable), EditorState.readOnly.of(!editable)];
        // Only highlight the cursor line while editing — an idle read-only
        // cursor would otherwise read as a stray selection (native parity).
        if (editable) extensions.push(highlightActiveLine(), highlightActiveLineGutter());
        return extensions;
    }

    private _lineNumbersExtension(): Extension {
        if (!this._lineNumbers) return [];
        const hex = this._hexAddresses;
        const start = this._lineNumberStart;
        return lineNumbers({
            formatNumber: (lineNo) =>
                hex ? formatHexAddress(lineNo, start ?? 0) : formatLineNumber(lineNo, start ?? 1),
        });
    }

    private _selectableExtension(): Extension {
        if (this._selectable) return [];
        // Non-selectable: suppress user selection + hide the caret.
        return EditorView.theme({
            '.cm-content': {
                userSelect: 'none',
                WebkitUserSelect: 'none',
                caretColor: 'transparent',
            },
            '.cm-cursor, .cm-cursorLayer': { display: 'none' },
        });
    }

    private _languageExtension(): Extension {
        return this._language === '6502' || this._language === '6502-assembler' ? asm6502() : [];
    }

    private _copyExtension(): Extension {
        // In hex mode, a Ctrl+C over the selection copies without whitespace,
        // mirroring the native monitor's copy-clipboard override.
        if (!this._hexAddresses) return [];
        return EditorView.domEventHandlers({
            copy: (event, view) => {
                const { from, to } = view.state.selection.main;
                if (from === to) return false;
                const selected = view.state.sliceDoc(from, to);
                event.clipboardData?.setData('text/plain', stripWhitespace(selected));
                event.preventDefault();
                return true;
            },
        });
    }

    private _reconfigure(compartment: Compartment, extension: Extension): void {
        this._view?.dispatch({ effects: compartment.reconfigure(extension) });
    }

    private _onCopyButtonClick(): void {
        const text = this._hexAddresses ? stripWhitespace(this.code) : this.code;
        const clipboard = (globalThis.navigator as Navigator | undefined)?.clipboard;
        if (clipboard?.writeText) void clipboard.writeText(text).catch(() => undefined);
        this.dispatchEvent(new CustomEvent('copy', { bubbles: true, detail: { code: this.code } }));
    }

    private _renderCopyIcon(): void {
        const name = this._copyButtonIcon || 'edit-copy';
        if (name === 'edit-copy' || name === 'copy' || name === '') {
            this._copyButton.innerHTML = COPY_SVG;
            return;
        }
        // A non-default icon uses the adwaita-web mask class (requires the main
        // bundle's icon CSS to be present).
        this._copyButton.replaceChildren(createGtkImage(name));
    }

    private _readDeclarativeAttributes(): void {
        for (const name of AdwSourceView.observedAttributes) {
            if (this.hasAttribute(name)) {
                this.attributeChangedCallback(name, null, this.getAttribute(name));
            }
        }
    }
}

customElements.define('adw-source-view', AdwSourceView);
