export class WebGLContextAttributes implements WebGLContextAttributes {
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
        public failIfMajorPerformanceCaveat?: boolean,
    ) {}
}
