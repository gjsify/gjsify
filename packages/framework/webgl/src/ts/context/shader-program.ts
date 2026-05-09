// Shader and program lifecycle / uniform / attribute methods for WebGLContextBase.
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1 — original in webgl-context-base.ts.

import tokenize from 'glsl-tokenizer/string';
import type { WebGLContextBase } from '../webgl-context-base.js';
import { WebGLActiveInfo } from '../webgl-active-info.js';
import { WebGLProgram } from '../webgl-program.js';
import { WebGLShader } from '../webgl-shader.js';
import { WebGLShaderPrecisionFormat } from '../webgl-shader-precision-format.js';
import { WebGLUniformLocation } from '../webgl-uniform-location.js';
import { checkObject, checkUniform, isValidString, listToArray, uniformTypeSize } from '../utils.js';

// Defined by the WebGL spec
const MAX_UNIFORM_LENGTH = 256;
const MAX_ATTRIBUTE_LENGTH = 256;

export interface ShaderProgramMethods {
    createShader(type?: GLenum): WebGLShader | null;
    deleteShader(shader: WebGLShader | null): void;
    compileShader(shader: WebGLShader): void;
    shaderSource(shader: WebGLShader, source: string): void;
    getShaderInfoLog(shader: WebGLShader): string | null;
    getShaderParameter(shader: WebGLShader, pname?: GLenum): unknown;
    getShaderPrecisionFormat(shaderType?: GLenum, precisionType?: GLenum): WebGLShaderPrecisionFormat | null;
    getShaderSource(shader: WebGLShader): string | null;
    attachShader(program: WebGLProgram, shader: WebGLShader): void;
    detachShader(program: WebGLProgram, shader: WebGLShader): void;
    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void;
    createProgram(): WebGLProgram | null;
    deleteProgram(program: WebGLProgram | null): void;
    useProgram(program: WebGLProgram): void;
    linkProgram(program: WebGLProgram): void;
    validateProgram(program: WebGLProgram): void;
    getActiveAttrib(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;
    getActiveUniform(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;
    getAttachedShaders(program: WebGLProgram): WebGLShader[] | null;
    getAttribLocation(program: WebGLProgram, name: string): GLint;
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): unknown;
    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
    getProgramInfoLog(program: WebGLProgram): string | null;
    getProgramParameter(program: WebGLProgram, pname?: GLenum): unknown;

    uniform1f(location: WebGLUniformLocation | null, x: GLfloat): void;
    uniform1i(location: WebGLUniformLocation | null, x: GLint): void;
    uniform2f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat): void;
    uniform2i(location: WebGLUniformLocation | null, x: GLint, y: GLint): void;
    uniform3f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat): void;
    uniform3i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint): void;
    uniform4f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void;
    uniform4i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint, w: GLint): void;
    uniform1fv(location: WebGLUniformLocation | null, value: Float32List | Int32List): void;
    uniform1iv(location: WebGLUniformLocation | null, v: Int32List): void;
    uniform2fv(location: WebGLUniformLocation | null, v: Float32List): void;
    uniform2iv(location: WebGLUniformLocation | null, v: Int32List): void;
    uniform3fv(location: WebGLUniformLocation | null, v: Float32List): void;
    uniform3iv(location: WebGLUniformLocation | null, v: Int32List): void;
    uniform4fv(location: WebGLUniformLocation | null, v: Float32List): void;
    uniform4iv(location: WebGLUniformLocation | null, v: Int32List): void;
    uniformMatrix2fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void;
    uniformMatrix3fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void;
    uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void;

    _checkLocation(location: WebGLUniformLocation | null): boolean;
    _checkLocationActive(location: WebGLUniformLocation | null): boolean;
    _checkUniformValid(location: WebGLUniformLocation | null, v0: GLfloat, name: string, count: number, type: string): boolean;
    _checkUniformValueValid(location: WebGLUniformLocation | null, value: Float32List | Int32List, name: string, count: number, type: string): boolean;
    _checkUniformMatrix(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List, name: string, count: number): boolean;
    _checkShaderSource(shader: WebGLShader): boolean;
    _wrapShader(type: GLenum, source: string): string;
    _switchActiveProgram(active: WebGLProgram | null): void;
    _fixupLink(program: WebGLProgram): boolean;
    _deleteLinkable(name: 'deleteProgram', object: WebGLProgram | null, Type: typeof WebGLProgram): void;
    _deleteLinkable(name: 'deleteShader', object: WebGLShader | null, Type: typeof WebGLShader): void;
}

