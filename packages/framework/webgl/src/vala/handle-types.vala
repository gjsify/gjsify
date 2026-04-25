namespace Gwebgl {
    using GL;

    //  public struct WebGLProgram : uint {}
    //  public struct WebGLShader : uint {}
    //  public struct WebGLBuffer : uint {}
    //  public struct WebGLFramebuffer : uint {}
    //  public struct WebGLRenderbuffer : uint {}
    //  public struct WebGLTexture : uint {}
    //  public struct WebGLUniformLocation : int {}

    public struct WebGLActiveInfo {
        public string name;
        public int size;
        public int type;
    }

    public struct WebGLShaderPrecisionFormat {
        public int precision;
        public int rangeMax;
        public int rangeMin;
    }
}