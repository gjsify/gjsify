
namespace Gwebgl {

    using GL;

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

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L2095
        //  public Variant extWEBGL_draw_buffers() {
        //      var builder = new VariantBuilder(new VariantType("a{si}"));
        //      // TODO:
        //      builder.add ("{si}", "COLOR_ATTACHMENT0_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT0_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT1_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT1_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT2_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT2_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT3_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT3_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT4_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT4_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT5_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT5_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT6_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT6_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT7_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT7_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT8_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT8_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT9_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT9_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT10_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT10_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT11_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT11_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT12_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT12_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT13_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT13_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT14_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT14_EXT));
        //      builder.add ("{si}", "COLOR_ATTACHMENT15_WEBGL", new Variant.int32(GL_COLOR_ATTACHMENT15_EXT));

        //      builder.add ("{si}", "DRAW_BUFFER0_WEBGL", new Variant.int32(GL_DRAW_BUFFER0_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER1_WEBGL", new Variant.int32(GL_DRAW_BUFFER1_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER2_WEBGL", new Variant.int32(GL_DRAW_BUFFER2_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER3_WEBGL", new Variant.int32(GL_DRAW_BUFFER3_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER4_WEBGL", new Variant.int32(GL_DRAW_BUFFER4_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER5_WEBGL", new Variant.int32(GL_DRAW_BUFFER5_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER6_WEBGL", new Variant.int32(GL_DRAW_BUFFER6_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER7_WEBGL", new Variant.int32(GL_DRAW_BUFFER7_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER8_WEBGL", new Variant.int32(GL_DRAW_BUFFER8_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER9_WEBGL", new Variant.int32(GL_DRAW_BUFFER9_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER10_WEBGL", new Variant.int32(GL_DRAW_BUFFER10_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER11_WEBGL", new Variant.int32(GL_DRAW_BUFFER11_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER12_WEBGL", new Variant.int32(GL_DRAW_BUFFER12_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER13_WEBGL", new Variant.int32(GL_DRAW_BUFFER13_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER14_WEBGL", new Variant.int32(GL_DRAW_BUFFER14_EXT));
        //      builder.add ("{si}", "DRAW_BUFFER15_WEBGL", new Variant.int32(GL_DRAW_BUFFER15_EXT));

        //      builder.add ("{si}", "MAX_COLOR_ATTACHMENTS_WEBGL", new Variant.int32(GL_MAX_COLOR_ATTACHMENTS_EXT));
        //      builder.add ("{si}", "MAX_DRAW_BUFFERS_WEBGL", new Variant.int32(GL_MAX_DRAW_BUFFERS_EXT));

        //      Variant result = builder.end();
        //      return result;
        //  }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L2079
        //  public void drawBuffersWEBGL(ByteArray buffersArray) {
        //      // TODO:
        //      GLuint numBuffers = buffersArray.len;
        //      GLenum[] buffers = new GLenum[numBuffers];
        //      glDrawBuffersEXT(numBuffers, buffersArray.data);
        //  }

        public void bufferData(int target, ByteArray *_data, int usage) {
            var data = _data != null ? _data->data : null;
            var size = _data != null ? _data->len : 0;

            glBufferData(target, size, (GL.GLvoid[]) data, usage);
        }

        public void bufferDataSizeOnly(int target, GLsizeiptr size, int usage) {
            glBufferData(target, size, null, usage);
        }

        public void bufferSubData(int target, long offset, ByteArray *_data) {
            var data = _data != null ? _data->data : null;
            var size = _data != null ? _data->len : 0;

            glBufferSubData(target, offset, size, (GL.GLvoid[]) data);
        }

        public void compressedTexImage2D(int target, int level, GLenum internalFormat, int width, int height, int border, ByteArray *_data) {
            var data = _data != null ? _data->data : null;
            var imageSize = (_data != null ? _data->len : 0);

            glCompressedTexImage2D(target, level, internalFormat, width, height, border, (GLsizei) imageSize, (GL.GLvoid[]) data);
        }

