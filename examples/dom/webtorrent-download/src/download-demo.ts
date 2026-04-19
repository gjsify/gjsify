// WebTorrent download demo — download a torrent seeded by a local peer.
//
// Creates a seeder that hosts a multi-file torrent, then a leecher that
// downloads it, logging per-file progress, peer count, and transfer speed.
// Demonstrates WebTorrent's download events and file API on GJS.

// @ts-ignore — WebTorrent types may not be available
import WebTorrent from 'webtorrent';
import type { TorrentFile } from 'webtorrent';

// arrayBuffer() exists at runtime but is missing from @types/webtorrent
interface TorrentFileWithBuffer extends TorrentFile {
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type LogFn = (tag: string, msg: string) => void;

// Multiple files to seed — demonstrates multi-file torrent handling
const FILES = [
    { name: 'readme.txt', content: 'WebTorrent multi-file download demo.\nTransferred via WebRTC data channels.\n' },
    { name: 'data.json', content: JSON.stringify({ framework: 'gjsify', transport: 'WebRTC', peers: 2 }, null, 2) + '\n' },
    { name: 'notes/hello.md', content: '# Hello\n\nThis file lives in a subdirectory inside the torrent.\n' },
];

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

function formatSpeed(bytesPerSec: number): string {
    return `${formatBytes(bytesPerSec)}/s`;
}

export async function runDownloadDemo(log: LogFn): Promise<void> {
    log('main', 'Starting WebTorrent multi-file download demo');
    log('main', `WebRTC support: ${WebTorrent.WEBRTC_SUPPORT}`);

    if (!WebTorrent.WEBRTC_SUPPORT) {
        log('ERROR', 'WebRTC is not available — cannot run demo');
        return;
    }

    // ---- Seeder ----

    const seeder = new WebTorrent(CLIENT_OPTS);
    seeder.on('error', (err: Error) => log('seeder', `ERROR: ${err.message}`));

    // Cast to Buffer[] — Buffer is always available in GJS; File is the browser fallback.
    // Mixed (Buffer | File)[] doesn't match WebTorrent's seed() overloads.
    const seedInputs = FILES.map(f => {
        const data = new TextEncoder().encode(f.content);
        return typeof Buffer !== 'undefined'
            ? Object.assign(Buffer.from(data), { name: f.name })
            : new File([data], f.name, { type: 'text/plain' });
    }) as Buffer[];

    log('seeder', `Seeding ${FILES.length} files...`);

    const torrent = await new Promise<any>((resolve, reject) => {
        const t = seeder.seed(seedInputs, { announce: TRACKERS });
        t.on('ready', () => {
            log('seeder', `Torrent ready — ${t.files.length} files, ${formatBytes(t.length)}`);
            log('seeder', `infoHash: ${t.infoHash}`);
            for (const f of t.files) {
                log('seeder', `  ${f.path} (${formatBytes(f.length)})`);
            }
            resolve(t);
        });
        t.on('error', reject);
        setTimeout(() => reject(new Error('Seed timeout (30s)')), 30000);
    });

    // ---- Leecher ----

    const leecher = new WebTorrent(CLIENT_OPTS);
    leecher.on('error', (err: Error) => log('leecher', `ERROR: ${err.message}`));

    log('leecher', 'Adding magnet URI...');

    await new Promise<void>((resolve, reject) => {
        const dl = leecher.add(torrent.magnetURI, { announce: TRACKERS });

        dl.on('metadata', () => {
            log('leecher', `Metadata received — ${dl.files.length} files, ${formatBytes(dl.length)}`);
            for (const f of dl.files) {
                log('leecher', `  ${f.path} (${formatBytes(f.length)})`);
            }
        });

        dl.on('wire', () => {
            log('leecher', `Peer connected (total: ${dl.numPeers})`);
        });

        let lastLog = 0;
        dl.on('download', () => {
            const now = Date.now();
            // Throttle progress logs to every 200ms
            if (now - lastLog < 200) return;
            lastLog = now;

            const pct = (dl.progress * 100).toFixed(1);
            const down = formatBytes(dl.downloaded);
            const speed = formatSpeed(dl.downloadSpeed);
            const peers = dl.numPeers;

            // Per-file progress
            const fileProgress = dl.files
                .map((f: any) => `${f.name}: ${(f.progress * 100).toFixed(0)}%`)
                .join(', ');

            log('leecher', `${pct}% (${down}) @ ${speed} | ${peers} peer(s) | ${fileProgress}`);
        });

        dl.on('done', async () => {
            log('leecher', `Download complete — ${formatBytes(dl.downloaded)} total`);

            // Verify each file
            let allMatch = true;
            for (let i = 0; i < dl.files.length; i++) {
                const file = dl.files[i] as TorrentFileWithBuffer;
                const buf = await file.arrayBuffer();
                const text = new TextDecoder().decode(buf);
                const expected = FILES.find(f => file.path.endsWith(f.name));

                if (expected && text === expected.content) {
                    log('verify', `${file.name} — OK`);
                } else {
                    log('verify', `${file.name} — MISMATCH`);
                    allMatch = false;
                }
            }

            log('main', allMatch ? 'SUCCESS — All files verified!' : 'FAILURE — Some files did not match');
            resolve();
        });

        dl.on('error', reject);
        setTimeout(() => {
            if (dl.progress < 1) reject(new Error(`Download timeout — ${dl.numPeers} peers, ${(dl.progress * 100).toFixed(1)}%`));
        }, 60000);
    });

    // Cleanup
    log('main', 'Cleaning up...');
    await new Promise<void>((r) => seeder.destroy(() => r()));
    await new Promise<void>((r) => leecher.destroy(() => r()));
    log('main', 'Done!');
}
