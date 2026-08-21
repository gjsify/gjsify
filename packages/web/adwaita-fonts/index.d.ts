// The `.` export of this package is a STYLESHEET (`index.css`), for a CSS
// pipeline that resolves `url('./files/*.ttf')` — Vite, webpack, a `<link>`,
// Astro's `customCss`. Importing it from JavaScript registers nothing: under
// `gjsify build --app browser|gjs` the css-as-string plugin turns it into
// `export default "<css>"`, and a side-effect import of a module with no side
// effect is tree-shaken away at exit 0. From JS use `./embedded`, whose faces
// are `data:` URIs behind a VALUE import (`applyAdwaitaFonts()`).
export {};
