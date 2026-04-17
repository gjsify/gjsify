// WebTorrent local seed + download — tests @gjsify/webrtc data channels
// through a real P2P torrent transfer in a single GJS process.
//
// How it works:
//   1. Client A (seeder) seeds a small buffer as a torrent
//   2. Client B (leecher) adds the magnet URI and downloads via WebRTC
//   3. Both clients exchange data through RTCPeerConnection + RTCDataChannel
//      (provided by @gjsify/webrtc, backed by GStreamer webrtcbin)
//
// This exercises the full WebRTC stack: signaling via WebSocket tracker,
// offer/answer + ICE via RTCPeerConnection, data transfer via RTCDataChannel.
//
// Prerequisites:
//   - GStreamer ≥ 1.20 with gst-plugins-bad + libnice-gstreamer1
//   - Network access to WebSocket tracker (wss://tracker.webtorrent.dev)
//
// Run: yarn build && yarn start

import GLib from 'gi://GLib?version=2.0';
// @ts-ignore — WebTorrent types may not be available
import WebTorrent from 'webtorrent';

declare const print: ((msg: string) => void) | undefined;

function log(tag: string, msg: string): void {
    if (typeof print === 'function') {
        print(`[${tag}] ${msg}`);
    } else {
        console.log(`[${tag}] ${msg}`);
    }
}

// The payload to seed — small enough for a quick test
const SEED_DATA = new TextEncoder().encode(
    'Hello from GJS + WebTorrent + @gjsify/webrtc!\n' +
    'This data was transferred peer-to-peer via WebRTC data channels,\n' +
    'backed by GStreamer webrtcbin running in GNOME JavaScript.\n',
);
const SEED_FILENAME = 'hello-gjsify.txt';

// Use the public WebTorrent tracker for WebRTC signaling
const TRACKERS = [
    'wss://tracker.webtorrent.dev',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
];

// Global unhandled rejection handler for debugging
if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('unhandledrejection', (ev: any) => {
        const reason = ev?.reason ?? ev;
        log('UNHANDLED', `${reason?.message ?? reason}`);
        if (reason?.stack) log('UNHANDLED', reason.stack);
    });
}

async function main(): Promise<void> {
    log('main', 'Starting WebTorrent seed + download demo');
    log('main', `WebRTC support: ${WebTorrent.WEBRTC_SUPPORT}`);

    if (!WebTorrent.WEBRTC_SUPPORT) {
        log('ERROR', 'WebRTC is not available! Check that @gjsify/webrtc globals are registered.');
        return;
    }

    // Common options: disable DHT/LSD/uTP (not available in GJS),
    // use only WebSocket trackers for WebRTC peer discovery.
    const clientOpts = {
        dht: false,
        lsd: false,
        utPex: false,
        utp: false,
        webSeeds: false,
        natUpnp: false,
        natPmp: false,
    };

    // ---- Seeder (Client A) ----

    const seeder = new WebTorrent(clientOpts);
    seeder.on('error', (err: Error) => log('seeder', `ERROR: ${err.message}`));
    seeder.on('warning', (err: Error) => log('seeder', `WARN: ${err.message}`));

    log('seeder', `Seeding ${SEED_DATA.byteLength} bytes as "${SEED_FILENAME}"...`);

    // Use a Buffer with a name property — WebTorrent accepts this format
    // and it avoids needing Blob.stream() which GJS doesn't support yet.
    const seedBuffer = Buffer.from(SEED_DATA);
    (seedBuffer as any).name = SEED_FILENAME;

    const torrent = await new Promise<any>((resolve, reject) => {
        const t = seeder.seed(seedBuffer, { announce: TRACKERS });

        // Listen to all key events for debugging
        for (const event of ['ready', 'metadata', 'infoHash', 'listening', 'done']) {
            t.on(event, () => log('seeder', `event: ${event}`));
        }

        t.on('ready', () => {
            log('seeder', `Torrent ready! infoHash: ${t.infoHash}`);
            log('seeder', `Magnet: ${t.magnetURI.slice(0, 80)}...`);
            resolve(t);
        });

        t.on('error', (err: Error) => {
            log('seeder', `Torrent error: ${err.message}`);
            if ((err as any).stack) log('seeder', `Stack: ${(err as any).stack}`);
            reject(err);
        });

        t.on('warning', (err: Error) => log('seeder', `Torrent warn: ${err.message}`));

        setTimeout(() => {
            log('seeder', `Timeout state: destroyed=${t.destroyed}, ready=${t.ready}, infoHash=${t.infoHash ?? 'none'}, numPeers=${t.numPeers}`);
            reject(new Error('Seed timeout (30s)'));
        }, 30000);
    });

    log('seeder', `Peers: ${torrent.numPeers}, uploaded: ${torrent.uploaded} bytes`);

    // ---- Leecher (Client B) ----

    const leecher = new WebTorrent(clientOpts);
    leecher.on('error', (err: Error) => log('leecher', `ERROR: ${err.message}`));
    leecher.on('warning', (err: Error) => log('leecher', `WARN: ${err.message}`));

    log('leecher', 'Adding magnet URI...');

    const downloaded = await new Promise<any>((resolve, reject) => {
        const dl = leecher.add(torrent.magnetURI, { announce: TRACKERS });

        dl.on('metadata', () => {
            log('leecher', `Metadata received! ${dl.files.length} file(s)`);
        });

        dl.on('wire', () => {
            log('leecher', `Connected to peer (total: ${dl.numPeers})`);
        });

        dl.on('download', (bytes: number) => {
            const pct = (dl.progress * 100).toFixed(1);
            log('leecher', `Downloaded ${bytes} bytes (${pct}% complete)`);
        });

        dl.on('warning', (err: Error) => log('leecher', `Torrent warn: ${err.message}`));

        dl.on('done', async () => {
            log('leecher', 'Download complete!');
            try {
                const file = dl.files[0];
                const buf = await file.arrayBuffer();
                const text = new TextDecoder().decode(buf);
                log('leecher', `File: "${file.name}" (${file.length} bytes)`);
                log('leecher', `Content:\n${text}`);

                // Verify content matches what was seeded
                const original = new TextDecoder().decode(SEED_DATA);
                if (text === original) {
                    log('main', 'SUCCESS — Downloaded content matches seeded data!');
                } else {
                    log('main', 'MISMATCH — Content does not match!');
                }
                resolve(dl);
            } catch (err: any) {
                reject(err);
            }
        });

        dl.on('error', (err: Error) => {
            log('leecher', `Torrent error: ${err.message}`);
            reject(err);
        });

        // Timeout after 60 seconds
        setTimeout(() => {
            if (dl.progress < 1) {
                log('leecher', `Timeout — ${(dl.progress * 100).toFixed(1)}% complete, ${dl.numPeers} peers`);
                reject(new Error(`Download timeout — ${dl.numPeers} peers`));
            }
        }, 60000);
    });

    // ---- Cleanup ----

    log('main', 'Cleaning up...');

    await new Promise<void>((resolve) => {
        seeder.destroy(() => {
            log('seeder', 'Destroyed');
            resolve();
        });
    });

    await new Promise<void>((resolve) => {
        leecher.destroy(() => {
            log('leecher', 'Destroyed');
            resolve();
        });
    });

    log('main', 'Demo complete!');
}

const loop = GLib.MainLoop.new(null, false);

main()
    .then(() => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    })
    .catch((err: any) => {
        log('ERROR', err?.message ?? String(err));
        if (err?.stack) log('STACK', err.stack);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    });

loop.run();
