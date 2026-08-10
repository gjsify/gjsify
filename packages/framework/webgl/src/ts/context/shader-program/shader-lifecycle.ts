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

        // Build preamble lines that must come AFTER #version (if any)
        let preamble = '';

        if (!this._extensions.oes_standard_derivatives && /#ifdef\s+GL_OES_standard_derivatives/.test(source)) {
            preamble += '#undef GL_OES_standard_derivatives\n';
        }

        // Only inject gl_MaxDrawBuffers for GLSL ES 1.0 shaders.
        // GLSL ES 3.0+ (#version 300 es) has gl_MaxDrawBuffers as a built-in
        // constant and forbids redefining names beginning with gl_.
        if (!this._extensions.webgl_draw_buffers && !hasVersion) {
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
            // If the shader uses GLSL 1.0 keywords (attribute/varying), keep it
            // as GLSL 1.0 even in a WebGL2 context. Real browsers default
            // versionless shaders to GLSL 1.0 compatibility mode.
            if (this.canvas) {
                const glArea = this.canvas.getGlArea();
                const es = glArea.get_use_es();
                const usesGlsl1Syntax = /\b(attribute|varying)\b/.test(source);
                // A GLSL1-shaped source must stay GLSL1 even on a WebGL2 context,
                // which is why this does NOT go through `_getGlslVersion` — that
                // one is overridden to answer `300 es` there. It used to inline
                // `'120'`, and desktop GLSL 1.20 is a COMPATIBILITY dialect a core
                // profile rejects outright; `_getGlsl1Version` knows the measured
                // answer for both kinds of desktop context.
                const version = usesGlsl1Syntax ? this._getGlsl1Version(es) : this._getGlslVersion(es);
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
