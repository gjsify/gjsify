// Program introspection — active-attribute / active-uniform metadata, attribute
// + uniform location lookup, and `getUniform` value readback. Same
// `install*Methods(proto)` shape as the sibling `webgl2-context/uniform.ts`
// split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see ../shader-program.ts pre-split.

import type { WebGLContextBase } from '../../webgl-context-base.js';
import { WebGLActiveInfo } from '../../webgl-active-info.js';
import { WebGLProgram } from '../../webgl-program.js';
import { WebGLUniformLocation } from '../../webgl-uniform-location.js';
import { checkObject, checkUniform, isValidString } from '../../utils.js';

// Defined by the WebGL spec
const MAX_ATTRIBUTE_LENGTH = 256;

export interface IntrospectionMethods {
    getActiveAttrib(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;
    getActiveUniform(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;
    getAttribLocation(program: WebGLProgram, name: string): GLint;
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): unknown;
    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
}

declare module '../shader-program.js' {
    interface ShaderProgramMethods extends IntrospectionMethods {}
}

const introspectionMethods: IntrospectionMethods & ThisType<WebGLContextBase> = {
    getActiveAttrib(this: WebGLContextBase, program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        if (!checkObject(program)) {
            throw new TypeError('getActiveAttrib(WebGLProgram)');
        } else if (!program) {
            throw new TypeError('getActiveAttrib(WebGLProgram, GLuint)');
        } else if (this._checkWrapper(program, WebGLProgram)) {
            const maxCount = program._linkStatus
                ? program._attributes.length
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
            const maxCount = program._linkStatus
                ? program._uniforms.length
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
        if (!checkObject(program) || !checkObject(location)) {
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

                const result = new WebGLUniformLocation(loc, program, info);

                // Distinguish three cases for array uniforms, where info.name
                // is always 'basename[0]' (per OpenGL spec for arrays):
                //   A. caller passed bare 'basename'  -> whole-array write -> populate _array
                //   B. caller passed 'basename[0]'    -> whole-array write -> populate _array
                //   C. caller passed 'basename[N>0]'  -> single-element write -> validate offset, no _array
                // Scalar uniforms (info.name has no '[0]') fall through without either.
                const callerBracketMatch = name.match(/\[(\d+)\]$/);
                const callerIndex = callerBracketMatch ? +callerBracketMatch[1] : -1;
                const infoIsArray = info.name.endsWith('[0]');

                if (infoIsArray && (callerIndex === -1 || callerIndex === 0)) {
                    // Cases A + B: populate full _array so uniform1fv/uniform1iv
                    // writes to all elements via the per-element locations.
                    const baseName = info.name.replace(/\[0\]$/, '');
                    const arrayLocs: number[] = [];
                    this._saveError();
                    for (let i = 0; this.getError() === this.NO_ERROR; ++i) {
                        const xloc = this._gl.getUniformLocation(program._ | 0, baseName + '[' + i + ']');
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
};

/** Install program-introspection methods on WebGLContextBase.prototype. */
export function installIntrospectionMethods(proto: object): void {
    Object.assign(proto, introspectionMethods);
}
