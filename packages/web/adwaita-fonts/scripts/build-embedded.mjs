// Generate the SELF-CONTAINED form of this package's `@font-face` rules:
// `lib/esm/embedded.js`, where every `src:` is a `data:` URI instead of a
// relative `url()`.
//
// WHY A SECOND FORM EXISTS AT ALL. `index.css` is correct and stays the default
// — a CSS pipeline (Vite, webpack, a `<link>`) resolves `url('./files/*.ttf')`
// against the stylesheet, emits the TTF as an asset and serves it. Nothing about
// that path was ever broken.
//
// It is the OTHER kind of consumer this file is for. Under `gjsify build --app
// browser` (and `--app gjs`) the css-as-string plugin turns a CSS import into a
// JS STRING, and the target emits ONE bundle file with no asset pipeline
// (`output.inlineDynamicImports`, the single-file invariant in
// rolldown-plugin-gjsify/AGENTS.md). Both halves of `index.css` fail there:
//
//   1. `import '@gjsify/adwaita-fonts'` is a SIDE-EFFECT import of a module whose
//      only content is `export default "<css>"`. That has no side effect, so it
//      is tree-shaken. MEASURED on 0.41.0: a probe entry whose only statement is
//      that import builds to a ZERO-BYTE bundle with zero `@font-face`, exit 0.
//      Nothing warns, because nothing went wrong from the bundler's point of view.
//   2. Even when the string is KEPT (`import css from …`), its `src:
//      url('./files/adwaita-sans-400.ttf')` resolves against the DOCUMENT, and the
//      single-file bundle emitted no such asset. The rule parses, the face 404s.
//
// A `data:` URI is the only form that survives both. This is the same lesson
// `@gjsify/adwaita-web`'s `styles.generated.ts` already encodes one level up:
// what has to travel through a JS bundle travels as a VALUE, never as a CSS
// import's side effect.
//
// THE COST IS THE REASON IT IS OPT-IN. Base64 is 4/3 of the payload and these are
// unsubsetted desktop TTFs, not web fonts:
//
//     adwaita-web.css              190 731 B   (25 891 B gzip -9)
//     + sans 400 as base64       1 363 795 B  (594 177 B gzip -9)   7.2x
//     + sans 400 + italic        2 577 599 B  (1 205 683 B gzip)   13.5x
//
// So `@gjsify/adwaita-web` does NOT import this module: its root entry would put
// ~600 KB gzip into every consumer's bundle for a typeface that is installed
// system-wide on the platform it targets. Opting in is one VALUE import, which is
// exactly the shape that cannot be silently discarded — see
// `@gjsify/adwaita-web/fonts`.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');

/**
 * The faces this package ships, in the order `index.css` + `400-italic.css`
 * declare them. Kept beside the CSS rather than parsed out of it: the CSS is the
 * artefact for a pipeline that resolves `url()`, this is the artefact for one
 * that cannot, and a generator that reads the first to write the second would
 * make a change to either silently reshape the other.
 *
 * `weight` IS A RANGE, whatever the `400` in the upstream file names suggests:
 * both TTFs are VARIABLE fonts whose `fvar` table carries `wght 100-900` and
 * `opsz 14-32`. A single `font-weight: 400` pins the variation axis at 400 and
 * makes the engine SYNTHESISE every heavier weight — and the compiled
 * `adwaita-web.css` asks for 700 at 27 declarations and 800 at 6, so the clamp
 * hits the common case rather than an edge. MEASURED in Firefox on the opt-in,
 * 'Hamburgefonstiv' at 64px: pinned renders 479.75 / 499.68 / 499.68 px at
 * weight 400 / 700 / 800 — 700 and 800 IDENTICAL, i.e. one synthetic bold —
 * against 479.75 / 517.77 / 533.28 with the range, three real instances. Pinned,
 * calling the opt-in made bold UI text WORSE than not calling it at all.
 *
 * `Adwaita Mono` is deliberately ABSENT: this package ships no mono TTF. The
 * stacks that head with `'Adwaita Mono'` say so, and `status/stylesheet-font-families.json`
 * carries the reason.
 */
const FACES = [
    { const: 'ADWAITA_SANS_400_CSS', file: 'files/adwaita-sans-400.ttf', style: 'normal', weight: '100 900' },
    { const: 'ADWAITA_SANS_400_ITALIC_CSS', file: 'files/adwaita-sans-400-italic.ttf', style: 'italic', weight: '100 900' },
];

