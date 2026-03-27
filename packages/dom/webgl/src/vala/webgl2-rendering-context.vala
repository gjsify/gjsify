// WebGL2 native context for GJS — original implementation using libepoxy (OpenGL ES 3.0)
// Reference: refs/headless-gl/src/native/webgl.cc, refs/headless-gl/src/native/bindings.cc

namespace Gwebgl {

    using GL;

    public class WebGL2RenderingContext: WebGLRenderingContextBase {

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

        // Sync object store: maps uint IDs → pointer values (GLsync is an opaque C pointer)
        private HashTable<uint, ulong> _sync_ptrs = new HashTable<uint, ulong> (null, null);
        private uint _sync_counter = 0;

        public WebGL2RenderingContext(
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

        // ─── Helpers (shared with WebGL1 context) ────────────────────────────

        private bool isVariantOfByteArray(Variant variant) {
            return variant.get_type().equal(new GLib.VariantType("ay"));
        }

        // ─── Vertex Array Objects ─────────────────────────────────────────────

        public uint createVertexArray() {
            GL.GLuint[] ids = new GL.GLuint[1];
            glGenVertexArrays(1, ids);
            return (uint) ids[0];
        }

        public void deleteVertexArray(uint vao) {
            GL.GLuint[] ids = { (GL.GLuint) vao };
            glDeleteVertexArrays(1, ids);
        }

        public bool isVertexArray(uint vao) {
            return (bool) glIsVertexArray((GL.GLuint) vao);
        }

        public void bindVertexArray(uint vao) {
            glBindVertexArray((GL.GLuint) vao);
        }

        // ─── Query Objects ────────────────────────────────────────────────────

        public uint createQuery() {
            GL.GLuint[] ids = new GL.GLuint[1];
            glGenQueries(1, ids);
            return (uint) ids[0];
        }

        public void deleteQuery(uint query) {
            GL.GLuint[] ids = { (GL.GLuint) query };
            glDeleteQueries(1, ids);
        }

        public bool isQuery(uint query) {
            return (bool) glIsQuery((GL.GLuint) query);
        }

        public void beginQuery(int target, uint query) {
            glBeginQuery((GL.GLenum) target, (GL.GLuint) query);
        }

        public void endQuery(int target) {
            glEndQuery((GL.GLenum) target);
        }

        public int getQueryParameter(uint query, int pname) {
            GL.GLuint[] result = new GL.GLuint[1];
            glGetQueryObjectuiv((GL.GLuint) query, (GL.GLenum) pname, result);
            return (int) result[0];
        }

        // ─── Sampler Objects ──────────────────────────────────────────────────

        public uint createSampler() {
            GL.GLuint[] ids = new GL.GLuint[1];
            glGenSamplers(1, ids);
            return (uint) ids[0];
        }

        public void deleteSampler(uint sampler) {
            GL.GLuint[] ids = { (GL.GLuint) sampler };
            glDeleteSamplers(1, ids);
        }

        public bool isSampler(uint sampler) {
            return (bool) glIsSampler((GL.GLuint) sampler);
        }

        public void bindSampler(uint unit, uint sampler) {
            glBindSampler((GL.GLuint) unit, (GL.GLuint) sampler);
        }

        public void samplerParameteri(uint sampler, int pname, int param) {
            glSamplerParameteri((GL.GLuint) sampler, (GL.GLenum) pname, (GL.GLint) param);
        }

        public void samplerParameterf(uint sampler, int pname, float param) {
            glSamplerParameterf((GL.GLuint) sampler, (GL.GLenum) pname, (GL.GLfloat) param);
        }

        public float getSamplerParameterf(uint sampler, int pname) {
            GL.GLfloat[] result = new GL.GLfloat[1];
            glGetSamplerParameterfv((GL.GLuint) sampler, (GL.GLenum) pname, result);
            return (float) result[0];
        }

        public int getSamplerParameteri(uint sampler, int pname) {
            GL.GLint[] result = new GL.GLint[1];
            glGetSamplerParameteriv((GL.GLuint) sampler, (GL.GLenum) pname, result);
            return (int) result[0];
        }

        // ─── Sync Objects ─────────────────────────────────────────────────────

        public uint fenceSync(int condition, int flags) {
            var sync = glFenceSync((GL.GLenum) condition, (GL.GLbitfield) flags);
            var id = ++_sync_counter;
            _sync_ptrs.insert(id, (ulong) (void*) sync);
            return id;
        }

        public bool isSync(uint syncId) {
            if (!_sync_ptrs.contains(syncId)) return false;
            unowned GL.GLsync sync = (GL.GLsync) (void*) _sync_ptrs.lookup(syncId);
            return (bool) glIsSync(sync);
        }

        public void deleteSync(uint syncId) {
            if (!_sync_ptrs.contains(syncId)) return;
            unowned GL.GLsync sync = (GL.GLsync) (void*) _sync_ptrs.lookup(syncId);
            glDeleteSync(sync);
            _sync_ptrs.remove(syncId);
        }

        public int clientWaitSync(uint syncId, int flags, uint64 timeout) {
            if (!_sync_ptrs.contains(syncId)) return 0x911C; // GL_WAIT_FAILED
            unowned GL.GLsync sync = (GL.GLsync) (void*) _sync_ptrs.lookup(syncId);
            return (int) glClientWaitSync(sync, (GL.GLbitfield) flags, (GL.GLuint64) timeout);
        }

        public void waitSync(uint syncId, int flags, uint64 timeout) {
            if (!_sync_ptrs.contains(syncId)) return;
            unowned GL.GLsync sync = (GL.GLsync) (void*) _sync_ptrs.lookup(syncId);
            glWaitSync(sync, (GL.GLbitfield) flags, (GL.GLuint64) timeout);
        }

        public int getSyncParameter(uint syncId, int pname) {
            if (!_sync_ptrs.contains(syncId)) return 0;
            unowned GL.GLsync sync = (GL.GLsync) (void*) _sync_ptrs.lookup(syncId);
            GL.GLsizei[] length = new GL.GLsizei[1];
            GL.GLint[] values = new GL.GLint[1];
            glGetSynciv(sync, (GL.GLenum) pname, 1, length, values);
            return (int) values[0];
        }

        // ─── Transform Feedback ───────────────────────────────────────────────

        public uint createTransformFeedback() {
            GL.GLuint[] ids = new GL.GLuint[1];
            glGenTransformFeedbacks(1, ids);
            return (uint) ids[0];
        }

        public void deleteTransformFeedback(uint tf) {
            GL.GLuint[] ids = { (GL.GLuint) tf };
            glDeleteTransformFeedbacks(1, ids);
        }

        public bool isTransformFeedback(uint tf) {
            return (bool) glIsTransformFeedback((GL.GLuint) tf);
        }

        public void bindTransformFeedback(int target, uint tf) {
            glBindTransformFeedback((GL.GLenum) target, (GL.GLuint) tf);
        }

        public void beginTransformFeedback(int primitiveMode) {
            glBeginTransformFeedback((GL.GLenum) primitiveMode);
        }

        public void endTransformFeedback() {
            glEndTransformFeedback();
        }

        public void pauseTransformFeedback() {
            glPauseTransformFeedback();
        }

        public void resumeTransformFeedback() {
            glResumeTransformFeedback();
        }

        public void transformFeedbackVaryings(uint program, string[] varyings, int bufferMode) {
            glTransformFeedbackVaryings((GL.GLuint) program, (GL.GLsizei) varyings.length, varyings, (GL.GLenum) bufferMode);
        }

        public Variant getTransformFeedbackVarying(uint program, uint index) {
            var builder = new VariantBuilder(new VariantType("a{sv}"));
            GL.GLsizei[] length = new GL.GLsizei[1];
            GL.GLsizei[] size = new GL.GLsizei[1];
            GL.GLenum[] type = new GL.GLenum[1];
            GL.GLubyte[] name = new GL.GLubyte[256];
            glGetTransformFeedbackVarying((GL.GLuint) program, (GL.GLuint) index, 256, length, size, type, name);
            string nameStr = ((string) name).substring(0, (int) length[0]);
            builder.add("{sv}", "name", new Variant.string(nameStr));
            builder.add("{sv}", "size", new Variant.int32((int) size[0]));
            builder.add("{sv}", "type", new Variant.int32((int) type[0]));
            return builder.end();
        }

        // ─── Indexed Buffer Binding ───────────────────────────────────────────

        public void bindBufferBase(int target, uint index, uint buffer) {
            glBindBufferBase((GL.GLenum) target, (GL.GLuint) index, (GL.GLuint) buffer);
        }

        public void bindBufferRange(int target, uint index, uint buffer, long offset, long size) {
            glBindBufferRange((GL.GLenum) target, (GL.GLuint) index, (GL.GLuint) buffer, (GL.GLintptr) offset, (GL.GLsizeiptr) size);
        }

        public void copyBufferSubData(int readTarget, int writeTarget, long readOffset, long writeOffset, long size) {
            glCopyBufferSubData((GL.GLenum) readTarget, (GL.GLenum) writeTarget, (GL.GLintptr) readOffset, (GL.GLintptr) writeOffset, (GL.GLsizeiptr) size);
        }

        public uint8[] getBufferSubData(int target, long srcByteOffset, int length) {
            // glGetBufferSubData is desktop GL only (not GLES); use glMapBufferRange instead.
            var ptr = (uint8*) glMapBufferRange((GL.GLenum) target, (GL.GLintptr) srcByteOffset, (GL.GLsizeiptr) length, GL_MAP_READ_BIT);
            var data = new uint8[length];
            if (ptr != null) {
                Memory.copy(data, ptr, length);
                glUnmapBuffer((GL.GLenum) target);
            }
            return data;
        }

        // ─── 3D Textures ──────────────────────────────────────────────────────

        public void texImage3D(int target, int level, int internalFormat, int width, int height, int depth, int border, int format, int type, Variant variant) {
            if (!isVariantOfByteArray(variant)) {
                printerr("[texImage3D] variant type must be 'ay'!");
                return;
            }
            var bytes = variant.get_data_as_bytes();
            glTexImage3D((GL.GLenum) target, (GL.GLint) level, (GL.GLint) internalFormat, (GL.GLsizei) width, (GL.GLsizei) height, (GL.GLsizei) depth, (GL.GLint) border, (GL.GLenum) format, (GL.GLenum) type, (GL.GLvoid[]) bytes.get_data());
        }

        public void texImage3DNull(int target, int level, int internalFormat, int width, int height, int depth, int border, int format, int type) {
            glTexImage3D((GL.GLenum) target, (GL.GLint) level, (GL.GLint) internalFormat, (GL.GLsizei) width, (GL.GLsizei) height, (GL.GLsizei) depth, (GL.GLint) border, (GL.GLenum) format, (GL.GLenum) type, null);
        }

        public void texSubImage3D(int target, int level, int xoffset, int yoffset, int zoffset, int width, int height, int depth, int format, int type, Variant variant) {
            if (!isVariantOfByteArray(variant)) {
                printerr("[texSubImage3D] variant type must be 'ay'!");
                return;
            }
            var bytes = variant.get_data_as_bytes();
            glTexSubImage3D((GL.GLenum) target, (GL.GLint) level, (GL.GLint) xoffset, (GL.GLint) yoffset, (GL.GLint) zoffset, (GL.GLsizei) width, (GL.GLsizei) height, (GL.GLsizei) depth, (GL.GLenum) format, (GL.GLenum) type, (GL.GLvoid[]) bytes.get_data());
        }

        public void compressedTexImage3D(int target, int level, int internalFormat, int width, int height, int depth, int border, Variant variant) {
            if (!isVariantOfByteArray(variant)) {
                printerr("[compressedTexImage3D] variant type must be 'ay'!");
                return;
            }
            var bytes = variant.get_data_as_bytes();
            int imageSize = (int) bytes.get_size();
            glCompressedTexImage3D((GL.GLenum) target, (GL.GLint) level, (GL.GLenum) internalFormat, (GL.GLsizei) width, (GL.GLsizei) height, (GL.GLsizei) depth, (GL.GLint) border, (GL.GLsizei) imageSize, (GL.GLvoid[]) bytes.get_data());
        }

        public void compressedTexSubImage3D(int target, int level, int xoffset, int yoffset, int zoffset, int width, int height, int depth, int format, Variant variant) {
            if (!isVariantOfByteArray(variant)) {
                printerr("[compressedTexSubImage3D] variant type must be 'ay'!");
                return;
            }
            var bytes = variant.get_data_as_bytes();
            int imageSize = (int) bytes.get_size();
            glCompressedTexSubImage3D((GL.GLenum) target, (GL.GLint) level, (GL.GLint) xoffset, (GL.GLint) yoffset, (GL.GLint) zoffset, (GL.GLsizei) width, (GL.GLsizei) height, (GL.GLsizei) depth, (GL.GLenum) format, (GL.GLsizei) imageSize, (GL.GLvoid[]) bytes.get_data());
        }

        public void copyTexSubImage3D(int target, int level, int xoffset, int yoffset, int zoffset, int x, int y, int width, int height) {
            glCopyTexSubImage3D((GL.GLenum) target, (GL.GLint) level, (GL.GLint) xoffset, (GL.GLint) yoffset, (GL.GLint) zoffset, (GL.GLint) x, (GL.GLint) y, (GL.GLsizei) width, (GL.GLsizei) height);
        }

        public void texStorage2D(int target, int levels, int internalFormat, int width, int height) {
            glTexStorage2D((GL.GLenum) target, (GL.GLsizei) levels, (GL.GLenum) internalFormat, (GL.GLsizei) width, (GL.GLsizei) height);
        }

        public void texStorage3D(int target, int levels, int internalFormat, int width, int height, int depth) {
            glTexStorage3D((GL.GLenum) target, (GL.GLsizei) levels, (GL.GLenum) internalFormat, (GL.GLsizei) width, (GL.GLsizei) height, (GL.GLsizei) depth);
        }

        public void framebufferTextureLayer(int target, int attachment, uint texture, int level, int layer) {
            glFramebufferTextureLayer((GL.GLenum) target, (GL.GLenum) attachment, (GL.GLuint) texture, (GL.GLint) level, (GL.GLint) layer);
        }

        // ─── Instancing & Advanced Draw ───────────────────────────────────────

        public void drawArraysInstanced(int mode, int first, int count, int instanceCount) {
            glDrawArraysInstanced((GL.GLenum) mode, (GL.GLint) first, (GL.GLsizei) count, (GL.GLsizei) instanceCount);
        }

        public void drawElementsInstanced(int mode, int count, int type, long offset, int instanceCount) {
            glDrawElementsInstanced((GL.GLenum) mode, (GL.GLsizei) count, (GL.GLenum) type, (GL.GLvoid*) offset, (GL.GLsizei) instanceCount);
        }

        public void vertexAttribDivisor(uint index, uint divisor) {
            glVertexAttribDivisor((GL.GLuint) index, (GL.GLuint) divisor);
        }

        public void vertexAttribIPointer(uint index, int size, int type, int stride, long offset) {
            unowned GL.GLvoid[] ptr = (GL.GLvoid[]) (void*) offset;
            glVertexAttribIPointer((GL.GLuint) index, (GL.GLint) size, (GL.GLenum) type, (GL.GLsizei) stride, ptr);
        }

        public void drawBuffers(int[] buffers) {
            GL.GLenum[] enums = new GL.GLenum[buffers.length];
            for (int i = 0; i < buffers.length; i++) {
                enums[i] = (GL.GLenum) buffers[i];
            }
            glDrawBuffers((GL.GLsizei) buffers.length, enums);
        }

        public void drawRangeElements(int mode, uint start, uint end, int count, int type, long offset) {
            unowned GL.GLvoid[] ptr = (GL.GLvoid[]) (void*) offset;
            glDrawRangeElements((GL.GLenum) mode, (GL.GLuint) start, (GL.GLuint) end, (GL.GLsizei) count, (GL.GLenum) type, ptr);
        }

        public void blitFramebuffer(int srcX0, int srcY0, int srcX1, int srcY1, int dstX0, int dstY0, int dstX1, int dstY1, int mask, int filter) {
            glBlitFramebuffer((GL.GLint) srcX0, (GL.GLint) srcY0, (GL.GLint) srcX1, (GL.GLint) srcY1, (GL.GLint) dstX0, (GL.GLint) dstY0, (GL.GLint) dstX1, (GL.GLint) dstY1, (GL.GLbitfield) mask, (GL.GLenum) filter);
        }

        public void invalidateFramebuffer(int target, int[] attachments) {
            GL.GLenum[] enums = new GL.GLenum[attachments.length];
            for (int i = 0; i < attachments.length; i++) {
                enums[i] = (GL.GLenum) attachments[i];
            }
            glInvalidateFramebuffer((GL.GLenum) target, (GL.GLsizei) attachments.length, enums);
        }

        public void invalidateSubFramebuffer(int target, int[] attachments, int x, int y, int width, int height) {
            GL.GLenum[] enums = new GL.GLenum[attachments.length];
            for (int i = 0; i < attachments.length; i++) {
                enums[i] = (GL.GLenum) attachments[i];
            }
            glInvalidateSubFramebuffer((GL.GLenum) target, (GL.GLsizei) attachments.length, enums, (GL.GLint) x, (GL.GLint) y, (GL.GLsizei) width, (GL.GLsizei) height);
        }

        public void readBuffer(int src) {
            glReadBuffer((GL.GLenum) src);
        }

        public void renderbufferStorageMultisample(int target, int samples, int internalFormat, int width, int height) {
            glRenderbufferStorageMultisample((GL.GLenum) target, (GL.GLsizei) samples, (GL.GLenum) internalFormat, (GL.GLsizei) width, (GL.GLsizei) height);
        }

        // ─── Unsigned Integer Uniforms ────────────────────────────────────────

        public void uniform1ui(int location, uint v0) {
            glUniform1ui((GL.GLint) location, (GL.GLuint) v0);
        }

        public void uniform2ui(int location, uint v0, uint v1) {
            glUniform2ui((GL.GLint) location, (GL.GLuint) v0, (GL.GLuint) v1);
        }

        public void uniform3ui(int location, uint v0, uint v1, uint v2) {
            glUniform3ui((GL.GLint) location, (GL.GLuint) v0, (GL.GLuint) v1, (GL.GLuint) v2);
        }

        public void uniform4ui(int location, uint v0, uint v1, uint v2, uint v3) {
            glUniform4ui((GL.GLint) location, (GL.GLuint) v0, (GL.GLuint) v1, (GL.GLuint) v2, (GL.GLuint) v3);
        }

        public void uniform1uiv(int location, int vLength, uint[] value) {
            glUniform1uiv((GL.GLint) location, (GL.GLsizei) vLength, (GL.GLuint[]) value);
        }

        public void uniform2uiv(int location, int vLength, uint[] value) {
            glUniform2uiv((GL.GLint) location, (GL.GLsizei) vLength, (GL.GLuint[]) value);
        }

        public void uniform3uiv(int location, int vLength, uint[] value) {
            glUniform3uiv((GL.GLint) location, (GL.GLsizei) vLength, (GL.GLuint[]) value);
        }

        public void uniform4uiv(int location, int vLength, uint[] value) {
            glUniform4uiv((GL.GLint) location, (GL.GLsizei) vLength, (GL.GLuint[]) value);
        }

        // ─── Non-square Matrix Uniforms ───────────────────────────────────────

        public void uniformMatrix2x3fv(int location, bool transpose, float[] value) {
            glUniformMatrix2x3fv((GL.GLint) location, (GL.GLsizei) (value.length / 6), (GL.GLboolean) ((uint8) transpose), value);
        }

        public void uniformMatrix3x2fv(int location, bool transpose, float[] value) {
            glUniformMatrix3x2fv((GL.GLint) location, (GL.GLsizei) (value.length / 6), (GL.GLboolean) ((uint8) transpose), value);
        }

        public void uniformMatrix2x4fv(int location, bool transpose, float[] value) {
            glUniformMatrix2x4fv((GL.GLint) location, (GL.GLsizei) (value.length / 8), (GL.GLboolean) ((uint8) transpose), value);
        }

        public void uniformMatrix4x2fv(int location, bool transpose, float[] value) {
            glUniformMatrix4x2fv((GL.GLint) location, (GL.GLsizei) (value.length / 8), (GL.GLboolean) ((uint8) transpose), value);
        }

        public void uniformMatrix3x4fv(int location, bool transpose, float[] value) {
            glUniformMatrix3x4fv((GL.GLint) location, (GL.GLsizei) (value.length / 12), (GL.GLboolean) ((uint8) transpose), value);
        }

        public void uniformMatrix4x3fv(int location, bool transpose, float[] value) {
            glUniformMatrix4x3fv((GL.GLint) location, (GL.GLsizei) (value.length / 12), (GL.GLboolean) ((uint8) transpose), value);
        }

        // ─── Uniform Blocks ───────────────────────────────────────────────────

        public uint getUniformBlockIndex(uint program, string uniformBlockName) {
            return (uint) glGetUniformBlockIndex((GL.GLuint) program, uniformBlockName);
        }

        public void uniformBlockBinding(uint program, uint uniformBlockIndex, uint uniformBlockBinding) {
            glUniformBlockBinding((GL.GLuint) program, (GL.GLuint) uniformBlockIndex, (GL.GLuint) uniformBlockBinding);
        }

        public string getActiveUniformBlockName(uint program, uint uniformBlockIndex) {
            GL.GLsizei[] length = new GL.GLsizei[1];
            GL.GLubyte[] name = new GL.GLubyte[256];
            glGetActiveUniformBlockName((GL.GLuint) program, (GL.GLuint) uniformBlockIndex, 256, length, name);
            return ((string) name).substring(0, (int) length[0]);
        }

        public int getActiveUniformBlockParameter(uint program, uint uniformBlockIndex, int pname) {
            GL.GLint[] result = new GL.GLint[1];
            glGetActiveUniformBlockiv((GL.GLuint) program, (GL.GLuint) uniformBlockIndex, (GL.GLenum) pname, result);
            return (int) result[0];
        }

        public int[] getActiveUniforms(uint program, uint[] uniformIndices, int pname) {
            GL.GLint[] result = new GL.GLint[uniformIndices.length];
            glGetActiveUniformsiv((GL.GLuint) program, (GL.GLsizei) uniformIndices.length, (GL.GLuint[]) uniformIndices, (GL.GLenum) pname, result);
            int[] output = new int[result.length];
            for (int i = 0; i < result.length; i++) {
                output[i] = (int) result[i];
            }
            return output;
        }

        // ─── Program Queries ──────────────────────────────────────────────────

        public int getFragDataLocation(uint program, string name) {
            return (int) glGetFragDataLocation((GL.GLuint) program, name);
        }

        // ─── Indexed Parameter Queries ────────────────────────────────────────

        public int getIndexedParameteri(int target, uint index) {
            GL.GLint[] result = new GL.GLint[1];
            glGetIntegeri_v((GL.GLenum) target, (GL.GLuint) index, result);
            return (int) result[0];
        }

        public int getInternalformatParameter(int target, int internalFormat, int pname) {
            GL.GLint[] result = new GL.GLint[1];
            glGetInternalformativ((GL.GLenum) target, (GL.GLenum) internalFormat, (GL.GLenum) pname, 1, result);
            return (int) result[0];
        }

        public string getStringi(int name, uint index) {
            return glGetStringi((GL.GLenum) name, (GL.GLuint) index) ?? "";
        }

        // ─── Buffer data overrides (WebGL2 adds offset parameter) ────────────

        public void bufferData2(int target, Variant variant, int usage) {
            if (!isVariantOfByteArray(variant)) {
                printerr("[bufferData2] variant type must be 'ay'!");
                return;
            }
            var bytes = variant.get_data_as_bytes();
            var size = bytes.get_size();
            glBufferData((GL.GLenum) target, (GL.GLsizeiptr) size, (GL.GLvoid[]) bytes.get_data(), (GL.GLenum) usage);
        }

        public void bufferDataSizeOnly2(int target, size_t size, int usage) {
            glBufferData((GL.GLenum) target, (GL.GLsizeiptr) size, null, (GL.GLenum) usage);
        }

        public void bufferSubData2(int target, long offset, Variant variant) {
            if (!isVariantOfByteArray(variant)) {
                printerr("[bufferSubData2] variant type must be 'ay'!");
                return;
            }
            var bytes = variant.get_data_as_bytes();
            var size = bytes.get_size();
            glBufferSubData((GL.GLenum) target, (GL.GLintptr) offset, (GL.GLsizeiptr) size, (GL.GLvoid[]) bytes.get_data());
        }
    }
}
