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
