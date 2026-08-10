// Shader object lifecycle + source validation/wrapping for WebGLContextBase.
// Same `install*Methods(proto)` shape as the sibling `webgl2-context/uniform.ts`
// split — typed `*Methods` interface declaration-merged into `WebGLContextBase`
// via `declare module`, methods object with `ThisType<WebGLContextBase>`, plus
// an `installShaderLifecycleMethods(proto)` function that copies the
// implementations onto the prototype.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see ../shader-program.ts pre-split.

import tokenize from 'glsl-tokenizer/string';
import type { WebGLContextBase } from '../../webgl-context-base.js';
import { WebGLShader } from '../../webgl-shader.js';
import { WebGLShaderPrecisionFormat } from '../../webgl-shader-precision-format.js';
import { checkObject, isValidString } from '../../utils.js';

export interface ShaderLifecycleMethods {
    createShader(type?: GLenum): WebGLShader | null;
    deleteShader(shader: WebGLShader | null): void;
    compileShader(shader: WebGLShader): void;
    shaderSource(shader: WebGLShader, source: string): void;
    getShaderInfoLog(shader: WebGLShader): string | null;
    getShaderParameter(shader: WebGLShader, pname?: GLenum): unknown;
    getShaderPrecisionFormat(shaderType?: GLenum, precisionType?: GLenum): WebGLShaderPrecisionFormat | null;
    getShaderSource(shader: WebGLShader): string | null;
    _checkShaderSource(shader: WebGLShader): boolean;
    _wrapShader(type: GLenum, source: string): string;
}

declare module '../shader-program.js' {
    interface ShaderProgramMethods extends ShaderLifecycleMethods {}
}

/**
 * Constructs that exist ONLY in GLSL ES 1.00 — every one of them was REMOVED in
 * GLSL ES 3.00, so a source containing any is written in the older dialect and
 * cannot be compiled as the newer one.
 *
 * `attribute` and `varying` used to be the whole list, and they are the
 * VERTEX-side half of it: a fragment shader carries its dialect in
 * `gl_FragColor` / `gl_FragData` and in the `texture2D` family instead, and a
 * fullscreen-pass fragment shader routinely has neither `attribute` nor
 * `varying`. Measured on Linux/Mesa 26.1.5, `void main(){ gl_FragColor = … }`
 * with no `#version` was therefore classed as modern, given `#version 300 es`,
 * and failed to compile with "`gl_FragColor' undeclared".
 */
const GLSL1_ONLY = /\b(attribute|varying|gl_FragColor|gl_FragData|texture2D|texture2DProj|textureCube)\b/;

/**
 * Constructs that exist ONLY in GLSL ES 3.00, used to recognise a versionless
 * source that is deliberately written in the modern dialect.
 *
 * This list guards the DEFAULT rather than driving the decision: a source that
 * matches nothing here is treated as GLSL 1.0, so anything modern it fails to
 * recognise is a source that WILL be miscompiled. That asymmetry is why it
 * covers the ESSL3-only BUILT-INS and TYPES and not just the declaration
 * syntax — a versionless vertex shader doing `gl_Position = texelFetch(…)` has
 * no `in`/`out` declaration of its own to give it away, and every entry below
 * was added because it is the only marker such a shader would carry.
 *
 * A GLOBAL `in`/`out` declaration, not a bare `\bout\b`: `in` and `out` are also
 * PARAMETER qualifiers in GLSL ES 1.00 (`void f(in vec3 v)`), so the bare word
 * proves nothing. Anchored per line and required to be followed by
 * `<type> <name>;`, which a parameter list cannot look like.
 *
 * The sampling built-ins are the ESSL3 spellings — ESSL1 says `texture2D` /
 * `textureCube` / `texture2DProj`, all of which `GLSL1_ONLY` claims first, so
 * the two lists cannot both match a well-formed source.
 */
