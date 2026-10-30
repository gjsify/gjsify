export { Gst, ensureGstInit, excludeUnboundedAutodetectCandidates } from './gst-init.js';
export {
    openCapture,
    createAudioSource,
    createVideoSource,
    bindDevice,
    isTestSource,
    buildAudioCaps,
    buildVideoCaps,
} from './capture-source.js';
export type { Capture, CaptureKind, CaptureConstraints } from './capture-source.js';
export { openPcmSource } from './pcm-source.js';
export type { PcmFormat, PcmSource, PcmSourceOptions } from './pcm-source.js';