/** `font/ttf` is the registered media type for TrueType (RFC 8081 § 4.4.4). */
const TTF_MEDIA_TYPE = 'font/ttf';

/** One `@font-face` rule with the TTF inlined. `font-display` matches the `url()` CSS. */
function faceRule(face) {
    const bytes = readFileSync(resolve(pkgRoot, face.file));
    const base64 = Buffer.from(bytes).toString('base64');
    return (
        `@font-face {\n` +
        `  font-family: 'Adwaita Sans';\n` +
        `  font-style: ${face.style};\n` +
        `  font-display: swap;\n` +
        `  font-weight: ${face.weight};\n` +
        `  src: url('data:${TTF_MEDIA_TYPE};base64,${base64}') format('truetype');\n` +
        `}\n`
    );
}

const rules = FACES.map((face) => ({ ...face, css: faceRule(face) }));
// CONCATENATED at runtime, never emitted as a second literal: a `data:` URI is
// two thirds of this file, and writing the combined form out again doubled the
// module from 2.3 MiB to 4.7 MiB for bytes the engine already has.
const combinedExpression = rules.map((r) => r.const).join(' + ');

const header = `// embedded — auto-generated by scripts/build-embedded.mjs.
// DO NOT EDIT. Every \`src:\` is a \`data:\` URI so the faces survive a bundler
// that turns CSS into a string and a build target that emits no assets.
`;

const declarations = rules
    .map(
        (r) =>
            `/** \`@font-face\` for \`${r.file}\` (${r.style}, weight ${r.weight}), TTF inlined as a \`data:\` URI. */\nexport const ${r.const} = ${JSON.stringify(r.css)};`,
    )
    .join('\n\n');

const esm = `${header}
${declarations}

/** Every face this package ships, concatenated — what {@link applyAdwaitaFonts} injects. */
export const ADWAITA_FONTS_CSS = ${combinedExpression};

/** The \`<style>\` id used for the injected rules, so a second call is a no-op. */
export const ADWAITA_FONTS_STYLE_ID = 'adwaita-fonts-style';

/**
 * Register the Adwaita Sans faces on \`document\`, idempotently.
 *
 * Returns \`true\` when it injected, \`false\` when the element was already there or
 * there is no document (a non-browser host). Call it once, early — the faces are
 * only in the bundle because you imported this module, so nothing is paid by a
 * consumer that does not.
 */
export function applyAdwaitaFonts(target) {
    const doc = target ?? (typeof document === 'undefined' ? undefined : document);
    if (!doc) return false;
    if (doc.getElementById(ADWAITA_FONTS_STYLE_ID)) return false;
    const style = doc.createElement('style');
    style.id = ADWAITA_FONTS_STYLE_ID;
    style.textContent = ADWAITA_FONTS_CSS;
    doc.head.appendChild(style);
    return true;
}
`;

const dts = `${header}
${rules.map((r) => `/** \`@font-face\` for \`${r.file}\` (${r.style}, weight ${r.weight}), TTF inlined as a \`data:\` URI. */\nexport declare const ${r.const}: string;`).join('\n\n')}

/** Every face this package ships, concatenated — what {@link applyAdwaitaFonts} injects. */
export declare const ADWAITA_FONTS_CSS: string;

/** The \`<style>\` id used for the injected rules, so a second call is a no-op. */
export declare const ADWAITA_FONTS_STYLE_ID: string;

/**
 * Register the Adwaita Sans faces on \`document\`, idempotently.
 *
 * Returns \`true\` when it injected, \`false\` when the element was already there or
 * there is no document (a non-browser host).
 */
export declare function applyAdwaitaFonts(target?: Document): boolean;
`;

mkdirSync(resolve(pkgRoot, 'lib', 'esm'), { recursive: true });
mkdirSync(resolve(pkgRoot, 'lib', 'types'), { recursive: true });
writeFileSync(resolve(pkgRoot, 'lib', 'esm', 'embedded.js'), esm);
writeFileSync(resolve(pkgRoot, 'lib', 'types', 'embedded.d.ts'), dts);

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
console.log(`✓ Generated lib/esm/embedded.js (${rules.length} faces, ${kb(esm.length)})`);
console.log(`✓ Generated lib/types/embedded.d.ts`);
