export class GjsifyWebGLContextAttributes implements WebGLContextAttributes {
    desynchronized?: boolean;
    powerPreference?: WebGLPowerPreference;
    constructor(
        public alpha?: boolean,
        public depth?: boolean,
        public stencil?: boolean,
        public antialias?: boolean,
        public premultipliedAlpha?: boolean,
        public preserveDrawingBuffer?: boolean,
        public preferLowPowerToHighPerformance?: boolean,
        public failIfMajorPerformanceCaveat?: boolean) {
        this.alpha = alpha
        this.depth = depth
        this.stencil = stencil
        this.antialias = antialias
        this.premultipliedAlpha = premultipliedAlpha
        this.preserveDrawingBuffer = preserveDrawingBuffer
        this.preferLowPowerToHighPerformance = preferLowPowerToHighPerformance
        this.failIfMajorPerformanceCaveat = failIfMajorPerformanceCaveat
    }
}

export { GjsifyWebGLContextAttributes as WebGLContextAttributes }