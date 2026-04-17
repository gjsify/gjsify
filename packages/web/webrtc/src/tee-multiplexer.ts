// GStreamer tee element manager for multi-PC fan-out.
//
// When a single MediaStreamTrack (backed by a GStreamer source) needs to
// feed multiple RTCPeerConnections, a tee element is inserted after the
// source. Each PC gets its own branch (encoder chain → webrtcbin sink).
//
// Reference: refs/node-gst-webrtc/src/media/TeeMultiplexer.ts (ISC)
// Reference: packages/web/webrtc-native/src/vala/receiver-bridge.vala (tee pattern)

import { Gst } from './gst-init.js';

/**
 * Manages a GStreamer `tee` element that fans out one source to multiple
 * consumer branches. Each branch gets its own src pad from the tee.
 */
export class TeeMultiplexer {
    private _tee: any; // Gst.Element
    private _pipeline: any; // Gst.Pipeline
    private _branchCount = 0;

    /**
     * Create a tee in the given pipeline and link it to the source's output.
     * The source must already be in the pipeline.
     */
    constructor(pipeline: any, source: any) {
        this._pipeline = pipeline;
        this._tee = Gst.ElementFactory.make('tee', null)!;
        (this._tee as any).allow_not_linked = true;

        pipeline.add(this._tee);
        this._tee.sync_state_with_parent();

        // Link source → tee
        source.link(this._tee);
    }

    /** Request a new src pad from the tee for a consumer branch. */
    requestSrcPad(): any /* Gst.Pad */ {
        const padName = 'src_%u';
        const srcPad = this._tee.request_pad_simple
            ? this._tee.request_pad_simple(padName)
            : this._tee.get_request_pad(padName);
        if (srcPad) this._branchCount++;
        return srcPad;
    }

    /**
     * Release a branch's src pad from the tee.
     * Adds a DROP probe before unlinking to prevent errors.
     */
    releaseSrcPad(srcPad: any): void {
        if (!srcPad) return;
        try {
            // Block data on the pad before unlinking
            srcPad.add_probe(
                Gst.PadProbeType.BLOCK_DOWNSTREAM,
                () => Gst.PadProbeReturn.DROP,
            );
        } catch { /* ignore if probe fails */ }
        try {
            const peer = srcPad.get_peer();
            if (peer) srcPad.unlink(peer);
        } catch { /* ignore */ }
        try {
            this._tee.release_request_pad(srcPad);
        } catch { /* ignore */ }
        this._branchCount--;
    }

    /** Number of active branches. */
    get branchCount(): number { return this._branchCount; }

    /** The tee element (for pipeline queries). */
    get element(): any { return this._tee; }
}
