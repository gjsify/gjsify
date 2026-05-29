#!/usr/bin/env node
// Generates a deterministic self-signed TLS certificate + key pair under
// ./fixtures/ for the tls-session integration suite. The fixture pair is
// used both by Node's `https.createServer` and by GJS's `Gio.TlsServerConnection`
// (via @gjsify/tls's createServer), so we need a real PEM cert/key — not
// just a stub.
//
// Layout produced:
//   fixtures/
//     cert.pem     # X.509 cert, CN=localhost, SAN: DNS:localhost,IP:127.0.0.1
//     key.pem      # 2048-bit RSA private key (PKCS#8 PEM)
//
// Strategy: shell out to `openssl req -x509 -nodes` (one command, no config
// file needed thanks to -addext). openssl ships on every Fedora/Debian/macOS
// dev environment + every Linux GHA runner image. We deliberately do NOT
// use Node's crypto module for cert generation — `crypto.X509Certificate`
// is verify-only in Node ≤ 25; the cleanest cross-runtime "create a self-
// signed cert" recipe is the openssl CLI.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, '..', 'fixtures');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

const certPath = join(dest, 'cert.pem');
const keyPath = join(dest, 'key.pem');

try {
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-keyout',
            keyPath,
            '-out',
            certPath,
            '-days',
            '365',
            '-nodes',
            '-subj',
            '/CN=localhost',
            '-addext',
            'subjectAltName=DNS:localhost,IP:127.0.0.1',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
    );
} catch (err) {
    console.error(`[setup-fixtures] failed to invoke openssl — install openssl(1) or skip the suite.`);
    console.error(err && (err.stderr?.toString?.() ?? String(err)));
    process.exit(1);
}

if (!existsSync(certPath) || !existsSync(keyPath)) {
    console.error(`[setup-fixtures] expected ${certPath} + ${keyPath} after openssl run`);
    process.exit(1);
}

// Sanity: write a tiny manifest so consumers don't have to hardcode the
// two filenames in three places.
await writeFile(
    join(dest, 'manifest.json'),
    JSON.stringify({ cert: 'cert.pem', key: 'key.pem', subject: 'localhost' }, null, 2) + '\n',
);

console.log(`[setup-fixtures] wrote cert+key → ${dest}`);
