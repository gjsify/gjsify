// Web platform standards coverage: a curated inventory of ~60 relevant W3C/WHATWG
// standards mapped against the `@gjsify/web-*` and supporting packages.
//
// Status tiers:
//   full         — reaches every consumer-facing surface
//   partial      — core works; subsystems missing or behind a fallback
//   missing      — in scope but not implemented yet (roadmap)
//   out-of-scope — doesn't apply to desktop GTK apps; counts against the total,
//                  but is excluded from the roadmap

export type StandardStatus = 'full' | 'partial' | 'missing' | 'out-of-scope';

export interface WebStandard {
    name: string;
    status: StandardStatus;
    /** Backing `@gjsify/<x>` package(s); absent for missing/out-of-scope entries. */
    pkg?: string;
    /** One-liner explaining out-of-scope decisions or partial gaps */
    note?: string;
}

export interface WebStandardCategory {
    name: string;
    standards: readonly WebStandard[];
}

export const webStandardsCategories: readonly WebStandardCategory[] = [
    {
        name: 'Networking',
        standards: [
            { name: 'Fetch', status: 'full', pkg: '@gjsify/fetch' },
            { name: 'XMLHttpRequest', status: 'full', pkg: '@gjsify/xmlhttprequest' },
            { name: 'WebSocket', status: 'full', pkg: '@gjsify/websocket' },
            { name: 'Server-Sent Events', status: 'full', pkg: '@gjsify/eventsource' },
            { name: 'WebRTC', status: 'full', pkg: '@gjsify/webrtc' },
        ],
    },
    {
        name: 'Storage',
        standards: [
            { name: 'Web Storage', status: 'full', pkg: '@gjsify/webstorage', note: 'localStorage + sessionStorage' },
            { name: 'IndexedDB', status: 'missing', note: 'libgda could back' },
            { name: 'Cookie Store API', status: 'missing' },
            { name: 'Cache API', status: 'out-of-scope', note: 'Service Worker companion' },
            {
                name: 'Origin Private File System',
                status: 'out-of-scope',
                note: 'Browser sandbox; GTK uses Gio.File directly',
            },
        ],
    },
    {
        name: 'Streams & Encoding',
        standards: [
            { name: 'Streams (Readable/Writable/Transform)', status: 'full', pkg: '@gjsify/web-streams' },
            { name: 'Queuing Strategies', status: 'full', pkg: '@gjsify/web-streams' },
            { name: 'Compression Streams', status: 'full', pkg: '@gjsify/compression-streams' },
            { name: 'Encoding (TextEncoder/Decoder)', status: 'full', pkg: '@gjsify/node-globals' },
            { name: 'TextEncoderStream / TextDecoderStream', status: 'full', pkg: '@gjsify/web-streams' },
        ],
    },
    {
        name: 'Crypto',
        standards: [{ name: 'Web Crypto', status: 'full', pkg: '@gjsify/webcrypto' }],
    },
    {
        name: 'Events & Async',
        standards: [
            { name: 'DOM Events (Event/EventTarget/CustomEvent)', status: 'full', pkg: '@gjsify/dom-events' },
            { name: 'DOMException', status: 'full', pkg: '@gjsify/dom-exception' },
            { name: 'AbortController / AbortSignal', status: 'full', pkg: '@gjsify/abort-controller' },
            { name: 'Channel Messaging (MessageChannel)', status: 'full', pkg: '@gjsify/message-channel' },
            {
                name: 'Prioritized Task Scheduling',
                status: 'missing',
                note: 'scheduler.postTask — GLib idle could back',
            },
        ],
    },
    {
        name: 'Workers',
        standards: [
            {
                name: 'Web Workers',
                status: 'partial',
                pkg: '@gjsify/worker_threads',
                note: 'file-based; no DOM-Worker shim',
            },
            { name: 'BroadcastChannel', status: 'full', pkg: '@gjsify/worker_threads' },
            { name: 'SharedWorker', status: 'out-of-scope', note: 'Browser multi-tab concept' },
            { name: 'Service Workers', status: 'out-of-scope', note: 'HTTP cache proxy — irrelevant for GTK apps' },
        ],
    },
    {
        name: 'Multimedia',
        standards: [
            {
                name: 'Web Audio',
                status: 'partial',
                pkg: '@gjsify/webaudio',
                note: 'Phase 1: AudioContext + Source + Gain',
            },
            { name: 'MediaDevices / getUserMedia', status: 'full', pkg: '@gjsify/webrtc' },
            { name: 'Canvas 2D', status: 'full', pkg: '@gjsify/canvas2d-core' },
            { name: 'WebGL / WebGL2', status: 'full', pkg: '@gjsify/webgl' },
            { name: 'MediaRecorder', status: 'missing', note: 'GStreamer encodebin could back' },
            { name: 'WebGPU', status: 'missing', note: 'no GNOME backend yet — multi-year effort' },
            { name: 'Web MIDI', status: 'out-of-scope', note: 'Native apps use ALSA/JACK directly' },
        ],
    },
    {
        name: 'DOM & UI',
        standards: [
            { name: 'DOM (Document/Element/Node)', status: 'full', pkg: '@gjsify/dom-elements' },
            { name: 'HTML Elements (HTMLElement family)', status: 'full', pkg: '@gjsify/dom-elements' },
            { name: 'DOMParser', status: 'full', pkg: '@gjsify/domparser' },
            { name: 'Mutation/Resize/IntersectionObserver', status: 'full', pkg: '@gjsify/dom-elements' },
            {
                name: 'Custom Elements + Shadow DOM',
                status: 'missing',
                note: 'Needed for Adwaita component composition',
            },
            { name: 'XMLSerializer', status: 'missing' },
            { name: 'View Transitions', status: 'out-of-scope', note: 'Browser render-pipeline specific' },
            { name: 'Web Animations API', status: 'missing' },
        ],
    },
    {
        name: 'Input & Devices',
        standards: [
            { name: 'Pointer/Mouse/Keyboard Events', status: 'full', pkg: '@gjsify/dom-events' },
            { name: 'Gamepad', status: 'full', pkg: '@gjsify/gamepad' },
            { name: 'Pointer Lock', status: 'missing', note: 'Gdk.Seat.grab could back' },
            { name: 'Web Bluetooth', status: 'out-of-scope', note: 'GTK apps use BlueZ directly' },
            {
                name: 'Web USB / Serial / HID / NFC',
                status: 'out-of-scope',
                note: 'Native apps use libusb/udev directly',
            },
        ],
    },
    {
        name: 'Files & Data',
        standards: [
            { name: 'Blob / File', status: 'full', pkg: '@gjsify/buffer' },
            { name: 'FormData', status: 'full', pkg: '@gjsify/formdata' },
            { name: 'URL / URLSearchParams', status: 'full', pkg: '@gjsify/url' },
            { name: 'FileReader', status: 'missing', note: 'Trivial via Blob+streams' },
            { name: 'File System Access API', status: 'out-of-scope', note: 'GTK uses Gio.File directly' },
        ],
    },
    {
        name: 'Performance & Compute',
        standards: [
            { name: 'Performance API', status: 'full', pkg: '@gjsify/perf_hooks' },
            { name: 'WebAssembly', status: 'full', pkg: '@gjsify/webassembly' },
            { name: 'structuredClone', status: 'full', pkg: '@gjsify/node-globals' },
        ],
    },
    {
        name: 'Notifications, Geo, Permissions',
        standards: [
            { name: 'Notifications API', status: 'missing', note: 'Gio.Notification candidate' },
            { name: 'Geolocation', status: 'missing', note: 'GeoClue2 + consent dialog' },
            { name: 'Permissions API', status: 'missing' },
        ],
    },
    {
        name: 'Modern / Experimental',
        standards: [
            { name: 'Web Locks', status: 'missing', note: 'GLib.Mutex async wrapper' },
            { name: 'URLPattern', status: 'missing' },
            { name: 'Background Sync / Push', status: 'out-of-scope', note: 'Service Worker tier' },
        ],
    },
];

