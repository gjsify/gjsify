// The copy button's glyph, built as NODES.
//
// It was a constant SVG string handed to `innerHTML`, which is safe only until someone
// edits the string — and it was, next to two `use-markup` surfaces that did the same with
// AUTHOR-controlled markup, the reason Mozilla's add-on reviewer flagged this package.
// The glyph is a constant and the sink was not: `createElementNS` costs two lines more and
// cannot parse anything.
//
// It lives in its own module, not in `pango-markup.ts` (which is about Pango markup) and
// not inline in `adw-source-view.ts` (which would drag CodeMirror into any suite that
// wants to check the shape) — so a test can assert the glyph without pulling the editor in.
//
// The two paths are the two sheets of the `edit-copy` mark: the back sheet offset up-left,
// the front sheet inset. `aria-hidden` because the button carries the accessible name, the
// same split `gtk-image.ts` documents.
//
// Reference: refs/adwaita-icon-theme/Adwaita/scalable/status-icons/edit-copy-symbolic.svg
//   (the same two-sheet mark, path data rounded to integers here)
// Copyright (c) 2025 gjsify contributors. MIT License.

/** The SVG namespace, spelled once — `createElementNS` needs it on every node. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The two sheet outlines, in draw order (back, then front). */
const SHEETS = [
    'M4 1a2 2 0 0 0-2 2v7h2V3h6V1H4z',
    'M7 4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H7zm0 2h5v7H7V6z',
];

/** The size both spinners and every symbolic icon in this package draw at. */
const GLYPH_SIZE = '16';

/**
 * A recognisable copy glyph rendered inline so the opt-in `source-view` subpath needs no
 * icon CSS. `doc` is a parameter so a caller outside the main document (a shadow root in
 * another frame) gets nodes its own tree can adopt.
 */
export function createCopyGlyph(doc: Document = document): SVGSVGElement {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', GLYPH_SIZE);
    svg.setAttribute('height', GLYPH_SIZE);
    svg.setAttribute('viewBox', `0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`);
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    for (const d of SHEETS) {
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}
