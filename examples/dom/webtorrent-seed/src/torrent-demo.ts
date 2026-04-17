// WebTorrent local seed + download — platform-agnostic shared logic.
//
// Client A seeds a small buffer as a torrent, Client B downloads it via
// the magnet URI. Both clients discover each other through WebSocket
// trackers and transfer data via WebRTC data channels.
//
// Works identically in browser (native WebRTC) and GJS (@gjsify/webrtc).

// @ts-ignore — WebTorrent types may not be available
import WebTorrent from 'webtorrent';

export type LogFn = (tag: string, msg: string) => void;

// The payload to seed — small enough for a quick test
const SEED_DATA = new TextEncoder().encode(
    'Hello from WebTorrent + WebRTC!\n' +
    'This data was transferred peer-to-peer via WebRTC data channels.\n',
);
const SEED_FILENAME = 'hello-gjsify.txt';

// Public WebTorrent trackers for WebRTC signaling
const TRACKERS = [
    'wss://tracker.webtorrent.dev',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
];

// Common options: disable Node.js-only transports
const CLIENT_OPTS = {
    dht: false,
    lsd: false,
    utPex: false,
    utp: false,
    webSeeds: false,
    natUpnp: false,
    natPmp: false,
};

export async function runTorrentDemo(log: LogFn): Promise<void> {
    log('main', 'Starting WebTorrent seed + download demo');
    log('main', `WebRTC support: ${WebTorrent.WEBRTC_SUPPORT}`);

    if (!WebTorrent.WEBRTC_SUPPORT) {
        log('ERROR', 'WebRTC is not available!');
        return;
    }

    // ---- Seeder (Client A) ----

    const seeder = new WebTorrent(CLIENT_OPTS);
    seeder.on('error', (err: Error) => log('seeder', `ERROR: ${err.message}`));
    seeder.on('warning', (err: Error) => log('seeder', `WARN: ${err.message}`));

    log('seeder', `Seeding ${SEED_DATA.byteLength} bytes as "${SEED_FILENAME}"...`);

    // Use Buffer with name property (avoids Blob.stream() which GJS lacks)
    const seedInput = typeof Buffer !== 'undefined'
        ? Object.assign(Buffer.from(SEED_DATA), { name: SEED_FILENAME })
        : new File([SEED_DATA], SEED_FILENAME, { type: 'text/plain' });

    const torrent = await new Promise<any>((resolve, reject) => {
        const t = seeder.seed(seedInput, { announce: TRACKERS });

        t.on('ready', () => {
            log('seeder', `Torrent ready! infoHash: ${t.infoHash}`);
            log('seeder', `Magnet: ${t.magnetURI.slice(0, 80)}...`);
            resolve(t);
        });

        t.on('error', (err: Error) => {
            log('seeder', `Torrent error: ${err.message}`);
            reject(err);
        });

        t.on('warning', (err: Error) => log('seeder', `Torrent warn: ${err.message}`));
        setTimeout(() => reject(new Error('Seed timeout (30s)')), 30000);
    });

    log('seeder', `Peers: ${torrent.numPeers}`);

    // ---- Leecher (Client B) ----

    const leecher = new WebTorrent(CLIENT_OPTS);
    leecher.on('error', (err: Error) => log('leecher', `ERROR: ${err.message}`));
    leecher.on('warning', (err: Error) => log('leecher', `WARN: ${err.message}`));

    log('leecher', 'Adding magnet URI...');

    await new Promise<void>((resolve, reject) => {
        const dl = leecher.add(torrent.magnetURI, { announce: TRACKERS });

        dl.on('metadata', () => log('leecher', `Metadata received! ${dl.files.length} file(s)`));
        dl.on('wire', () => log('leecher', `Connected to peer (total: ${dl.numPeers})`));
        dl.on('download', (bytes: number) => {
            log('leecher', `Downloaded ${bytes} bytes (${(dl.progress * 100).toFixed(1)}%)`);
        });
        dl.on('warning', (err: Error) => log('leecher', `WARN: ${err.message}`));

        dl.on('done', async () => {
            log('leecher', 'Download complete!');
            try {
                const file = dl.files[0];
                const buf = await file.arrayBuffer();
                const text = new TextDecoder().decode(buf);
                log('leecher', `File: "${file.name}" (${file.length} bytes)`);
                log('leecher', `Content:\n${text}`);

                const original = new TextDecoder().decode(SEED_DATA);
                if (text === original) {
                    log('main', 'SUCCESS — Downloaded content matches seeded data!');
                } else {
                    log('main', 'MISMATCH — Content does not match!');
                }
                resolve();
            } catch (err: any) {
                reject(err);
            }
        });

        dl.on('error', (err: Error) => reject(err));
        setTimeout(() => {
            if (dl.progress < 1) reject(new Error(`Download timeout — ${dl.numPeers} peers`));
        }, 60000);
    });

    // Cleanup
    log('main', 'Cleaning up...');
    await new Promise<void>((r) => seeder.destroy(() => r()));
    await new Promise<void>((r) => leecher.destroy(() => r()));
    log('main', 'Demo complete!');
}
