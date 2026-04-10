// AudioNode — base class for all audio graph nodes.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioNode

export class AudioNode {
    /** @internal downstream connections */
    _outputs: Set<AudioNode> = new Set();
    /** @internal upstream connections */
    _inputs: Set<AudioNode> = new Set();

    readonly numberOfInputs: number;
    readonly numberOfOutputs: number;
    readonly channelCount: number;

    constructor(numberOfInputs = 1, numberOfOutputs = 1) {
        this.numberOfInputs = numberOfInputs;
        this.numberOfOutputs = numberOfOutputs;
        this.channelCount = 2;
    }

    connect(destination: AudioNode): AudioNode {
        this._outputs.add(destination);
        destination._inputs.add(this);
        return destination;
    }

    disconnect(destination?: AudioNode): void {
        if (destination) {
            this._outputs.delete(destination);
            destination._inputs.delete(this);
        } else {
            for (const node of this._outputs) {
                node._inputs.delete(this);
            }
            this._outputs.clear();
        }
    }
}
