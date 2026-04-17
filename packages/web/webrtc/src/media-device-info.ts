// W3C MediaDeviceInfo for GJS — backed by GStreamer Device Monitor.
//
// Reference: W3C Media Capture and Streams spec § 10.2.1

export type MediaDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';

export class MediaDeviceInfo {
    readonly deviceId: string;
    readonly kind: MediaDeviceKind;
    readonly label: string;
    readonly groupId: string;

    constructor(init: {
        deviceId: string;
        kind: MediaDeviceKind;
        label: string;
        groupId?: string;
    }) {
        this.deviceId = init.deviceId;
        this.kind = init.kind;
        this.label = init.label;
        this.groupId = init.groupId ?? '';
    }

    toJSON(): object {
        return {
            deviceId: this.deviceId,
            kind: this.kind,
            label: this.label,
            groupId: this.groupId,
        };
    }
}
