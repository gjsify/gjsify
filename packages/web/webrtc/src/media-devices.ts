// W3C MediaDevices for GJS.
//
// Phase 3: getUserMedia via GStreamer sources.
// Phase 4.3: enumerateDevices via GStreamer Device Monitor,
//            getSupportedConstraints returns supported constraints.
//
// Reference: W3C Media Capture and Streams spec § 10.2
// Reference: refs/webkit/Source/WebCore/platform/mediastream/gstreamer/GStreamerCaptureDeviceManager.cpp

import '@gjsify/dom-events/register/event-target';

import { ensureGstInit, Gst } from './gst-init.js';
import { getUserMedia, type MediaStreamConstraints } from './get-user-media.js';
import { MediaDeviceInfo, type MediaDeviceKind } from './media-device-info.js';
import type { MediaStream } from './media-stream.js';

/** Map GStreamer device class strings to W3C MediaDeviceKind. */
const DEVICE_CLASS_MAP: Record<string, MediaDeviceKind> = {
    'Audio/Source': 'audioinput',
    'Video/Source': 'videoinput',
    'Audio/Sink': 'audiooutput',
};

/** Whether getUserMedia has been successfully called (unlocks full device info). */
let _permissionGranted = false;

/**
 * Check if GStreamer device monitoring is safe to use.
 * On some GJS/GStreamer combinations (e.g. Fedora 44 / GJS 1.88 in Docker),
 * DeviceMonitor and DeviceProviderFactory can SIGSEGV in native code — a crash
 * that JS error handling cannot intercept. We skip device monitoring entirely
 * when DISPLAY is absent (headless/CI) since there are typically no audio/video
 * devices in containers anyway.
 */
function isDeviceMonitorSafe(): boolean {
    try {
        // Import GLib to check environment — avoid crashing GStreamer APIs
        const GLib = imports.gi.GLib;
        // Skip in CI environments or headless containers
        if (GLib.getenv('CI')) return false;
        // No display = likely a container without devices
        if (!GLib.getenv('DISPLAY') && !GLib.getenv('WAYLAND_DISPLAY')) return false;
        return true;
    } catch {
        return false;
    }
}

export class MediaDevices extends EventTarget {
    private _ondevicechange: ((ev: Event) => void) | null = null;

    get ondevicechange(): ((ev: Event) => void) | null { return this._ondevicechange; }
    set ondevicechange(v: ((ev: Event) => void) | null) { this._ondevicechange = v; }

    async getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream> {
        if (!constraints) {
            throw new TypeError(
                "Failed to execute 'getUserMedia' on 'MediaDevices': At least one of audio or video must be requested",
            );
        }
        const stream = await getUserMedia(constraints);
        _permissionGranted = true;
        return stream;
    }

    async enumerateDevices(): Promise<MediaDeviceInfo[]> {
        ensureGstInit();

        let monitor: InstanceType<typeof Gst.DeviceMonitor> | null = null;
        const result: MediaDeviceInfo[] = [];

        try {
            // Guard: on CI containers without PipeWire/PulseAudio, DeviceMonitor
            // can SIGSEGV in native GStreamer code. Check for device providers first.
            if (!isDeviceMonitorSafe()) {
                return result;
            }

            monitor = new Gst.DeviceMonitor();
            monitor.set_show_all_devices(true);
            const audioCaps = Gst.Caps.from_string('audio/x-raw');
            const videoCaps = Gst.Caps.from_string('video/x-raw');
            if (audioCaps) {
                monitor.add_filter('Audio/Source', audioCaps);
                monitor.add_filter('Audio/Sink', audioCaps);
            }
            if (videoCaps) {
                monitor.add_filter('Video/Source', videoCaps);
            }

            if (!monitor.start()) {
                // DeviceMonitor failed to start — return empty list gracefully
                return result;
            }

            let gstDevices: any[];
            try {
                gstDevices = monitor.get_devices() ?? [];
            } catch {
                // get_devices() can crash on some GStreamer/GJS versions — return empty
                return result;
            }

            for (const device of gstDevices) {
                const deviceClass = device.get_device_class?.() ?? '';
                const kind = DEVICE_CLASS_MAP[deviceClass];
                if (!kind) continue;

                const displayName = device.get_display_name?.() ?? '';
                let deviceId = '';
                let groupId = '';

                // Extract persistent-id from device properties if available
                try {
                    const props = device.get_properties?.();
                    if (props) {
                        const n = props.n_fields();
                        for (let i = 0; i < n; i++) {
                            const name = props.nth_field_name(i);
                            if (name === 'persistent-id' || name === 'node.name') {
                                const val = props.get_value(name);
                                if (val && !deviceId) deviceId = String(val);
                            }
                            if (name === 'group-id') {
                                const val = props.get_value(name);
                                if (val) groupId = String(val);
                            }
                        }
                    }
                } catch { /* properties may not be available */ }

                // Fallback deviceId from display name hash
                if (!deviceId) {
                    deviceId = displayName || `${kind}-${result.length}`;
                }

                // Per W3C: before getUserMedia permission, expose only empty
                // deviceId/label/groupId (one device per kind max).
                if (_permissionGranted) {
                    result.push(new MediaDeviceInfo({
                        deviceId,
                        kind,
                        label: displayName,
                        groupId,
                    }));
                } else {
                    // Check if we already have a device of this kind
                    if (!result.some(d => d.kind === kind)) {
                        result.push(new MediaDeviceInfo({
                            deviceId: '',
                            kind,
                            label: '',
                            groupId: '',
                        }));
                    }
                }
            }
        } catch {
            // DeviceMonitor or device enumeration crashed — return whatever we have
            return result;
        } finally {
            try { monitor?.stop(); } catch { /* ignore stop errors */ }
        }

        // W3C ordering: audioinput first, then videoinput, then audiooutput
        const order: Record<string, number> = { audioinput: 0, videoinput: 1, audiooutput: 2 };
        result.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));

        return result;
    }

    getSupportedConstraints(): Record<string, boolean> {
        return {
            deviceId: true,
            width: true,
            height: true,
            frameRate: true,
            sampleRate: true,
            channelCount: true,
            // Not yet supported — return false
            aspectRatio: false,
            facingMode: false,
            resizeMode: false,
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            latency: false,
            groupId: false,
        };
    }
}
