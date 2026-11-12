// `px` in a GTK stylesheet is a LOGICAL pixel — the unit libadwaita's own CSS is written in. In
// NativeScript `12px` is a PHYSICAL pixel, and a bare `12` is a device-independent one (`dip`,
// `length-shared.js`). On a 3.5 px/dp phone `padding: 12px` therefore draws 3.4 dp, not 12.
//
// So a GTK stylesheet reaches NativeScript with its `px` dropped. Headless and shared by the build
// (`@gjsify/nativescript-vite`, PostCSS) and the runtime (`Gtk.CssProvider` -> `Application.addCss`).
//
// Only `px` is touched. Comments, strings and `url(...)` are copied through as written. `em`, `pt`,
// `rem` and the rest are not converted: whether NativeScript reads them as GTK does is a separate
// question.

const SKIP = String.raw`\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|url\([^)]*\)`;
const PX = String.raw`(?<![\w.#-])([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px(?![\w-])`;

/** `12px` -> `12`, `0 -4.5px` -> `0 -4.5`; everything else, and anything quoted or commented, as is. */
export function cssPxToDip(css: string): string {
    return css.replace(new RegExp(`${SKIP}|${PX}`, 'gi'), (match, number?: string) =>
        number === undefined ? match : number,
    );
}

// --- App scale: one factor over every length in a stylesheet ---------------------------------
//
// A GTK stylesheet is authored for a ~360 logical-pixel window. A phone reports more than that
// (a Galaxy S9: 411.4 dp), so the same sheet draws the same widgets SMALLER relative to the
// screen. `scaleAdwaitaCss` multiplies every length by one factor, so the app reads like the
// GTK one at the same apparent size — fonts and the boxes around them together, never one
// without the other.
//
// It emits an OVERRIDE SHEET, not a rewritten stylesheet: the same selectors, carrying only the
// length declarations, to be appended after the original (`Application.addCss` on NativeScript
// is append-only, `platform-host.ts`). Same selector, same specificity, later position — so the
// scaled value wins and every non-length declaration is left exactly as authored. That is also
// why the identity case (`scale === 1`) still emits: appending the ORIGINAL lengths again is
// the only way to take a scale back.
//
// PROPERTIES ARE AN ALLOWLIST, never a denylist. `rgba(0, 0, 0, 0.8)` is three numbers and a
// colour; `transition: 0.2s` is a duration. Both stay untouched because `color` and
// `transition` are not lengths, and a property nobody listed is a property nobody scales.

/**
 * The declarations an app scale multiplies: lengths, and nothing that only looks like one.
 *
 * `letter-spacing` is absent on purpose — NativeScript reads it as a multiple of the font size,
 * so it already follows a scaled `font-size` and scaling it again would widen the tracking.
 */
export const SCALED_CSS_PROPERTIES: readonly string[] = [
    'font-size',
    'line-height',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'width',
    'height',
    'min-width',
    'min-height',
    'border-radius',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
    'border-width',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
];

const SCALED = new Set(SCALED_CSS_PROPERTIES);

/** A bare number, optionally with `px`. A percentage, a unit, a hex colour or an identifier is not one. */
const SCALABLE = String.raw`(?<![\w.#-])([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px)?(?![\w%.-])`;

/** At most three decimals, and no `1.1400000000000001`. */
function roundLength(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

/** `12 0 -4` at 1.5 -> `18 0 -6`; `100%`, `auto` and anything quoted or commented as is. */
function scaleLengthValue(value: string, scale: number): { readonly text: string; readonly scaled: boolean } {
    let scaled = false;
    const text = value.replace(new RegExp(`${SKIP}|${SCALABLE}`, 'gi'), (match, number?: string, unit?: string) => {
        if (number === undefined) return match;
        scaled = true;
        return `${roundLength(Number(number) * scale)}${unit ?? ''}`;
    });
    return { text, scaled };
}

/**
 * Drop comments from a selector or a declaration.
 *
 * Not cosmetic: a comment sits between rules in the source, so it would otherwise be carried
 * into the emitted selector — and NativeScript drops a selector it cannot parse WITHOUT a word,
 * so the scale would simply be missing for that rule.
 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** The index just past the `}` that closes the `{` at `open`, or the end of the text. */
function closingBrace(css: string, open: number): number {
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        const char = css[i];
        if (char === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            i = end === -1 ? css.length : end + 1;
        } else if (char === '"' || char === "'") {
            for (i++; i < css.length && css[i] !== char; i++) if (css[i] === '\\') i++;
        } else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return i + 1;
    }
    return css.length;
}

/** Split a declaration list on the `;` that are not inside a string, a comment or `(...)`. */
function splitDeclarations(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (char === '/' && body[i + 1] === '*') {
            const end = body.indexOf('*/', i + 2);
            i = end === -1 ? body.length : end + 1;
        } else if (char === '"' || char === "'") {
            for (i++; i < body.length && body[i] !== char; i++) if (body[i] === '\\') i++;
        } else if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ';' && depth === 0) {
            parts.push(body.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(body.slice(start));
    return parts;
}

/** The scaled declarations of one rule body, `prop: value; …`, or `''` when it carries no length. */
function scaleDeclarations(body: string, scale: number): string {
    const kept: string[] = [];
    for (const raw of splitDeclarations(body)) {
        const declaration = stripComments(raw);
        const colon = declaration.indexOf(':');
        if (colon === -1) continue;
        const property = declaration.slice(0, colon).trim().toLowerCase();
        if (!SCALED.has(property)) continue;
        const { text, scaled } = scaleLengthValue(declaration.slice(colon + 1), scale);
        if (scaled) kept.push(`${property}:${text.replace(/\s+$/, '')}`);
    }
    return kept.join('; ');
}

/**
 * The override sheet that puts `scale` over every length of `css`.
 *
 * Style rules keep their selector; `@media` and `@supports` keep their condition, so a rule that
 * only applies on a wide window still only applies there. `@keyframes`, `@font-face` and the
 * other at-rules carry no layout length and are dropped. A rule left with no length declaration
 * is dropped too, so the sheet is always a fraction of the one it came from.
 *
 * Pure, and length-only by construction: it can never clobber the append-only accent and named
 * colour overrides (`widgets/named-colors-theme.ts`), because it emits no colour.
 *
 * @param css    a stylesheet whose `px` have already been dropped (see {@link cssPxToDip}).
 * @param scale  the factor; `1` emits the original lengths, which is how a scale is taken back.
 */
export function scaleAdwaitaCss(css: string, scale: number): string {
    if (!Number.isFinite(scale) || scale <= 0) return '';
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < css.length; i++) {
        const char = css[i];
        if (char === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            i = end === -1 ? css.length : end + 1;
        } else if (char === '"' || char === "'") {
            for (i++; i < css.length && css[i] !== char; i++) if (css[i] === '\\') i++;
        } else if (char === ';') {
            start = i + 1;
        } else if (char === '{') {
            const end = closingBrace(css, i);
            const prelude = stripComments(css.slice(start, i)).trim();
            const body = css.slice(i + 1, end - 1);
            if (prelude.startsWith('@')) {
                const name = /^@[\w-]*/.exec(prelude)?.[0].toLowerCase();
                if (name === '@media' || name === '@supports') {
                    const inner = scaleAdwaitaCss(body, scale);
                    if (inner !== '') out.push(`${prelude} { ${inner} }`);
                }
            } else if (prelude !== '') {
                const declarations = scaleDeclarations(body, scale);
                if (declarations !== '') out.push(`${prelude} { ${declarations} }`);
            }
            i = end - 1;
            start = end;
        }
    }
    return out.join('\n');
}
