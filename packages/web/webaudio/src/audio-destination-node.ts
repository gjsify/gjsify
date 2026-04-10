// AudioDestinationNode — represents the final audio output (speakers).
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioDestinationNode

import { AudioNode } from './audio-node.js';

export class AudioDestinationNode extends AudioNode {
    readonly maxChannelCount = 2;

    constructor() {
        super(1, 0); // 1 input, 0 outputs (terminal node)
    }
}