        public void compressedTexSubImage2D(int target, int level, int xoffset, int yoffset, int width, int height, int format, ByteArray *_data) {
            var data = _data != null ? _data->data : null;
            var imageSize = (_data != null ? _data->len : 0);

            glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, (GLsizei) imageSize, (GL.GLvoid[]) data);
        }

        public uint8[] readPixels(int x, int y, int width, int height, int format, int type, ByteArray *_pixels) {
            uint8[] pixels = _pixels != null ? _pixels->data : null;

            glReadPixels(x, y, width, height, format, type, (GL.GLvoid[]) pixels);
            return pixels;
        }

        public void texImage2D(int target, int level, int internalFormat, int width, int height, GLint border, int format, int type, ByteArray *_pixels)
        {
            var pixels = _pixels != null ? _pixels->data : null;

            glTexImage2D(target, level, internalFormat, width, height, border, format, type, (GL.GLvoid[]) pixels);
        }

        public void texImage2DFromPixbuf(int target, int level, int internalFormat, int format, int type, Gdk.Pixbuf *source)
        {
            int width  = source->get_width();
            int height = source->get_height();
            var pixels = source->get_pixels();
            glTexImage2D(target, level, internalFormat, width, height, 0, format, type, (GL.GLvoid[]) pixels);
        }

        public void texSubImage2D(int target, int level, int xoffset, int yoffset, int width, int height, int format, int type, ByteArray *_pixels) {
            var pixels = _pixels != null ? _pixels->data : null;
            glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, (GL.GLvoid[]) pixels);
        }

        public void texSubImage2DFromPixbuf(int target, int level, int xoffset, int yoffset, int format, int type, Gdk.Pixbuf *source) {
            int width  = source->get_width();
            int height = source->get_height();
            var pixels = source->get_pixels();

            glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, (GL.GLvoid[]) pixels);
        }

        public void uniform1fv(/*WebGLUniformLocation*/ int location, int vLength, float[] value) {
            
            glUniform1fv(location, vLength, value);
        }

        public void uniform1iv(/*WebGLUniformLocation*/ int location, int vLength, int[] value) {
            glUniform1iv(location, vLength, value);
        }

        public void uniform2fv(/*WebGLUniformLocation*/ int location, int vLength, float[] value) {
            glUniform2fv(location, vLength, value);
        }

        public void uniform2iv(/*WebGLUniformLocation*/ int location, int vLength, int[] value) {
            glUniform2iv(location, vLength, value);
        }

        public void uniform3fv(/*WebGLUniformLocation*/ int location, int vLength, float[] value) {
            glUniform3fv(location, vLength, value);
        }

        public void uniform3iv(/*WebGLUniformLocation*/ int location, int vLength, int[] value) {
            glUniform3iv(location, vLength, value);
        }

        public void uniform4fv(/*WebGLUniformLocation*/ int location, int vLength, float[] value) {
            glUniform4fv(location, vLength, value);
        }

        public void uniform4iv(/*WebGLUniformLocation*/ int location, int vLength, int[] value) {
            glUniform4iv(location, vLength, value);
        }

        public void uniformMatrix2fv(/*WebGLUniformLocation*/ int location, bool transpose, float[] value) {
            int length = value == null ? 0 : value.length;
            glUniformMatrix2fv(location, length / 4, (uint8) transpose, value);
        }

        public void uniformMatrix3fv(/*WebGLUniformLocation*/ int location, bool transpose, GLfloat[] value) {
            int length = value == null ? 0 : value.length;
            glUniformMatrix3fv(location, length / 9, (uint8) transpose, value);
        }

        public void uniformMatrix4fv(/*WebGLUniformLocation*/ int location, bool transpose, GLfloat[] value) {
            int length = value == null ? 0 : value.length;
            glUniformMatrix4fv(location, length / 16, (uint8) transpose, value);
        }
    }
}