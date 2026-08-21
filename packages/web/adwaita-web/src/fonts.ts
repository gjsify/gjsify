// `@gjsify/adwaita-web/fonts` — the opt-in that actually ships the typeface.
//
// A SEPARATE SUBPATH, not part of the root entry, and both halves of that are
// deliberate:
//
//   • Separate, because the payload is base64 TTF. Inlined, the two Adwaita Sans
//     faces are 2.39 MB / 1.18 MB gzip against a 190 KB / 26 KB stylesheet, and
//     `gjsify build --app browser` emits ONE file with `inlineDynamicImports`, so
//     there is no lazy form that costs less. An app on GNOME already has the
//     typeface installed; an app served to arbitrary browsers does not. That is
//     the app's call, so it is the app's import.
//   • A VALUE export rather than a side-effect module, because a side-effect
//     import is exactly how the fonts stopped shipping in the first place:
//     `src/index.ts` carried `import '@gjsify/adwaita-fonts';` for its whole
//     life, and under css-as-string that resolves to `export default "<css>"`,
//     tree-shakes to nothing, and exits 0. `applyAdwaitaFonts` has to be CALLED,
//     so there is no way to write the opt-in and still get silence.
//
// Usage:
//
//     import '@gjsify/adwaita-web';
//     import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
//     applyAdwaitaFonts();

export { ADWAITA_FONTS_CSS, ADWAITA_FONTS_STYLE_ID, applyAdwaitaFonts } from '@gjsify/adwaita-fonts/embedded';
