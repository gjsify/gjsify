import { GjsifyWebGLRenderingContextBase } from './webgl-rendering-context-base.js';

export class GjsifyWebGLRenderingContext extends GjsifyWebGLRenderingContextBase implements WebGLRenderingContext {
    bufferData(target: GLenum, size: GLsizeiptr, usage: GLenum): void;
    bufferData(target: GLenum, data: BufferSource | null, usage: GLenum): void;
    bufferData(target: GLenum, dataOrSize: GLsizeiptr | BufferSource | null, usage: GLenum): void {
        let size = 0;
        let data: BufferSource | null = null;
        if(typeof dataOrSize === 'number') {
            size = dataOrSize;
        } else if(dataOrSize && typeof dataOrSize === 'object') {
            data = dataOrSize;
        }

        if(!data) {
            return super.bufferDataSizeOnly(target, size, usage);
        }

        
    }
    bufferSubData(target: GLenum, offset: GLintptr, data: BufferSource): void {

    }
    compressedTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: ArrayBufferView): void {

    }
    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: ArrayBufferView): void {

    }
    readPixels(x: GLint, y: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void {

    }
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void ;
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, formatOrWidth: GLenum | GLsizei, typeOrHeight: GLenum | GLsizei, sourceOrBorder: TexImageSource | GLint, format?: GLenum, type?: GLenum, pixels?: ArrayBufferView | null): void {

    }
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, formatOrWidth: GLenum | GLsizei, typeOrHeight: GLenum | GLsizei, sourceOrFormat: TexImageSource | GLenum, type?: GLenum, pixels?: ArrayBufferView | null): void {

    }
    uniform1fv(location: WebGLUniformLocation | null, v: Float32List): void {

    }
    uniform1iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniform2fv(location: WebGLUniformLocation | null, v: Float32List): void {

    }
    uniform2iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniform3fv(location: WebGLUniformLocation | null, v: Float32List): void {

    }
    uniform3iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniform4fv(location: WebGLUniformLocation | null, v: Float32List): void {

    }
    uniform4iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniformMatrix2fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {

    }
    uniformMatrix3fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {

    }
    uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {

    }
}