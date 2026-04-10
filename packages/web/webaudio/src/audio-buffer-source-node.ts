// AudioBufferSourceNode — single-use audio playback node backed by GStreamer.
//
// W3C spec: each source node can only be started once. Excalibur creates a new
// AudioBufferSourceNode for every play via _createNewBufferSource().
//
// Audio graph: AudioBufferSourceNode → GainNode → AudioDestinationNode
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode

import { AudioNode } from './audio-node.js';
import { AudioParam } from './audio-param.js';
import { GstPlayer } from './gst-player.js';
import { GainNode } from './gain-node.js';
import type { AudioBuffer } from './audio-buffer.js';

export class AudioBufferSourceNode extends AudioNode {
    buffer: AudioBuffer | null = null;
    loop = false;
    loopStart = 0;
    loopEnd = 0;
    readonly playbackRate: AudioParam;
    onended: (() => void) | null = null;

    private _player: GstPlayer | null = null;
    private _started = false;

    constructor() {
        super(0, 1); // 0 inputs (source node), 1 output
        this.playbackRate = new AudioParam(1, 0.0625, 16);
    }

    start(when = 0, offset = 0, duration?: number): void {
        if (this._started) {
            throw new DOMException('AudioBufferSourceNode can only be started once', 'InvalidStateError');
        }
        this._started = true;

        if (!this.buffer) return;

        // Walk connection chain to find GainNode and its volume
        const gainNode = this._findGainNode();
        const volume = gainNode ? gainNode.gain.value : 1;

        this._player = new GstPlayer({
            audioBuffer: this.buffer,
            volume,
            loop: this.loop,
            offset,
            duration,
            playbackRate: this.playbackRate.value,
            onEnded: () => {
                // Unregister from GainNode
                if (gainNode) {
                    gainNode._activePlayers.delete(this._player!);
                }
                this._player = null;
                this.onended?.();
            },
        });

        // Register with GainNode for live volume updates
        if (gainNode && this._player) {
            gainNode._activePlayers.add(this._player);
        }
    }

    stop(_when = 0): void {
        if (this._player) {
            this._player.stop();
        }
    }

    /** Walk the output chain to find a GainNode */
    private _findGainNode(): GainNode | null {
        for (const node of this._outputs) {
            if (node instanceof GainNode) return node;
            // Check one level deeper (in case of intermediary nodes)
            for (const inner of node._outputs) {
                if (inner instanceof GainNode) return inner;
            }
        }
        return null;
    }
}