const GLSL3_ONLY = new RegExp(
    [
        // A global in/out declaration: `flat in vec3 vNormal;`
        String.raw`^\s*(?:flat\s+|smooth\s+|centroid\s+)*(?:in|out)\s+\w+\s+\w+\s*;`,
        // layout(location = 0) / layout(std140)
        String.raw`\blayout\s*\(`,
        // ESSL3 sampling built-ins (ESSL1 has the `*2D`/`*Cube` spellings)
        String.raw`\b(?:texture|textureProj|textureLod|textureProjLod|textureGrad|textureProjGrad|texelFetch|texelFetchOffset|textureSize|textureOffset)\s*\(`,
        // Integer/unsigned samplers and the unsigned scalar/vector types
        String.raw`\b(?:isampler|usampler)(?:2D|3D|Cube|2DArray)\b`,
        String.raw`\b(?:uint|uvec[234])\b`,
        // Built-ins that only exist in ESSL3 (ESSL1 reaches gl_FragDepth only
        // through EXT_frag_depth, whose spelling is gl_FragDepthEXT)
        String.raw`\b(?:gl_VertexID|gl_InstanceID|gl_FragDepth)\b`,
    ].join('|'),
    'm',
);

/**
 * Which dialect is a source WITHOUT a `#version` directive written in?
 *
 * Order matters, and the DEFAULT is the point: WebGL specifies that a shader
 * with no `#version` targets GLSL ES 1.00, which is also what browsers do, so
 * anything not positively identified as modern is GLSL 1.0 rather than the
 * context's newest dialect. Recognising the modern shape at all is a deliberate
 * extension beyond the spec — such a source is invalid in a browser — kept
 * because it costs nothing and refusing it would take away a capability that
 * works today.
 */
function glslDialectOf(source: string): 'glsl1' | 'modern' {
    if (GLSL1_ONLY.test(source)) return 'glsl1';
    if (GLSL3_ONLY.test(source)) return 'modern';
    return 'glsl1';
}

