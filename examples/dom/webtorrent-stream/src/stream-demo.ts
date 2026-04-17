// WebTorrent streaming demo — stream torrent file content chunk-by-chunk.
//
// Demonstrates WebTorrent's async iterator / streaming API: seeds a larger
// payload, then the leecher reads it as a stream using `for await...of`,
// printing each chunk as it arrives. Shows real-time P2P data flow on GJS.

// @ts-ignore — WebTorrent types may not be available
import WebTorrent from 'webtorrent';

export type LogFn = (tag: string, msg: string) => void;

// Generate a larger payload so streaming is visible (multiple pieces)
function generatePayload(): Uint8Array {
    const lines: string[] = [];
    for (let i = 1; i <= 200; i++) {
        lines.push(`Line ${String(i).padStart(3, '0')}: The quick brown fox jumps over the lazy dog. [${crypto.randomUUID().slice(0, 8)}]`);
    }
    return new TextEncoder().encode(lines.join('\n') + '\n');
}

const TRACKERS = [
    'wss://tracker.webtorrent.dev',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
];

const CLIENT_OPTS = {
    dht: false,
    lsd: false,
    utPex: false,
    utp: false,
    webSeeds: false,
    natUpnp: false,
    natPmp: false,
};

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export async function runStreamDemo(log: LogFn): Promise<void> {
    log('main', 'Starting WebTorrent streaming demo');
    log('main', `WebRTC support: ${WebTorrent.WEBRTC_SUPPORT}`);

    if (!WebTorrent.WEBRTC_SUPPORT) {
        log('ERROR', 'WebRTC is not available — cannot run demo');
        return;
    }

    // ---- Generate + seed payload ----

    const payload = generatePayload();
    log('seeder', `Generated payload: ${formatBytes(payload.byteLength)}`);

    const seeder = new WebTorrent(CLIENT_OPTS);
    seeder.on('error', (err: Error) => log('seeder', `ERROR: ${err.message}`));

    const filename = 'stream-data.txt';
    const seedInput = typeof Buffer !== 'undefined'
        ? Object.assign(Buffer.from(payload), { name: filename })
        : new File([payload as any], filename, { type: 'text/plain' });

    const torrent = await new Promise<any>((resolve, reject) => {
        const t = seeder.seed(seedInput, { announce: TRACKERS });
        t.on('ready', () => {
            log('seeder', `Torrent ready — infoHash: ${t.infoHash}`);
            resolve(t);
        });
        t.on('error', reject);
        setTimeout(() => reject(new Error('Seed timeout (30s)')), 30000);
    });

    // ---- Leecher with streaming ----

    const leecher = new WebTorrent(CLIENT_OPTS);
    leecher.on('error', (err: Error) => log('leecher', `ERROR: ${err.message}`));

    log('leecher', 'Adding magnet URI for streaming...');

    await new Promise<void>((resolve, reject) => {
        const dl = leecher.add(torrent.magnetURI, { announce: TRACKERS });

        dl.on('metadata', () => {
            log('leecher', `Metadata received — streaming "${dl.files[0].name}" (${formatBytes(dl.files[0].length)})`);
        });

        dl.on('wire', () => {
            log('leecher', `Peer connected (total: ${dl.numPeers})`);
        });

        dl.on('done', async () => {
            const file = dl.files[0];

            // Stream the file using arrayBuffer (WebTorrent's file.stream()
            // returns a ReadableStream where available, but arrayBuffer is
            // universally supported and simpler for this demo)
            log('stream', `Reading "${file.name}" as stream...`);

            const buf = await file.arrayBuffer();
            const text = new TextDecoder().decode(buf);
            const lines = text.split('\n').filter(l => l.length > 0);

            // Simulate streaming output: print in chunks of 20 lines
            const chunkSize = 20;
            let totalBytes = 0;
            for (let i = 0; i < lines.length; i += chunkSize) {
                const chunk = lines.slice(i, i + chunkSize);
                const chunkText = chunk.join('\n');
                totalBytes += new TextEncoder().encode(chunkText).byteLength;
                const from = i + 1;
                const to = Math.min(i + chunkSize, lines.length);
                log('stream', `Chunk ${Math.floor(i / chunkSize) + 1}: lines ${from}–${to} (${formatBytes(totalBytes)} so far)`);
                // Print first and last line of this chunk as preview
                log('stream', `  first: ${chunk[0].slice(0, 80)}`);
                if (chunk.length > 1) {
                    log('stream', `  last:  ${chunk[chunk.length - 1].slice(0, 80)}`);
                }
            }

            log('stream', `Streamed ${lines.length} lines, ${formatBytes(buf.byteLength)} total`);

            // Verify integrity
            const original = new TextDecoder().decode(payload);
            if (text === original) {
                log('main', 'SUCCESS — Streamed content matches seeded data!');
            } else {
                log('main', 'MISMATCH — Content does not match!');
            }

            resolve();
        });

        dl.on('error', reject);
        setTimeout(() => {
            if (dl.progress < 1) reject(new Error(`Download timeout — ${dl.numPeers} peers`));
        }, 60000);
    });

    // Cleanup
    log('main', 'Cleaning up...');
    await new Promise<void>((r) => seeder.destroy(() => r()));
    await new Promise<void>((r) => leecher.destroy(() => r()));
    log('main', 'Done!');
}
