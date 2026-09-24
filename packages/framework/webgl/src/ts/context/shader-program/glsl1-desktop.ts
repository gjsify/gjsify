// GLSL ES 1.00 → desktop core GLSL, for the one case a desktop context cannot
// compile the ES dialect itself: a WebGL1 shader using OES_standard_derivatives.
//
// WHY THIS EXISTS. A desktop core context compiles `#version 100` through
// ARB_ES2_compatibility (core from GL 4.1), which is how every other WebGL1
// shader reaches macOS. But that ES front end is exactly GLSL ES 1.00 with NO
// extensions: measured on macOS 27 / GL 4.1 core (Apple M-series),
// `#extension GL_OES_standard_derivatives : enable` answers "extension is not
// supported" and `dFdx` is then an undeclared identifier. The derivatives
// themselves are core desktop GLSL since 1.10, so the feature is there — only
// the ES spelling of the shader cannot reach it. The same shader, spelled in the
// context's own desktop GLSL, compiles and evaluates.
//
// Pure: no GL, so the spelling is testable without a context. The CALLER decides
// WHEN (a GLSL1 source using a derivative, on a context whose ES front end was
// probed and found to lack them) — a context that can compile the ES shader
// keeps it untouched, because rewriting a consumer's shader for nothing is a
// change nobody asked for.

/** Does a source call one of the three OES_standard_derivatives built-ins? */
export const usesStandardDerivatives = (source: string): boolean => /\b(?:dFdx|dFdy|fwidth)\s*\(/.test(source);

const FRAG_COLOR = 'gjsify_FragColor';
const FRAG_DATA = 'gjsify_FragData';
const DERIVATIVES_MACRO = 'GJSIFY_OES_standard_derivatives';

/**
 * Identifiers GLSL ES 1.00 leaves free that desktop core GLSL claims — a keyword
 * there, or (`texture`) the built-in every `texture2D` below is renamed TO. A
 * consumer's `uniform sampler2D texture;` is ordinary GLSL1 (stackgl-era shaders
 * spell it exactly so), and left alone it would shadow or collide with the
 * desktop built-in. None of them is a GLSL1 built-in, so every occurrence is the
 * consumer's own name and is renamed as a token, before any macro applies.
 */
const DESKTOP_ONLY_NAMES =
    /\b(texture|sample|smooth|flat|layout|centroid|noperspective|patch|subroutine|precise|uint|uvec[234]|common|partition|active|filter)\b/g;

/**
 * Respell a GLSL ES 1.00 source as desktop `#version <desktopVersion>` GLSL.
 *
 * Macros, not a parser: every construct ES 1.00 has and core desktop GLSL lost
 * is a NAME (`attribute`, `varying`, `texture2D`, `gl_FragColor`, …), so a
 * `#define` renames it in place and the consumer's lines stay as written, in
 * order. Precision qualifiers need no help: desktop GLSL accepts and ignores
 * them. `#line` directives put every consumer line back at its own number, so a
 * compile error still names the line the consumer wrote — `desktopVersion` is
 * always ≥ 330 here (the caller only respells on GL ≥ 4.1), where `#line N`
 * numbers the NEXT line N.
 *
 * The fragment outputs are the one thing a macro cannot supply, since core GLSL
 * needs them DECLARED. The declaration goes after the last `#extension`
 * directive, because a directive after the first non-preprocessor token is an
 * error in several front ends.
 *
 * `#extension GL_OES_standard_derivatives` is commented out: the derivatives are
 * core desktop GLSL, and a desktop front end does not know the ES name — `: enable`
 * would only warn, but `: require` is a compile error.
 *
 * `#ifdef GL_OES_standard_derivatives` must still answer as WebGL says: defined
 * exactly when the consumer enabled the extension (`derivativesEnabled`), because
 * consumers branch on it. It cannot simply be `#define`d: desktop GLSL reserves
 * every `GL_`-prefixed macro name, and macOS refuses the definition ("#define of
 * reserved name", measured). So the conditionals are pointed at an unreserved
 * stand-in, defined only when the extension is on.
 */
export function translateGlsl1ToDesktop(
    source: string,
    stage: 'vertex' | 'fragment',
    desktopVersion: string,
    preamble: string,
    derivativesEnabled: boolean,
): string {
    // An explicit `#version 100` is replaced, not supplemented — blanked rather
    // than removed so every line after it keeps its number.
    const body = source.replace(/^(\s*)#\s*version\s+100\b[^\n]*/, '$1').replace(DESKTOP_ONLY_NAMES, 'gjsify_$1');

    const header: string[] = [
        `#version ${desktopVersion}`,
        '#define texture2D texture',
        '#define texture2DProj textureProj',
        '#define texture2DLod textureLod',
        '#define texture2DProjLod textureProjLod',
        '#define textureCube texture',
        '#define textureCubeLod textureLod',
    ];
    if (derivativesEnabled) header.push(`#define ${DERIVATIVES_MACRO} 1`);
    const outputs: string[] = [];
    if (stage === 'vertex') {
        header.push('#define attribute in', '#define varying out');
    } else {
        header.push('#define varying in');
        if (/\bgl_FragColor\b/.test(body)) {
            header.push(`#define gl_FragColor ${FRAG_COLOR}`);
            outputs.push(`out vec4 ${FRAG_COLOR};`);
        }
        if (/\bgl_FragData\b/.test(body)) {
            // One slot: WebGL1 without WEBGL_draw_buffers has exactly one, which
            // is also what the preamble's `gl_MaxDrawBuffers 1` states.
            header.push(`#define gl_FragData ${FRAG_DATA}`);
            outputs.push(`out vec4 ${FRAG_DATA}[1];`);
        }
    }

    const lines = body.split('\n');
    let lastExtension = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*#\s*extension\s+GL_OES_standard_derivatives\b/.test(lines[i])) {
            lines[i] = '// ' + lines[i];
            lastExtension = i;
        } else if (/^\s*#\s*extension\b/.test(lines[i])) {
            lastExtension = i;
        } else if (/^\s*#\s*(?:if|ifdef|ifndef|elif)\b/.test(lines[i])) {
            lines[i] = lines[i].replace(/\bGL_OES_standard_derivatives\b/g, DERIVATIVES_MACRO);
        }
    }
    // `#line N` numbers the line AFTER it N; line index i is the consumer's line i + 1.
    if (outputs.length > 0) lines.splice(lastExtension + 1, 0, ...outputs, `#line ${lastExtension + 2}`);

    return header.join('\n') + '\n' + preamble + '#line 1\n' + lines.join('\n');
}
