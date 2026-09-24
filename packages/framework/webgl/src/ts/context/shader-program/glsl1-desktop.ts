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
 * Respell a GLSL ES 1.00 source as desktop `#version <desktopVersion>` GLSL.
 *
 * Macros, not a parser: every construct ES 1.00 has and core desktop GLSL lost
 * is a NAME (`attribute`, `varying`, `texture2D`, `gl_FragColor`, …), so a
 * `#define` renames it in place and the consumer's lines stay as written, in
 * order — a compile error still names the consumer's own line, shifted by the
 * fixed header. Precision qualifiers need no help: desktop GLSL accepts
 * and ignores them.
 *
 * The fragment outputs are the one thing a macro cannot supply, since core GLSL
 * needs them DECLARED. The declaration goes after the last `#extension`
 * directive, because a directive after the first non-preprocessor token is an
 * error in several front ends.
 *
 * `#ifdef GL_OES_standard_derivatives` must still see the extension, because
 * the ES front end predefines that macro wherever the extension is supported
 * and consumers branch on it — left undefined, a shader with a fallback would
 * silently take the fallback here. It cannot simply be `#define`d: desktop GLSL
 * reserves every `GL_`-prefixed macro name, and macOS refuses the definition
 * ("#define of reserved name", measured). So the conditionals are pointed at
 * an unreserved stand-in instead; the `#extension` line keeps its spelling.
 */
export function translateGlsl1ToDesktop(
    source: string,
    stage: 'vertex' | 'fragment',
    desktopVersion: string,
    preamble: string,
): string {
    // Drop an explicit `#version 100`: it is replaced, not supplemented.
    const body = source.replace(/^\s*#\s*version\s+100\b[^\n]*\n?/, '');

    const header: string[] = [
        `#version ${desktopVersion}`,
        `#define ${DERIVATIVES_MACRO} 1`,
        '#define texture2D texture',
        '#define texture2DProj textureProj',
        '#define texture2DLod textureLod',
        '#define texture2DProjLod textureProjLod',
        '#define textureCube texture',
        '#define textureCubeLod textureLod',
    ];
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
        if (/^\s*#\s*extension\b/.test(lines[i])) lastExtension = i;
        else if (/^\s*#\s*(?:if|ifdef|ifndef|elif)\b/.test(lines[i])) {
            lines[i] = lines[i].replace(/\bGL_OES_standard_derivatives\b/g, DERIVATIVES_MACRO);
        }
    }
    if (outputs.length > 0) lines.splice(lastExtension + 1, 0, ...outputs);

    return header.join('\n') + '\n' + preamble + lines.join('\n');
}
