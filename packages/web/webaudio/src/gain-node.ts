// GainNode — controls audio volume via an AudioParam.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/GainNode

import { AudioNode } from './audio-node.js';
import { AudioParam } from './audio-param.js';
import type { GstPlayer } from './gst-player.js';

export class GainNode extends AudioNode {
    readonly gain: AudioParam;

    /** @internal active players that need volume updates */
    _activePlayers: Set<GstPlayer> = new Set();

    constructor() {
        super(1, 1);
        this.gain = new AudioParam(1, 0, 10);
        this.gain._onChange = (value) => {
            for (const player of this._activePlayers) {
                player.setVolume(value);
            }
        };
    }
}