const shaderLifecycleMethods: ShaderLifecycleMethods & ThisType<WebGLContextBase> = {
    createShader(this: WebGLContextBase, type: GLenum = 0): WebGLShader | null {
        if (type !== this.FRAGMENT_SHADER && type !== this.VERTEX_SHADER) {
            this.setError(this.INVALID_ENUM);
            return null;
        }
        const id = this._gl.createShader(type);
        if (id < 0) {
            return null;
        }
        const result = new WebGLShader(id, this, type);
        this._shaders[id] = result;
        return result;
    },

    deleteShader(this: WebGLContextBase, shader: WebGLShader | null): void {
        this._deleteLinkable('deleteShader', shader, WebGLShader);
    },

    compileShader(this: WebGLContextBase, shader: WebGLShader): void {
        if (!checkObject(shader)) {
            throw new TypeError('compileShader(WebGLShader)');
        }
        if (this._checkWrapper(shader, WebGLShader) && this._checkShaderSource(shader)) {
            const prevError = this.getError();
            this._gl.compileShader(shader._ | 0);
            shader._needsRecompile = false;
            const error = this.getError();
            shader._compileStatus = !!this._gl.getShaderParameter(shader._ | 0, this.COMPILE_STATUS);
            shader._compileInfo = this._gl.getShaderInfoLog(shader._ | 0) || 'null';
            this.getError();
            this.setError(prevError || error);
        }
    },

    shaderSource(this: WebGLContextBase, shader: WebGLShader, source: string): void {
        if (!checkObject(shader)) {
            throw new TypeError('shaderSource(WebGLShader, String)');
        }
        if (!shader || (!source && typeof source !== 'string')) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (!isValidString(source)) {
            this.setError(this.INVALID_VALUE);
        } else if (this._checkWrapper(shader, WebGLShader)) {
            source = this._wrapShader(shader._type, source);
            this._gl.shaderSource(shader._ | 0, source);
            shader._source = source;
            shader._needsRecompile = true;
        }
    },

    getShaderInfoLog(this: WebGLContextBase, shader: WebGLShader): string | null {
        if (!checkObject(shader)) {
            throw new TypeError('getShaderInfoLog(WebGLShader)');
        } else if (this._checkWrapper(shader, WebGLShader)) {
            return shader._compileInfo;
        }
        return null;
    },

    getShaderParameter(this: WebGLContextBase, shader: WebGLShader, pname: GLenum = 0): unknown {
        if (!checkObject(shader)) {
            throw new TypeError('getShaderParameter(WebGLShader, GLenum)');
        } else if (this._checkWrapper(shader, WebGLShader)) {
            switch (pname) {
                case this.DELETE_STATUS:
                    return shader._pendingDelete;
                case this.COMPILE_STATUS:
                    return shader._compileStatus;
                case this.SHADER_TYPE:
                    return shader._type;
            }
            this.setError(this.INVALID_ENUM);
        }
        return null;
    },

    getShaderPrecisionFormat(
        this: WebGLContextBase,
        shaderType: GLenum = 0,
        precisionType: GLenum = 0,
    ): WebGLShaderPrecisionFormat | null {
        if (
            !(shaderType === this.FRAGMENT_SHADER || shaderType === this.VERTEX_SHADER) ||
            !(
                precisionType === this.LOW_FLOAT ||
                precisionType === this.MEDIUM_FLOAT ||
                precisionType === this.HIGH_FLOAT ||
                precisionType === this.LOW_INT ||
                precisionType === this.MEDIUM_INT ||
                precisionType === this.HIGH_INT
            )
        ) {
            this.setError(this.INVALID_ENUM);
            return null;
        }

        const format = this._gl.getShaderPrecisionFormat(shaderType, precisionType);
        if (!format) {
            return null;
        }

        return new WebGLShaderPrecisionFormat(format);
    },

    getShaderSource(this: WebGLContextBase, shader: WebGLShader): string | null {
        if (!checkObject(shader)) {
            throw new TypeError('Input to getShaderSource must be an object');
        } else if (this._checkWrapper(shader, WebGLShader)) {
            return shader._source;
        }
        return null;
    },

    _checkShaderSource(this: WebGLContextBase, shader: WebGLShader): boolean {
        const source = shader._source;
        const tokens = tokenize(source);

        let errorStatus = false;
        const errorLog: string[] = [];

        for (let i = 0; i < tokens.length; ++i) {
            const tok = tokens[i];
            if (!tok) continue;
            switch (tok.type) {
                case 'ident':
                    if (!this._validGLSLIdentifier(tok.data)) {
                        errorStatus = true;
                        errorLog.push(tok.line + ':' + tok.column + ' invalid identifier - ' + tok.data);
                    }
                    break;
                case 'preprocessor': {
                    const match = tok.data.match(/^\s*#\s*(.*)$/);
                    if (!match || match?.length < 2) {
                        break;
                    }
                    const bodyToks = tokenize(match[1]);
                    for (let j = 0; j < bodyToks.length; ++j) {
                        const btok = bodyToks[j];
                        if (btok.type === 'ident' || btok.type === undefined) {
                            if (!this._validGLSLIdentifier(btok.data)) {
                                errorStatus = true;
                                errorLog.push(tok.line + ':' + btok.column + ' invalid identifier - ' + btok.data);
                            }
                        }
                    }
                    break;
                }
                case 'keyword':
                    switch (tok.data) {
                        case 'do':
                            errorStatus = true;
                            errorLog.push(tok.line + ':' + tok.column + ' do not supported');
                            break;
                    }
                    break;
                case 'builtin':
                    switch (tok.data) {
                        case 'dFdx':
                        case 'dFdy':
                        case 'fwidth':
                            // dFdx/dFdy/fwidth are standard in GLSL ES 3.00 (WebGL2); only require
                            // OES_standard_derivatives extension in GLSL ES 1.00 (WebGL1)
                            if (!this._extensions.oes_standard_derivatives && this._getGlslVersion(true) === '100') {
                                errorStatus = true;
                                errorLog.push(tok.line + ':' + tok.column + ' ' + tok.data + ' not supported');
                            }
                            break;
                    }
            }
        }

        if (errorStatus) {
            shader._compileInfo = errorLog.join('\n');
        }
        return !errorStatus;
    },

    _wrapShader(this: WebGLContextBase, _type: GLenum, source: string): string {
        // the gl implementation seems to define `GL_OES_standard_derivatives` even when the extension is disabled
        // this behaviour causes one conformance test ('GL_OES_standard_derivatives defined in shaders when extension is disabled') to fail
        // by `undef`ing `GL_OES_standard_derivatives`, this appears to solve the issue

        // Determine if the source already has a #version directive
        const hasVersion = source.startsWith('#version') || source.includes('\n#version');

        // The dialect a VERSIONLESS source is written in, decided ONCE. Both the
        // `#version` to inject and the preamble to inject depend on it, and they
        // used to answer it separately: the version through
        // `/\b(attribute|varying)\b/` and the preamble through `!hasVersion`
        // alone. Two conditions for one question is how they came to disagree —
        // measured on Linux/Mesa 26.1.5, a versionless `gl_FragColor` shader was
        // handed `#version 300 es` (where that variable does not exist, so it
        // failed to compile) TOGETHER WITH `#define gl_MaxDrawBuffers 1`, a
        // `gl_`-prefixed macro GLSL ES 3.00 explicitly forbids.
        const dialect = hasVersion ? null : glslDialectOf(source);

        // Build preamble lines that must come AFTER #version (if any)
        let preamble = '';

        if (!this._extensions.oes_standard_derivatives && /#ifdef\s+GL_OES_standard_derivatives/.test(source)) {
            preamble += '#undef GL_OES_standard_derivatives\n';
        }

        // Only inject gl_MaxDrawBuffers for GLSL ES 1.0 shaders.
        // GLSL ES 3.0+ (#version 300 es) has gl_MaxDrawBuffers as a built-in
        // constant and forbids redefining names beginning with gl_ — so this
        // follows the DIALECT, not merely the absence of a `#version` line.
        if (!this._extensions.webgl_draw_buffers && dialect === 'glsl1') {
            preamble += '#define gl_MaxDrawBuffers 1\n';
        }

        if (hasVersion) {
            // Insert preamble after the first line (#version ...\n), keeping #version at line 1
            if (preamble) {
                const newline = source.indexOf('\n');
                if (newline !== -1) {
                    source = source.slice(0, newline + 1) + preamble + source.slice(newline + 1);
                } else {
                    source = source + '\n' + preamble;
                }
            }
        } else {
            // No #version in source — inject version + preamble at the top.
            // A GLSL 1.0-shaped source stays GLSL 1.0 even in a WebGL2 context.
            // Real browsers default versionless shaders to GLSL 1.0.
            if (this.canvas) {
                const glArea = this.canvas.getGlArea();
                const es = glArea.get_use_es();
                // A GLSL1-shaped source must stay GLSL1 even on a WebGL2 context,
                // which is why this does NOT go through `_getGlslVersion` — that
                // one is overridden to answer `300 es` there. It used to inline
                // `'120'`, and desktop GLSL 1.20 is a COMPATIBILITY dialect a core
                // profile rejects outright; `_getGlsl1Version` knows the measured
                // answer for both kinds of desktop context.
                const version = dialect === 'glsl1' ? this._getGlsl1Version(es) : this._getGlslVersion(es);
                if (version) {
                    source = '#version ' + version + '\n' + preamble + source;
                } else if (preamble) {
                    source = preamble + source;
                }
            } else if (preamble) {
                source = preamble + source;
            }
        }

        return source;
    },
};

/** Install shader-object lifecycle + source-validation methods on WebGLContextBase.prototype. */
export function installShaderLifecycleMethods(proto: object): void {
    Object.assign(proto, shaderLifecycleMethods);
}
