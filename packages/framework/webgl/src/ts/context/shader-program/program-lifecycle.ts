// Program object lifecycle (create / delete / use / link / validate / attach /
// detach) + program parameter / info-log readers + the shared `_deleteLinkable`
// helper used by both program and shader deletion. Same `install*Methods(proto)`
// shape as the sibling `webgl2-context/uniform.ts` split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see ../shader-program.ts pre-split.

import type { WebGLContextBase } from '../../webgl-context-base.js';
import { WebGLProgram } from '../../webgl-program.js';
import { WebGLShader } from '../../webgl-shader.js';
import { checkObject, isValidString } from '../../utils.js';

// Defined by the WebGL spec
const MAX_UNIFORM_LENGTH = 256;
const MAX_ATTRIBUTE_LENGTH = 256;

export interface ProgramLifecycleMethods {
    createProgram(): WebGLProgram | null;
    deleteProgram(program: WebGLProgram | null): void;
    useProgram(program: WebGLProgram): void;
    linkProgram(program: WebGLProgram): void;
    validateProgram(program: WebGLProgram): void;
    attachShader(program: WebGLProgram, shader: WebGLShader): void;
    detachShader(program: WebGLProgram, shader: WebGLShader): void;
    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void;
    getAttachedShaders(program: WebGLProgram): WebGLShader[] | null;
    getProgramInfoLog(program: WebGLProgram): string | null;
    getProgramParameter(program: WebGLProgram, pname?: GLenum): unknown;
    _switchActiveProgram(active: WebGLProgram | null): void;
    _fixupLink(program: WebGLProgram): boolean;
    _deleteLinkable(name: 'deleteProgram', object: WebGLProgram | null, Type: typeof WebGLProgram): void;
    _deleteLinkable(name: 'deleteShader', object: WebGLShader | null, Type: typeof WebGLShader): void;
}

declare module '../shader-program.js' {
    interface ShaderProgramMethods extends ProgramLifecycleMethods {}
}

const programLifecycleMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
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

    attachShader(this: WebGLContextBase, program: WebGLProgram, shader: WebGLShader): void {
        if (!checkObject(program) || !checkObject(shader)) {
            throw new TypeError('attachShader(WebGLProgram, WebGLShader)');
        }
        if (!program || !shader) {
            this.setError(this.INVALID_VALUE);
            return;
        } else if (
            program instanceof WebGLProgram &&
            shader instanceof WebGLShader &&
            this._checkOwns(program) &&
            this._checkOwns(shader)
        ) {
            if (!program._linked(shader)) {
                this._saveError();
                this._gl.attachShader(program._ | 0, shader._ | 0);
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
        if (!checkObject(program) || !checkObject(shader)) {
            throw new TypeError('detachShader(WebGLProgram, WebGLShader)');
        }
        if (this._checkWrapper(program, WebGLProgram) && this._checkWrapper(shader, WebGLShader)) {
            if (program._linked(shader)) {
                this._gl.detachShader(program._, shader._);
                program._unlink(shader);
            } else {
                this.setError(this.INVALID_OPERATION);
            }
        }
    },

    bindAttribLocation(this: WebGLContextBase, program: WebGLProgram, index: GLuint, name: string): void {
        if (!checkObject(program) || typeof name !== 'string') {
            throw new TypeError('bindAttribLocation(WebGLProgram, GLint, String)');
        }
        name += '';
        if (!isValidString(name) || name.length > MAX_ATTRIBUTE_LENGTH) {
            this.setError(this.INVALID_VALUE);
        } else if (/^_?webgl_a/.test(name)) {
            this.setError(this.INVALID_OPERATION);
        } else if (this._checkWrapper(program, WebGLProgram)) {
            this._gl.bindAttribLocation(program._ | 0, index | 0, name);
        }
    },

    getAttachedShaders(this: WebGLContextBase, program: WebGLProgram): WebGLShader[] | null {
        if (
            !checkObject(program) ||
            (typeof program === 'object' && program !== null && !(program instanceof WebGLProgram))
        ) {
            throw new TypeError('getAttachedShaders(WebGLProgram)');
        }
        if (!program) {
            this.setError(this.INVALID_VALUE);
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return program._references.filter((r) => r instanceof WebGLShader) as WebGLShader[];
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
                    return program._linkStatus
                        ? program._attributes.length
                        : this._gl.getProgramParameter(program._, pname);
                case this.ACTIVE_UNIFORMS:
                    return program._linkStatus
                        ? program._uniforms.length
                        : this._gl.getProgramParameter(program._, pname);
            }
            this.setError(this.INVALID_ENUM);
        }
        return null;
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
        const names: string[] = Array.from({ length: numAttribs });
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
            this._gl.bindAttribLocation(program._ | 0, program._attributes[i], names[i]);
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

    _deleteLinkable(
        this: WebGLContextBase,
        name: string,
        object: WebGLProgram | WebGLShader | null,
        Type: typeof WebGLProgram | typeof WebGLShader,
    ): void {
        if (!checkObject(object)) {
            throw new TypeError(name + '(' + Type.name + ')');
        }
        if (object instanceof Type && this._checkOwns(object)) {
            object._pendingDelete = true;
            object._checkDelete();
            return;
        }
        this.setError(this.INVALID_OPERATION);
    },
};

/** Install program-object lifecycle methods on WebGLContextBase.prototype. */
export function installProgramLifecycleMethods(proto: object): void {
    Object.assign(proto, programLifecycleMethods);
}
