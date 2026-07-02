// Pure, framework-free helpers for <adw-source-view>. They carry no CodeMirror
// or DOM dependency so they stay unit-testable on any runtime and drive the
// gutter formatter + the hex copy-without-spaces behaviour.
// Reference: packages/app-gnome/src/gutter-renderer-line-numbers.ts (native parity)
// Reference: packages/app-gnome/src/widgets/source-view.ts onCopyHexClipboard()

/** Bytes represented per visual line in the hex monitor / hexdump gutter. */
export const HEX_ADDRESS_STRIDE = 16;

/**
 * Format a 1-based CodeMirror line number as a 4-digit uppercase hex address,
 * the way the native GtkSourceView hex gutter renders monitor/hexdump rows:
 * each row advances the address by `stride` bytes from `start`.
 *
 * @param lineNo 1-based line number (CodeMirror's `formatNumber` contract).
 * @param start  base address of the first row (e.g. 0x0600 for a 6502 program).
 * @param stride bytes per row (default 16 — one hexdump row).
 */
export function formatHexAddress(lineNo: number, start: number, stride: number = HEX_ADDRESS_STRIDE): string {
    const address = start + (lineNo - 1) * stride;
    return address.toString(16).padStart(4, '0').toUpperCase();
}

/**
 * Format a 1-based CodeMirror line number for the normal (decimal) gutter,
 * offset by `start` so a pane can begin numbering at an arbitrary value —
 * the web twin of the native renderer's `line + startValue`.
 *
 * @param lineNo 1-based line number.
 * @param start  value shown on the first line (default 1 → identity).
 */
export function formatLineNumber(lineNo: number, start: number = 1): string {
    return String(lineNo - 1 + start);
}

/**
 * Strip every whitespace character from `text` — the copy-without-spaces
 * transform the native hex monitor applies so a copied address/byte run pastes
 * as a compact hex string. Mirrors `text.replace(/\s/g, '')` in the GTK widget.
 */
export function stripWhitespace(text: string): string {
    return text.replace(/\s/g, '');
}