declare module '../webgl-context-base.js' {
    interface WebGLContextBase extends ShaderProgramMethods { }
}

const shaderProgramMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
    createShader(this: WebGLContextBase, type: GLenum = 0): WebGLShader | null {
        if (type !== this.FRAGMENT_SHADER &&
            type !== this.VERTEX_SHADER) {
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
        if (this._checkWrapper(shader, WebGLShader) &&
            this._checkShaderSource(shader)) {
            const prevError = this.getError();
            this._gl.compileShader(shader._ | 0);
            shader._needsRecompile = false;
            const error = this.getError();
            shader._compileStatus = !!this._gl.getShaderParameter(
                shader._ | 0,
                this.COMPILE_STATUS);
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

    getShaderPrecisionFormat(this: WebGLContextBase, shaderType: GLenum = 0, precisionType: GLenum = 0): WebGLShaderPrecisionFormat | null {
        if (!(shaderType === this.FRAGMENT_SHADER ||
            shaderType === this.VERTEX_SHADER) ||
            !(precisionType === this.LOW_FLOAT ||
                precisionType === this.MEDIUM_FLOAT ||
                precisionType === this.HIGH_FLOAT ||
                precisionType === this.LOW_INT ||
                precisionType === this.MEDIUM_INT ||
                precisionType === this.HIGH_INT)) {
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

    attachShader(this: WebGLContextBase, program: WebGLProgram, shader: WebGLShader): void {
        if (!checkObject(program) ||
            !checkObject(shader)) {
            throw new TypeError('attachShader(WebGLProgram, WebGLShader)');
        }
        if (!program || !shader) {
            this.setError(this.INVALID_VALUE);
            return;
        } else if (program instanceof WebGLProgram &&
            shader instanceof WebGLShader &&
            this._checkOwns(program) &&
            this._checkOwns(shader)) {
            if (!program._linked(shader)) {
                this._saveError();
                this._gl.attachShader(
                    program._ | 0,
                    shader._ | 0);
                const error = this.getError();
                this._restoreError(error);
                if (error === this.NO_ERROR) {
                    program._link(shader);
                }
                return;
            }
        }
        this.setError(this.INVALID_OPERATION);
    },

    detachShader(this: WebGLContextBase, program: WebGLProgram, shader: WebGLShader): void {
        if (!checkObject(program) ||
            !checkObject(shader)) {
            throw new TypeError('detachShader(WebGLProgram, WebGLShader)');
        }
        if (this._checkWrapper(program, WebGLProgram) &&
            this._checkWrapper(shader, WebGLShader)) {
            if (program._linked(shader)) {
                this._gl.detachShader(program._, shader._);
                program._unlink(shader);
            } else {
                this.setError(this.INVALID_OPERATION);
            }
        }
    },

    bindAttribLocation(this: WebGLContextBase, program: WebGLProgram, index: GLuint, name: string): void {
        if (!checkObject(program) ||
            typeof name !== 'string') {
            throw new TypeError('bindAttribLocation(WebGLProgram, GLint, String)');
        }
        name += '';
        if (!isValidString(name) || name.length > MAX_ATTRIBUTE_LENGTH) {
            this.setError(this.INVALID_VALUE);
        } else if (/^_?webgl_a/.test(name)) {
            this.setError(this.INVALID_OPERATION);
        } else if (this._checkWrapper(program, WebGLProgram)) {
            this._gl.bindAttribLocation(
                program._ | 0,
                index | 0,
                name);
        }
    },

    createProgram(this: WebGLContextBase): WebGLProgram | null {
        const id = this._gl.createProgram();
        if (id <= 0) return null;
        const webGLProgram = new WebGLProgram(id, this);
        this._programs[id] = webGLProgram;
        return webGLProgram;
    },

    deleteProgram(this: WebGLContextBase, program: WebGLProgram | null): void {
        this._deleteLinkable('deleteProgram', program, WebGLProgram);
    },

    useProgram(this: WebGLContextBase, program: WebGLProgram): void {
        if (!checkObject(program)) {
            throw new TypeError('useProgram(WebGLProgram)');
        } else if (!program) {
            this._switchActiveProgram(this._activeProgram);
            this._activeProgram = null;
            this._gl.useProgram(0);
            return;
        } else if (this._checkWrapper(program, WebGLProgram)) {
            if (this._activeProgram !== program) {
                this._switchActiveProgram(this._activeProgram);
                this._activeProgram = program;
                program._refCount += 1;
            }
            this._gl.useProgram(program._ | 0);
        }
    },

    linkProgram(this: WebGLContextBase, program: WebGLProgram): void {
        if (!checkObject(program)) {
            throw new TypeError('linkProgram(WebGLProgram)');
        }
        if (this._checkWrapper(program, WebGLProgram)) {
            program._linkCount += 1;
            program._attributes = [];
            const prevError = this.getError();
            // Deferred compilation: recompile any shader whose source changed since last compile
            for (const s of program._references) {
                if (s instanceof WebGLShader && s._needsRecompile) {
                    this._gl.compileShader(s._ | 0);
                    s._needsRecompile = false;
                }
            }
            this._gl.linkProgram(program._ | 0);
            const error = this.getError();
            if (error === this.NO_ERROR) {
                program._linkStatus = this._fixupLink(program);
            }
            this.getError();
            this.setError(prevError || error);
        }
    },

    validateProgram(this: WebGLContextBase, program: WebGLProgram): void {
        if (this._checkWrapper(program, WebGLProgram)) {
            this._gl.validateProgram(program._ | 0);
            const error = this.getError();
            if (error === this.NO_ERROR) {
                program._linkInfoLog = this._gl.getProgramInfoLog(program._ | 0);
            }
            this.getError();
            this.setError(error);
        }
    },

    getActiveAttrib(this: WebGLContextBase, program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        if (!checkObject(program)) {
            throw new TypeError('getActiveAttrib(WebGLProgram)');
        } else if (!program) {
            throw new TypeError('getActiveAttrib(WebGLProgram, GLuint)');
        } else if (this._checkWrapper(program, WebGLProgram)) {
            const maxCount = program._linkStatus ? program._attributes.length
                : (this._gl.getProgramParameter(program._ | 0, this.ACTIVE_ATTRIBUTES) as number);
            if (index >= maxCount) {
                // Flush any pending native GL error so that our setError() call is not
                // blocked by the native setError implementation (which is a no-op if a
                // native error is already pending in the queue).
                this._gl.getError();
                this.setError(this.INVALID_VALUE);
                return null;
            }
            const info = this._gl.getActiveAttrib(program._ | 0, index | 0);
            if (info) {
                return new WebGLActiveInfo(info);
            }
        }
        return null;
    },

    getActiveUniform(this: WebGLContextBase, program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        if (!checkObject(program)) {
            throw new TypeError('getActiveUniform(WebGLProgram, GLint)');
        } else if (!program) {
            throw new TypeError('getActiveUniform(WebGLProgram, GLuint)');
        } else if (this._checkWrapper(program, WebGLProgram)) {
            const maxCount = program._linkStatus ? program._uniforms.length
                : (this._gl.getProgramParameter(program._ | 0, this.ACTIVE_UNIFORMS) as number);
            if (index >= maxCount) {
                this.setError(this.INVALID_VALUE);
                return null;
            }
            const info = this._gl.getActiveUniform(program._ | 0, index | 0);
            if (info) {
                return new WebGLActiveInfo(info);
            }
        }
        return null;
    },

    getAttachedShaders(this: WebGLContextBase, program: WebGLProgram): WebGLShader[] | null {
        if (!checkObject(program) ||
            (typeof program === 'object' &&
                program !== null &&
                !(program instanceof WebGLProgram))) {
            throw new TypeError('getAttachedShaders(WebGLProgram)');
        }
        if (!program) {
            this.setError(this.INVALID_VALUE);
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return program._references.filter(r => r instanceof WebGLShader) as WebGLShader[];
        }
        return null;
    },

    getAttribLocation(this: WebGLContextBase, program: WebGLProgram, name: string): GLint {
        if (!checkObject(program)) {
            throw new TypeError('getAttribLocation(WebGLProgram, String)');
        }
        name += '';
        if (!isValidString(name) || name.length > MAX_ATTRIBUTE_LENGTH) {
            this.setError(this.INVALID_VALUE);
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return this._gl.getAttribLocation(program._ | 0, name + '');
        }
        return -1;
    },

    getUniform(this: WebGLContextBase, program: WebGLProgram, location: WebGLUniformLocation): unknown {
        if (!checkObject(program) ||
            !checkObject(location)) {
            throw new TypeError('getUniform(WebGLProgram, WebGLUniformLocation)');
        } else if (!program) {
            this.setError(this.INVALID_VALUE);
            return null;
        } else if (!location) {
            return null;
        } else if (this._checkWrapper(program, WebGLProgram)) {
            if (!checkUniform(program, location)) {
                this.setError(this.INVALID_OPERATION);
                return null;
            }
            const data = this._gl.getUniform(program._ | 0, location._ | 0);
            if (!data) {
                return null;
            }
            switch (location._activeInfo.type) {
                case this.FLOAT:
                    return data[0];
                case this.FLOAT_VEC2:
                    return new Float32Array(data.slice(0, 2));
                case this.FLOAT_VEC3:
                    return new Float32Array(data.slice(0, 3));
                case this.FLOAT_VEC4:
                    return new Float32Array(data.slice(0, 4));
                case this.INT:
                    return data[0] | 0;
                case this.INT_VEC2:
                    return new Int32Array(data.slice(0, 2));
                case this.INT_VEC3:
                    return new Int32Array(data.slice(0, 3));
                case this.INT_VEC4:
                    return new Int32Array(data.slice(0, 4));
                case this.BOOL:
                    return !!data[0];
                case this.BOOL_VEC2:
                    return [!!data[0], !!data[1]];
                case this.BOOL_VEC3:
                    return [!!data[0], !!data[1], !!data[2]];
                case this.BOOL_VEC4:
                    return [!!data[0], !!data[1], !!data[2], !!data[3]];
                case this.FLOAT_MAT2:
                    return new Float32Array(data.slice(0, 4));
                case this.FLOAT_MAT3:
                    return new Float32Array(data.slice(0, 9));
                case this.FLOAT_MAT4:
                    return new Float32Array(data.slice(0, 16));
                case this.SAMPLER_2D:
                case this.SAMPLER_CUBE:
                    return data[0] | 0;
                default:
                    return null;
            }
        }
        return null;
    },

    getUniformLocation(this: WebGLContextBase, program: WebGLProgram, name: string): WebGLUniformLocation | null {
        if (!checkObject(program)) {
            throw new TypeError('getUniformLocation(WebGLProgram, String)');
        }

        name += '';
        if (!isValidString(name)) {
            this.setError(this.INVALID_VALUE);
            return null;
        }

        if (this._checkWrapper(program, WebGLProgram)) {
            const loc = this._gl.getUniformLocation(program._ | 0, name);
            if (loc !== null && loc >= 0) {
                let searchName = name;
                if (/\[\d+\]$/.test(name)) {
                    searchName = name.replace(/\[\d+\]$/, '[0]');
                }

                // OpenGL's getActiveUniform returns array uniforms as
                // 'name[0]' (per WebGL + ES spec), so we must match both the
                // exact form and the array-base form when the caller passes
                // the bare name like `getUniformLocation(prog, 'u_textures')`
                // for `uniform sampler2D u_textures[8]`. Without this, valid
                // array uniforms return null — which Excalibur interprets as
                // "uniform doesn't exist or is not used" and throws.
                const arraySearchName = searchName + '[0]';
                let info: { name: string; type: number; size: number } | null = null;
                for (let i = 0; i < program._uniforms.length; ++i) {
                    const infoItem = program._uniforms[i];
                    if (infoItem.name === searchName || infoItem.name === arraySearchName) {
                        info = {
                            size: infoItem.size,
                            type: infoItem.type,
                            name: infoItem.name,
                        };
                        break;
                    }
                }
                if (!info) {
                    // Native GL validated the uniform exists, but _uniforms cache doesn't
                    // have it (e.g. _fixupLink skipped due to pre-existing GL error, or
                    // name format mismatch for custom material programs). Trust native GL.
                    info = { name: searchName, type: 0, size: 1 };
                }

                const result = new WebGLUniformLocation(
                    loc,
                    program,
                    info);

                // Distinguish three cases for array uniforms, where info.name
                // is always 'basename[0]' (per OpenGL spec for arrays):
                //   A. caller passed bare 'basename'  -> whole-array write -> populate _array
                //   B. caller passed 'basename[0]'    -> whole-array write -> populate _array
                //   C. caller passed 'basename[N>0]'  -> single-element write -> validate offset, no _array
                // Scalar uniforms (info.name has no '[0]') fall through without either.
                const callerBracketMatch = name.match(/\[(\d+)\]$/);
                const callerIndex = callerBracketMatch ? +callerBracketMatch[1] : -1;
                const infoIsArray = /\[0\]$/.test(info.name);

                if (infoIsArray && (callerIndex === -1 || callerIndex === 0)) {
                    // Cases A + B: populate full _array so uniform1fv/uniform1iv
                    // writes to all elements via the per-element locations.
                    const baseName = info.name.replace(/\[0\]$/, '');
                    const arrayLocs: number[] = [];
                    this._saveError();
                    for (let i = 0; this.getError() === this.NO_ERROR; ++i) {
                        const xloc = this._gl.getUniformLocation(
                            program._ | 0,
                            baseName + '[' + i + ']');
                        if (this.getError() !== this.NO_ERROR || xloc == null || xloc < 0) {
                            break;
                        }
                        arrayLocs.push(xloc);
                    }
                    this._restoreError(this.NO_ERROR);

                    result._array = arrayLocs;
                } else if (callerIndex > 0) {
                    // Case C: caller wants a specific array element. Validate
                    // that the index is within bounds; the returned location
                    // writes to only that element (no _array).
                    if (callerIndex >= info.size) {
                        return null;
                    }
                }
                return result;
            }
        }
        return null;
    },

    getProgramInfoLog(this: WebGLContextBase, program: WebGLProgram): string | null {
        if (!checkObject(program)) {
            throw new TypeError('getProgramInfoLog(WebGLProgram)');
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return program._linkInfoLog;
        }
        return null;
    },

    getProgramParameter(this: WebGLContextBase, program: WebGLProgram, pname: GLenum = 0): unknown {
        if (!checkObject(program)) {
            throw new TypeError('getProgramParameter(WebGLProgram, GLenum)');
        } else if (this._checkWrapper(program, WebGLProgram)) {
            switch (pname) {
                case this.DELETE_STATUS:
                    return program._pendingDelete;

                case this.LINK_STATUS:
                    return program._linkStatus;

                case this.VALIDATE_STATUS:
                    return !!this._gl.getProgramParameter(program._, pname);

                case this.ATTACHED_SHADERS:
                    return this._gl.getProgramParameter(program._, pname);
                case this.ACTIVE_ATTRIBUTES:
                    return program._linkStatus ? program._attributes.length
                        : this._gl.getProgramParameter(program._, pname);
                case this.ACTIVE_UNIFORMS:
                    return program._linkStatus ? program._uniforms.length
                        : this._gl.getProgramParameter(program._, pname);
            }
            this.setError(this.INVALID_ENUM);
        }
        return null;
    },

    // ─── Uniform setters ───────────────────────────────────────────────────

    uniform1f(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform1f', 1, 'f')) return;
        this._gl.uniform1f(location?._ || 0, x);
    },

    uniform1i(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLint): void {
        this._gl.uniform1i(location?._ || 0, x);
    },

    uniform2f(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform2f', 2, 'f')) return;
        this._gl.uniform2f(location?._ || 0, x, y);
    },

    uniform2i(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLint, y: GLint): void {
        if (!this._checkUniformValid(location, x, 'uniform2i', 2, 'i')) return;
        this._gl.uniform2i(location?._ || 0, x, y);
    },

    uniform3f(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform3f', 3, 'f')) return;
        this._gl.uniform3f(location?._ || 0, x, y, z);
    },

    uniform3i(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint): void {
        if (!this._checkUniformValid(location, x, 'uniform3i', 3, 'i')) return;
        this._gl.uniform3i(location?._ || 0, x, y, z);
    },

    uniform4f(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform4f', 4, 'f')) {
            console.error('uniform4f is not valid!');
            return;
        }
        this._gl.uniform4f(location?._ || 0, x, y, z, w);
    },

    uniform4i(this: WebGLContextBase, location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint, w: GLint): void {
        if (!this._checkUniformValid(location, x, 'uniform4i', 4, 'i')) return;
        this._gl.uniform4i(location?._ || 0, x, y, z, w);
    },

    uniform1fv(this: WebGLContextBase, location: WebGLUniformLocation | null, value: Float32List | Int32List): void {
        if (!location || !this._checkUniformValueValid(location, value, 'uniform1fv', 1, 'f')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && i < value.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform1f(loc, value[i]);
                }
            }
            return;
        }
        this._gl.uniform1f(location?._ | 0, value[0]);
    },

    uniform1iv(this: WebGLContextBase, location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform1iv', 1, 'i')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && i < v.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform1i(loc, v[i]);
                }
            }
            return;
        }
        this.uniform1i(location, v[0]);
    },

    uniform2fv(this: WebGLContextBase, location: WebGLUniformLocation | null, v: Float32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform2fv', 2, 'f')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && 2 * i < v.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform2f(loc, v[2 * i], v[(2 * i) + 1]);
                }
            }
            return;
        }
        this._gl.uniform2f(location?._ || 0, v[0], v[1]);
    },

    uniform2iv(this: WebGLContextBase, location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform2iv', 2, 'i')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && 2 * i < v.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform2i(loc, v[2 * i], v[2 * i + 1]);
                }
            }
            return;
        }
        this.uniform2i(location, v[0], v[1]);
    },

    uniform3fv(this: WebGLContextBase, location: WebGLUniformLocation | null, v: Float32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform3fv', 3, 'f')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && 3 * i < v.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform3f(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2]);
                }
            }
            return;
        }
        this._gl.uniform3f(location?._ || 0, v[0], v[1], v[2]);
    },

    uniform3iv(this: WebGLContextBase, location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform3iv', 3, 'i')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && 3 * i < v.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform3i(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2]);
                }
            }
            return;
        }
        this.uniform3i(location, v[0], v[1], v[2]);
    },

    uniform4fv(this: WebGLContextBase, location: WebGLUniformLocation | null, v: Float32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform4fv', 4, 'f')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && 4 * i < v.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform4f(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3]);
                }
            }
            return;
        }
        this._gl.uniform4f(location?._ || 0, v[0], v[1], v[2], v[3]);
    },

    uniform4iv(this: WebGLContextBase, location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform4iv', 4, 'i')) return;
        if (location?._array) {
            const locs = location._array;
            for (let i = 0; i < locs.length && 4 * i < v.length; ++i) {
                const loc = locs[i];
                if (loc != null) {
                    this._gl.uniform4i(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3]);
                }
            }
            return;
        }
        this.uniform4i(location, v[0], v[1], v[2], v[3]);
    },

    uniformMatrix2fv(this: WebGLContextBase, location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix2fv', 2)) return;
        const data = new Float32Array(value);
        this._gl.uniformMatrix2fv(
            location?._ || 0,
            !!transpose,
            listToArray(data));
    },

    uniformMatrix3fv(this: WebGLContextBase, location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix3fv', 3)) return;
        const data = new Float32Array(value);
        this._gl.uniformMatrix3fv(
            location?._ || 0,
            !!transpose,
            listToArray(data));
    },

    uniformMatrix4fv(this: WebGLContextBase, location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix4fv', 4)) return;
        const data = new Float32Array(value);
        this._gl.uniformMatrix4fv(
            location?._ || 0,
            !!transpose,
            listToArray(data));
    },

    // ─── Internal validation helpers ────────────────────────────────────────

    _checkLocation(this: WebGLContextBase, location: WebGLUniformLocation | null): boolean {
        if (!(location instanceof WebGLUniformLocation)) {
            this.setError(this.INVALID_VALUE);
            return false;
        } else if (location._program._ctx !== this ||
            location._linkCount !== location._program._linkCount) {
            this.setError(this.INVALID_OPERATION);
            return false;
        }
        return true;
    },

    _checkLocationActive(this: WebGLContextBase, location: WebGLUniformLocation | null): boolean {
        if (!location) {
            return false;
        } else if (!this._checkLocation(location)) {
            return false;
        } else if (location._program !== this._activeProgram) {
            this.setError(this.INVALID_OPERATION);
            return false;
        }
        return true;
    },

    _checkUniformValid(this: WebGLContextBase, location: WebGLUniformLocation | null, v0: GLfloat, name: string, count: number, type: string): boolean {
        if (!checkObject(location)) {
            throw new TypeError(`${name}(WebGLUniformLocation, ...)`);
        } else if (!location) {
            return false;
        } else if (this._checkLocationActive(location)) {
            const utype = location._activeInfo.type;
            if (utype === this.SAMPLER_2D || utype === this.SAMPLER_CUBE) {
                if (count !== 1) {
                    this.setError(this.INVALID_VALUE);
                    return false;
                }
                if (type !== 'i') {
                    this.setError(this.INVALID_OPERATION);
                    return false;
                }
                if (v0 < 0 || v0 >= this._textureUnits.length) {
                    this.setError(this.INVALID_VALUE);
                    return false;
                }
            }
            if (uniformTypeSize(this, utype) > count) {
                this.setError(this.INVALID_OPERATION);
                return false;
            }
            return true;
        }
        return false;
    },

    _checkUniformValueValid(this: WebGLContextBase, location: WebGLUniformLocation | null, value: Float32List | Int32List, name: string, count: number, _type: string): boolean {
        if (!checkObject(location) ||
            !checkObject(value)) {
            throw new TypeError(`${name}v(WebGLUniformLocation, Array)`);
        } else if (!location) {
            return false;
        } else if (!this._checkLocationActive(location)) {
            return false;
        } else if (typeof value !== 'object' || !value || typeof value.length !== 'number') {
            throw new TypeError(`Second argument to ${name} must be array`);
        } else if (uniformTypeSize(this, location._activeInfo.type) > count) {
            this.setError(this.INVALID_OPERATION);
            return false;
        } else if (value.length >= count && value.length % count === 0) {
            if (location._array) {
                return true;
            } else if (value.length === count) {
                return true;
            } else {
                this.setError(this.INVALID_OPERATION);
                return false;
            }
        }
        this.setError(this.INVALID_VALUE);
        return false;
    },

    _checkUniformMatrix(this: WebGLContextBase, location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List, name: string, count: number): boolean {
        if (!checkObject(location) ||
            typeof value !== 'object') {
            throw new TypeError(name + '(WebGLUniformLocation, Boolean, Array)');
        } else if (!!transpose ||
            typeof value !== 'object' ||
            value === null ||
            !value.length ||
            value.length % count * count !== 0) {
            this.setError(this.INVALID_VALUE);
            return false;
        }
        if (!location) {
            return false;
        }
        if (!this._checkLocationActive(location)) {
            return false;
        }

        if (value.length === count * count) {
            return true;
        } else if (location._array) {
            return true;
        }
        this.setError(this.INVALID_VALUE);
        return false;
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
                        errorLog.push(tok.line + ':' + tok.column +
                            ' invalid identifier - ' + tok.data);
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
                                errorLog.push(tok.line + ':' + btok.column +
                                    ' invalid identifier - ' + btok.data);
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
                const version = usesGlsl1Syntax
                    ? (es ? '100' : '120')
                    : this._getGlslVersion(es);
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

    _switchActiveProgram(this: WebGLContextBase, active: WebGLProgram | null): void {
        if (active) {
            active._refCount -= 1;
            active._checkDelete();
        }
    },

    _fixupLink(this: WebGLContextBase, program: WebGLProgram): boolean {
        if (!this._gl.getProgramParameter(program._, this.LINK_STATUS)) {
            program._linkInfoLog = this._gl.getProgramInfoLog(program._);
            return false;
        }

        // Record attribute attributeLocations
        const numAttribs = this.getProgramParameter(program, this.ACTIVE_ATTRIBUTES) as number;
        const names: string[] = new Array(numAttribs);
        program._attributes.length = numAttribs;
        for (let i = 0; i < numAttribs; ++i) {
            names[i] = this.getActiveAttrib(program, i)?.name;
            program._attributes[i] = this.getAttribLocation(program, names[i]) | 0;
        }

        // Check attribute names
        for (let i = 0; i < names.length; ++i) {
            if (names[i].length > MAX_ATTRIBUTE_LENGTH) {
                program._linkInfoLog = 'attribute ' + names[i] + ' is too long';
                return false;
            }
        }

        for (let i = 0; i < numAttribs; ++i) {
            if (program._attributes[i] < 0) continue;
            this._gl.bindAttribLocation(
                program._ | 0,
                program._attributes[i],
                names[i]);
        }

        this._gl.linkProgram(program._ | 0);

        // The second link (after rebinding attributes) may fail independently.
        if (!this._gl.getProgramParameter(program._ | 0, this.LINK_STATUS)) {
            program._linkInfoLog = this._gl.getProgramInfoLog(program._);
            return false;
        }

        const numUniforms = this.getProgramParameter(program, this.ACTIVE_UNIFORMS) as number;
        program._uniforms.length = numUniforms;
        for (let i = 0; i < numUniforms; ++i) {
            const info = this.getActiveUniform(program, i);
            if (info) program._uniforms[i] = info;
        }

        // Check attribute and uniform name lengths
        for (let i = 0; i < program._uniforms.length; ++i) {
            if (program._uniforms[i].name.length > MAX_UNIFORM_LENGTH) {
                program._linkInfoLog = 'uniform ' + program._uniforms[i].name + ' is too long';
                return false;
            }
        }

        program._linkInfoLog = '';
        return true;
    },

    _deleteLinkable(this: WebGLContextBase, name: string, object: WebGLProgram | WebGLShader | null, Type: typeof WebGLProgram | typeof WebGLShader): void {
        if (!checkObject(object)) {
            throw new TypeError(name + '(' + Type.name + ')');
        }
        if (object instanceof Type &&
            this._checkOwns(object)) {
            object._pendingDelete = true;
            object._checkDelete();
            return;
        }
        this.setError(this.INVALID_OPERATION);
    },
};

/** Install shader/program methods on the given prototype. Called from webgl-context-base.ts. */
export function installShaderProgramMethods(proto: object): void {
    Object.assign(proto, shaderProgramMethods);
}
