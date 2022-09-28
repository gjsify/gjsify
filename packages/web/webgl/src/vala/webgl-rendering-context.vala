
namespace Gwebgl {

    using GLES2;

    public class WebGLRenderingContext: WebGLRenderingContextBase {

        public int width { get; construct; }
        public int height { get; construct; }
        public bool alpha { get; construct; }
        public bool depth { get; construct; }
        public bool stencil { get; construct; }
        public bool antialias { get; construct; }
        public bool premultipliedAlpha { get; construct; }
        public bool preserveDrawingBuffer { get; construct; }
        public bool preferLowPowerToHighPerformance { get; construct; }
        public bool failIfMajorPerformanceCaveat { get; construct; }

        public WebGLRenderingContext(
            int width,
            int height,
            bool alpha,
            bool depth,
            bool stencil,
            bool antialias,
            bool premultipliedAlpha,
            bool preserveDrawingBuffer,
            bool preferLowPowerToHighPerformance,
            bool failIfMajorPerformanceCaveat
        ) {

        }

        construct {

        }

        public void bufferData(GLenum target, ByteArray _data, GLenum usage) {
            var data = _data != null ? _data.data : null;
            var size = _data != null ? _data.len : 0;


            glBufferData(target, size, data, usage);
        }

        public void bufferDataSizeOnly(GLenum target, GLsizeiptr size, GLenum usage) {
            glBufferData(target, size, null, usage);
        }

        public void bufferSubData(GLenum target, long offset, ByteArray _data) {
            var data = _data != null ? _data.data : null;
            var size = _data != null ? _data.len : 0;

            glBufferSubData(target, offset, size, data);
        }

        public void compressedTexImage2D(GLenum target, GLint level, GLenum internalformat, int width, int height, int border, ByteArray _data) {
            var data = _data != null ? _data.data : null;
            var imageSize = (_data != null ? _data.len : 0);

            glCompressedTexImage2D(target, level, internalformat, width, height, border, (GLsizei) imageSize, data);
        }

        public void compressedTexSubImage2D(GLenum target, GLint level, int xoffset, int yoffset, int width, int height, GLenum format, ByteArray _data) {
            var data = _data != null ? _data.data : null;
            var imageSize = (_data != null ? _data.len : 0);

            glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, (GLsizei) imageSize, data);
        }

        public void readPixels(GLint x, GLint y, GLint width, GLint height, GLenum format, GLenum type, ByteArray _pixels) {
            var pixels = _pixels != null ? _pixels.data : null;

            glReadPixels(x, y, width, height, format, type, pixels);
        }

        public void texImage2D(GLenum target, GLint level, GLint internalformat, GLint width, GLint height, GLint border, GLenum format, GLenum type, ByteArray? _pixels)
        {
            var pixels = _pixels != null ? _pixels.data : null;

            glTexImage2D(target, level, internalformat, width, height, border, format, type, pixels);
        }

        public void texImage2DFromPixbuf(GLenum target, GLint level, GLint internalformat, GLenum format, GLenum type, Gdk.Pixbuf source)
        {
            GLint width  = source.get_width();
            GLint height = source.get_height();
            var pixels = source.get_pixels();
            glTexImage2D(target, level, internalformat, width, height, 0, format, type, pixels);
        }

        public void texSubImage2D(GLenum target, GLint level, GLint xoffset, GLint yoffset, GLint width, GLint height, GLenum format, GLenum type, ByteArray _pixels) {
            var pixels = _pixels != null ? _pixels.data : null;
            glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
        }

        public void texSubImage2DFromPixbuf(GLenum target, int level, int xoffset, int yoffset, GLenum format, GLenum type, Gdk.Pixbuf source) {
            int width  = source.get_width();
            int height = source.get_height();
            var pixels = source.get_pixels();

            glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
        }

        public void uniform1fv(/*WebGLUniformLocation*/ int location, int vLength, GLfloat[]? value) {
            
            glUniform1fv(location, vLength, value);
        }

        public void uniform1iv(/*WebGLUniformLocation*/ int location, int vLength, GLint[]? value) {
            glUniform1iv(location, vLength, value);
        }

        public void uniform2fv(/*WebGLUniformLocation*/ int location,int vLength,GLfloat[]? value) {
            glUniform2fv(location, vLength, value);
        }

        public void uniform2iv(/*WebGLUniformLocation*/ int location, int vLength, GLint[]? value) {
            glUniform2iv(location, vLength, value);
        }

        public void uniform3fv(/*WebGLUniformLocation*/ int location, int vLength, GLfloat[]? value) {
            glUniform3fv(location, vLength, value);
        }

        public void uniform3iv(/*WebGLUniformLocation*/ int location, int vLength, GLint[]? value) {
            glUniform3iv(location, vLength, value);
        }

        public void uniform4fv(/*WebGLUniformLocation*/ int location, int vLength, GLfloat[]? value) {
            glUniform4fv(location, vLength, value);
        }

        public void uniform4iv(/*WebGLUniformLocation*/ int location, int vLength, GLint[]? value) {
            glUniform4iv(location, vLength, value);
        }

        public void uniformMatrix2fv(/*WebGLUniformLocation*/ int location, int valueLength, GLboolean transpose, GLfloat[]? value) {
            glUniformMatrix2fv(location, valueLength / 4, transpose, value);
        }

        public void uniformMatrix3fv(/*WebGLUniformLocation*/ int location, int valueLength, GLboolean transpose, GLfloat[]? value) {
            glUniformMatrix3fv(location, valueLength / 9, transpose, value);
        }

        public void uniformMatrix4fv(/*WebGLUniformLocation*/ int location, int valueLength, GLboolean transpose, GLfloat[]? value) {
            glUniformMatrix4fv(location, valueLength / 16, transpose, value);
        }
    
    }
}