export interface CoverageTotals {
    full: number;
    partial: number;
    missing: number;
    outOfScope: number;
    /** Sum across all tiers including out-of-scope */
    total: number;
    /** Coverage = (full + partial) / total, including out-of-scope in the denominator */
    coveragePct: number;
}

export function tallyCategory(cat: WebStandardCategory): CoverageTotals {
    const t = { full: 0, partial: 0, missing: 0, outOfScope: 0 };
    for (const s of cat.standards) {
        if (s.status === 'out-of-scope') t.outOfScope++;
        else if (s.status === 'missing') t.missing++;
        else t[s.status]++;
    }
    const total = t.full + t.partial + t.missing + t.outOfScope;
    const coveragePct = total === 0 ? 0 : Math.round(((t.full + t.partial) / total) * 100);
    return { ...t, total, coveragePct };
}

export function tallyAllWebStandards(): CoverageTotals {
    const acc = { full: 0, partial: 0, missing: 0, outOfScope: 0, total: 0 };
    for (const cat of webStandardsCategories) {
        const t = tallyCategory(cat);
        acc.full += t.full;
        acc.partial += t.partial;
        acc.missing += t.missing;
        acc.outOfScope += t.outOfScope;
        acc.total += t.total;
    }
    const coveragePct = acc.total === 0 ? 0 : Math.round(((acc.full + acc.partial) / acc.total) * 100);
    return { ...acc, coveragePct };
}
