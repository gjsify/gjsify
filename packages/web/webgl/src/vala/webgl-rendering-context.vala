
namespace Gwebgl {

public class WebGLRenderingContext: Object {


    public WebGLRenderingContext() {

    }

    construct {

    }

    public void bufferData(GLES2.GLenum target, ByteArray* _data, GLES2.GLenum usage) {
        var data = _data != null ? (GLES2.GLvoid[]?) _data->data : null;
        var size = _data != null ? _data->len : 0;

        GLES2.glBufferData(target, size, data, usage);
    }

    public void bufferDataSizeOnly(GLES2.GLenum target, GLES2.GLsizeiptr size, GLES2.GLenum usage) {
        GLES2.glBufferData(target, size, null, usage);
    }

    public void bufferSubData(GLES2.GLenum target, long offset, ByteArray* _data) {
        var data = _data != null ? (GLES2.GLvoid[]?) _data->data : null;
        var size = _data != null ? _data->len : 0;

        GLES2.glBufferSubData(target, offset, size, data);
    }

    public void compressedTexImage2D(GLES2.GLenum target, GLES2.GLint level, GLES2.GLenum internalformat, int width, int height, int border, ByteArray* _data) {
        var data = _data != null ? (GLES2.GLvoid[]?) _data->data : null;
        var imageSize = (GLES2.GLsizei) (_data != null ? _data->len : 0);

        GLES2.glCompressedTexImage2D(target, level, internalformat, width, height, border, imageSize, data);
    }

    public void compressedTexSubImage2D(GLES2.GLenum target, GLES2.GLint level, int xoffset, int yoffset, int width, int height, GLES2.GLenum format, ByteArray* _data) {
        var data = _data != null ? (GLES2.GLvoid[]?) _data->data : null;
        var imageSize = (GLES2.GLsizei) (_data != null ? _data->len : 0);

        GLES2.glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data);
    }

    public void readPixels(GLES2.GLint x, GLES2.GLint y, GLES2.GLint width, GLES2.GLint height, GLES2.GLenum format, GLES2.GLenum type, ByteArray* _pixels) {
        var pixels = _pixels != null ? (GLES2.GLvoid[]?) _pixels->data : null;

        GLES2.glReadPixels(x, y, width, height, format, type, pixels);
    }

    public void texImage2D(GLES2.GLenum target, GLES2.GLint level, GLES2.GLint internalformat, GLES2.GLint width, GLES2.GLint height, GLES2.GLint border, GLES2.GLenum format, GLES2.GLenum type, ByteArray *_pixels)
    {
        var pixels = _pixels != null ? (GLES2.GLvoid[]?) _pixels->data : null;

        GLES2.glTexImage2D(target, level, internalformat, width, height, border, format, type, pixels);
    }

    public void texImage2DFromPixbuf(GLES2.GLenum target, GLES2.GLint level, GLES2.GLint internalformat, GLES2.GLenum format, GLES2.GLenum type, Gdk.Pixbuf *source)
    {
        GLES2.GLint width  = source->get_width();
        GLES2.GLint height = source->get_height();
        var pixels = (GLES2.GLvoid[]?) source->get_pixels();
        GLES2.glTexImage2D(target, level, internalformat, width, height, 0, format, type, pixels);
    }

    public void texSubImage2D(
        GLES2.GLenum target,
        GLES2.GLint level,
        GLES2.GLint xoffset,
        GLES2.GLint yoffset,
        GLES2.GLint width,
        GLES2.GLint height,
        GLES2.GLenum format,
        GLES2.GLenum type,
        ByteArray *_pixels)
    {
        var pixels = _pixels != null ? (GLES2.GLvoid[]?) _pixels->data : null;
        GLES2.glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
    }

    public void texSubImage2DFromPixbuf(
        GLES2.GLenum target,
        int level,
        int xoffset,
        int yoffset,
        GLES2.GLenum format,
        GLES2.GLenum type,
        Gdk.Pixbuf *source)
    {
        int width  = source->get_width();
        int height = source->get_height();
        var pixels = (GLES2.GLvoid[]?) source->get_pixels();

        GLES2.glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
    }

    public void uniform1fv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLfloat[]? value)
    {
        
        GLES2.glUniform1fv(location, vLength, value);
    }

    public void uniform1iv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLint[]? value)
    {
        GLES2.glUniform1iv(location, vLength, value);
    }

    public void uniform2fv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLfloat[]? value)
    {
        GLES2.glUniform2fv(location, vLength, value);
    }

    public void uniform2iv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLint[]? value)
    {
        GLES2.glUniform2iv(location, vLength, value);
    }

    public void uniform3fv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLfloat[]? value)
    {
        GLES2.glUniform3fv(location, vLength, value);
    }

    public void uniform3iv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLint[]? value)
    {
        GLES2.glUniform3iv(location, vLength, value);
    }

    public void uniform4fv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLfloat[]? value)
    {
        GLES2.glUniform4fv(location, vLength, value);
    }

    public void uniform4iv(
        GwebglWebGLUniformLocation location,
        int vLength,
        GLES2.GLint[]? value)
    {
        GLES2.glUniform4iv(location, vLength, value);
    }

    public void uniformMatrix2fv(
        GwebglWebGLUniformLocation location,
        int valueLength,
        GLES2.GLboolean transpose,
        GLES2.GLfloat[]? value)
    {
        GLES2.glUniformMatrix2fv(location, valueLength / 4, transpose, value);
    }

    public void uniformMatrix3fv(
        GwebglWebGLUniformLocation location,
        int valueLength,
        GLES2.GLboolean transpose,
        GLES2.GLfloat[]? value)
    {
        GLES2.glUniformMatrix3fv(location, valueLength / 9, transpose, value);
    }

    public void uniformMatrix4fv(
        GwebglWebGLUniformLocation location,
        int valueLength,
        GLES2.GLboolean transpose,
        GLES2.GLfloat[]? value)
    {
        GLES2.glUniformMatrix4fv(location, valueLength / 16, transpose, value);
    }
 
}
}