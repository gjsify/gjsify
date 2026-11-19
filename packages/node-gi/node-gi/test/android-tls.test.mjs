// SPDX-License-Identifier: MIT
// The pure half of android-tls.js: which modules to load, and which roots make up ADR 0134's
// Android `system` set. The device half (Gio calls) is proven in tests/integration/nativescript-gi.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractPemCertificates, gioModulesOf, mergeSystemCAs } from '../android-tls.js';

const pem = (body) => `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
// The shape of a file in /system/etc/security/cacerts: the text dump first, then the PEM.
const cacertsFile = (body) =>
    `Certificate:\n    Data:\n        Version: 3 (0x2)\n        Subject: O=Test\nSHA1 Fingerprint=00:11\n${pem(body)}\n`;

describe('gioModulesOf: what the installed runtime packages declare', () => {
    it('unions the manifests, sorted and de-duplicated', () => {
        assert.deepEqual(
            gioModulesOf([
                { package: 'core' },
                { package: 'tls', gioModules: ['libgioopenssl.so'] },
                { package: 'other', gioModules: ['libgioopenssl.so', 'libgioproxy.so'] },
            ]),
            ['libgioopenssl.so', 'libgioproxy.so'],
        );
    });

    it('is empty without a TLS add-on, so the set-up never runs', () => {
        assert.deepEqual(gioModulesOf([{ package: 'core', typelibs: ['Gio-2.0'] }]), []);
        assert.deepEqual(gioModulesOf([]), []);
    });

    it('ignores anything that is not a bare lib*.so soname', () => {
        assert.deepEqual(gioModulesOf([{ gioModules: ['../evil.so', '/abs/libx.so', 42, 'libok.so'] }]), ['libok.so']);
        assert.deepEqual(gioModulesOf([{ gioModules: 'libgioopenssl.so' }, null]), []);
    });
});

describe('extractPemCertificates: Android files carry a text dump before the PEM', () => {
    it('keeps only the PEM blocks', () => {
        assert.deepEqual(extractPemCertificates(cacertsFile('QUJD')), [pem('QUJD')]);
    });

    it('normalises CRLF and finds several blocks', () => {
        const text = `${pem('QQ==')}\r\n${pem('Qg==')}`.replace(/\n/g, '\r\n');
        assert.deepEqual(extractPemCertificates(text), [pem('QQ=='), pem('Qg==')]);
    });

    it('finds nothing in a file without a certificate', () => {
        assert.deepEqual(extractPemCertificates('Certificate:\n  no pem here\n'), []);
    });
});

describe("mergeSystemCAs: ADR 0134's Android `system` set", () => {
    const system = [
        { name: 'bbbb0000.0', text: cacertsFile('Qg==') },
        { name: 'aaaa0000.0', text: cacertsFile('QQ==') },
        { name: 'cccc0000.0', text: cacertsFile('Qw==') },
    ];

    it('is the system store, in file-name order, as one plain PEM text', () => {
        const merged = mergeSystemCAs({ system });
        assert.equal(merged.count, 3);
        assert.equal(merged.removed, 0);
        assert.equal(merged.pem, `${[pem('QQ=='), pem('Qg=='), pem('Qw==')].join('\n')}\n`);
        assert.equal(/Certificate:|Fingerprint/.test(merged.pem), false, 'no text dump survives');
    });

    it('drops the roots the user disabled, matched by file name', () => {
        const merged = mergeSystemCAs({ system, removed: ['bbbb0000.0', 'not-there.0'] });
        assert.equal(merged.count, 2);
        assert.equal(merged.removed, 1);
        assert.equal(merged.pem.includes('Qg=='), false);
    });

    it('is empty, not a lone newline, when nothing is left', () => {
        assert.deepEqual(mergeSystemCAs({ system: [] }), { pem: '', count: 0, removed: 0 });
    });
});

describe('@gjsify/gi-runtime-android-tls: the package and its builder agree', () => {
    const dir = fileURLToPath(new URL('../../gi-runtime-android-tls/', import.meta.url));

    it('the builder writes the file the package exports as manifestPath', async () => {
        const { manifestPath } = await import('../../gi-runtime-android-tls/index.js');
        const script = readFileSync(`${dir}scripts/build-gi-runtime-android-tls.mjs`, 'utf8');
        const named = /manifestName:\s*'([^']+)'/.exec(script);
        assert.ok(named);
        assert.equal(join(dir, 'platforms', 'android', named[1]), manifestPath);
        assert.match(script, /gioModules:\s*true/);
    });

    it('declares the module the sysroot ships, and the licence table attributes it', () => {
        const pkg = JSON.parse(readFileSync(`${dir}package.json`, 'utf8'));
        assert.deepEqual(pkg.gjsify.giRuntime.gioModules, ['libgioopenssl.so']);
        const table = JSON.parse(
            readFileSync(
                fileURLToPath(new URL('../../gi-runtime-android/licenses/bundled-projects.json', import.meta.url)),
                'utf8',
            ),
        );
        for (const soname of ['libgioopenssl.so', 'libssl.so', 'libcrypto.so']) {
            assert.ok(table.projects[table.libraries[soname]], `${soname} is attributed`);
        }
    });
});
