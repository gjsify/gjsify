export interface WebGLContextAttributeOptions {
    alpha?: boolean;
    depth?: boolean;
    stencil?: boolean;
    antialias?: boolean;
    premultipliedAlpha?: boolean;
    preserveDrawingBuffer?: boolean;
    preferLowPowerToHighPerformance?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    desynchronized?: boolean;
    powerPreference?: WebGLPowerPreference;
}