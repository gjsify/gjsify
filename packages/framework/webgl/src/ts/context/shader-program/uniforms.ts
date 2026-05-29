// WebGL1 uniform setters — scalar (`uniform1f`/`1i`/…/`4f`/`4i`), vector
// (`uniform[1234][fi]v`), and square-matrix (`uniformMatrix[234]fv`) entry
// points — plus the shared location/uniform validation helpers
// (`_checkLocation*`, `_checkUniformValid*`, `_checkUniformMatrix`).
// Same `install*Methods(proto)` shape as the sibling `webgl2-context/uniform.ts`
// split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see ../shader-program.ts pre-split.

import type { WebGLContextBase } from '../../webgl-context-base.js';
import { WebGLUniformLocation } from '../../webgl-uniform-location.js';
import { checkObject, listToArray, uniformTypeSize } from '../../utils.js';

export interface UniformsMethods {
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
    _checkUniformValid(
        location: WebGLUniformLocation | null,
        v0: GLfloat,
        name: string,
        count: number,
        type: string,
    ): boolean;
    _checkUniformValueValid(
        location: WebGLUniformLocation | null,
        value: Float32List | Int32List,
        name: string,
        count: number,
        type: string,
    ): boolean;
    _checkUniformMatrix(
        location: WebGLUniformLocation | null,
        transpose: GLboolean,
        value: Float32List,
        name: string,
        count: number,
    ): boolean;
}

declare module '../shader-program.js' {
    interface ShaderProgramMethods extends UniformsMethods {}
}

const uniformsMethods: UniformsMethods & ThisType<WebGLContextBase> = {
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

    uniform4f(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        x: GLfloat,
        y: GLfloat,
        z: GLfloat,
        w: GLfloat,
    ): void {
        if (!this._checkUniformValid(location, x, 'uniform4f', 4, 'f')) {
            console.error('uniform4f is not valid!');
            return;
        }
        this._gl.uniform4f(location?._ || 0, x, y, z, w);
    },

    uniform4i(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        x: GLint,
        y: GLint,
        z: GLint,
        w: GLint,
    ): void {
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
                    this._gl.uniform2f(loc, v[2 * i], v[2 * i + 1]);
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

    uniformMatrix2fv(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        transpose: GLboolean,
        value: Float32List,
    ): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix2fv', 2)) return;
        const data = new Float32Array(value);
        this._gl.uniformMatrix2fv(location?._ || 0, !!transpose, listToArray(data));
    },

    uniformMatrix3fv(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        transpose: GLboolean,
        value: Float32List,
    ): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix3fv', 3)) return;
        const data = new Float32Array(value);
        this._gl.uniformMatrix3fv(location?._ || 0, !!transpose, listToArray(data));
    },

    uniformMatrix4fv(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        transpose: GLboolean,
        value: Float32List,
    ): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix4fv', 4)) return;
        const data = new Float32Array(value);
        this._gl.uniformMatrix4fv(location?._ || 0, !!transpose, listToArray(data));
    },

    // ─── Internal validation helpers ────────────────────────────────────────

    _checkLocation(this: WebGLContextBase, location: WebGLUniformLocation | null): boolean {
        if (!(location instanceof WebGLUniformLocation)) {
            this.setError(this.INVALID_VALUE);
            return false;
        } else if (location._program._ctx !== this || location._linkCount !== location._program._linkCount) {
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

    _checkUniformValid(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        v0: GLfloat,
        name: string,
        count: number,
        type: string,
    ): boolean {
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

    _checkUniformValueValid(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        value: Float32List | Int32List,
        name: string,
        count: number,
        _type: string,
    ): boolean {
        if (!checkObject(location) || !checkObject(value)) {
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

    _checkUniformMatrix(
        this: WebGLContextBase,
        location: WebGLUniformLocation | null,
        transpose: GLboolean,
        value: Float32List,
        name: string,
        count: number,
    ): boolean {
        if (!checkObject(location) || typeof value !== 'object') {
            throw new TypeError(name + '(WebGLUniformLocation, Boolean, Array)');
        } else if (
            !!transpose ||
            typeof value !== 'object' ||
            value === null ||
            !value.length ||
            (value.length % count) * count !== 0
        ) {
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
};

/** Install uniform setter + validation helper methods on WebGLContextBase.prototype. */
export function installUniformsMethods(proto: object): void {
    Object.assign(proto, uniformsMethods);
}
